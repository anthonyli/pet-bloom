import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
// @ts-expect-error Standalone deployment module.
import { backupKey, cryptFile } from '../scripts/lib/encrypted-backup.mjs'
// @ts-expect-error Standalone deployment module.
import { validateCI, persistEncryptedBackup } from '../scripts/deploy-github.mjs'
const folders: string[] = []
const key = backupKey('01'.repeat(32))
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })
async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), 'pet-bloom-ci-')); folders.push(folder)
  const filename = path.join(folder, 'snapshot.db')
  await writeFile(filename, 'PRIVATE database fixture')
  await writeFile(path.join(folder, 'manifest.json'), '{"sha256":"fixture"}')
  return { filename, folder }
}
describe('automatic production release', () => {
  it('authenticates encrypted backups and never publishes tampered output or overwrites a file', async () => {
    const { filename, folder } = await fixture()
    const encrypted = path.join(folder, 'backup.enc'), restored = path.join(folder, 'restored.db')
    await cryptFile(filename, encrypted, key)
    expect((await readFile(encrypted)).includes(Buffer.from('PRIVATE'))).toBe(false)
    await cryptFile(encrypted, restored, key, true)
    expect(await readFile(restored)).toEqual(await readFile(filename))
    await expect(cryptFile(encrypted, restored, key, true)).rejects.toThrow()
    expect(await readFile(restored)).toEqual(await readFile(filename))
    const damaged = await readFile(encrypted); damaged[25] ^= 1; await writeFile(encrypted, damaged)
    const bad = path.join(folder, 'bad.db')
    await expect(cryptFile(encrypted, bad, key, true)).rejects.toThrow()
    await expect(readFile(bad)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('uploads only encrypted snapshot and manifest and waits for durable acknowledgement', async () => {
    const backup = await fixture()
    const upload = vi.fn(async (_name: string, files: string[]) => {
      expect(files.map(file => path.basename(file))).toEqual(['snapshot.db.enc', 'manifest.json.enc'])
      for (const file of files) expect((await readFile(file)).includes(Buffer.from('PRIVATE'))).toBe(false)
      return { id: 123, digest: 'hash' }
    })
    expect(await persistEncryptedBackup(backup, { key, upload, name: 'test' })).toMatchObject({ id: 123 })
    await expect(persistEncryptedBackup(await fixture(), { key, upload: async () => ({}), name: 'test' })).rejects.toThrow('not confirmed')
    await expect(persistEncryptedBackup(await fixture(), { key, upload: async () => { throw new Error('network') }, name: 'test' })).rejects.toThrow('network')
  })
  it('rejects forks, PRs, non-main branches and missing secrets before release work', () => {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'anthonyli/pet-bloom', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', VERCEL_TOKEN: 'v', TURSO_API_TOKEN: 't', ACTIONS_RUNTIME_TOKEN: 'a', ACTIONS_RESULTS_URL: 'u', BACKUP_ENCRYPTION_KEY: '01'.repeat(32) }
    expect(validateCI(env)).toEqual(key)
    for (const changes of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REPOSITORY: 'fork/pet-bloom' }, { GITHUB_REF: 'refs/heads/topic' }, { VERCEL_TOKEN: '' }, { BACKUP_ENCRYPTION_KEY: 'short' }]) expect(() => validateCI({ ...env, ...changes })).toThrow()
  })
  it('routes main changes through serialized deployment, preserving preview deployments', async () => {
    const workflow = parse(await readFile('.github/workflows/production.yml', 'utf8'))
    expect(workflow.on.push.branches).toEqual(['main'])
    expect(workflow.on.pull_request).toBeUndefined()
    expect(workflow.concurrency['cancel-in-progress']).toBe(false)
    expect(workflow.jobs.deploy.environment).toBe('production')
    const config = JSON.parse(await readFile('vercel.json', 'utf8'))
    expect(config.git.deploymentEnabled).toEqual({ main: false })
  })
})
