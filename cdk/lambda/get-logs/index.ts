import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-cloudwatch-logs';
import { ECSClient, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import jwksRsa from 'jwks-rsa';
import jwt from 'jsonwebtoken';

const cwl = new CloudWatchLogsClient({ region: process.env.AWS_REGION });
const ecs = new ECSClient({ region: process.env.AWS_REGION });

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

  try {
    await validateToken(event.headers?.authorization);

    const qs = event.queryStringParameters || {};
    const logGroup = (qs.logGroup || process.env.LOG_GROUP_NAME)!;
    const logStream = qs.logStream;
    const nextToken = qs.nextToken;
    const taskArn = qs.taskArn;

    if (!logStream) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'logStream は必須です' }),
      };
    }

    // ── ログ取得 ────────────────────────────────────────────
    type LogEvent = { timestamp: number; message: string };
    let events: LogEvent[] = [];
    let newNextToken: string | undefined;

    try {
      const resp = await cwl.send(
        new GetLogEventsCommand({
          logGroupName: logGroup,
          logStreamName: logStream,
          nextToken,
          startFromHead: true,
          limit: 100,
        }),
      );
      events = (resp.events || []).map((e) => ({
        timestamp: e.timestamp || 0,
        message: e.message || '',
      }));
      newNextToken = resp.nextForwardToken;
    } catch (e) {
      // ロggストリームがまだ存在しない場合は空を返す (タスク起動直後)
      if (!(e instanceof ResourceNotFoundException)) throw e;
    }

    // ── タスク状態確認 ───────────────────────────────────────
    let taskStatus = 'UNKNOWN';
    if (taskArn) {
      try {
        const resp = await ecs.send(
          new DescribeTasksCommand({
            cluster: process.env.ECS_CLUSTER_ARN!,
            tasks: [taskArn],
          }),
        );
        taskStatus = resp.tasks?.[0]?.lastStatus || 'UNKNOWN';
      } catch {
        // 無視 (ログだけ返す)
      }
    }

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ events, nextToken: newNextToken, taskStatus }),
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
