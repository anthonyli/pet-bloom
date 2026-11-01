import { z } from 'zod'

export const teachingRoles = ['homeroom', 'subject', 'other'] as const
export const teacherProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  subject: z.string().trim().min(1).max(60),
  teachingRole: z.enum(teachingRoles)
})
