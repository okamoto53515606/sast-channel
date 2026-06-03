'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, generatePKCE, buildCognitoLoginUrl } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated()) router.replace('/dashboard');
  }, [router]);

  async function handleLogin() {
    try {
      setLoading(true);
      setError('');
      const { verifier, challenge } = await generatePKCE();
      sessionStorage.setItem('pkce_verifier', verifier);
      const loginUrl = buildCognitoLoginUrl(challenge);
      window.location.href = loginUrl;
    } catch (e) {
      setError('ログインURLの生成に失敗しました。設定を確認してください。');
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center p-8"
      style={{ background: 'var(--bg)' }}
    >
      {/* ロゴ */}
      <div className="mb-8 text-center">
        <div className="mb-3 text-5xl">📡</div>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--accent)' }}>
          SASTちゃんねる
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          キャラクター駆動型 SAST &amp; 自動パッチシステム
        </p>
      </div>

      {/* カード */}
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <h2 className="mb-6 text-center text-lg font-semibold">管理者ログイン</h2>

        {error && (
          <p
            className="mb-4 rounded p-3 text-sm"
            style={{ background: '#450a0a', color: 'var(--error)' }}
          >
            {error}
          </p>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full rounded-lg py-3 font-semibold transition-opacity disabled:opacity-50"
          style={{ background: 'var(--accent)', color: '#000' }}
        >
          {loading ? 'リダイレクト中...' : 'Cognito でログイン'}
        </button>

        <p className="mt-4 text-center text-xs" style={{ color: 'var(--muted)' }}>
          Cognito Hosted UI に遷移します
        </p>
      </div>
    </div>
  );
}
