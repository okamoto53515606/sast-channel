import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  poweredByHeader: false,
  // 親ディレクトリの package-lock.json を誤検出しないよう、プロジェクトルートを固定する
  turbopack: {
    root: __dirname,
  },
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
