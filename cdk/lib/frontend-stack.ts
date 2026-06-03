import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

/**
 * SastFrontendStack
 *
 * リソース:
 *   - S3 バケット (プライベート、静的ファイル格納)
 *   - CloudFront ディストリビューション (OAC 経由で S3 配信)
 *   - CloudFront Function (クリーンURL → /path/index.html リライト)
 *
 * デプロイ後に CLOUDFRONT_DOMAIN と S3_BUCKET_NAME を .env に記入すること。
 */
export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── S3 バケット ──────────────────────────────────────────
    const bucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `sast-channel-frontend-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: false,
    });

    // ── OAC (Origin Access Control) ──────────────────────────
    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      description: 'SAST Channel Frontend OAC',
    });

    // ── CloudFront Function: クリーンURL リライト ─────────────
    // /login → /login/index.html 等に変換。静的ファイル(.js/.css等)はそのまま。
    const rewriteFn = new cloudfront.Function(this, 'RewriteFunction', {
      functionName: 'sast-channel-url-rewrite',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  // 拡張子あり（静的ファイル）はそのまま
  if (uri.includes('.')) return request;
  // 末尾スラッシュあり
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else {
    request.uri = uri + '/index.html';
  }
  return request;
}
      `.trim()),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // ── CloudFront ディストリビューション ─────────────────────
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'SAST Channel Frontend',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket, { originAccessControl: oac }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        functionAssociations: [
          {
            function: rewriteFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        // 404 は index.html を返してクライアントルーターに委ねる
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // ── Outputs ───────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: '→ .env の CLOUDFRONT_DOMAIN に設定',
    });
    new cdk.CfnOutput(this, 'S3BucketName', {
      value: bucket.bucketName,
      description: '→ .env の S3_BUCKET_NAME に設定',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID (キャッシュ無効化用)',
    });
  }
}
