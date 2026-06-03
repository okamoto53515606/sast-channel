import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  cloudfrontDomain: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  ecsClusterArn: string;
  /** タスク定義ファミリー名（ARNではなく固定名。クロススタック依存を避けるため） */
  taskDefinitionFamily: string;
  subnetIds: string[];
  taskSecurityGroupId: string;
  logGroupName: string;
  containerName: string;
}

/**
 * SastApiStack
 *
 * リソース:
 *   - Lambda run-task (タスク起動 + JWT検証)
 *   - Lambda get-logs (ログ取得 + タスク状態確認 + JWT検証)
 *
 * 両 Lambda は Function URL (authType: NONE) で公開。
 * セキュリティは Lambda 内部の Cognito JWT検証で担保。
 */
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const allowedOrigin = props.cloudfrontDomain
      ? `https://${props.cloudfrontDomain}`
      : 'http://localhost:3000';

    const commonEnv = {
      COGNITO_USER_POOL_ID: props.cognitoUserPoolId,
      COGNITO_CLIENT_ID: props.cognitoClientId,
      CLOUDFRONT_DOMAIN: props.cloudfrontDomain,
    };

    const bundling: lambda_nodejs.BundlingOptions = {
      // AWS SDK v3 は Lambda ランタイムに含まれるため外部化
      externalModules: ['@aws-sdk/*'],
      // jsonwebtoken, jwks-rsa はバンドルに含める
      nodeModules: ['jsonwebtoken', 'jwks-rsa'],
      target: 'node22',
    };

    // ── run-task Lambda ───────────────────────────────────────
    const runTaskFn = new lambda_nodejs.NodejsFunction(this, 'RunTaskFunction', {
      functionName: 'sast-channel-run-task',
      entry: path.join(__dirname, '../lambda/run-task/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling,
      environment: {
        ...commonEnv,
        ECS_CLUSTER_ARN: props.ecsClusterArn,
        TASK_DEFINITION_ARN: props.taskDefinitionFamily,
        SUBNET_IDS: props.subnetIds.join(','),
        TASK_SECURITY_GROUP_ID: props.taskSecurityGroupId,
        LOG_GROUP_NAME: props.logGroupName,
        CONTAINER_NAME: props.containerName,
      },
    });

    // ECS RunTask 権限
    // why: taskDefinitionArnの代わりにfamilyベースのARNを使い、クロススタック依存を排除
    runTaskFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:RunTask'],
        resources: [
          `arn:aws:ecs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:task-definition/${props.taskDefinitionFamily}:*`,
          props.ecsClusterArn,
        ],
      }),
    );
    // タスクロール/実行ロールの iam:PassRole
    runTaskFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: ['*'],
        conditions: {
          StringLike: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
        },
      }),
    );

    const runTaskUrl = runTaskFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['http://localhost:3000', allowedOrigin],
        allowedHeaders: ['Authorization', 'Content-Type'],
        allowedMethods: [lambda.HttpMethod.POST],
        maxAge: cdk.Duration.seconds(300),
      },
    });

    // ── get-logs Lambda ───────────────────────────────────────
    const getLogsFn = new lambda_nodejs.NodejsFunction(this, 'GetLogsFunction', {
      functionName: 'sast-channel-get-logs',
      entry: path.join(__dirname, '../lambda/get-logs/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      bundling,
      environment: {
        ...commonEnv,
        ECS_CLUSTER_ARN: props.ecsClusterArn,
        LOG_GROUP_NAME: props.logGroupName,
      },
    });

    // CloudWatch Logs 読み取り権限
    getLogsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['logs:GetLogEvents', 'logs:DescribeLogStreams'],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:${props.logGroupName}:*`],
      }),
    );
    // ECS DescribeTasks 権限 (タスク状態確認)
    getLogsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:DescribeTasks'],
        resources: ['*'],
        conditions: {
          ArnLike: { 'ecs:cluster': props.ecsClusterArn },
        },
      }),
    );

    const getLogsUrl = getLogsFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['http://localhost:3000', allowedOrigin],
        allowedHeaders: ['Authorization', 'Content-Type'],
        allowedMethods: [lambda.HttpMethod.GET],
        maxAge: cdk.Duration.seconds(300),
      },
    });

    // ── Outputs ───────────────────────────────────────────────
    new cdk.CfnOutput(this, 'RunTaskFunctionUrl', {
      value: runTaskUrl.url,
      description: '→ .env の RUN_TASK_FUNCTION_URL に設定',
    });
    new cdk.CfnOutput(this, 'GetLogsFunctionUrl', {
      value: getLogsUrl.url,
      description: '→ .env の GET_LOGS_FUNCTION_URL に設定',
    });
  }
}
