'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { exchangeCodeForTokens, setIdToken } from '@/lib/auth';

export default function CallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function handleCallback() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const error = params.get('error');

      if (error) {
        setErrorMsg(`Cognito 認証エラー: ${error}`);
        setStatus('error');
        return;
      }

      if (!code) {
        setErrorMsg('認証コードが見つかりません。');
        setStatus('error');
        return;
      }

      const verifier = sessionStorage.getItem('pkce_verifier');
      if (!verifier) {
        setErrorMsg('PKCEコードが見つかりません。もう一度ログインしてください。');
        setStatus('error');
        return;
      }

      try {
        const idToken = await exchangeCodeForTokens(code, verifier);
        sessionStorage.removeItem('pkce_verifier');
        setIdToken(idToken);
        router.replace('/dashboard');
      } catch (e) {
        setErrorMsg('トークン取得に失敗しました。もう一度ログインしてください。');
        setStatus('error');
      }
    }

    handleCallback();
  }, [router]);

  if (status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-8">
        <div
          className="w-full max-w-sm rounded-xl p-8 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p className="mb-2 text-2xl">⚠️</p>
          <p className="mb-4 font-semibold" style={{ color: 'var(--error)' }}>
            認証エラー
          </p>
          <p className="mb-6 text-sm" style={{ color: 'var(--muted)' }}>
            {errorMsg}
          </p>
          <a
            href="/login"
            className="rounded px-4 py-2 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#000' }}
          >
            ログインに戻る
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <p style={{ color: 'var(--muted)' }}>認証処理中...</p>
    </div>
  );
}
