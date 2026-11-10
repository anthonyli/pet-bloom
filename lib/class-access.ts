import type { Classroom } from './types'

export function hasClassOwnerAccess(classroom?: Pick<Classroom, 'role'>): boolean {
  return classroom?.role === 'owner' || classroom?.role === 'global_admin'
}
