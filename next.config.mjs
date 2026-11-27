/** @type {import('next').NextConfig} */
const config = {
  output: process.env.VERCEL ? undefined : 'standalone',
  distDir: process.env.BUILD_DIR || '.next',
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  env: { NEXT_PUBLIC_CLOUD_DEPLOYMENT: process.env.VERCEL ? 'true' : 'false' },
  async headers() {
    const assetHeaders = { key: 'Cache-Control', value: 'public, max-age=86400' }
    return [
      { source: '/pets/:image(.*\\.webp)', headers: [assetHeaders] },
      { source: '/pet-backgrounds/:image(.*\\.svg)', headers: [assetHeaders] },
      { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Frame-Options', value: 'DENY' }
      ] }
    ]
  }
}
export default config
