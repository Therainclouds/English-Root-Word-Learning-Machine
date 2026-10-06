/** @type {import('next').NextConfig} */

/**
 * dev 与 build 默认共用 .next，两者同时运行会互相删除 chunk，
 * 导致 "Cannot find module './611.js'" 之类的运行时错误。
 * 这里让 build 使用独立中间目录（导出结果仍然输出到 out/）。
 */
const isBuild = process.argv.includes('build') || process.env.npm_lifecycle_event === 'build';

const nextConfig = {
  // 纯前端本地应用：静态导出，不依赖任何服务端
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  distDir: isBuild ? '.next-build' : '.next',
};

export default nextConfig;
