import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, appendFile, rm } from 'node:fs/promises'
import { DefaultArtifactClient } from '@actions/artifact'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { main as deploy } from './deploy-vercel.mjs'
import { main as migrate } from './migrate-turso.mjs'
import { backupKey, cryptFile } from './lib/encrypted-backup.mjs'

export function validateCI(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'anthonyli/pet-bloom' || env.GITHUB_REF !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error('Production deployment requires the main branch of anthonyli/pet-bloom')
  }
  for (const key of ['VERCEL_TOKEN', 'TURSO_API_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_RESULTS_URL']) {
    if (!env[key]) throw new Error(`Missing required configuration: ${key}`)
  }
  return backupKey(env.BACKUP_ENCRYPTION_KEY)
}

export async function persistEncryptedBackup(backup, { key, upload, name }) {
  const folder = path.join(path.dirname(backup.filename), 'encrypted')
  await mkdir(folder, { mode: 0o700 })
  const files = []
  for (const source of [backup.filename, path.join(path.dirname(backup.filename), 'manifest.json')]) {
    const destination = path.join(folder, `${path.basename(source)}.enc`)
    await cryptFile(source, destination, key)
    files.push(destination)
  }
  const result = await upload(name, files, folder, { retentionDays: 90, compressionLevel: 0 })
  if (!result?.id || !result?.digest) throw new Error('Encrypted backup upload was not confirmed; migration stopped')
  console.log(`Encrypted backup saved: artifact ${result.id}`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `Encrypted database backup: artifact ${result.id} (90 days). SHA-256: ${result.digest}\n`)
  }
  return result
}

export async function main() {
  const key = validateCI(process.env)
  const artifact = new DefaultArtifactClient()
  const exec = promisify(execFile)
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'])
  const commit = stdout.trim()
  console.log(`Deploying main commit: ${commit}`)
  try {
    await deploy([], {
      beforePromote: async () => {
        const result = await exec('git', ['ls-remote', 'https://github.com/anthonyli/pet-bloom.git', 'refs/heads/main'], { timeout: 30_000 })
        if (result.stdout.split(/\s/)[0] !== commit) throw new Error('A newer main commit is waiting; skip stale promotion')
      },
      migrateDatabase: () => migrate([], {
        backupAlways: true,
        persistBackup: backup => persistEncryptedBackup(backup, {
          key, name: `turso-backup-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
          upload: (...args) => artifact.uploadArtifact(...args)
        })
      })
    })
  } finally {
    key.fill(0)
    // The encrypted artifact is durable before any migration, even on failure.
    await rm('data/backups/turso', { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    // Database/CLI errors can include private values. Never dump the raw error.
    console.error('Automatic release stopped. Check configuration and the last completed step; production was not promoted unless the promotion step had started.')
    process.exitCode = 1
  })
}
