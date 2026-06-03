#!/usr/bin/env bash
# Cognito ユーザー手動作成スクリプト
# 使い方: bash scripts/create-user.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/.env"

AWS_ARGS="--profile ${AWS_PROFILE:-okamo} --region ${AWS_REGION:-us-east-1}"

if [[ -z "${COGNITO_USER_EMAIL:-}" ]]; then
  echo "ERROR: .env の COGNITO_USER_EMAIL を設定してください。"
  exit 1
fi

if [[ -z "${COGNITO_USER_POOL_ID:-}" ]]; then
  echo "ERROR: .env の COGNITO_USER_POOL_ID を設定してください。"
  exit 1
fi

echo "Creating user: $COGNITO_USER_EMAIL in pool: $COGNITO_USER_POOL_ID"

aws cognito-idp admin-create-user \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "$COGNITO_USER_EMAIL" \
  --user-attributes \
    Name=email,Value="$COGNITO_USER_EMAIL" \
    Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  $AWS_ARGS

echo "Done. メールで仮パスワードを確認してください。"
