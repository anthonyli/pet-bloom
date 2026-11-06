import { describe, expect, it } from 'vitest'
import { defaultGardenSettings } from '../lib/garden-settings'
import { eligibleElapsed, petStatus } from '../lib/pet-status'
const time = (date: string) => new Date(date).getTime()
const hour = 3600000

describe('宠物形态、饥饿与学校日历', () => {
  it.each([
    [-9, -20, 'sick'],
    [-7, 0, 'sick'],
    [-7, 8, 'sick'],
    [-1, 39, 'sick'],
    [-7, 40, 'normal'],
    [-10, 0, 'egg'],
    [-13, -2, 'egg'],
    [-13, 100, 'egg'],
    [5, -13, 'normal'],
    [0, -7, 'normal'],
    [0, 0, 'normal']
  ] as const)('负分形态按积分%s判断，成长值%s保留等级判断', (points, exp, form) => {
    const settings = { ...defaultGardenSettings(), resetToEgg: true, sickness: true }
    expect(petStatus('panda', points, exp, 0, settings).form).toBe(form)
  })
  it('生病开关、领养状态和自定义等级门槛均生效', () => {
    const settings = { ...defaultGardenSettings(), sickness: true }
    expect(petStatus('panda', -7, 0, 0, { ...settings, sickness: false }).form).toBe('normal')
    expect(petStatus(null, -7, 0, 0, settings).form).toBe('unadopted')
    settings.growth[0].experience = 10
    expect(petStatus('panda', -7, 9, 0, settings).form).toBe('sick')
    expect(petStatus('panda', -7, 10, 0, settings).form).toBe('normal')
    settings.growth[0].experience = 100
    expect(petStatus('panda', -7, 40, 0, settings).form).toBe('sick')
  })
  it('关闭蛋形态与尚未领养时不触发，仍使用教师配置的积分线', () => {
    const settings = { ...defaultGardenSettings(), resetToEgg: true, eggThreshold: -20 }
    expect(petStatus('panda', -13, -30, 0, settings).form).toBe('normal')
    expect(petStatus('panda', -20, 0, 0, settings).form).toBe('egg')
    expect(petStatus('panda', -20, 0, 0, { ...settings, resetToEgg: false }).form).toBe('normal')
    expect(petStatus(null, -20, 0, 0, settings).form).toBe('unadopted')
  })
  it('准确处理提醒阈值和无宠物、关闭状态', () => {
    const settings = defaultGardenSettings(), start = time('2026-10-30T00:00:00Z')
    settings.hunger = { ...settings.hunger, enabled: true, minutes: 60, excludeWeekends: false, excludeHolidays: false }
    expect(petStatus('panda', 0, 0, start, settings, start + hour - 1).hungry).toBe(false)
    expect(petStatus('panda', 0, 0, start, settings, start + hour).hungry).toBe(true)
    expect(petStatus(null, 0, 0, start, settings, start + hour).hungry).toBe(false)
    settings.hunger.enabled = false
    expect(petStatus('panda', 0, 0, start, settings, start + hour).hungry).toBe(false)
  })
  it('按学校时区排除周末，而不是浏览器所在时区', () => {
    const hunger = defaultGardenSettings().hunger
    const start = time('2026-10-30T15:00:00Z'), end = time('2026-11-02T01:00:00Z')
    expect(eligibleElapsed(start, end, hunger)).toBe(10 * hour)
    expect(eligibleElapsed(start, end, { ...hunger, timeZone: 'UTC' })).toBe(10 * hour)
    expect(eligibleElapsed(time('2026-10-30T16:00:00Z'), time('2026-10-31T00:00:00Z'), hunger)).toBe(0)
    expect(eligibleElapsed(time('2026-10-30T16:00:00Z'), time('2026-10-31T00:00:00Z'), { ...hunger, timeZone: 'UTC' })).toBe(8 * hour)
  })
  it('假期起止日期均排除，重叠假期不重复扣除', () => {
    const hunger = { ...defaultGardenSettings().hunger, excludeWeekends: false, holidays: [{ start: '2026-10-01', end: '2026-10-03' }, { start: '2026-10-03', end: '2026-10-04' }] }
    expect(eligibleElapsed(time('2026-09-30T16:00:00Z'), time('2026-10-05T16:00:00Z'), hunger)).toBe(24 * hour)
    expect(eligibleElapsed(time('2026-09-30T16:00:00Z'), time('2026-10-05T16:00:00Z'), { ...hunger, excludeHolidays: false })).toBe(120 * hour)
  })
  it.each([
    ['2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 23],
    ['2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 25]
  ])('夏令时当地一天按实际时长计算 %s', (start, end, hours) => {
    const hunger = { ...defaultGardenSettings().hunger, timeZone: 'America/New_York', excludeWeekends: false, holidays: [{ start: '2026-01-01', end: '2026-01-01' }] }
    expect(eligibleElapsed(time(start), time(end), hunger)).toBe(hours * hour)
    expect(eligibleElapsed(time(start), time(end), { ...hunger, excludeWeekends: true })).toBe(0)
  })
  it('周末与假期合并排除，不影响后续工作日', () => {
    const hunger = { ...defaultGardenSettings().hunger, holidays: [{ start: '2026-10-30', end: '2026-11-02' }] }
    expect(eligibleElapsed(time('2026-10-29T16:00:00Z'), time('2026-11-03T16:00:00Z'), hunger)).toBe(24 * hour)
  })
  it('未来起点不累计，达到提醒后可以提前结束长区间扫描', () => {
    const hunger = defaultGardenSettings().hunger, start = time('2026-10-30T00:00:00Z')
    expect(eligibleElapsed(start, start - 1, hunger)).toBe(0)
    const elapsed = eligibleElapsed(start, time('2030-01-01T00:00:00Z'), hunger, hour)
    expect(elapsed).toBeGreaterThanOrEqual(hour)
    expect(elapsed).toBeLessThanOrEqual(24 * hour)
  })
  it.each([
    ['America/Havana', '2026-03-07T05:00:00Z', '2026-03-09T04:00:00Z', '2026-03-08', 24],
    ['America/Havana', '2026-10-31T04:00:00Z', '2026-11-02T05:00:00Z', '2026-11-01', 24],
    ['America/Santiago', '2026-09-05T04:00:00Z', '2026-09-07T03:00:00Z', '2026-09-06', 24],
    ['Africa/Cairo', '2026-04-23T21:30:00Z', '2026-04-24T21:30:00Z', '2026-04-24', 1],
    ['Pacific/Apia', '2011-12-29T10:00:00Z', '2011-12-31T10:00:00Z', '2011-12-30', 48]
  ])('%s 缺失、重复或跳过日界不多扣校假、不跨日误计', (zone, start, end, holiday, hours) => {
    const hunger = { ...defaultGardenSettings().hunger, timeZone: zone, excludeWeekends: false, excludeHolidays: true, holidays: [{ start: holiday, end: holiday }] }
    expect(eligibleElapsed(time(start), time(end), hunger)).toBe(hours * hour)
  })
  it.each([
    ['America/Havana', '2026-03-07T04:30:00Z', '2026-03-09T04:30:00Z'],
    ['America/Havana', '2026-10-31T03:30:00Z', '2026-11-02T05:30:00Z'],
    ['Pacific/Apia', '2011-12-30T09:30:00Z', '2012-01-01T10:30:00Z']
  ])('%s 跨跳变周末只累计相邻工作日，并正常结束迭代', (zone, start, end) => {
    const hunger = { ...defaultGardenSettings().hunger, timeZone: zone, excludeWeekends: true, excludeHolidays: false }
    expect(eligibleElapsed(time(start), time(end), hunger)).toBe(hour)
  })
})
