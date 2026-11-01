import type { GardenSettings } from './garden-settings'
import { growthLevel } from './growth'

import { zonedDateParts as parts, zonedMidnight as midnight } from './date-time'

export interface PetStatus { form: 'unadopted' | 'normal' | 'sick' | 'egg'; hungry: boolean; lastFedAt: number }
export function eligibleElapsed(start: number, end: number, hunger: GardenSettings['hunger'], limit = Infinity) {
  if (end <= start) return 0
  if (!hunger.excludeWeekends && (!hunger.excludeHolidays || !hunger.holidays.length)) return end - start
  let cursor = start, elapsed = 0
  while (cursor < end && elapsed < limit) {
    const local = parts(cursor, hunger.timeZone)
    const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day + 1))
    const next = midnight(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate(), hunger.timeZone)
    const boundary = Math.min(end, next > cursor ? next : cursor + 3600000)
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()
    const excluded = (hunger.excludeWeekends && (weekday === 0 || weekday === 6)) || (hunger.excludeHolidays && hunger.holidays.some(range => range.start <= local.date && local.date <= range.end))
    if (!excluded) elapsed += boundary - cursor
    cursor = boundary
  }
  return elapsed
}
export function petStatus(petId: string | null, points: number, exp: number, lastFedAt: number, settings: GardenSettings, now = Date.now()): PetStatus {
  if (!petId) return { form: 'unadopted', hungry: false, lastFedAt }
  const form = settings.resetToEgg && points <= settings.eggThreshold ? 'egg' : settings.sickness && points < 0 && growthLevel(exp, settings.growth) === 1 ? 'sick' : 'normal'
  const threshold = settings.hunger.minutes * 60000
  const hungry = settings.hunger.enabled && lastFedAt > 0 && eligibleElapsed(lastFedAt, now, settings.hunger, threshold) >= threshold
  return { form, hungry, lastFedAt }
}
