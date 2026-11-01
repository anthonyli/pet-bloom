import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
for (const file of ['.env', '.env.local']) if (existsSync(file)) process.loadEnvFile(file)
const dist = process.env.BUILD_DIR || '.next'
const server = path.resolve(dist, 'standalone/server.js')
if (!existsSync(server)) {
  console.error('请先运行 pnpm build / Please run pnpm build first.')
  process.exit(1)
}
// 独立服务会切换工作目录，数据库必须解析为项目持久化目录的绝对路径
const database = path.resolve(process.env.DATABASE_PATH || 'data/pet-garden.db')
const child = spawn(process.execPath, [server], {
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT || '3100', HOSTNAME: process.env.HOSTNAME || '0.0.0.0', DATABASE_PATH: database }
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error('启动失败：', error); process.exit(1) })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
