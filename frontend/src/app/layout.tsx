import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SASTちゃんねる',
  description: 'キャラクター駆動型 SAST & 自動パッチシステム',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
