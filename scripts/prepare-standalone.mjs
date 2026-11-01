import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
const root = process.cwd(), dist = process.env.BUILD_DIR || '.next'
const standalone = path.join(root, dist, 'standalone')
await mkdir(path.join(standalone, dist), { recursive: true })
await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true })
await cp(path.join(root, dist, 'static'), path.join(standalone, dist, 'static'), { recursive: true })
console.log('已准备独立服务的静态资源和本地字体。')
