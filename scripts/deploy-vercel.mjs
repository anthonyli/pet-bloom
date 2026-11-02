import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { target } from './deploy-config.mjs'

export { target }
const root = fileURLToPath(new URL('..', import.meta.url))
const requireCondition = (condition, message) => { if (!condition) throw new Error(message) }

export function validateLocal(pkg, config, link) {
  requireCondition(pkg.name === 'pet-bloom', '项目名称不匹配 / Unexpected package name')
  requireCondition(config.framework === 'nextjs' && JSON.stringify(config.regions) === '["sin1"]',
    'vercel.json 必须固定新加坡 sin1 / Singapore sin1 is required')
  requireCondition(!link || (link.projectId === target.project && link.orgId === target.team),
    '.vercel 链接了其他项目 / .vercel points to another project')
}

export function validateRemote(project, envs, domain) {
  requireCondition(project.id === target.project && project.accountId === target.team,
    '云端项目或团队不匹配 / Unexpected remote project or team')
  requireCondition(JSON.stringify(project.resourceConfig?.functionDefaultRegions) === '["sin1"]',
    '云端 Functions 区域必须是新加坡 / Remote Functions must use Singapore')
  const production = envs.filter(item => item.target?.includes('production') && !item.gitBranch)
  requireCondition(production.find(item => item.key === 'TURSO_DATABASE_URL')?.value === target.database,
    'Production 的 Turso 地址必须指向现有新加坡数据库 / Production must use the existing Singapore database')
  requireCondition(production.some(item => item.key === 'TURSO_AUTH_TOKEN' && item.type === 'sensitive'),
    'Production 缺少 Secret 类型的 Turso 令牌 / Missing Production Turso secret')
  requireCondition(domain.name === target.domain && domain.verified === true,
    '生产域名尚未验证 / Production domain is not verified')
}

export function validateRelease(deployment, alias, expectedId) {
  requireCondition(deployment.id === expectedId && deployment.projectId === target.project &&
    deployment.readyState === 'READY' && deployment.target === 'production' &&
    JSON.stringify(deployment.regions) === '["sin1"]',
  '新部署尚未就绪或目标/区域不符 / Deployment is not ready or has an unexpected target/region')
  requireCondition(alias.projectId === target.project && alias.deploymentId === expectedId,
    '生产域名尚未指向本次部署 / Production domain does not point to this deployment')
}

export function testEnvironment(source) {
  const env = { ...source }
  for (const key of Object.keys(env)) {
    if (/^(TURSO_|VERCEL_|NEXT_PUBLIC_CLOUD_DEPLOYMENT$|DATABASE_PATH$|DESKTOP_TOKEN$)/.test(key) || key === 'VERCEL') delete env[key]
  }
  return env
}

// Capture cloud responses: environment values must never reach logs.
function run(command, args, { capture = false, env = process.env, timeout = 30 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, shell: false, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', timeout })
    let output = ''
    if (capture) {
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.resume()
    }
    child.on('error', () => reject(new Error(`${command} 无法启动 / Could not start command`)))
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(
      `${command} 执行失败（${code}）/ Command failed; check authentication, network, or the Vercel dashboard`)))
  })
}

const cli = args => run('pnpm', ['dlx', target.cli, ...args, '--scope', target.scope], { capture: true })
const json = async promise => {
  const output = await promise
  try { return JSON.parse(output) } catch { throw new Error('CLI 响应不是有效 JSON / Invalid CLI JSON response') }
}
const api = endpoint => json(cli(['api', `${endpoint}?teamId=${target.team}`]))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function verifyLive(expectedId, { get = api, health, sleep = delay, attempts = 6 } = {}) {
  const readHealth = health ?? (() => json(run('curl', [
    '--fail', '--silent', '--show-error', '--connect-timeout', '10', '--max-time', '20',
    `https://${target.domain}/api/health?deployment=${encodeURIComponent(expectedId)}`
  ], { capture: true, timeout: 25_000 })))
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const deployment = await get(`/v13/deployments/${expectedId}`)
      const alias = await get(`/v4/aliases/${target.domain}`)
      validateRelease(deployment, alias, expectedId)
      const result = await readHealth()
      requireCondition(result.status === 'ok' && result.database === 'turso',
        '线上数据库健康检查失败 / Live Turso health check failed')
      return
    } catch (error) { lastError = error }
    if (attempt + 1 < attempts) await sleep(5000)
  }
  throw lastError
}

export async function release({ stage, migrate, promote, verify }) {
  const id = await stage()
  await migrate()
  await promote(id)
  await verify(id)
  return id
}

export async function main(args = process.argv.slice(2)) {
  requireCondition(args.every(arg => ['--check', '--dry-run', '--help'].includes(arg)) && args.length <= 1,
    '用法 / Usage: pnpm deploy:vercel [--check | --dry-run | --help]')
  if (args.includes('--help')) {
    console.log('pnpm deploy:vercel             检查并发布生产 / Check and deploy production\npnpm deploy:check              云配置检查及测试，不发布 / Remote preflight and tests only\npnpm deploy:vercel --dry-run    只显示本地部署计划 / Local plan only')
    return
  }
  const readJson = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'))
  let link
  try { link = await readJson('.vercel/project.json') } catch (error) { if (error.code !== 'ENOENT') throw error }
  validateLocal(await readJson('package.json'), await readJson('vercel.json'), link)
  console.log(`pet-bloom → ${target.scope} / ${target.region} → https://${target.domain}`)
  if (args.includes('--dry-run')) {
    console.log('计划 / Plan: remote preflight → typecheck → tests → database preflight → staged build → backup + migration → promote → alias + Turso health check')
    return
  }
  console.log('检查云端配置 / Checking remote configuration…')
  const project = await api(`/v9/projects/${target.project}`)
  const envs = project.env ?? []
  const database = envs.find(item => item.key === 'TURSO_DATABASE_URL' && item.target?.includes('production') && !item.gitBranch)
  requireCondition(database?.id, '缺少 Production Turso 地址 / Missing Production Turso URL')
  // Decrypt only the non-secret database URL in memory; never request the auth token.
  const url = await api(`/v1/projects/${target.project}/env/${encodeURIComponent(database.id)}`)
  database.value = url.value
  const domain = await api(`/v9/projects/${target.project}/domains/${target.domain}`)
  validateRemote(project, envs, domain)
  const env = testEnvironment(process.env)
  await run('pnpm', ['typecheck'], { env })
  await run('pnpm', ['test'], { env })
  await run('pnpm', ['db:check'])
  if (args.includes('--check')) {
    console.log('检查通过，未发布；生产构建在正式部署时执行 / Preflight passed; no deployment. Production build runs during deployment.')
    return
  }
  console.log('构建待发布版本 / Building staged production…')
  let promoting = false
  try {
    await release({
      stage: async () => {
        const result = await json(cli(['deploy', '--project', target.project, '--prod', '--skip-domain', '--regions', target.region, '--yes', '--json']))
        const id = result.deployment?.id
        requireCondition(typeof id === 'string' && /^dpl_[A-Za-z0-9]+$/.test(id), '部署响应缺少 ID / Deployment response is missing its ID')
        const deployment = await api(`/v13/deployments/${id}`)
        validateRelease(deployment, { projectId: target.project, deploymentId: id }, id)
        console.log(`待发布版本已就绪 / Staged deployment ready: ${id}`)
        return id
      },
      migrate: () => run('pnpm', ['db:migrate']),
      promote: async id => {
        promoting = true
        console.log('迁移成功，切换生产域名 / Migration succeeded; promoting production…')
        await cli(['promote', id, '--yes'])
      },
      verify: verifyLive
    })
    console.log(`部署及验证完成 / Deployment verified: https://${target.domain}`)
  } catch (error) {
    console.error(promoting
      ? '版本切换或验证未确认成功；数据库迁移保留，请检查 Vercel 控制台 / Promotion or verification unconfirmed; migrations retained. Inspect Vercel.'
      : '发布已停止，未执行生产域名切换；请检查构建或迁移状态 / Release stopped before promotion; check build and migration status.')
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
