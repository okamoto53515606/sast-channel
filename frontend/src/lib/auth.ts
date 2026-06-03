/**
 * Cognito PKCE 認証ユーティリティ
 *
 * フロー:
 *   1. generatePKCE() → code_verifier/challenge 生成
 *   2. buildCognitoLoginUrl(challenge) → Hosted UI URL
 *   3. exchangeCodeForTokens(code, verifier) → id_token 取得
 *   4. setIdToken(token) → localStorage に保存
 *   5. getIdToken() / isAuthenticated() → 認証状態確認
 */

const ID_TOKEN_KEY = 'sast_id_token';

// ── PKCE ────────────────────────────────────────────────────

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = base64UrlEncode(array.buffer);

  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const challenge = base64UrlEncode(hash);

  return { verifier, challenge };
}

// ── Cognito URL ──────────────────────────────────────────────

export function buildCognitoLoginUrl(challenge: string): string {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN!;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
  const redirectUri = `${window.location.origin}/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid email',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return `https://${domain}/login?${params.toString()}`;
}

export function buildCognitoLogoutUrl(logoutRedirectUri: string): string {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN!;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;

  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: logoutRedirectUri,
  });

  return `https://${domain}/logout?${params.toString()}`;
}

// ── トークン交換 ─────────────────────────────────────────────

export async function exchangeCodeForTokens(code: string, verifier: string): Promise<string> {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN!;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
  const redirectUri = `${window.location.origin}/callback`;

  const resp = await fetch(`https://${domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed: ${resp.status} ${text}`);
  }

  const data = (await resp.json()) as { id_token?: string };
  if (!data.id_token) throw new Error('id_token が取得できませんでした');
  return data.id_token;
}

// ── トークン管理 ─────────────────────────────────────────────

export function getIdToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ID_TOKEN_KEY);
}

export function setIdToken(token: string): void {
  localStorage.setItem(ID_TOKEN_KEY, token);
}

export function clearIdToken(): void {
  localStorage.removeItem(ID_TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  const token = getIdToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { exp?: number };
    return (payload.exp || 0) * 1000 > Date.now();
  } catch {
    return false;
  }
}
