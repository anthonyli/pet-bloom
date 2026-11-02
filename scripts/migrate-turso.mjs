import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@libsql/client'
import { target } from './deploy-config.mjs'
import { MigrationError, loadMigrations, inspectState, createVerifiedBackup, migrate } from './lib/turso-migrations.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

function capture(command, args) {
  return new Promise((resolve, reject) => {
    // Never echo CLI responses: token creation and export may contain private data.
    const child = spawn(command, args, { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60_000 })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.resume()
    child.on('error', () => reject(new MigrationError('无法运行 Turso CLI；请安装并登录 / Install Turso CLI and run turso auth login')))
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new MigrationError(`Turso ${args.slice(0, 2).join(' ')} 失败；请检查登录、权限和网络 / Check Turso login, permissions and network`)))
  })
}

async function tursoCommand() {
  if (process.env.TURSO_CLI) return process.env.TURSO_CLI
  const installed = path.join(homedir(), '.turso', 'turso')
  try { await access(installed); return installed } catch { return 'turso' }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || args.some(arg => !['--check', '--status', '--help'].includes(arg))) throw new MigrationError('用法 / Usage: pnpm db:migrate [--check | --status | --help]')
  if (args.includes('--help')) {
    console.log('pnpm db:check       只检查版本、历史及表结构 / Inspect version, history and schema\npnpm db:migrate     备份、恢复演练、事务迁移 / Backup, rehearse and migrate atomically')
    return
  }
  const { current } = JSON.parse(await readFile(path.join(root, 'lib/server/schema-version.json'), 'utf8'))
  const migrations = await loadMigrations(path.join(root, 'migrations/turso'), current)
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_DATABASE_URL !== target.database) throw new MigrationError('环境变量指向其他数据库 / Environment points to another database')
  const command = await tursoCommand()
  const url = await capture(command, ['db', 'show', target.databaseName, '--url'])
  if (url !== target.database) throw new MigrationError('Turso CLI 数据库不是预期的新加坡生产库 / Unexpected Turso database or region')
  const readOnly = args.includes('--check') || args.includes('--status')
  // Use a short-lived database-scoped token in memory; never read a saved app
  // token, pass it in argv, print it, or write it to disk.
  const token = await capture(command, ['db', 'tokens', 'create', target.databaseName, '--expiration', '1d', ...(readOnly ? ['--read-only'] : [])])
  const client = createClient({ url, authToken: token, intMode: 'bigint' })
  try {
    if (readOnly) {
      const state = await inspectState(client, migrations)
      console.log(`Turso ${target.databaseName} (Singapore): schema v${state.version}; 待执行 / pending: ${state.pending.map(item => item.filename).join(', ') || 'none'}`)
      console.log('检查通过，未修改数据库 / Check passed; database unchanged')
      return
    }
    const result = await migrate(client, migrations, async state => {
      console.log('创建完整数据库快照并演练迁移 / Creating full snapshot and rehearsing migration…')
      const backup = await createVerifiedBackup({
        directory: path.join(root, 'data/backups/turso'), state, source: url,
        exportDatabase: filename => capture(command, ['db', 'export', target.databaseName, '--output-file', filename])
      })
      console.log(`备份已验证 / Backup verified: ${backup.filename}`)
      return backup
    })
    console.log(result.applied.length
      ? `迁移完成 / Migration complete: v${result.version}; applied: ${result.applied.join(', ')}`
      : `数据库已是最新版本 / Database is current: v${result.version}`)
    return result
  } finally { client.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // SQLite errors can contain SQL and values. Do not print raw errors for a
    // production database; a failed response may also follow a successful commit.
    if (error instanceof MigrationError) console.error(error.message)
    else if (typeof error.code === 'string' && /^[A-Z_0-9]+$/.test(error.code)) console.error(`数据库错误代码 / Database error code: ${error.code}`)
    console.error('迁移未能确认成功，发布必须停止。已生成的备份保留在 data/backups/turso；运行 pnpm db:check 确认状态后再重试。 / Migration unconfirmed; stop release. Existing backups are retained. Run pnpm db:check before retrying.')
    process.exitCode = 1
  })
}
