import { target, vercelApi, validateRelease, ReleaseError } from '../deploy-vercel.mjs'

// The CLI requires a user profile. Project-scoped CI tokens use project APIs.
export async function stageGitDeployment(commit, { api = vercelApi, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 180 } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new ReleaseError('Invalid release commit')
  const project = await api(`/v9/projects/${target.project}`)
  if (project.link?.type !== 'github' || String(project.link.repoId) !== '1441591486') throw new ReleaseError('Vercel Git connection does not match anthonyli/pet-bloom')
  const previousAlias = await api(`/v4/aliases/${target.domain}`)
  const created = await api('/v13/deployments', { method: 'POST', body: {
    name: 'pet-bloom', project: target.project, target: 'production',
    autoAssignCustomDomains: false,
    gitSource: { type: 'github', repoId: '1441591486', ref: 'main', sha: commit },
    meta: { releaseCommit: commit, releaseWorkflow: 'github-actions' }
  } })
  const id = created.id
  if (typeof id !== 'string' || !/^dpl_[A-Za-z0-9]+$/.test(id)) throw new ReleaseError('Vercel did not return a deployment ID')
  console.log(`Staged build created: ${id} (commit ${commit})`)
  for (let attempt = 0; attempt < attempts; attempt++) {
    const deployment = await api(`/v13/deployments/${id}`)
    if (deployment.readyState === 'READY') {
      validateRelease(deployment, { projectId: target.project, deploymentId: id }, id)
      if ((deployment.gitSource?.sha ?? deployment.meta?.githubCommitSha) !== commit) throw new ReleaseError('Staged build does not match the checked main commit')
      const alias = await api(`/v4/aliases/${target.domain}`)
      if (alias.deploymentId !== previousAlias.deploymentId) throw new ReleaseError('Production alias changed before migration; release stopped')
      console.log(`Staged deployment ready: ${id}; production alias unchanged`)
      return id
    }
    if (['ERROR', 'CANCELED'].includes(deployment.readyState)) throw new ReleaseError(`Staged build ${id} ended with ${deployment.readyState}`)
    if (attempt % 6 === 0) console.log(`Staged build ${id}: ${deployment.readyState}`)
    await sleep(5000)
  }
  throw new ReleaseError(`Timed out waiting for staged build ${id}`)
}

export async function promoteGitDeployment(id, { api = vercelApi } = {}) {
  if (!/^dpl_[A-Za-z0-9]+$/.test(id)) throw new ReleaseError('Invalid promotion deployment ID')
  await api(`/v10/projects/${target.project}/promote/${id}`, { method: 'POST', body: {} })
}
