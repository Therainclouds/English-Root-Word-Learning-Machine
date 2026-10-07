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
  /**
   * build 用独立目录，避免与 dev 共用 `.next` 时互删 chunk（会报 Cannot find module './xxx.js'）。
   *
   * 直接写成 `out`：`output: 'export'` 时 Next 把导出结果落到 distDir，
   * 且**只保留静态站**（不含 server / cache 等中间产物），
   * 因此 `npm run start`（`serve out`）、README 与部署平台默认识别的目录三处都能对上。
   */
  distDir: isBuild ? 'out' : '.next',
};

export default nextConfig;
