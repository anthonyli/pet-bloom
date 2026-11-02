import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Deployment entry point is a standalone Node.js module.
import { target, validateLocal, validateRemote, validateRelease, verifyLive, testEnvironment, release } from '../scripts/deploy-vercel.mjs'

const project = { id: target.project, accountId: target.team, resourceConfig: { functionDefaultRegions: ['sin1'] } }
const envs = [
  { key: 'TURSO_DATABASE_URL', value: target.database, target: ['production'] },
  { key: 'TURSO_AUTH_TOKEN', type: 'sensitive', target: ['production'] }
]
const domain = { name: target.domain, verified: true }
const deployment = { id: 'dpl_test', projectId: target.project, readyState: 'READY', target: 'production', regions: ['sin1'] }
const alias = { projectId: target.project, deploymentId: deployment.id }

describe('production deployment safeguards', () => {
  it('builds first, migrates second, and only then promotes and verifies', async () => {
    const steps: string[] = []
    await release({
      stage: async () => { steps.push('build'); return 'dpl_new' },
      migrate: async () => { steps.push('migrate') },
      promote: async (id: string) => { expect(id).toBe('dpl_new'); steps.push('promote') },
      verify: async () => { steps.push('verify') }
    })
    expect(steps).toEqual(['build', 'migrate', 'promote', 'verify'])
  })

  it('does not migrate after a failed build or promote after a failed migration', async () => {
    const migrate = vi.fn(), promote = vi.fn(), verify = vi.fn()
    await expect(release({ stage: async () => { throw new Error('build failed') }, migrate, promote, verify })).rejects.toThrow()
    expect(migrate).not.toHaveBeenCalled()
    await expect(release({ stage: async () => 'dpl_new', migrate: async () => { throw new Error('backup failed') }, promote, verify })).rejects.toThrow()
    expect(promote).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
  })
  it('accepts a fresh checkout but rejects a link to another project', () => {
    const pkg = { name: 'pet-bloom' }
    const config = { framework: 'nextjs', regions: ['sin1'] }
    expect(() => validateLocal(pkg, config)).not.toThrow()
    expect(() => validateLocal(pkg, config, { projectId: 'other', orgId: target.team })).toThrow()
    expect(() => validateLocal(pkg, { ...config, regions: ['hnd1'] })).toThrow()
  })

  it('requires the intended team, Singapore database and production secret', () => {
    expect(() => validateRemote(project, envs, domain)).not.toThrow()
    expect(() => validateRemote({ ...project, accountId: 'other' }, envs, domain)).toThrow()
    expect(() => validateRemote({ ...project, resourceConfig: { functionDefaultRegions: ['hnd1'] } }, envs, domain)).toThrow()
    expect(() => validateRemote(project, [{ ...envs[0], value: 'libsql://other.turso.io' }, envs[1]], domain)).toThrow()
    expect(() => validateRemote(project, [envs[0], { ...envs[1], target: ['preview'] }], domain)).toThrow()
    expect(() => validateRemote(project, envs, { ...domain, verified: false })).toThrow()
  })

  it('does not mistake an older healthy release for the new deployment', async () => {
    const health = vi.fn(async () => ({ status: 'ok', database: 'turso' }))
    const get = vi.fn(async (endpoint: string) => endpoint.includes('/aliases/') ? { ...alias, deploymentId: 'dpl_old' } : deployment)
    await expect(verifyLive(deployment.id, { get, health, attempts: 1 })).rejects.toThrow()
    expect(health).not.toHaveBeenCalled()
    expect(() => validateRelease({ ...deployment, regions: ['hnd1'] }, alias, deployment.id)).toThrow()
  })

  it('retries propagation and requires Turso rather than local SQLite', async () => {
    const get = async (endpoint: string) => endpoint.includes('/aliases/') ? alias : deployment
    const health = vi.fn().mockResolvedValueOnce({ status: 'ok', database: 'sqlite' }).mockResolvedValueOnce({ status: 'ok', database: 'turso' })
    const sleep = vi.fn(async () => {})
    await expect(verifyLive(deployment.id, { get, health, sleep, attempts: 2 })).resolves.toBeUndefined()
    expect(health).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    await expect(verifyLive(deployment.id, { get, health: async () => ({ status: 'error' }), attempts: 1 })).rejects.toThrow()
  })

  it('does not pass production or optional cloud-test credentials into tests', () => {
    const source = { PATH: '/bin', TURSO_AUTH_TOKEN: 'secret', TURSO_TEST_DATABASE_URL: 'production', VERCEL_TOKEN: 'secret', VERCEL: '1', DATABASE_PATH: 'production.db' }
    expect(testEnvironment(source)).toEqual({ PATH: '/bin' })
    expect(source.TURSO_AUTH_TOKEN).toBe('secret')
  })
})
