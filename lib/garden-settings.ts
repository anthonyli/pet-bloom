import { z } from 'zod'

const step = z.object({ experience: z.number().int().min(1).max(10000), badges: z.number().int().min(0).max(100) })
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
})
export const gardenSettingsSchema = z.object({
  growth: z.array(step).length(7),
  allowChangePet: z.boolean(),
  hunger: z.object({
    enabled: z.boolean(), minutes: z.number().int().min(1).max(525600),
    excludeWeekends: z.boolean(), excludeHolidays: z.boolean(),
    timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }),
    holidays: z.array(z.object({ start: date, end: date }).refine(value => value.start <= value.end)).max(100)
  }),
  sickness: z.boolean(), resetToEgg: z.boolean(), eggThreshold: z.number().int().min(-10000).max(-1),
  signedGrowth: z.boolean()
})
export type GardenSettings = z.infer<typeof gardenSettingsSchema>
export type GrowthStep = GardenSettings['growth'][number]
export interface SettingsVersion { id: string; version: number; value: GardenSettings; created_at: number }
export function defaultGardenSettings(): GardenSettings {
  return {
    growth: [40, 60, 80, 100, 120, 140, 160].map(experience => ({ experience, badges: 1 })),
    allowChangePet: true,
    hunger: { enabled: false, minutes: 2880, excludeWeekends: true, excludeHolidays: true, timeZone: 'Asia/Shanghai', holidays: [] },
    sickness: false, resetToEgg: false, eggThreshold: -10, signedGrowth: false
  }
}
export const graduationExperience = (steps: GrowthStep[]) => steps.reduce((sum, step) => sum + step.experience, 0)
