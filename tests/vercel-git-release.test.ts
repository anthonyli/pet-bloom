import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Standalone deployment module.
import { stageGitDeployment, promoteGitDeployment } from '../scripts/lib/vercel-git-release.mjs'
// @ts-expect-error Standalone deployment configuration.
import { target } from '../scripts/deploy-config.mjs'

const commit = 'a'.repeat(40)
function mockApi(overrides = {}) {
  return vi.fn(async (endpoint: string) => {
    if (endpoint === `/v9/projects/${target.project}`) return { link: { type: 'github', repoId: 1441591486 } }
    if (endpoint.includes('/aliases/')) return { deploymentId: 'dpl_previous' }
    if (endpoint === '/v13/deployments') return { id: 'dpl_new' }
    return { id: 'dpl_new', projectId: target.project, target: 'production', readyState: 'READY', regions: ['sin1'], gitSource: { sha: commit }, ...overrides }
  })
}
describe('project-scoped Git deployment', () => {
  it('pins the commit and disables domain assignment before migration', async () => {
    const api = mockApi()
    await expect(stageGitDeployment(commit, { api })).resolves.toBe('dpl_new')
    expect(api).toHaveBeenCalledWith('/v13/deployments', { method: 'POST', body: expect.objectContaining({ autoAssignCustomDomains: false, target: 'production', gitSource: { type: 'github', repoId: '1441591486', ref: 'main', sha: commit } }) })
  })
  it('rejects failed builds or a different commit before migration', async () => {
    await expect(stageGitDeployment(commit, { api: mockApi({ readyState: 'ERROR' }) })).rejects.toThrow('ended with ERROR')
    await expect(stageGitDeployment(commit, { api: mockApi({ gitSource: { sha: 'b'.repeat(40) } }) })).rejects.toThrow('does not match')
  })
  it('waits for READY and refuses an early production alias change', async () => {
    const base = mockApi(), sleep = vi.fn(async () => {})
    let reads = 0, aliases = 0
    const api = async (endpoint: string) => {
      if (endpoint.includes('/aliases/')) return { deploymentId: ++aliases === 1 ? 'dpl_previous' : 'dpl_other' }
      if (endpoint === '/v13/deployments/dpl_new' && reads++ === 0) return { readyState: 'BUILDING' }
      return base(endpoint)
    }
    await expect(stageGitDeployment(commit, { api, sleep })).rejects.toThrow('alias changed')
    expect(sleep).toHaveBeenCalledTimes(1)
  })
  it('promotes only the specified deployment in the configured project', async () => {
    const api = vi.fn(async () => {})
    await promoteGitDeployment('dpl_new', { api })
    expect(api).toHaveBeenCalledWith(`/v10/projects/${target.project}/promote/dpl_new`, { method: 'POST', body: {} })
  })
})
