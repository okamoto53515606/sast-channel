#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { FrontendStack } from '../lib/frontend-stack';
import { CognitoStack } from '../lib/cognito-stack';
import { TaskStack } from '../lib/task-stack';
import { ApiStack } from '../lib/api-stack';

// プロジェクトルートの .env を読み込む
dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '210387976006',
  region: process.env.AWS_REGION || 'us-east-1',
};

// CDK context または .env からCloudFrontドメインを取得
// デプロイ順序:
//   1. cdk deploy SastFrontendStack → CLOUDFRONT_DOMAIN を .env に記入
//   2. cdk deploy SastCognitoStack --context cloudfrontDomain=xxxxx.cloudfront.net
//   3. cdk deploy SastTaskStack SastApiStack --context cloudfrontDomain=xxxxx.cloudfront.net
const cloudfrontDomain =
  (app.node.tryGetContext('cloudfrontDomain') as string | undefined) ||
  process.env.CLOUDFRONT_DOMAIN ||
  '';

const initialUserEmail = process.env.COGNITO_USER_EMAIL || '';

// ── Stack 1: S3 + CloudFront ────────────────────────────────
const frontendStack = new FrontendStack(app, 'SastFrontendStack', { env });

// ── Stack 2: Cognito (CloudFrontドメインが確定後にデプロイ) ──
const cognitoStack = new CognitoStack(app, 'SastCognitoStack', {
  env,
  cloudfrontDomain,
  initialUserEmail,
});

// ── Stack 3: ECS タスク ─────────────────────────────────────
const taskStack = new TaskStack(app, 'SastTaskStack', { env });

// ── Stack 4: Lambda Function URLs ───────────────────────────
new ApiStack(app, 'SastApiStack', {
  env,
  cloudfrontDomain,
  cognitoUserPoolId:
    (app.node.tryGetContext('cognitoUserPoolId') as string | undefined) ||
    process.env.COGNITO_USER_POOL_ID ||
    '',
  cognitoClientId:
    (app.node.tryGetContext('cognitoClientId') as string | undefined) ||
    process.env.COGNITO_CLIENT_ID ||
    '',
  ecsClusterArn: taskStack.clusterArn,
  taskDefinitionFamily: taskStack.taskDefinitionFamily,
  subnetIds: taskStack.subnetIds,
  taskSecurityGroupId: taskStack.taskSecurityGroupId,
  logGroupName: taskStack.logGroupName,
  containerName: taskStack.containerName,
});
