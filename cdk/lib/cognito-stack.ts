import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface CognitoStackProps extends cdk.StackProps {
  /** CloudFront ドメイン (FrontendStack デプロイ後に取得) */
  cloudfrontDomain: string;
  /** 初期管理者ユーザーのメールアドレス (.env の COGNITO_USER_EMAIL) */
  initialUserEmail: string;
}

/**
 * SastCognitoStack
 *
 * リソース:
 *   - Cognito User Pool (セルフサインアップ不可、メール認証)
 *   - Cognito Hosted UI ドメイン
 *   - App Client (PKCE対応、シークレットなし)
 *
 * デプロイ後に以下を .env に記入:
 *   COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID / COGNITO_DOMAIN
 *
 * 初期ユーザー作成は scripts/create-user.sh で行う。
 */
export class CognitoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    const domainPrefix = `sast-channel-${this.account}`;

    // ── User Pool ─────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'sast-channel-pool',
      selfSignUpEnabled: false,           // 管理者のみ (AdminCreateUser で作成)
      signInAliases: { email: true },
      autoVerify: { email: true },
      mfa: cognito.Mfa.OFF,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Hosted UI ドメイン ────────────────────────────────────
    userPool.addDomain('HostedDomain', {
      cognitoDomain: { domainPrefix },
    });

    // ── App Client (PKCE / シークレットなし) ──────────────────
    const callbackBase = props.cloudfrontDomain
      ? `https://${props.cloudfrontDomain}`
      : 'http://localhost:3000';

    const client = userPool.addClient('AppClient', {
      userPoolClientName: 'sast-channel-client',
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [
          'http://localhost:3000/callback',
          `${callbackBase}/callback`,
        ],
        logoutUrls: [
          'http://localhost:3000/login',
          `${callbackBase}/login`,
        ],
      },
      // IDトークン有効期限: 1時間
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    const cognitoDomain = `${domainPrefix}.auth.${this.region}.amazoncognito.com`;

    // ── Outputs ───────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: '→ .env の COGNITO_USER_POOL_ID に設定',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: client.userPoolClientId,
      description: '→ .env の COGNITO_CLIENT_ID に設定',
    });
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: cognitoDomain,
      description: '→ .env の COGNITO_DOMAIN に設定',
    });
    if (props.initialUserEmail) {
      new cdk.CfnOutput(this, 'InitialUserEmail', {
        value: props.initialUserEmail,
        description: 'scripts/create-user.sh を実行してユーザーを作成してください',
      });
    }
  }
}
