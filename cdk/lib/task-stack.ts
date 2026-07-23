import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import { Construct } from 'constructs';

/**
 * SastTaskStack
 *
 * リソース:
 *   - VPC (パブリックサブネットのみ、NAT不要)
 *   - ECS Fargate クラスター
 *   - タスク定義 (SASTちゃんねる タスク)
 *   - CloudWatch Logs グループ
 *
 * タスク Docker イメージは task/ ディレクトリから自動ビルド＆ECRプッシュ。
 * CDK deploy 時に Docker が起動している必要があります。
 */
export class TaskStack extends cdk.Stack {
  public readonly clusterArn: string;
  public readonly taskDefinitionArn: string;
  /** タスク定義ファミリー名（改訂によらず固定）。ApiStack で使用 */
  public readonly taskDefinitionFamily: string;
  public readonly subnetIds: string[];
  public readonly taskSecurityGroupId: string;
  public readonly logGroupName: string;
  public readonly containerName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.containerName = 'sast-channel-task';

    // ── VPC (パブリックサブネットのみ、コスト最小) ─────────────
    // why: Fargate + ASSIGN_PUBLIC_IP=ENABLED でインターネット接続可能。
    //      NAT Gateway 不要でコストを抑える。
    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: 'sast-channel-vpc',
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    // ── タスク用セキュリティグループ ──────────────────────────
    const taskSg = new ec2.SecurityGroup(this, 'TaskSg', {
      vpc,
      securityGroupName: 'sast-channel-task-sg',
      description: 'SAST Channel Fargate task SG',
      allowAllOutbound: true, // GitHub API, Anthropic API等への発信
    });

    // ── CloudWatch Logs グループ ──────────────────────────────
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/ecs/sast-channel-task',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── ECS クラスター ────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: 'sast-channel-cluster',
      vpc,
    });

    // ── Docker イメージ (task/ ディレクトリからビルド) ─────────
    const taskImage = new ecr_assets.DockerImageAsset(this, 'TaskImage', {
      directory: path.join(__dirname, '../../task'),
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    // ── Fargate タスク定義 ────────────────────────────────────
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      family: 'sast-channel-task',
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    taskDef.addContainer(this.containerName, {
      image: ecs.ContainerImage.fromDockerImageAsset(taskImage),
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: 'ecs',
      }),
      // API キーは .env から CDK デプロイ時に埋め込む（タスク定義に直接渡す）
      // 実行時に run-task Lambda から REPO_URL 等の実行パラメータを上書き
      environment: {
        // ── 実行時パラメータ（Lambda から上書き） ──
        REPO_URL: '',
        REVIEW_BRANCH: '',
        AUTHOR_NICKNAME: '',
        AUTHOR_INTRO: '',
        // ── API キー（デプロイ時に .env から注入） ──
        GITHUB_PAT:      process.env.GITHUB_PAT      || '',
        CLAUDE_API_KEY:  process.env.CLAUDE_API_KEY  || '',
        OPENAI_API_KEY:  process.env.OPENAI_API_KEY  || '',
        GEMINI_API_KEY:  process.env.GEMINI_API_KEY  || '',
        BRAVE_API_KEY:   process.env.BRAVE_API_KEY   || '',
        CLAUDE_MODEL_ID: process.env.CLAUDE_MODEL_ID || 'claude-sonnet-5',
        OPEN_AI_MODEL_ID: process.env.OPEN_AI_MODEL_ID || 'gpt-5.6-terra',
        GEMINI_MODEL_ID: process.env.GEMINI_MODEL_ID || 'gemini-3.5-flash',
        // ── 節約モード（DeepSeek V4 Pro） ──
        DEEPSEEK_API_KEY:  process.env.DEEPSEEK_API_KEY  || '',
        DEEPSEEK_MODEL_ID: process.env.DEEPSEEK_MODEL_ID || '',
      },
    });

    this.clusterArn = cluster.clusterArn;
    this.taskDefinitionArn = taskDef.taskDefinitionArn;
    this.taskDefinitionFamily = taskDef.family;
    this.subnetIds = vpc.publicSubnets.map((s) => s.subnetId);
    this.taskSecurityGroupId = taskSg.securityGroupId;
    this.logGroupName = logGroup.logGroupName;

    // ── Outputs ───────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ClusterArn', { value: cluster.clusterArn });
    new cdk.CfnOutput(this, 'TaskDefinitionArn', { value: taskDef.taskDefinitionArn });
    new cdk.CfnOutput(this, 'SubnetIds', { value: this.subnetIds.join(',') });
    new cdk.CfnOutput(this, 'TaskSgId', { value: taskSg.securityGroupId });
    new cdk.CfnOutput(this, 'LogGroupName', { value: logGroup.logGroupName });
  }
}
