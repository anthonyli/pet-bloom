/** @type {import('next').NextConfig} */
const config = {
  output: process.env.VERCEL ? undefined : 'standalone',
  distDir: process.env.BUILD_DIR || '.next',
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  env: { NEXT_PUBLIC_CLOUD_DEPLOYMENT: process.env.VERCEL ? 'true' : 'false' },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' }
    ] }]
  }
}
export default config
