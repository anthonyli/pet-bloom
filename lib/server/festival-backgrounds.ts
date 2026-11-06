import Holidays from 'date-holidays'
import { zonedDateParts, nextZonedDateChange } from '../date-time'
import { holidayBackgroundIds, versionSevenBackgroundIds } from '../pet-backgrounds'
import type { FestivalBackgroundAvailability } from '../types'

type FestivalBackgroundId = typeof holidayBackgroundIds[number] | typeof versionSevenBackgroundIds[number]

export const festivalRules: Record<FestivalBackgroundId, readonly string[]> = {
  'spring-festival': ['chinese 01-0-01'],
  'lantern-festival': ['chinese 01-0-15'],
  qingming: ['chinese 5-01 solarterm'],
  'dragon-boat': ['chinese 05-0-05'],
  qixi: ['chinese 07-0-07'],
  'ghost-festival': ['chinese 07-0-15'],
  'mid-autumn': ['chinese 08-0-15'],
  'double-ninth': ['chinese 09-0-09'],
  laba: ['chinese 12-0-08'],
  'national-day': ['10-01'],
  'labour-day': ['05-01'],
  'childrens-day': ['06-01'],
  'teachers-day': ['09-10'],
  'new-year': ['01-01'],
  'valentines-day': ['02-14'],
  'womens-day': ['03-08'],
  'earth-day': ['04-22'],
  'book-day': ['04-23'],
  'mothers-day': ['2nd Sunday in May'],
  'fathers-day': ['3rd Sunday in June'],
  easter: ['easter'],
  halloween: ['10-31'],
  thanksgiving: ['4th Thursday in November'],
  christmas: ['12-25'],
  'st-patricks-day': ['03-17'],
  diwali: [],
  'eid-al-fitr': ['1 Shawwal'],
  hanukkah: ['25 Kislev P8D'],
  'lunar-new-years-eve': ['chinese 01-0-00'],
  'little-new-year': ['chinese 12-0-23', 'chinese 12-0-24'],
  'dragon-head-raising': ['chinese 02-0-02'],
  'winter-solstice': ['chinese 22-01 solarterm'],
  'arbor-day': ['03-12'],
  'youth-day': ['05-04'],
  'cpc-founding-day': ['07-01'],
  'army-day': ['08-01'],
  'farmers-harvest-festival': ['chinese 16-01 solarterm']
}

// 印度新德里 Lakshmi Puja 主日，已按 Drik Panchang 与 timeanddate India 逐年核对。
const diwaliDates: Record<number, string> = {
  2026: '2026-11-08',
  2027: '2027-10-29',
  2028: '2028-10-17',
  2029: '2029-11-05',
  2030: '2030-10-26'
}
const calendar = new Holidays({ timezone: 'Asia/Shanghai', languages: 'en' })
for (const [id, rules] of Object.entries(festivalRules)) {
  for (const rule of rules) calendar.setHoliday(rule, { name: id, type: 'observance' })
}

type CalendarDay = { id: string; year: number; month: number; day: number; days: number }
const years = new Map<number, CalendarDay[]>()
function calendarYear(year: number) {
  const cached = years.get(year)
  if (cached) return cached
  const days = calendar.getHolidays(year).map(holiday => {
    // 宗教历法的日落时刻不等于学校民用日，统一按规则给出的日期开放。
    const [eventYear, month, day] = holiday.date.slice(0, 10).split('-').map(Number)
    return { id: holiday.name, year: eventYear, month, day, days: holiday.name === 'hanukkah' ? 8 : 1 }
  })
  if (diwaliDates[year]) {
    const [eventYear, month, day] = diwaliDates[year].split('-').map(Number)
    days.push({ id: 'diwali', year: eventYear, month, day, days: 1 })
  }
  if (years.size >= 8) years.delete(years.keys().next().value!)
  years.set(year, days)
  return days
}

export function getFestivalBackgrounds(now: number, timeZone: string): FestivalBackgroundAvailability {
  const local = zonedDateParts(now, timeZone)
  const localDate = Date.UTC(local.year, local.month - 1, local.day)
  const validUntil = nextZonedDateChange(now, timeZone)
  const currentYear = calendarYear(local.year)
  const supported = new Set(currentYear.map(day => day.id))
  const available = new Map<string, number>()
  for (const year of [local.year - 1, local.year, local.year + 1]) {
    for (const day of calendarYear(year)) {
      // Compare civil dates, since one date can occupy disjoint time intervals.
      const start = Date.UTC(day.year, day.month - 1, day.day)
      const end = Date.UTC(day.year, day.month - 1, day.day + day.days)
      if (start <= localDate && localDate < end) {
        let expiresAt = validUntil
        for (;;) {
          const next = zonedDateParts(expiresAt, timeZone)
          const nextDate = Date.UTC(next.year, next.month - 1, next.day)
          if (nextDate < start || nextDate >= end) break
          expiresAt = nextZonedDateChange(expiresAt, timeZone)
        }
        available.set(day.id, expiresAt)
      }
    }
  }
  return {
    server_now: now,
    valid_until: validUntil,
    time_zone: timeZone,
    backgrounds: [...available].map(([background_id, expires_at]) => ({ background_id, expires_at })),
    unsupported_background_ids: Object.keys(festivalRules).filter(id => !supported.has(id))
  }
}
