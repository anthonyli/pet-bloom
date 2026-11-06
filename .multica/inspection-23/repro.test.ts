import { expect, it } from 'vitest'
import { zonedMidnight, zonedDateParts } from '../../lib/date-time'
import { getFestivalBackgrounds } from '../../lib/server/festival-backgrounds'

it('Havana 的日界必须是目标日期第一个真实时刻', () => {
  const value = zonedMidnight(2026, 3, 8, 'America/Havana')
  console.log('Havana midnight', new Date(value).toISOString(), zonedDateParts(value, 'America/Havana'))
  expect(value).toBe(Date.parse('2026-03-08T05:00:00Z'))
})
it('妇女节不能在 Havana 当地 3 月 7 日 23:30 提前开放', () => {
  const timestamp = Date.parse('2026-03-08T04:30:00Z')
  const value = getFestivalBackgrounds(timestamp, 'America/Havana')
  console.log('Havana festival', { local: zonedDateParts(timestamp, 'America/Havana'), value })
  expect(value.backgrounds.map(row => row.background_id)).not.toContain('womens-day')
})
it('日历有效期在 Havana 跨日之前应晚于当前时间', () => {
  const timestamp = Date.parse('2026-03-08T04:30:00Z')
  const value = getFestivalBackgrounds(timestamp, 'America/Havana')
  expect(value.valid_until).toBeGreaterThan(timestamp)
})
it('Santiago 缺失午夜同样必须返回当天起点', () => {
  const value = zonedMidnight(2026, 9, 6, 'America/Santiago')
  expect(value).toBe(Date.parse('2026-09-06T04:00:00Z'))
})
