import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'

let garden: Garden, owner: string, colleague: string, classId: string, studentId: string
const holiday = Date.UTC(2026, 9, 1, 4)
const holidayEnd = Date.UTC(2026, 9, 1, 16)
const time = (value: number) => vi.mocked(Date.now).mockReturnValue(value)
const state = async (id = classId) => (await garden.snapshot(owner, id))
const student = async () => (await state()).students.find(row => row.id === studentId)!
const ledger = async () => Object.fromEntries(await Promise.all(['badges', 'items', 'redemptions'].map(async table => [table, (await garden.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())])))
async function settings(id: string, edit: (value: Awaited<ReturnType<Garden['settings']>>['value']) => void) {
  const current = await garden.settings(owner, id), value = structuredClone(current.value)
  edit(value)
  await garden.saveSettings(owner, { classId: id, version: current.version, value })
}
async function own(backgroundId: string) {
  const itemId = (await state()).items.find(item => item.background_id === backgroundId)!.id
  await garden.redeem(owner, { studentId, itemId })
}
async function permitColleague() {
  const invitation = await garden.createInvitation(owner, classId)
  await garden.joinClass(colleague, { code: invitation.code })
}

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(holiday)
  garden = new Garden(createDatabase(':memory:'))
  const teacher = async (username: string) => {
    const id = (await garden.register({ username, password: 'festival-test-password' })).user.id
    await garden.saveProfile(id, { displayName: username, subject: '科学', teachingRole: 'subject' })
    return id
  }
  owner = (await teacher('festival-owner'))
  colleague = (await teacher('festival-colleague'))
  classId = (await garden.createClass(owner, { name: '节日背景测试班' })).id
  studentId = (await garden.addStudents(owner, { classId, students: [{ name: '零徽章学生' }] }))[0]
  await garden.adopt(owner, studentId, { petId: 'panda' })
})
afterEach(() => { vi.restoreAllMocks(); garden.db.close() })

describe('服务端节日临时背景权限', () => {
  it('Havana 缺失午夜按真实日界授权，保留已兑换背景与徽章账本', async () => {
    await settings(classId, value => { value.hunger.timeZone = 'America/Havana' })
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 40 } })
    await own('garden')
    await garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    const beforeLedger = await ledger()
    const start = Date.parse('2026-03-08T05:00:00Z'), end = Date.parse('2026-03-09T04:00:00Z')
    const permanent = { background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 1 }
    for (const now of [Date.parse('2026-03-08T04:30:00Z'), start - 1]) {
      time(now)
      await expect(garden.setBackground(owner, studentId, { backgroundId: 'womens-day' })).rejects.toThrow('backgroundNotOwned')
      expect(await student()).toMatchObject({ ...permanent, festival_background_id: null })
      expect((await state()).festival_backgrounds.valid_until).toBe(start)
    }
    for (const now of [start, start + 1, end - 1]) {
      time(now)
      await expect(garden.setBackground(colleague, studentId, { backgroundId: 'womens-day' })).rejects.toThrow('notFound')
      await garden.setBackground(owner, studentId, { backgroundId: 'womens-day' })
      expect(await student()).toMatchObject({ ...permanent, festival_background_id: 'womens-day', festival_background_expires_at: end })
    }
    for (const now of [end, end + 1]) {
      time(now)
      await expect(garden.setBackground(owner, studentId, { backgroundId: 'womens-day' })).rejects.toThrow('backgroundNotOwned')
      expect(await student()).toMatchObject({ ...permanent, festival_background_id: null, festival_background_expires_at: null })
      await garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    }
    expect(await ledger()).toEqual(beforeLedger)
  })

  it('学校节日零徽章免费使用，不扣徽章、不改商品、不写兑换也不变成永久持有', async () => {
    const before = await ledger()
    expect((await state()).festival_backgrounds).toMatchObject({ server_now: holiday, valid_until: holidayEnd, time_zone: 'Asia/Shanghai', backgrounds: expect.arrayContaining([{ background_id: 'national-day', expires_at: holidayEnd }]) })
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day', cost: 0, expiresAt: Infinity })
    expect(await student()).toMatchObject({ background_id: null, festival_background_id: 'national-day', festival_background_expires_at: holidayEnd, badge_count: 0, spent_badges: 0, owned_background_ids: [] })
    expect(await ledger()).toEqual(before)
  })

  it('非对应节日、日常背景和伪造免费字段仍拒绝，状态完全不变', async () => {
    const before = await student(), beforeLedger = await ledger()
    for (const backgroundId of ['garden', 'christmas', 'labour-day']) {
      await expect(async () => (await garden.setBackground(owner, studentId, { backgroundId, free: true, server_now: Date.UTC(2026, 11, 25), owned_background_ids: [backgroundId], festival_background_expires_at: holidayEnd }))).rejects.toThrow('backgroundNotOwned')
    }
    expect(await student()).toEqual(before)
    expect(await ledger()).toEqual(beforeLedger)
    time(holidayEnd)
    await expect(async () => (await garden.setBackground(owner, studentId, { backgroundId: 'national-day', date: '2026-10-01', timeZone: 'Asia/Shanghai' }))).rejects.toThrow('backgroundNotOwned')
  })

  it('免费当日仍校验教师归属，协作者失权后不能重选或用客户端classId绕过', async () => {
    await expect(async () => (await garden.setBackground(colleague, studentId, { backgroundId: 'national-day', classId, actor_user_id: owner }))).rejects.toThrow('notFound')
    await permitColleague()
    await garden.setBackground(colleague, studentId, { backgroundId: 'national-day' })
    const before = await student()
    await garden.leaveClass(colleague, classId)
    await expect(async () => (await garden.setBackground(colleague, studentId, { backgroundId: null }))).rejects.toThrow('notFound')
    expect(await student()).toEqual(before)
    await expect(async () => (await garden.setBackground(owner, 'missing-student', { backgroundId: 'national-day' }))).rejects.toThrow('notFound')
  })

  it('免费覆盖不改长期背景，午夜立即恢复，次年同节日也不复活旧临时选择', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 40 } })
    await own('garden')
    await garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    expect(await student()).toMatchObject({ background_id: 'garden', festival_background_id: 'national-day', owned_background_ids: ['garden'], spent_badges: 1 })
    time(holidayEnd - 1)
    expect((await student()).festival_background_id).toBe('national-day')
    time(holidayEnd)
    expect(await student()).toMatchObject({ background_id: 'garden', festival_background_id: null, festival_background_expires_at: null, owned_background_ids: ['garden'], spent_badges: 1 })
    expect((await state()).festival_backgrounds.backgrounds.some(row => row.background_id === 'national-day')).toBe(false)
    time(Date.UTC(2027, 9, 1, 4))
    expect((await state()).festival_backgrounds.backgrounds.some(row => row.background_id === 'national-day')).toBe(true)
    expect((await student()).festival_background_id).toBeNull()
  })

  it('普通日已拥有可全年使用，保存已拥有或默认均清除临时覆盖', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 40 } })
    await own('national-day')
    time(Date.UTC(2026, 10, 1, 4))
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    expect(await student()).toMatchObject({ background_id: 'national-day', festival_background_id: null, festival_background_expires_at: null })
    time(Date.UTC(2026, 11, 25, 4))
    await garden.setBackground(owner, studentId, { backgroundId: 'christmas' })
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    expect(await student()).toMatchObject({ background_id: 'national-day', festival_background_id: null, festival_background_expires_at: null })
    await garden.setBackground(owner, studentId, { backgroundId: 'christmas' })
    await garden.setBackground(owner, studentId, { backgroundId: null })
    expect(await student()).toMatchObject({ background_id: null, festival_background_id: null, festival_background_expires_at: null, owned_background_ids: ['national-day'] })
  })

  it('快照不延长已存截止时间，过期临时选择即使仍在同一节日也被裁掉', async () => {
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    const shorter = holiday + 60000
    await garden.db.prepare('UPDATE students SET festival_background_expires_at = ? WHERE id = ?').run(shorter, studentId)
    expect((await student()).festival_background_expires_at).toBe(shorter)
    time(shorter - 1)
    expect((await student()).festival_background_expires_at).toBe(shorter)
    time(shorter)
    expect(await student()).toMatchObject({ festival_background_id: null, festival_background_expires_at: null })
    expect((await state()).festival_backgrounds.backgrounds.some(row => row.background_id === 'national-day')).toBe(true)
    expect(await garden.db.prepare('SELECT festival_background_expires_at FROM students WHERE id = ?').get(studentId)).toEqual({ festival_background_expires_at: shorter })
  })

  it('快照将临时截止夹到当前服务端节日窗口，错误ID及不完整临时状态不返回', async () => {
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    await garden.db.prepare('UPDATE students SET festival_background_expires_at = ? WHERE id = ?').run(holidayEnd + 86400000, studentId)
    expect((await student()).festival_background_expires_at).toBe(holidayEnd)
    for (const backgroundId of ['garden', 'christmas', 'unknown']) {
      await garden.db.prepare('UPDATE students SET festival_background_id = ? WHERE id = ?').run(backgroundId, studentId)
      expect(await student()).toMatchObject({ festival_background_id: null, festival_background_expires_at: null })
    }
    await garden.db.prepare('UPDATE students SET festival_background_id = ?, festival_background_expires_at = NULL WHERE id = ?').run('national-day', studentId)
    expect(await student()).toMatchObject({ festival_background_id: null, festival_background_expires_at: null })
  })

  it('多日节日清单每天过期，但已选临时背景保留到原连续窗口末，不续期', async () => {
    time(Date.UTC(2026, 11, 5, 4))
    const offer = (await state()).festival_backgrounds.backgrounds.find(row => row.background_id === 'hanukkah')!
    expect(offer).toBeDefined()
    await garden.setBackground(owner, studentId, { backgroundId: 'hanukkah' })
    const first = await state()
    expect(offer.expires_at).toBeGreaterThan(first.festival_backgrounds.valid_until)
    time(first.festival_backgrounds.valid_until)
    expect(await student()).toMatchObject({ festival_background_id: 'hanukkah', festival_background_expires_at: offer.expires_at })
    time(offer.expires_at)
    expect(await student()).toMatchObject({ festival_background_id: null, festival_background_expires_at: null })
  })

  it('学校时区独立决定当天，不使用客户端时区或其他班级设置', async () => {
    const secondClass = (await garden.createClass(owner, { name: '纽约学校班' })).id
    const second = (await garden.addStudents(owner, { classId: secondClass, students: [{ name: '纽约学生' }] }))[0]
    await settings(secondClass, value => { value.hunger.timeZone = 'America/New_York' })
    time(Date.UTC(2026, 8, 30, 17))
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    await expect(async () => (await garden.setBackground(owner, second, { backgroundId: 'national-day', classId, timeZone: 'Asia/Shanghai' }))).rejects.toThrow('backgroundNotOwned')
    expect((await state()).festival_backgrounds.time_zone).toBe('Asia/Shanghai')
    expect((await state(secondClass)).festival_backgrounds.time_zone).toBe('America/New_York')
    time(Date.UTC(2026, 9, 1, 5))
    await garden.setBackground(owner, second, { backgroundId: 'national-day' })
    expect((await state(secondClass)).students[0].festival_background_expires_at).toBe(Date.UTC(2026, 9, 2, 4))
  })

  it('改变学校时区在事务内清空全班包括未领养学生的临时字段，不动另一班和永久持有', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 40 } })
    await own('garden')
    await garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    const egg = (await garden.addStudents(owner, { classId, students: [{ name: '尚未领养' }] }))[0]
    const otherClass = (await garden.createClass(owner, { name: '另一班' })).id
    const otherStudent = (await garden.addStudents(owner, { classId: otherClass, students: [{ name: '另一班学生' }] }))[0]
    for (const id of [studentId, egg, otherStudent]) await garden.setBackground(owner, id, { backgroundId: 'national-day' })
    await settings(classId, value => { value.allowChangePet = !value.allowChangePet })
    expect((await state()).students.every(row => row.festival_background_id === 'national-day')).toBe(true)
    await settings(classId, value => { value.hunger.timeZone = 'America/New_York' })
    expect((await state()).students.every(row => row.festival_background_id === null && row.festival_background_expires_at === null)).toBe(true)
    expect(await student()).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 1 })
    expect((await state(otherClass)).students[0].festival_background_id).toBe('national-day')
    expect(await garden.db.prepare('SELECT festival_background_id, festival_background_expires_at FROM students WHERE id = ?').get(egg)).toEqual({ festival_background_id: null, festival_background_expires_at: null })
  })

  it('免费期间永久兑换同款只解锁，之后明确装扮才改为长期，退款不自动赠送免费权限', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
    await own('garden')
    await garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    await own('national-day')
    expect(await student()).toMatchObject({ background_id: 'garden', festival_background_id: 'national-day', owned_background_ids: ['garden', 'national-day'], spent_badges: 2 })
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    expect(await student()).toMatchObject({ background_id: 'national-day', festival_background_id: null, festival_background_expires_at: null })
    await garden.undoRedemption(owner, (await state()).redemptions.find(row => row.background_id === 'national-day')!.id)
    expect(await student()).toMatchObject({ background_id: null, festival_background_id: null, owned_background_ids: ['garden'], spent_badges: 1 })
    time(holidayEnd)
    await expect(async () => (await garden.setBackground(owner, studentId, { backgroundId: 'national-day' }))).rejects.toThrow('backgroundNotOwned')
  })

  it('退款保留已经合法选中的免费覆盖，不续期也不撤销其他永久背景', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
    await own('garden')
    await garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    await own('national-day')
    await garden.undoRedemption(owner, (await state()).redemptions.find(row => row.background_id === 'national-day')!.id)
    expect(await student()).toMatchObject({ background_id: 'garden', festival_background_id: 'national-day', festival_background_expires_at: holidayEnd, owned_background_ids: ['garden'], spent_badges: 1 })
    time(holidayEnd)
    expect(await student()).toMatchObject({ background_id: 'garden', festival_background_id: null })
  })

  it('换宠、毕业和再次领养不延长临时窗口，仍到点恢复长期装扮', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
    await own('garden')
    await garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    await garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    await settings(classId, value => { value.allowChangePet = true })
    await garden.changePet(owner, studentId, { petId: 'westie' })
    await garden.adopt(owner, studentId, { petId: 'panda' })
    expect(await student()).toMatchObject({ background_id: 'garden', festival_background_id: 'national-day', festival_background_expires_at: holidayEnd, owned_background_ids: ['garden'] })
    time(holidayEnd)
    expect(await student()).toMatchObject({ background_id: 'garden', festival_background_id: null })
  })
})
