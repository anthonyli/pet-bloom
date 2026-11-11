import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const migrationTemp = await mkdtemp(path.join(tmpdir(), 'pet-bloom-test-migrations-'))
try {
  const result = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, PET_BLOOM_MIGRATION_TEST_TEMP: migrationTemp }
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  // libSQL can retain Windows file handles after an intentionally failed batch.
  // The worker process must exit before removing its temporary databases.
  await rm(migrationTemp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
