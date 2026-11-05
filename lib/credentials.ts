import { z } from 'zod'

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 30
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export const credentials = z.object({
  username: z.string().trim().min(USERNAME_MIN_LENGTH).max(USERNAME_MAX_LENGTH).regex(/^[\p{L}\p{N}_ .@+\-]+$/u),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)
})

export function credentialError(error: z.ZodError) {
  const field = error.issues[0]?.path[0]
  return field === 'username' ? 'invalidUsername' : field === 'password' ? 'invalidPassword' : 'invalidInput'
}
