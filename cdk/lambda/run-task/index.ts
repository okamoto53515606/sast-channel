import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import jwksRsa from 'jwks-rsa';
import jwt from 'jsonwebtoken';

const ecs = new ECSClient({ region: process.env.AWS_REGION });

// JWKS クライアント (モジュール変数でウォームスタート間キャッシュ)
const userPoolId = process.env.COGNITO_USER_POOL_ID!;
const region = userPoolId.split('_')[0];
const jwksClient = jwksRsa({
  jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 3_600_000,
  rateLimit: true,
});

function getSigningKey(header: jwt.JwtHeader): Promise<string> {
  return new Promise((resolve, reject) => {
    jwksClient.getSigningKey(header.kid!, (err, key) => {
      if (err || !key) return reject(err || new Error('Signing key not found'));
      resolve(key.getPublicKey());
    });
  });
}

async function validateToken(authHeader: string | undefined): Promise<void> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Authorization header missing or invalid'), { status: 401 });
  }
  const token = authHeader.slice(7);
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw Object.assign(new Error('Invalid JWT format'), { status: 401 });
  }
  const signingKey = await getSigningKey(decoded.header);
  await new Promise<void>((resolve, reject) => {
    jwt.verify(
      token,
      signingKey,
      {
        issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
        audience: process.env.COGNITO_CLIENT_ID,
        algorithms: ['RS256'],
      },
      (err) => (err ? reject(Object.assign(err, { status: 401 })) : resolve()),
    );
  });
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  // Lambda Function URL が OPTIONS プリフライトを自動処理するためここでは不要

  try {
    await validateToken(event.headers?.authorization);

    const body = JSON.parse(event.body || '{}') as Record<string, string>;
    const repoUrl = (body.repoUrl || '').trim();
    const reviewBranch = (body.reviewBranch || 'sast-channel').trim();
    const authorNickname = (body.authorNickname || '').trim();
    const authorIntro = (body.authorIntro || '').trim();

    if (!repoUrl) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'repoUrl は必須です' }),
      };
    }

    const subnets = process.env.SUBNET_IDS!.split(',');
    const result = await ecs.send(
      new RunTaskCommand({
        cluster: process.env.ECS_CLUSTER_ARN!,
        taskDefinition: process.env.TASK_DEFINITION_ARN!,
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets,
            securityGroups: [process.env.TASK_SECURITY_GROUP_ID!],
            assignPublicIp: 'ENABLED',
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: process.env.CONTAINER_NAME || 'sast-channel-task',
              environment: [
                { name: 'REPO_URL', value: repoUrl },
                { name: 'REVIEW_BRANCH', value: reviewBranch },
                { name: 'AUTHOR_NICKNAME', value: authorNickname },
                { name: 'AUTHOR_INTRO', value: authorIntro },
              ],
            },
          ],
        },
      }),
    );

    const task = result.tasks?.[0];
    if (!task?.taskArn) {
      const failure = result.failures?.[0];
      throw new Error(`タスク起動失敗: ${failure?.reason || 'unknown'}`);
    }

    // タスクID = ARN の最終セグメント (新旧形式どちらでも動作)
    const taskId = task.taskArn.split('/').pop()!;
    const containerName = process.env.CONTAINER_NAME || 'sast-channel-task';
    const logGroup = process.env.LOG_GROUP_NAME!;
    const logStream = `ecs/${containerName}/${taskId}`;

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ taskArn: task.taskArn, logGroup, logStream }),
    };
  } catch (err: unknown) {
    const e = err as Error & { status?: number };
    return {
      statusCode: e.status || 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: e.message || 'Internal server error' }),
    };
  }
};
