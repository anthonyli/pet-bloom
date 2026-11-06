import { describe, expect, it } from 'vitest'
import { zonedDateParts, zonedMidnight } from '../lib/date-time'

const hour = 3600000

describe('学校民用日的首个有效时刻', () => {
  it.each([
    ['America/Havana', 2026, 3, 8, '2026-03-08T05:00:00Z', 1],
    ['America/Santiago', 2026, 9, 6, '2026-09-06T04:00:00Z', 1],
    ['Africa/Cairo', 2026, 4, 24, '2026-04-23T22:00:00Z', 1],
    ['Asia/Shanghai', 2026, 3, 8, '2026-03-07T16:00:00Z', 0],
    ['UTC', 2026, 3, 8, '2026-03-08T00:00:00Z', 0],
    // 十五分钟跳变不能硬编码成一小时。
    ['Asia/Kathmandu', 1986, 1, 1, '1985-12-31T18:30:00Z', 0]
  ] as const)('%s %i-%i-%i 的日界为 %s', (zone, year, month, day, expected, localHour) => {
    const start = zonedMidnight(year, month, day, zone)
    expect(start).toBe(Date.parse(expected))
    expect(zonedDateParts(start, zone)).toMatchObject({ year, month, day, hour: localHour })
    expect(zonedDateParts(start - 1, zone).day).not.toBe(day)
    expect(zonedDateParts(start + 1, zone).day).toBe(day)
  })

  it.each([
    ['America/Havana', 2026, 11, 1, '2026-11-01T04:00:00Z'],
    ['America/Goose_Bay', 2009, 11, 1, '2009-11-01T03:00:00Z']
  ] as const)('%s 重复午夜选择第一次，即使随后短暂退回前一天', (zone, year, month, day, expected) => {
    const start = zonedMidnight(year, month, day, zone)
    expect(start).toBe(Date.parse(expected))
    expect(zonedDateParts(start, zone)).toMatchObject({ year, month, day, hour: 0, minute: 0 })
    expect(zonedDateParts(start + hour, zone)).toMatchObject({ year, month, day, hour: 0, minute: 0 })
    expect(zonedDateParts(start - 1, zone).day).not.toBe(day)
  })

  it.each([
    ['America/New_York', 3, 8, 23], ['America/New_York', 11, 1, 25],
    ['America/Havana', 3, 8, 23], ['America/Havana', 11, 1, 25],
    ['Africa/Cairo', 4, 24, 23], ['Africa/Cairo', 10, 29, 25],
    ['Asia/Shanghai', 3, 8, 24], ['UTC', 11, 1, 24]
  ] as const)('%s %i-%i 按自然日计算 %i 小时', (zone, month, day, hours) => {
    expect(zonedMidnight(2026, month, day + 1, zone) - zonedMidnight(2026, month, day, zone)).toBe(hours * hour)
  })

  it('规范化跨月、跨年和闰日', () => {
    expect(zonedMidnight(2026, 12, 32, 'Asia/Shanghai')).toBe(Date.parse('2026-12-31T16:00:00Z'))
    expect(zonedMidnight(2026, 2, 29, 'UTC')).toBe(Date.parse('2026-03-01T00:00:00Z'))
    expect(zonedMidnight(2024, 2, 30, 'UTC')).toBe(Date.parse('2024-03-01T00:00:00Z'))
    expect(zonedMidnight(2026, 1, 0, 'UTC')).toBe(Date.parse('2025-12-31T00:00:00Z'))
  })

  it('整日跳过时与下一有效日期共用日界，区间为空而非倒退', () => {
    const zone = 'Pacific/Apia'
    const before = zonedMidnight(2011, 12, 29, zone)
    const skipped = zonedMidnight(2011, 12, 30, zone)
    const after = zonedMidnight(2011, 12, 31, zone)
    expect(skipped).toBe(Date.parse('2011-12-30T10:00:00Z'))
    expect(skipped).toBe(after)
    expect(skipped - before).toBe(24 * hour)
    expect(zonedDateParts(skipped - 1, zone).date).toBe('2011-12-29')
    expect(zonedDateParts(skipped, zone).date).toBe('2011-12-31')
    expect(zonedMidnight(2011, 12, 32, zone)).toBeGreaterThan(after)
  })
})
