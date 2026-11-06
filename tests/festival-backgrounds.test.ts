import { describe, expect, it } from 'vitest'
import { zonedDateParts, zonedMidnight } from '../lib/date-time'
import { defaultGardenSettings } from '../lib/garden-settings'
import { equippedBackgroundId, expireFestivalBackgrounds, petBackgrounds } from '../lib/pet-backgrounds'
import { festivalRules, getFestivalBackgrounds } from '../lib/server/festival-backgrounds'
import type { Snapshot, Student } from '../lib/types'

const time = (date: string) => Date.parse(date)
const offers = (date: string, zone = 'Asia/Shanghai') => getFestivalBackgrounds(time(date), zone).backgrounds
const ids = (date: string, zone = 'Asia/Shanghai') => offers(date, zone).map(offer => offer.background_id)
const atNoon = (date: string) => `${date}T12:00:00+08:00`

const dates = [
  ['spring-festival', '2026-02-17'], ['lantern-festival', '2026-03-03'],
  ['qingming', '2026-04-05'], ['dragon-boat', '2026-06-19'],
  ['qixi', '2026-08-19'], ['ghost-festival', '2026-08-27'],
  ['mid-autumn', '2026-09-25'], ['double-ninth', '2026-10-18'],
  ['laba', '2026-01-26'], ['national-day', '2026-10-01'],
  ['labour-day', '2026-05-01'], ['childrens-day', '2026-06-01'],
  ['teachers-day', '2026-09-10'], ['new-year', '2026-01-01'],
  ['valentines-day', '2026-02-14'], ['womens-day', '2026-03-08'],
  ['earth-day', '2026-04-22'], ['book-day', '2026-04-23'],
  ['mothers-day', '2026-05-10'], ['fathers-day', '2026-06-21'],
  ['easter', '2026-04-05'], ['halloween', '2026-10-31'],
  ['thanksgiving', '2026-11-26'], ['christmas', '2026-12-25'],
  ['st-patricks-day', '2026-03-17'], ['diwali', '2026-11-08'],
  ['eid-al-fitr', '2026-03-20'], ['hanukkah', '2026-12-05'],
  ['lunar-new-years-eve', '2026-02-16'], ['little-new-year', '2026-02-10'],
  ['dragon-head-raising', '2026-03-20'], ['winter-solstice', '2026-12-22'],
  ['arbor-day', '2026-03-12'], ['youth-day', '2026-05-04'],
  ['cpc-founding-day', '2026-07-01'], ['army-day', '2026-08-01'],
  ['farmers-harvest-festival', '2026-09-23']
] as const

function snapshotAt(date: string, overrides: Partial<Student> = {}): Snapshot {
  return {
    user: { id: 'teacher', username: 'teacher', display_name: '教师', subject: '语文', teaching_role: 'homeroom', profile_complete: true },
    settings: { id: 'settings', version: 1, value: defaultGardenSettings(), created_at: 0 },
    classes: [], badges: [], rules: [], records: [], items: [], redemptions: [],
    students: [{ id: 'student', class_id: 'class', name: '学生', student_no: '', pet_id: 'panda', points: 0, pet_exp: 0, generation: 0, badge_count: 0, spent_badges: 0, background_id: 'garden', owned_background_ids: ['garden'], festival_background_id: null, festival_background_expires_at: null, ...overrides }],
    festival_backgrounds: getFestivalBackgrounds(time(date), 'Asia/Shanghai')
  }
}

describe('服务端节日免费日历', () => {
  it('显式覆盖37款节日且排除4款日常背景', () => {
    expect(Object.keys(festivalRules).sort()).toEqual(petBackgrounds.filter(background => background.category !== 'everyday').map(background => background.id).sort())
    expect(dates).toHaveLength(37)
    expect(getFestivalBackgrounds(time('2026-11-01T00:00:00Z'), 'Asia/Shanghai').unsupported_background_ids).toEqual([])
  })
  it.each(dates)('%s 在主日 %s 可免费使用', (id, date) => {
    expect(ids(atNoon(date))).toContain(id)
    const offer = offers(atNoon(date)).find(offer => offer.background_id === id)!
    expect(offer.expires_at).toBeGreaterThan(time(atNoon(date)))
    if (id !== 'hanukkah') {
      const [year, month, day] = date.split('-').map(Number)
      expect(offer.expires_at).toBe(zonedMidnight(year, month, day + 1, 'Asia/Shanghai'))
    }
  })
  it('同日节日共存，不采用调休长假或第二个庆典日', () => {
    expect(ids(atNoon('2026-04-05')).sort()).toEqual(['easter', 'qingming'])
    expect(ids(atNoon('2026-03-20')).sort()).toEqual(['dragon-head-raising', 'eid-al-fitr'])
    expect(ids(atNoon('2026-02-18'))).not.toContain('spring-festival')
    expect(ids(atNoon('2026-10-02'))).not.toContain('national-day')
    expect(ids(atNoon('2026-03-21'))).not.toContain('eid-al-fitr')
  })
  it.each(['2026-02-10', '2026-02-11'])('小年兼容腊月二十三和二十四 %s', date => {
    expect(ids(atNoon(date))).toContain('little-new-year')
  })
  it.each(['2024-02-09', '2025-01-28', '2026-02-16', '2027-02-05'])('除夕在大小月均为春节前一日 %s', date => {
    expect(ids(atNoon(date))).toContain('lunar-new-years-eve')
    expect(ids(atNoon(date))).not.toContain('spring-festival')
  })
  it('农历普通月不重复开放到闰月', () => {
    expect(ids(atNoon('2023-02-21'))).toContain('dragon-head-raising')
    expect(ids(atNoon('2023-03-23'))).not.toContain('dragon-head-raising')
  })
  it.each([
    ['2026-11-08', '2026-11-09'], ['2027-10-29', '2027-10-28'],
    ['2028-10-17', '2028-11-15'], ['2029-11-05', '2029-11-06'],
    ['2030-10-26', '2030-10-25']
  ])('排灯节采用印度主日 %s，不采用异地主日或补休日 %s', (main, other) => {
    expect(ids(atNoon(main))).toContain('diwali')
    expect(ids(atNoon(other))).not.toContain('diwali')
    expect(getFestivalBackgrounds(time(atNoon(main)), 'Asia/Shanghai').unsupported_background_ids).not.toContain('diwali')
  })
  it('没有可信年份时明确不支持，不影响其他节日', () => {
    const result = getFestivalBackgrounds(time(atNoon('2031-12-25')), 'Asia/Shanghai')
    expect(result.unsupported_background_ids).toContain('diwali')
    expect(result.backgrounds.map(offer => offer.background_id)).toContain('christmas')
  })
  it('学校时区决定开放和结束，日期不使用浏览器时区', () => {
    expect(ids('2026-09-30T16:00:00Z', 'Asia/Shanghai')).toContain('national-day')
    expect(ids('2026-09-30T16:00:00Z', 'UTC')).not.toContain('national-day')
    expect(ids('2026-10-01T16:00:00Z', 'Asia/Shanghai')).not.toContain('national-day')
    expect(ids('2026-10-01T16:00:00Z', 'UTC')).toContain('national-day')
    const now = time('2026-12-31T16:00:00Z'), result = getFestivalBackgrounds(now, 'Asia/Shanghai')
    expect(result).toMatchObject({ server_now: now, valid_until: time('2027-01-01T16:00:00Z'), time_zone: 'Asia/Shanghai' })
    expect(result.backgrounds.map(offer => offer.background_id)).toContain('new-year')
  })
  it('按学校当地自然日处理夏令时，不固定加24小时', () => {
    const spring = getFestivalBackgrounds(time('2026-03-08T05:00:00Z'), 'America/New_York')
    expect(spring.valid_until - spring.server_now).toBe(23 * 3600000)
    expect(spring.backgrounds.find(offer => offer.background_id === 'womens-day')?.expires_at).toBe(time('2026-03-09T04:00:00Z'))
    const autumn = getFestivalBackgrounds(time('2026-11-01T04:00:00Z'), 'America/New_York')
    expect(autumn.valid_until - autumn.server_now).toBe(25 * 3600000)
  })
  it('光明节按八个学校民用日开放，忽略库中的日落近似', () => {
    expect(ids(atNoon('2026-12-04'))).not.toContain('hanukkah')
    for (let day = 5; day <= 12; day++) {
      const offer = offers(atNoon(`2026-12-${String(day).padStart(2, '0')}`)).find(offer => offer.background_id === 'hanukkah')
      expect(offer?.expires_at).toBe(time('2026-12-12T16:00:00Z'))
    }
    expect(ids('2026-12-12T16:00:00Z')).not.toContain('hanukkah')
  })
  it.each([
    ['2026-03-08T04:30:00Z', false, '2026-03-08T05:00:00Z'],
    ['2026-03-08T04:59:59.999Z', false, '2026-03-08T05:00:00Z'],
    ['2026-03-08T05:00:00Z', true, '2026-03-09T04:00:00Z'],
    ['2026-03-08T05:00:00.001Z', true, '2026-03-09T04:00:00Z'],
    ['2026-03-09T03:59:59.999Z', true, '2026-03-09T04:00:00Z'],
    ['2026-03-09T04:00:00Z', false, '2026-03-10T04:00:00Z'],
    ['2026-03-09T04:00:00.001Z', false, '2026-03-10T04:00:00Z']
  ] as const)('Havana 缺失午夜的妇女节开放与有效期：%s', (date, available, until) => {
    const result = getFestivalBackgrounds(time(date), 'America/Havana')
    const offer = result.backgrounds.find(row => row.background_id === 'womens-day')
    expect(Boolean(offer)).toBe(available)
    if (available) expect(offer?.expires_at).toBe(time('2026-03-09T04:00:00Z'))
    expect(result.valid_until).toBe(time(until))
    expect(result.valid_until).toBeGreaterThan(result.server_now)
  })
  it.each([
    ['America/Havana', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
    ['America/Santiago', '2026-09-06T04:00:00Z', '2026-09-07T03:00:00Z'],
    ['Africa/Cairo', '2026-04-23T22:00:00Z', '2026-04-24T21:00:00Z'],
    ['Pacific/Apia', '2011-12-30T10:00:00Z', '2011-12-31T10:00:00Z']
  ])('%s 跳变前后1毫秒均有未来的日历有效期', (zone, date, nextDate) => {
    const boundary = time(date)
    for (const offset of [-1, 0, 1]) {
      const result = getFestivalBackgrounds(boundary + offset, zone)
      expect(result.valid_until).toBe(offset < 0 ? boundary : time(nextDate))
      expect(result.valid_until).toBeGreaterThan(result.server_now)
    }
  })
  it('跨年仍保留上一年开始的光明节窗口', () => {
    const offer = offers(atNoon('2025-01-01')).find(offer => offer.background_id === 'hanukkah')
    expect(offer?.expires_at).toBe(time('2025-01-02T16:00:00Z'))
    expect(ids(atNoon('2025-01-03'))).not.toContain('hanukkah')
  })
  it('共享时区工具保持当地日期与午夜一致', () => {
    expect(zonedDateParts(time('2026-10-31T16:00:00Z'), 'Asia/Shanghai')).toMatchObject({ date: '2026-11-01', hour: 0 })
    expect(zonedMidnight(2026, 12, 32, 'Asia/Shanghai')).toBe(time('2026-12-31T16:00:00Z'))
  })
})

describe('浏览器过期权益裁剪', () => {
  it('未到期时返回原快照，不把临时背景算作拥有', () => {
    const expiry = time('2026-10-31T16:00:00Z')
    const snapshot = snapshotAt('2026-10-31T00:00:00Z', { festival_background_id: 'halloween', festival_background_expires_at: expiry })
    expect(expireFestivalBackgrounds(snapshot, expiry - 1)).toBe(snapshot)
    expect(equippedBackgroundId(snapshot.students[0])).toBe('halloween')
    expect(snapshot.students[0].owned_background_ids).toEqual(['garden'])
  })
  it('断网或迟到快照到午夜立即恢复长期背景，不改永久账本', () => {
    const expiry = time('2026-10-31T16:00:00Z')
    const snapshot = snapshotAt('2026-10-31T00:00:00Z', { festival_background_id: 'halloween', festival_background_expires_at: expiry })
    const expired = expireFestivalBackgrounds(snapshot, expiry)
    expect(expired.festival_backgrounds.backgrounds).toEqual([])
    expect(expired.students[0]).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], festival_background_id: null, festival_background_expires_at: null, spent_badges: 0 })
    expect(equippedBackgroundId(expired.students[0])).toBe('garden')
    expect(expireFestivalBackgrounds(expired, expiry + 1000)).toBe(expired)
    expect(snapshot.students[0].festival_background_id).toBe('halloween')
  })
  it('没有长期背景时恢复默认，缺失临时截止时间也不保留', () => {
    const snapshot = snapshotAt('2026-10-31T00:00:00Z', { background_id: null, owned_background_ids: [], festival_background_id: 'halloween', festival_background_expires_at: null })
    expect(equippedBackgroundId(expireFestivalBackgrounds(snapshot, time('2026-10-31T01:00:00Z')).students[0])).toBeNull()
  })
  it('每天清单过期不提前取消多日已选装扮，也不延长存储截止时间', () => {
    const expiry = time('2026-12-12T16:00:00Z')
    const snapshot = snapshotAt('2026-12-05T00:00:00Z', { festival_background_id: 'hanukkah', festival_background_expires_at: expiry })
    const nextDay = expireFestivalBackgrounds(snapshot, time('2026-12-05T16:00:00Z'))
    expect(nextDay.festival_backgrounds.backgrounds).toEqual([])
    expect(nextDay.students[0].festival_background_expires_at).toBe(expiry)
    expect(equippedBackgroundId(nextDay.students[0])).toBe('hanukkah')
    expect(equippedBackgroundId(expireFestivalBackgrounds(nextDay, expiry).students[0])).toBe('garden')
  })
})
