#!/usr/bin/env bash
# =====================================================================
# SASTちゃんねる フルデプロイスクリプト
#
# 使い方:
#   cd scripts
#   bash deploy.sh
#
# 前提:
#   - AWS CLI 設定済み (AWS_PROFILE=okamo)
#   - Docker 起動済み (ECR プッシュに必要)
#   - Node.js 22+ / npm インストール済み
#   - jq インストール済み
#   - .env の COGNITO_USER_EMAIL にメールアドレスを設定済み
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
CDK_DIR="$ROOT/cdk"
FRONTEND_DIR="$ROOT/frontend"

# .env を読み込む
set -o allexport
source "$ENV_FILE"
set +o allexport

AWS_ARGS="--profile ${AWS_PROFILE:-okamo} --region ${AWS_REGION:-us-east-1}"

echo ""
echo "======================================================"
echo " SASTちゃんねる デプロイ開始"
echo "======================================================"
echo " AWS Account: $(aws sts get-caller-identity --query Account --output text $AWS_ARGS)"
echo " Region     : ${AWS_REGION:-us-east-1}"
echo ""

# CDK 依存関係インストール
echo ">>> [CDK] 依存関係インストール..."
cd "$CDK_DIR" && npm ci --silent

# ──────────────────────────────────────────────────────────
# Step 1: SastFrontendStack → S3 + CloudFront
# ──────────────────────────────────────────────────────────
echo ""
echo ">>> [Step 1] SastFrontendStack デプロイ..."
cd "$CDK_DIR"
npx cdk deploy SastFrontendStack \
  --require-approval never \
  --outputs-file /tmp/sast-frontend-outputs.json \
  $AWS_ARGS

CLOUDFRONT_DOMAIN=$(jq -r '.SastFrontendStack.CloudFrontDomain' /tmp/sast-frontend-outputs.json)
S3_BUCKET_NAME=$(jq -r '.SastFrontendStack.S3BucketName' /tmp/sast-frontend-outputs.json)
DISTRIBUTION_ID=$(jq -r '.SastFrontendStack.DistributionId' /tmp/sast-frontend-outputs.json)

echo "  CloudFront : $CLOUDFRONT_DOMAIN"
echo "  S3 Bucket  : $S3_BUCKET_NAME"

# .env 更新
sed -i "s|^CLOUDFRONT_DOMAIN=.*|CLOUDFRONT_DOMAIN=\"$CLOUDFRONT_DOMAIN\"|" "$ENV_FILE"
sed -i "s|^S3_BUCKET_NAME=.*|S3_BUCKET_NAME=\"$S3_BUCKET_NAME\"|" "$ENV_FILE"

# ──────────────────────────────────────────────────────────
# Step 2: SastCognitoStack → User Pool
# ──────────────────────────────────────────────────────────
echo ""
echo ">>> [Step 2] SastCognitoStack デプロイ..."
cd "$CDK_DIR"
npx cdk deploy SastCognitoStack \
  --require-approval never \
  --context cloudfrontDomain="$CLOUDFRONT_DOMAIN" \
  --outputs-file /tmp/sast-cognito-outputs.json \
  $AWS_ARGS

COGNITO_USER_POOL_ID=$(jq -r '.SastCognitoStack.UserPoolId' /tmp/sast-cognito-outputs.json)
COGNITO_CLIENT_ID=$(jq -r '.SastCognitoStack.UserPoolClientId' /tmp/sast-cognito-outputs.json)
COGNITO_DOMAIN=$(jq -r '.SastCognitoStack.CognitoDomain' /tmp/sast-cognito-outputs.json)

echo "  User Pool  : $COGNITO_USER_POOL_ID"
echo "  Client ID  : $COGNITO_CLIENT_ID"

sed -i "s|^COGNITO_USER_POOL_ID=.*|COGNITO_USER_POOL_ID=\"$COGNITO_USER_POOL_ID\"|" "$ENV_FILE"
sed -i "s|^COGNITO_CLIENT_ID=.*|COGNITO_CLIENT_ID=\"$COGNITO_CLIENT_ID\"|" "$ENV_FILE"
sed -i "s|^COGNITO_DOMAIN=.*|COGNITO_DOMAIN=\"$COGNITO_DOMAIN\"|" "$ENV_FILE"

# ──────────────────────────────────────────────────────────
# Step 3: SastTaskStack + SastApiStack
# ──────────────────────────────────────────────────────────
echo ""
echo ">>> [Step 3] SastTaskStack + SastApiStack デプロイ (Docker ビルドを含む)..."
cd "$CDK_DIR"
npx cdk deploy SastTaskStack SastApiStack \
  --require-approval never \
  --context cloudfrontDomain="$CLOUDFRONT_DOMAIN" \
  --context cognitoUserPoolId="$COGNITO_USER_POOL_ID" \
  --context cognitoClientId="$COGNITO_CLIENT_ID" \
  --outputs-file /tmp/sast-api-outputs.json \
  $AWS_ARGS

RUN_TASK_URL=$(jq -r '.SastApiStack.RunTaskFunctionUrl' /tmp/sast-api-outputs.json)
GET_LOGS_URL=$(jq -r '.SastApiStack.GetLogsFunctionUrl' /tmp/sast-api-outputs.json)

echo "  run-task   : $RUN_TASK_URL"
echo "  get-logs   : $GET_LOGS_URL"

# .env に追記 (存在しなければ追加)
if grep -q '^RUN_TASK_FUNCTION_URL=' "$ENV_FILE"; then
  sed -i "s|^RUN_TASK_FUNCTION_URL=.*|RUN_TASK_FUNCTION_URL=\"$RUN_TASK_URL\"|" "$ENV_FILE"
else
  echo "" >> "$ENV_FILE"
  echo "RUN_TASK_FUNCTION_URL=\"$RUN_TASK_URL\"" >> "$ENV_FILE"
fi

if grep -q '^GET_LOGS_FUNCTION_URL=' "$ENV_FILE"; then
  sed -i "s|^GET_LOGS_FUNCTION_URL=.*|GET_LOGS_FUNCTION_URL=\"$GET_LOGS_URL\"|" "$ENV_FILE"
else
  echo "GET_LOGS_FUNCTION_URL=\"$GET_LOGS_URL\"" >> "$ENV_FILE"
fi

# ──────────────────────────────────────────────────────────
# Step 4: 初期ユーザー作成
# ──────────────────────────────────────────────────────────
echo ""
echo ">>> [Step 4] 初期ユーザー作成..."
if [[ -n "${COGNITO_USER_EMAIL:-}" ]]; then
  aws cognito-idp admin-create-user \
    --user-pool-id "$COGNITO_USER_POOL_ID" \
    --username "$COGNITO_USER_EMAIL" \
    --user-attributes \
      Name=email,Value="$COGNITO_USER_EMAIL" \
      Name=email_verified,Value=true \
    --desired-delivery-mediums EMAIL \
    $AWS_ARGS 2>/dev/null || echo "  (ユーザーは既に存在します)"
  echo "  ユーザー: $COGNITO_USER_EMAIL (メールで仮パスワードを確認してください)"
else
  echo "  COGNITO_USER_EMAIL が未設定のためスキップ。後で scripts/create-user.sh を実行してください。"
fi

# ──────────────────────────────────────────────────────────
# Step 5: フロントエンドビルド & S3 アップロード
# ──────────────────────────────────────────────────────────
echo ""
echo ">>> [Step 5] フロントエンドビルド..."
cd "$FRONTEND_DIR"
npm ci --silent

# .env.local を生成
cat > .env.local << EOF
NEXT_PUBLIC_COGNITO_DOMAIN=${COGNITO_DOMAIN}
NEXT_PUBLIC_COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}
NEXT_PUBLIC_RUN_TASK_URL=${RUN_TASK_URL}
NEXT_PUBLIC_GET_LOGS_URL=${GET_LOGS_URL}
EOF

npm run build

echo ""
echo ">>> [Step 6] S3 アップロード..."
aws s3 sync out/ "s3://$S3_BUCKET_NAME/" --delete $AWS_ARGS

echo ""
echo ">>> [Step 7] CloudFront キャッシュ無効化..."
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --profile "${AWS_PROFILE:-okamo}" 2>/dev/null || true

# ──────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo " デプロイ完了！"
echo "======================================================"
echo " URL: https://$CLOUDFRONT_DOMAIN"
echo " ログインメール: ${COGNITO_USER_EMAIL:-未設定}"
echo " ※ 初回ログイン時はメールの仮パスワードで Cognito Hosted UI にアクセスし"
echo "   パスワード変更を完了してください。"
echo "======================================================"
