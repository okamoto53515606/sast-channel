/**
 * Lambda Function URL API クライアント
 */

export interface RunTaskResponse {
  taskArn: string;
  logGroup: string;
  logStream: string;
}

export interface LogEvent {
  timestamp: number;
  message: string;
}

export interface GetLogsResponse {
  events: LogEvent[];
  nextToken?: string;
  taskStatus: string;
}

async function apiFetch<T>(
  url: string,
  idToken: string,
  options: RequestInit = {},
): Promise<T> {
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = (await resp.json()) as T & { error?: string };

  if (!resp.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${resp.status}`);
  }

  return data;
}

export async function runTask(
  idToken: string,
  repoUrl: string,
  reviewBranch: string,
  authorNickname: string,
  authorIntro: string,
): Promise<RunTaskResponse> {
  const url = process.env.NEXT_PUBLIC_RUN_TASK_URL!;
  return apiFetch<RunTaskResponse>(url, idToken, {
    method: 'POST',
    body: JSON.stringify({ repoUrl, reviewBranch, authorNickname, authorIntro }),
  });
}

export async function getLogs(
  idToken: string,
  logGroup: string,
  logStream: string,
  nextToken?: string,
  taskArn?: string,
): Promise<GetLogsResponse> {
  const base = process.env.NEXT_PUBLIC_GET_LOGS_URL!;
  const qs = new URLSearchParams({ logGroup, logStream });
  if (nextToken) qs.set('nextToken', nextToken);
  if (taskArn) qs.set('taskArn', taskArn);
  return apiFetch<GetLogsResponse>(`${base}?${qs.toString()}`, idToken);
}
