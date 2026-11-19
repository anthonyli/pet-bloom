import type { Classroom } from './types'

export function hasClassOwnerAccess(classroom?: Pick<Classroom, 'role'>): boolean {
  return classroom?.role === 'owner' || classroom?.role === 'global_admin'
}

export function isActiveClass(classroom: { graduated_at?: number | null }) {
  return classroom.graduated_at == null
}

export function activeClasses<T extends { graduated_at?: number | null }>(classes: readonly T[]) {
  return classes.filter(isActiveClass)
}

// An explicit id may be a graduated class opened from the account menu.
// Otherwise stay on an active class, so graduating the current class leaves the switcher.
export function selectWorkspaceClass<T extends { id: string; graduated_at?: number | null }>(classes: readonly T[], requestedId?: string) {
  if (requestedId && classes.some(classroom => classroom.id === requestedId)) return requestedId
  return activeClasses(classes)[0]?.id || ''
}
