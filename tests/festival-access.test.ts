import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'

let garden: Garden, owner: string, colleague: string, classId: string, studentId: string
const holiday = Date.UTC(2026, 9, 1, 4)
const holidayEnd = Date.UTC(2026, 9, 1, 16)
const time = (value: number) => vi.mocked(Date.now).mockReturnValue(value)
const state = (id = classId) => garden.snapshot(owner, id)
const student = () => state().students.find(row => row.id === studentId)!
const ledger = () => Object.fromEntries(['badges', 'items', 'redemptions'].map(table => [table, garden.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
function settings(id: string, edit: (value: ReturnType<Garden['settings']>['value']) => void) {
  const current = garden.settings(owner, id), value = structuredClone(current.value)
  edit(value)
  garden.saveSettings(owner, { classId: id, version: current.version, value })
}
function own(backgroundId: string) {
  const itemId = state().items.find(item => item.background_id === backgroundId)!.id
  garden.redeem(owner, { studentId, itemId })
}
function permitColleague() {
  const invitation = garden.createInvitation(owner, classId)
  garden.joinClass(colleague, { code: invitation.code })
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(holiday)
  garden = new Garden(createDatabase(':memory:'))
  const teacher = (username: string) => {
    const id = garden.register({ username, password: 'festival-test-password' }).user.id
    garden.saveProfile(id, { displayName: username, subject: '科学', teachingRole: 'subject' })
    return id
  }
  owner = teacher('festival-owner')
  colleague = teacher('festival-colleague')
  classId = garden.createClass(owner, { name: '节日背景测试班' }).id
  studentId = garden.addStudents(owner, { classId, students: [{ name: '零徽章学生' }] })[0]
  garden.adopt(owner, studentId, { petId: 'panda' })
})
afterEach(() => { vi.restoreAllMocks(); garden.db.close() })

describe('服务端节日临时背景权限', () => {
  it('学校节日零徽章免费使用，不扣徽章、不改商品、不写兑换也不变成永久持有', () => {
    const before = ledger()
    expect(state().festival_backgrounds).toMatchObject({ server_now: holiday, valid_until: holidayEnd, time_zone: 'Asia/Shanghai', backgrounds: expect.arrayContaining([{ background_id: 'national-day', expires_at: holidayEnd }]) })
    garden.setBackground(owner, studentId, { backgroundId: 'national-day', cost: 0, expiresAt: Infinity })
    expect(student()).toMatchObject({ background_id: null, festival_background_id: 'national-day', festival_background_expires_at: holidayEnd, badge_count: 0, spent_badges: 0, owned_background_ids: [] })
    expect(ledger()).toEqual(before)
  })

  it('非对应节日、日常背景和伪造免费字段仍拒绝，状态完全不变', () => {
    const before = student(), beforeLedger = ledger()
    for (const backgroundId of ['garden', 'christmas', 'labour-day']) {
      expect(() => garden.setBackground(owner, studentId, { backgroundId, free: true, server_now: Date.UTC(2026, 11, 25), owned_background_ids: [backgroundId], festival_background_expires_at: holidayEnd })).toThrow('backgroundNotOwned')
    }
    expect(student()).toEqual(before)
    expect(ledger()).toEqual(beforeLedger)
    time(holidayEnd)
    expect(() => garden.setBackground(owner, studentId, { backgroundId: 'national-day', date: '2026-10-01', timeZone: 'Asia/Shanghai' })).toThrow('backgroundNotOwned')
  })

  it('免费当日仍校验教师归属，协作者失权后不能重选或用客户端classId绕过', () => {
    expect(() => garden.setBackground(colleague, studentId, { backgroundId: 'national-day', classId, actor_user_id: owner })).toThrow('notFound')
    permitColleague()
    garden.setBackground(colleague, studentId, { backgroundId: 'national-day' })
    const before = student()
    garden.leaveClass(colleague, classId)
    expect(() => garden.setBackground(colleague, studentId, { backgroundId: null })).toThrow('notFound')
    expect(student()).toEqual(before)
    expect(() => garden.setBackground(owner, 'missing-student', { backgroundId: 'national-day' })).toThrow('notFound')
  })

  it('免费覆盖不改长期背景，午夜立即恢复，次年同节日也不复活旧临时选择', () => {
    garden.evaluate(owner, { studentIds: [studentId], custom: { points: 40 } })
    own('garden')
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    expect(student()).toMatchObject({ background_id: 'garden', festival_background_id: 'national-day', owned_background_ids: ['garden'], spent_badges: 1 })
    time(holidayEnd - 1)
    expect(student().festival_background_id).toBe('national-day')
    time(holidayEnd)
    expect(student()).toMatchObject({ background_id: 'garden', festival_background_id: null, festival_background_expires_at: null, owned_background_ids: ['garden'], spent_badges: 1 })
    expect(state().festival_backgrounds.backgrounds.some(row => row.background_id === 'national-day')).toBe(false)
    time(Date.UTC(2027, 9, 1, 4))
    expect(state().festival_backgrounds.backgrounds.some(row => row.background_id === 'national-day')).toBe(true)
    expect(student().festival_background_id).toBeNull()
  })

  it('普通日已拥有可全年使用，保存已拥有或默认均清除临时覆盖', () => {
    garden.evaluate(owner, { studentIds: [studentId], custom: { points: 40 } })
    own('national-day')
    time(Date.UTC(2026, 10, 1, 4))
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    expect(student()).toMatchObject({ background_id: 'national-day', festival_background_id: null, festival_background_expires_at: null })
    time(Date.UTC(2026, 11, 25, 4))
    garden.setBackground(owner, studentId, { backgroundId: 'christmas' })
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    expect(student()).toMatchObject({ background_id: 'national-day', festival_background_id: null, festival_background_expires_at: null })
    garden.setBackground(owner, studentId, { backgroundId: 'christmas' })
    garden.setBackground(owner, studentId, { backgroundId: null })
    expect(student()).toMatchObject({ background_id: null, festival_background_id: null, festival_background_expires_at: null, owned_background_ids: ['national-day'] })
  })

  it('快照不延长已存截止时间，过期临时选择即使仍在同一节日也被裁掉', () => {
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    const shorter = holiday + 60000
    garden.db.prepare('UPDATE students SET festival_background_expires_at = ? WHERE id = ?').run(shorter, studentId)
    expect(student().festival_background_expires_at).toBe(shorter)
    time(shorter - 1)
    expect(student().festival_background_expires_at).toBe(shorter)
    time(shorter)
    expect(student()).toMatchObject({ festival_background_id: null, festival_background_expires_at: null })
    expect(state().festival_backgrounds.backgrounds.some(row => row.background_id === 'national-day')).toBe(true)
    expect(garden.db.prepare('SELECT festival_background_expires_at FROM students WHERE id = ?').get(studentId)).toEqual({ festival_background_expires_at: shorter })
  })

  it('快照将临时截止夹到当前服务端节日窗口，错误ID及不完整临时状态不返回', () => {
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    garden.db.prepare('UPDATE students SET festival_background_expires_at = ? WHERE id = ?').run(holidayEnd + 86400000, studentId)
    expect(student().festival_background_expires_at).toBe(holidayEnd)
    for (const backgroundId of ['garden', 'christmas', 'unknown']) {
      garden.db.prepare('UPDATE students SET festival_background_id = ? WHERE id = ?').run(backgroundId, studentId)
      expect(student()).toMatchObject({ festival_background_id: null, festival_background_expires_at: null })
    }
    garden.db.prepare('UPDATE students SET festival_background_id = ?, festival_background_expires_at = NULL WHERE id = ?').run('national-day', studentId)
    expect(student()).toMatchObject({ festival_background_id: null, festival_background_expires_at: null })
  })

  it('多日节日清单每天过期，但已选临时背景保留到原连续窗口末，不续期', () => {
    time(Date.UTC(2026, 11, 5, 4))
    const offer = state().festival_backgrounds.backgrounds.find(row => row.background_id === 'hanukkah')!
    expect(offer).toBeDefined()
    garden.setBackground(owner, studentId, { backgroundId: 'hanukkah' })
    const first = state()
    expect(offer.expires_at).toBeGreaterThan(first.festival_backgrounds.valid_until)
    time(first.festival_backgrounds.valid_until)
    expect(student()).toMatchObject({ festival_background_id: 'hanukkah', festival_background_expires_at: offer.expires_at })
    time(offer.expires_at)
    expect(student()).toMatchObject({ festival_background_id: null, festival_background_expires_at: null })
  })

  it('学校时区独立决定当天，不使用客户端时区或其他班级设置', () => {
    const secondClass = garden.createClass(owner, { name: '纽约学校班' }).id
    const second = garden.addStudents(owner, { classId: secondClass, students: [{ name: '纽约学生' }] })[0]
    settings(secondClass, value => { value.hunger.timeZone = 'America/New_York' })
    time(Date.UTC(2026, 8, 30, 17))
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    expect(() => garden.setBackground(owner, second, { backgroundId: 'national-day', classId, timeZone: 'Asia/Shanghai' })).toThrow('backgroundNotOwned')
    expect(state().festival_backgrounds.time_zone).toBe('Asia/Shanghai')
    expect(state(secondClass).festival_backgrounds.time_zone).toBe('America/New_York')
    time(Date.UTC(2026, 9, 1, 5))
    garden.setBackground(owner, second, { backgroundId: 'national-day' })
    expect(state(secondClass).students[0].festival_background_expires_at).toBe(Date.UTC(2026, 9, 2, 4))
  })

  it('改变学校时区在事务内清空全班包括未领养学生的临时字段，不动另一班和永久持有', () => {
    garden.evaluate(owner, { studentIds: [studentId], custom: { points: 40 } })
    own('garden')
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    const egg = garden.addStudents(owner, { classId, students: [{ name: '尚未领养' }] })[0]
    const otherClass = garden.createClass(owner, { name: '另一班' }).id
    const otherStudent = garden.addStudents(owner, { classId: otherClass, students: [{ name: '另一班学生' }] })[0]
    for (const id of [studentId, egg, otherStudent]) garden.setBackground(owner, id, { backgroundId: 'national-day' })
    settings(classId, value => { value.allowChangePet = !value.allowChangePet })
    expect(state().students.every(row => row.festival_background_id === 'national-day')).toBe(true)
    settings(classId, value => { value.hunger.timeZone = 'America/New_York' })
    expect(state().students.every(row => row.festival_background_id === null && row.festival_background_expires_at === null)).toBe(true)
    expect(student()).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 1 })
    expect(state(otherClass).students[0].festival_background_id).toBe('national-day')
    expect(garden.db.prepare('SELECT festival_background_id, festival_background_expires_at FROM students WHERE id = ?').get(egg)).toEqual({ festival_background_id: null, festival_background_expires_at: null })
  })

  it('免费期间永久兑换同款只解锁，之后明确装扮才改为长期，退款不自动赠送免费权限', () => {
    garden.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
    own('garden')
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    own('national-day')
    expect(student()).toMatchObject({ background_id: 'garden', festival_background_id: 'national-day', owned_background_ids: ['garden', 'national-day'], spent_badges: 2 })
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    expect(student()).toMatchObject({ background_id: 'national-day', festival_background_id: null, festival_background_expires_at: null })
    garden.undoRedemption(owner, state().redemptions.find(row => row.background_id === 'national-day')!.id)
    expect(student()).toMatchObject({ background_id: null, festival_background_id: null, owned_background_ids: ['garden'], spent_badges: 1 })
    time(holidayEnd)
    expect(() => garden.setBackground(owner, studentId, { backgroundId: 'national-day' })).toThrow('backgroundNotOwned')
  })

  it('退款保留已经合法选中的免费覆盖，不续期也不撤销其他永久背景', () => {
    garden.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
    own('garden')
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    own('national-day')
    garden.undoRedemption(owner, state().redemptions.find(row => row.background_id === 'national-day')!.id)
    expect(student()).toMatchObject({ background_id: 'garden', festival_background_id: 'national-day', festival_background_expires_at: holidayEnd, owned_background_ids: ['garden'], spent_badges: 1 })
    time(holidayEnd)
    expect(student()).toMatchObject({ background_id: 'garden', festival_background_id: null })
  })

  it('换宠、毕业和再次领养不延长临时窗口，仍到点恢复长期装扮', () => {
    garden.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
    own('garden')
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    garden.setBackground(owner, studentId, { backgroundId: 'national-day' })
    settings(classId, value => { value.allowChangePet = true })
    garden.changePet(owner, studentId, { petId: 'westie' })
    garden.adopt(owner, studentId, { petId: 'panda' })
    expect(student()).toMatchObject({ background_id: 'garden', festival_background_id: 'national-day', festival_background_expires_at: holidayEnd, owned_background_ids: ['garden'] })
    time(holidayEnd)
    expect(student()).toMatchObject({ background_id: 'garden', festival_background_id: null })
  })
})
