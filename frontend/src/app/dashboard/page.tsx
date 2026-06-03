'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getIdToken, isAuthenticated, clearIdToken, buildCognitoLogoutUrl } from '@/lib/auth';
import { runTask, getLogs, type LogEvent } from '@/lib/api';

type TaskState = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export default function DashboardPage() {
  const router = useRouter();

  // ── 認証チェック ───────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated()) router.replace('/login');
  }, [router]);

  // ── フォーム状態 ───────────────────────────────────────────
  const [repoUrl, setRepoUrl] = useState('');
  const [reviewBranch, setReviewBranch] = useState('sast-channel');
  const [authorNickname, setAuthorNickname] = useState('');
  const [authorIntro, setAuthorIntro] = useState('');

  // ── authorNickname を localStorage から復元 ────────────────
  useEffect(() => {
    const saved = localStorage.getItem('sast_author_nickname');
    if (saved) setAuthorNickname(saved);
  }, []);

  function handleNicknameChange(v: string) {
    setAuthorNickname(v);
    localStorage.setItem('sast_author_nickname', v);
  }

  // ── タスク状態 ─────────────────────────────────────────────
  const [taskState, setTaskState] = useState<TaskState>('idle');
  const [taskError, setTaskError] = useState('');
  const [taskArn, setTaskArn] = useState('');
  const [logGroup, setLogGroup] = useState('');
  const [logStream, setLogStream] = useState('');
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const nextTokenRef = useRef<string | undefined>();
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  // ── ログ自動スクロール ─────────────────────────────────────
  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  // ── ポーリング停止 (アンマウント時) ───────────────────────
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  // ── ログポーリング ─────────────────────────────────────────
  async function pollLogs(arn: string, group: string, stream: string) {
    const token = getIdToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    try {
      const data = await getLogs(token, group, stream, nextTokenRef.current, arn);

      if (data.events.length > 0) {
        setLogs((prev) => [...prev, ...data.events]);
        nextTokenRef.current = data.nextToken;
      }

      const status = data.taskStatus;
      if (status === 'STOPPED') {
        setTaskState('stopped');
        return; // ポーリング終了
      }

      // RUNNING / PROVISIONING / PENDING → 3秒後に再ポーリング
      setTaskState('running');
      pollingRef.current = setTimeout(() => pollLogs(arn, group, stream), 3000);
    } catch (e) {
      // エラーが出てもポーリングは継続 (一時的なエラーのため)
      pollingRef.current = setTimeout(() => pollLogs(arn, group, stream), 5000);
    }
  }

  // ── タスク起動 ─────────────────────────────────────────────
  async function handleStartTask() {
    if (!repoUrl.trim()) {
      setTaskError('リポジトリURLを入力してください。');
      return;
    }
    if (!authorNickname.trim()) {
      setTaskError('ニックネームを入力してください。');
      return;
    }

    const token = getIdToken();
    if (!token || !isAuthenticated()) {
      router.replace('/login');
      return;
    }

    setTaskState('starting');
    setTaskError('');
    setLogs([]);
    nextTokenRef.current = undefined;
    if (pollingRef.current) clearTimeout(pollingRef.current);

    try {
      const data = await runTask(token, repoUrl.trim(), reviewBranch.trim(), authorNickname.trim(), authorIntro.trim());
      setTaskArn(data.taskArn);
      setLogGroup(data.logGroup);
      setLogStream(data.logStream);

      // 少し待ってからポーリング開始 (ログストリームが存在するまで)
      pollingRef.current = setTimeout(
        () => pollLogs(data.taskArn, data.logGroup, data.logStream),
        3000,
      );
    } catch (e) {
      setTaskError((e as Error).message || 'タスク起動に失敗しました。');
      setTaskState('error');
    }
  }

  // ── ログアウト ─────────────────────────────────────────────
  function handleLogout() {
    clearIdToken();
    const logoutUrl = buildCognitoLogoutUrl(`${window.location.origin}/login`);
    window.location.href = logoutUrl;
  }

  // ── ステータスバッジ ───────────────────────────────────────
  const statusMap: Record<TaskState, { label: string; color: string }> = {
    idle: { label: '待機中', color: 'var(--muted)' },
    starting: { label: '起動中...', color: 'var(--warn)' },
    running: { label: '実行中', color: 'var(--success)' },
    stopped: { label: '完了', color: 'var(--accent)' },
    error: { label: 'エラー', color: 'var(--error)' },
  };
  const { label: statusLabel, color: statusColor } = statusMap[taskState];

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">📡</span>
          <span className="font-bold" style={{ color: 'var(--accent)' }}>
            SASTちゃんねる
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="rounded px-3 py-1 text-sm transition-opacity hover:opacity-70"
          style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          ログアウト
        </button>
      </header>

      {/* ── Main ───────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-3xl flex-1 p-6 space-y-6">

        {/* ── タスク起動フォーム ─────────────────────────────── */}
        <section
          className="rounded-xl p-6 space-y-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <h2 className="text-base font-semibold">タスク起動</h2>

          <div className="space-y-3">
            <label className="block">
              <span className="text-sm" style={{ color: 'var(--muted)' }}>
                ニックネーム <span style={{ color: 'var(--error)' }}>*</span>
                <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>AIがレビュー時に呼ぶ名前（保存されます）</span>
              </span>
              <input
                type="text"
                value={authorNickname}
                onChange={(e) => handleNicknameChange(e.target.value)}
                placeholder="例: okamo"
                disabled={taskState === 'starting' || taskState === 'running'}
                className="mt-1 w-full rounded-lg px-4 py-2.5 text-sm disabled:opacity-50"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  outline: 'none',
                }}
              />
            </label>

            <label className="block">
              <span className="text-sm" style={{ color: 'var(--muted)' }}>
                リポジトリURL <span style={{ color: 'var(--error)' }}>*</span>
              </span>
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                disabled={taskState === 'starting' || taskState === 'running'}
                className="mt-1 w-full rounded-lg px-4 py-2.5 text-sm disabled:opacity-50"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  outline: 'none',
                }}
              />
            </label>

            <label className="block">
              <span className="text-sm" style={{ color: 'var(--muted)' }}>
                レビューブランチ名
              </span>
              <input
                type="text"
                value={reviewBranch}
                onChange={(e) => setReviewBranch(e.target.value)}
                placeholder="sast-channel"
                disabled={taskState === 'starting' || taskState === 'running'}
                className="mt-1 w-full rounded-lg px-4 py-2.5 text-sm disabled:opacity-50"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  outline: 'none',
                }}
              />
            </label>

            <label className="block">
              <span className="text-sm" style={{ color: 'var(--muted)' }}>
                リポジトリ作者の自己紹介（AIコンテキスト用）
              </span>
              <textarea
                value={authorIntro}
                onChange={(e) => setAuthorIntro(e.target.value)}
                placeholder="例: TypeScript/Next.js を主に使うフロントエンドエンジニアです。テストが少なく、コード品質の改善を目標にしています。"
                rows={3}
                disabled={taskState === 'starting' || taskState === 'running'}
                className="mt-1 w-full rounded-lg px-4 py-2.5 text-sm disabled:opacity-50"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </label>
          </div>

          {taskError && (
            <p
              className="rounded p-3 text-sm"
              style={{ background: '#450a0a', color: 'var(--error)' }}
            >
              {taskError}
            </p>
          )}

          <button
            onClick={handleStartTask}
            disabled={taskState === 'starting' || taskState === 'running'}
            className="rounded-lg px-6 py-2.5 font-semibold transition-opacity disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#000' }}
          >
            {taskState === 'starting' ? '起動中...' : 'タスク起動'}
          </button>
        </section>

        {/* ── ログビューアー ─────────────────────────────────── */}
        {taskState !== 'idle' && (
          <section
            className="rounded-xl p-6 space-y-3"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">タスクログ</h2>
              <span
                className="rounded-full px-3 py-0.5 text-xs font-semibold"
                style={{ background: `${statusColor}22`, color: statusColor }}
              >
                ● {statusLabel}
              </span>
            </div>

            {taskState === 'starting' && logs.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                タスク起動中。ログストリーム確立を待っています...
              </p>
            )}

            <div
              ref={logBoxRef}
              className="overflow-y-auto rounded-lg p-4 text-xs leading-relaxed"
              style={{
                background: '#050505',
                border: '1px solid var(--border)',
                color: '#a3e635',
                fontFamily: '"Cascadia Code", "Fira Code", monospace',
                minHeight: '200px',
                maxHeight: '500px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {logs.length === 0 ? (
                <span style={{ color: 'var(--muted)' }}>ログ待機中...</span>
              ) : (
                logs.map((ev, i) => (
                  <div key={i}>
                    <span style={{ color: '#4b5563' }}>
                      {new Date(ev.timestamp).toLocaleTimeString('ja-JP')}{' '}
                    </span>
                    {ev.message}
                  </div>
                ))
              )}
              {taskState === 'stopped' && (
                <div style={{ color: 'var(--accent)', marginTop: '8px' }}>
                  ── タスク完了 ──
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
