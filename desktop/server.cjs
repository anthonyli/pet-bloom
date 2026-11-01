const path = require('node:path')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')

async function main() {
  const directory = path.join(__dirname, '..', 'web')
  const requireWeb = createRequire(path.join(directory, 'package.json'))
  const { config } = JSON.parse(readFileSync(path.join(directory, '.next-desktop', 'required-server-files.json'), 'utf8'))
  process.chdir(directory)
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config)
  delete process.env.APP_ORIGIN
  delete process.env.NEXT_MANUAL_SIG_HANDLE
  requireWeb('next')
  const { startServer } = requireWeb('next/dist/server/lib/start-server')
  await startServer({ dir: directory, isDev: false, config, hostname: '127.0.0.1', port: Number(process.env.DESKTOP_PORT), allowRetry: false })
  const port = Number(process.env.PORT)
  process.env.APP_ORIGIN = `http://127.0.0.1:${port}`
  const response = await fetch(`${process.env.APP_ORIGIN}/api/health`, {
    headers: { 'x-petbloom-desktop': process.env.DESKTOP_TOKEN },
    signal: AbortSignal.timeout(45000)
  })
  if (!response.ok || (await response.json()).status !== 'ok') throw new Error('本地数据库检查失败 / Local database check failed')
  process.parentPort.postMessage({ type: 'ready', port })
  process.parentPort.on('message', ({ data }) => {
    if (data.type === 'shutdown') process.emit('SIGTERM')
  })
}

main().catch(error => { console.error(error); process.exit(1) })
