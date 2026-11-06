import { z } from 'zod'

// Server-only configuration. A class co-admin or a display name grants nothing here.
export function isGlobalAdmin(userId: string): boolean {
  const configured = (process.env.PET_GARDEN_ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
  if (!configured.length || configured.some(id => !z.string().uuid().safeParse(id).success)) return false
  return configured.includes(userId)
}
