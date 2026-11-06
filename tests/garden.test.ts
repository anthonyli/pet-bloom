import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from '../lib/server/db'
import { Garden, level } from '../lib/server/garden'
import { exportBackup, restoreBackup } from '../lib/server/backup'
import { DomainError } from '../lib/server/errors'
import type { GardenSettings } from '../lib/garden-settings'
import pets from '../lib/data/pets.json'
import rules from '../lib/data/rules.json'

let garden: Garden, owner: string, other: string, classId: string, studentId: string, positive: string, negative: string
beforeEach(async () => {
  garden = new Garden(createDatabase(':memory:'))
  owner = (await garden.register({ username: 'teacher-a', password: 'Test-password-123' })).user.id
  other = (await garden.register({ username: 'teacher-b', password: 'Test-password-456' })).user.id
  await garden.saveProfile(owner, { displayName: '甲老师', subject: '语文', teachingRole: 'homeroom' })
  await garden.saveProfile(other, { displayName: '乙老师', subject: '数学', teachingRole: 'subject' })
  classId = (await garden.createClass(owner, { name: '测试班级' })).id
  studentId = (await garden.addStudents(owner, { classId, students: [{ name: '测试学生', studentNo: '01' }] }))[0]
  await garden.adopt(owner, studentId, { petId: 'panda' })
  const data = await garden.snapshot(owner)
  positive = data.rules.find(rule => rule.points === 3)!.id
  negative = data.rules.find(rule => rule.points === -2)!.id
})
afterEach(() => garden.db.close())
const scoringState = async () => Object.fromEntries(await Promise.all(['students', 'evaluations', 'growth_events', 'badges', 'rules', 'settings_versions'].map(async table => [table, (await garden.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())])))
async function saveSettings(edit: (value: GardenSettings) => void) {
  const current = await garden.settings(owner, classId), value = structuredClone(current.value)
  edit(value)
  await garden.saveSettings(owner, { classId, version: current.version, value })
}

describe('目录、中英文和账号', () => {
  it('包含 50 种完整八阶段双语宠物，包含 83 条完整中英文规则', async () => {
    expect(pets).toHaveLength(50); expect(rules).toHaveLength(83)
    expect(pets.every(pet => pet.name.zh && pet.name.en)).toBe(true)
    expect(rules.every(rule => rule.name.zh && rule.name.en)).toBe(true)
    expect((await garden.snapshot(owner)).rules).toHaveLength(83)
    expect((await garden.snapshot(other)).rules).toHaveLength(0)
    const templates = await garden.db.prepare('SELECT owner_id, COUNT(*) AS count FROM rules WHERE class_id IS NULL GROUP BY owner_id').all()
    expect(templates).toEqual(expect.arrayContaining([{ owner_id: owner, count: 83 }, { owner_id: other, count: 83 }]))
    const ownerTemplateIds = await garden.db.prepare('SELECT id FROM rules WHERE owner_id = ? AND class_id IS NULL').all(owner)
    const otherTemplateIds = await garden.db.prepare('SELECT id FROM rules WHERE owner_id = ? AND class_id IS NULL').all(other)
    expect(ownerTemplateIds).toHaveLength(83)
    expect(otherTemplateIds).toHaveLength(83)
    expect(ownerTemplateIds.some(row => otherTemplateIds.some(otherRow => (otherRow as { id: string }).id === (row as { id: string }).id))).toBe(false)
  })
  it('登录会话可验证、退出后失效', async () => {
    const session = await garden.login({ username: 'TEACHER-A', password: 'Test-password-123' })
    expect(await garden.authenticate(session.token)).toBe(owner)
    await garden.logout(session.token)
    await expect(async () => (await garden.authenticate(session.token))).rejects.toThrow('unauthorized')
  })
  it('错误口令、短口令和重复用户名被拒绝', async () => {
    await expect(async () => (await garden.login({ username: 'teacher-a', password: 'Wrong-password' }))).rejects.toThrow('invalidCredentials')
    await expect(async () => (await garden.register({ username: 'teacher-c', password: '123' }))).rejects.toThrow()
    await expect(async () => (await garden.register({ username: 'TEACHER-A', password: 'Valid-password' }))).rejects.toThrow('usernameTaken')
  })
  it('密码与会话 token 不以明文保存', async () => {
    const session = await garden.session(owner)
    expect(JSON.stringify(await garden.db.prepare('SELECT * FROM users').all())).not.toContain('Test-password')
    expect(JSON.stringify(await garden.db.prepare('SELECT * FROM sessions').all())).not.toContain(session.token)
  })
})
describe('教师数据隔离与输入验证', () => {
  it('无法读取、改名或删除其他教师的班级', async () => {
    expect((await garden.snapshot(other)).classes).toHaveLength(0)
    await expect(async () => (await garden.snapshot(other, classId))).rejects.toThrow('notFound')
    await expect(async () => (await garden.renameClass(other, classId, { name: '越权' }))).rejects.toThrow('notFound')
    await expect(async () => (await garden.deleteClass(other, classId))).rejects.toThrow('notFound')
  })
  it('不能导入、修改、删除或领养其他教师的学生', async () => {
    await expect(async () => (await garden.addStudents(other, { classId, students: [{ name: '越权' }] }))).rejects.toThrow('notFound')
    await expect(async () => (await garden.updateStudent(other, studentId, { name: '越权' }))).rejects.toThrow('notFound')
    await expect(async () => (await garden.deleteStudent(other, studentId))).rejects.toThrow('notFound')
    await expect(async () => (await garden.adopt(other, studentId, { petId: 'panda' }))).rejects.toThrow('notFound')
  })
  it('更换宠物验证教师归属和宠物目录，未领养学生不能直接更换', async () => {
    await expect(async () => (await garden.changePet(other, studentId, { petId: 'westie' }))).rejects.toThrow('notFound')
    await expect(async () => (await garden.changePet(owner, studentId, { petId: '../../secret' }))).rejects.toThrow()
    const unadopted = (await garden.addStudents(owner, { classId, students: [{ name: '等待领养' }] }))[0]
    await expect(async () => (await garden.changePet(owner, unadopted, { petId: 'westie' }))).rejects.toThrow('invalidInput')
    expect((await garden.student(owner, studentId)).pet_id).toBe('panda')
  })
  it('不能使用其他教师的规则或给其他教师学生评价', async () => {
    await expect(async () => (await garden.evaluate(other, { studentIds: [studentId], ruleId: positive }))).rejects.toThrow('notFound')
    const otherClass = (await garden.createClass(other, { name: '乙老师的班级' })).id
    const otherRule = (await garden.snapshot(other, otherClass)).rules[0].id
    await expect(async () => (await garden.evaluate(other, { studentIds: [studentId], ruleId: otherRule }))).rejects.toThrow('notFound')
  })
  it('拒绝空姓名、无效宠物和零分规则', async () => {
    await expect(async () => (await garden.addStudents(owner, { classId, students: [{ name: ' ' }] }))).rejects.toThrow()
    await expect(async () => (await garden.adopt(owner, studentId, { petId: '../../secret' }))).rejects.toThrow()
    await expect(async () => (await garden.addRule(owner, { classId, name: { zh: '规则', en: 'Rule' }, points: 0, category: 'other' }))).rejects.toThrow()
  })
})
describe('积分、批量事务、撤回与成长', () => {
  it.each([-Number.MAX_SAFE_INTEGER, -1_000_000, -1000, -101, -100, -1, 1, 100, 101, 1000, 1_000_000, Number.MAX_SAFE_INTEGER])('一次性自定义%s分不限业务大小，保存与撤回保留双语原因、规则和数据库版本', async points => {
    const beforeRules = await garden.db.prepare('SELECT * FROM rules ORDER BY id').all(), version = await garden.db.pragma('user_version', { simple: true })
    const batch = await garden.evaluate(owner, { studentIds: [studentId], custom: { points } })
    const state = await garden.snapshot(owner)
    expect(state.records).toMatchObject([{ batch_id: batch.batchId, points, category: 'other', reason: points > 0 ? { zh: '自定义加分', en: 'Custom bonus' } : { zh: '自定义扣分', en: 'Custom deduction' } }])
    expect(await garden.student(owner, studentId)).toMatchObject({ points, pet_exp: Math.max(0, points) })
    expect(state.rules).toHaveLength(83)
    expect(await garden.db.prepare('SELECT * FROM rules ORDER BY id').all()).toEqual(beforeRules)
    await garden.undo(owner, batch.batchId)
    expect(await garden.student(owner, studentId)).toMatchObject({ points: 0, pet_exp: 0 })
    expect(await garden.db.prepare('SELECT * FROM rules ORDER BY id').all()).toEqual(beforeRules)
    expect(await garden.db.pragma('user_version', { simple: true })).toBe(version)
  })
  it.each([
    [3, '', { zh: '自定义加分', en: 'Custom bonus' }],
    [-3, ' \t\n ', { zh: '自定义扣分', en: 'Custom deduction' }],
    [3, ' \t\n ', { zh: '自定义加分', en: 'Custom bonus' }],
    [-3, '', { zh: '自定义扣分', en: 'Custom deduction' }],
    [3, '  主动帮助同学  ', { zh: '主动帮助同学', en: '主动帮助同学' }],
    [-3, '  Please listen carefully  ', { zh: 'Please listen carefully', en: 'Please listen carefully' }],
    [3, `  ${'中'.repeat(80)}  `, { zh: '中'.repeat(80), en: '中'.repeat(80) }],
    [-3, `  ${'a'.repeat(80)}  `, { zh: 'a'.repeat(80), en: 'a'.repeat(80) }]
  ])('自定义%s分原因%j去除首尾空白后保存双语原文', async (points, reason, expected) => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points, reason } })
    expect((await garden.snapshot(owner)).records).toMatchObject([{ points, reason: expected, category: 'other' }])
  })
  it.each([
    ['零分', { custom: { points: 0 } }],
    ['正小数', { custom: { points: 1.5 } }],
    ['负小数', { custom: { points: -1.5 } }],
    ['正不安全整数', { custom: { points: Number.MAX_SAFE_INTEGER + 1 } }],
    ['负不安全整数', { custom: { points: Number.MIN_SAFE_INTEGER - 1 } }],
    ['NaN直接领域输入', { custom: { points: Number.NaN } }],
    ['正无穷直接领域输入', { custom: { points: Number.POSITIVE_INFINITY } }],
    ['负无穷直接领域输入', { custom: { points: Number.NEGATIVE_INFINITY } }],
    ['缺少分数', { custom: {} }],
    ['字符串分数', { custom: { points: '3' } }],
    ['空分数', { custom: { points: null } }],
    ['中文81字', { custom: { points: 3, reason: '中'.repeat(81) } }],
    ['英文81字', { custom: { points: -3, reason: 'a'.repeat(81) } }],
    ['非文本原因', { custom: { points: 3, reason: { zh: '原因', en: 'Reason' } } }],
    ['空自定义', { custom: null }],
    ['空学生列表', { studentIds: [], custom: { points: 3 } }],
    ['两种评分均未传', {}],
    ['同时传规则和自定义', { custom: { points: 3 }, ruleId: 'existing-rule' }]
  ])('非法自定义评分%s抛出invalidEvaluation且无任何写入', async (_, input) => {
    const before = await scoringState()
    let error: unknown
    try { await garden.evaluate(owner, { studentIds: [studentId], ...input, ...('ruleId' in input ? { ruleId: positive } : {}) }) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'invalidEvaluation', status: 400 })
    expect(await scoringState()).toEqual(before)
  })
  it.each([-1, 1])('累计积分抵达%s方向的安全整数边界后，额外一分返回409且全部回滚', async direction => {
    const points = direction * Number.MAX_SAFE_INTEGER
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points } })
    expect(await garden.student(owner, studentId)).toMatchObject({ points, pet_exp: Math.max(0, points) })
    const before = await scoringState()
    let error: unknown
    try { await garden.evaluate(owner, { studentIds: [studentId], custom: { points: direction } }) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'scoreLimitExceeded', status: 409 })
    expect(await scoringState()).toEqual(before)
  })
  it.each([-1, 1])('批量%s分中后一位累计积分溢出，前一位已评分和成长奖励也全部回滚', async direction => {
    const second = (await garden.addStudents(owner, { classId, students: [{ name: '即将越界' }] }))[0]
    await garden.adopt(owner, second, { petId: 'westie' })
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: direction * 39 } })
    await garden.evaluate(owner, { studentIds: [second], custom: { points: direction * Number.MAX_SAFE_INTEGER } })
    const before = await scoringState()
    let error: unknown
    try { await garden.evaluate(owner, { studentIds: [studentId, second], custom: { points: direction } }) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'scoreLimitExceeded', status: 409 })
    expect(await scoringState()).toEqual(before)
  })
  it('截零模式累计积分仍为0但成长已达安全边界时，再加一分同样返回409且无写入', async () => {
    expect((await garden.settings(owner, classId)).value.signedGrowth).toBe(false)
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: -Number.MAX_SAFE_INTEGER } })
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: Number.MAX_SAFE_INTEGER } })
    expect(await garden.student(owner, studentId)).toMatchObject({ points: 0, pet_exp: Number.MAX_SAFE_INTEGER })
    const before = await scoringState()
    let error: unknown
    try { await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 1 } }) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'scoreLimitExceeded', status: 409 })
    expect(await scoringState()).toEqual(before)
  })
  it('成长重基准产生的合法小数不被安全整数评分限制误拒，后续评分和撤回保留小数', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 1 } })
    await saveSettings(value => { value.growth[0].experience = 50 })
    expect(await garden.student(owner, studentId)).toMatchObject({ points: 1, pet_exp: 1.25 })
    const batch = await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 101 } })
    expect(await garden.student(owner, studentId)).toMatchObject({ points: 102, pet_exp: 102.25 })
    await garden.undo(owner, batch.batchId)
    expect(await garden.student(owner, studentId)).toMatchObject({ points: 1, pet_exp: 1.25 })
  })
  it('成长重基准事件把经验推过安全边界时，设置版本、事件和评分状态整体回滚', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: Number.MAX_SAFE_INTEGER } })
    const before = await scoringState()
    let error: unknown
    try { await saveSettings(value => { value.growth[0].experience = 41 }) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'scoreLimitExceeded', status: 409 })
    expect(await scoringState()).toEqual(before)
  })
  it('大额自定义批量评分去重并为每人保留一条成长事件，整批撤回', async () => {
    const second = (await garden.addStudents(owner, { classId, students: [{ name: '自定义第二位' }] }))[0]
    await garden.adopt(owner, second, { petId: 'westie' })
    const batch = await garden.evaluate(owner, { studentIds: [studentId, studentId, second, second], custom: { points: 1_000_000, reason: '共同进步' } })
    expect((await garden.snapshot(owner)).records.filter(row => row.batch_id === batch.batchId)).toHaveLength(2)
    expect(await garden.db.prepare("SELECT COUNT(*) AS n FROM growth_events WHERE kind = 'evaluation'").get()).toEqual({ n: 2 })
    for (const id of [studentId, second]) expect((await garden.snapshot(owner)).students.find(row => row.id === id)).toMatchObject({ points: 1_000_000, pet_exp: 1_000_000, badge_count: 7 })
    await garden.undo(owner, batch.batchId)
    for (const id of [studentId, second]) expect((await garden.snapshot(owner)).students.find(row => row.id === id)).toMatchObject({ points: 0, pet_exp: 0, badge_count: 0 })
    expect((await garden.snapshot(owner)).records.filter(row => row.batch_id === batch.batchId).every(row => row.undone === 1)).toBe(true)
    await expect(async () => (await garden.undo(owner, batch.batchId))).rejects.toThrow('notFound')
  })
  it('自定义成长发放等级徽章，扣分与撤回按历史重算且不重复奖励', async () => {
    const first = await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 40 } })
    const second = await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 60, reason: '突破等级' } })
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: 100, pet_exp: 100, badge_count: 2 })
    expect((await garden.snapshot(owner)).badges.map(row => row.level).sort()).toEqual([2, 3])
    const deduction = await garden.evaluate(owner, { studentIds: [studentId], custom: { points: -2 } })
    expect(await garden.student(owner, studentId)).toMatchObject({ points: 98, pet_exp: 98 })
    await garden.undo(owner, deduction.batchId)
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: 100, pet_exp: 100, badge_count: 2 })
    await garden.undo(owner, second.batchId)
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: 40, pet_exp: 40, badge_count: 1 })
    await garden.undo(owner, first.batchId)
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: 0, pet_exp: 0, badge_count: 0 })
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 100 } })
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ pet_exp: 100, badge_count: 2 })
    expect(await garden.db.prepare('SELECT level FROM badges WHERE student_id = ? ORDER BY level').all(studentId)).toEqual([{ level: 2 }, { level: 3 }])
  })
  it('自定义扣分按累计积分触发蛋和Lv1生病，成长仍非负时加分恢复及撤回都立即生效', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: -11 } })
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: -11, pet_exp: 0, status: { form: 'normal' } })
    await saveSettings(value => { value.sickness = true; value.resetToEgg = true })
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: -11, pet_exp: 0, status: { form: 'egg' } })
    const sick = await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 2 } })
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: -9, pet_exp: 2, status: { form: 'sick' } })
    const recovered = await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 9 } })
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: 0, pet_exp: 11, status: { form: 'normal' } })
    await garden.undo(owner, recovered.batchId)
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: -9, pet_exp: 2, status: { form: 'sick' } })
    await garden.undo(owner, sick.batchId)
    expect((await garden.snapshot(owner)).students[0]).toMatchObject({ points: -11, pet_exp: 0, status: { form: 'egg' } })
  })
  it('700 经验满级，正确处理全部等级边界', () => {
    expect([0, 39, 40, 99, 100, 180, 280, 400, 540, 700, 900].map(exp => level(exp))).toEqual([1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 8])
  })
  it('加分后同步成长，撤回扣分会恢复成长而非再次扣减', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    const batch = await garden.evaluate(owner, { studentIds: [studentId], ruleId: negative })
    expect((await garden.student(owner, studentId)).pet_exp).toBe(1)
    await garden.undo(owner, batch.batchId)
    expect((await garden.student(owner, studentId)).pet_exp).toBe(3)
    expect((await garden.student(owner, studentId)).points).toBe(3)
  })
  it('低于零的经验被截断，撤回会按仍有效的完整记录重算', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], ruleId: negative })
    const added = await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    expect((await garden.student(owner, studentId)).pet_exp).toBe(3)
    expect((await garden.student(owner, studentId)).points).toBe(1)
    await garden.undo(owner, added.batchId)
    expect((await garden.student(owner, studentId)).pet_exp).toBe(0)
  })
  it('批量评价只要一人越权就全部回滚', async () => {
    const foreignClass = (await garden.createClass(other, { name: '其他班级' })).id
    const foreignStudent = (await garden.addStudents(other, { classId: foreignClass, students: [{ name: '他人学生' }] }))[0]
    await expect(async () => (await garden.evaluate(owner, { studentIds: [studentId, foreignStudent], ruleId: positive }))).rejects.toThrow('notFound')
    expect((await garden.student(owner, studentId)).points).toBe(0)
    expect((await garden.snapshot(owner)).records).toHaveLength(0)
  })
  it('批量重复 ID 不会重复加分，整批可撤回', async () => {
    const second = (await garden.addStudents(owner, { classId, students: [{ name: '学生二' }] }))[0]
    const batch = await garden.evaluate(owner, { studentIds: [studentId, studentId, second], ruleId: positive })
    expect((await garden.student(owner, studentId)).points).toBe(3)
    expect((await garden.student(owner, second)).points).toBe(3)
    await garden.undo(owner, batch.batchId)
    expect((await garden.student(owner, studentId)).points).toBe(0)
    expect((await garden.student(owner, second)).points).toBe(0)
    await expect(async () => (await garden.undo(owner, batch.batchId))).rejects.toThrow('notFound')
  })
  it('升级徽章不重复，每个毕业周期获得七枚，新宠物保留历史积分和徽章', async () => {
    await garden.addRule(owner, { classId, name: { zh: '成长', en: 'Growth' }, points: 100, category: 'other' })
    const ruleId = (await garden.snapshot(owner)).rules.at(-1)!.id
    for (let index = 0; index < 8; index++) await garden.evaluate(owner, { studentIds: [studentId], ruleId })
    expect((await garden.snapshot(owner)).students[0].badge_count).toBe(7)
    expect((await garden.snapshot(owner)).badges.map(badge => badge.level).sort()).toEqual([2, 3, 4, 5, 6, 7, 8])
    await garden.adopt(owner, studentId, { petId: 'capybara' })
    expect((await garden.student(owner, studentId)).pet_exp).toBe(0)
    await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    expect((await garden.student(owner, studentId)).pet_exp).toBe(3)
    expect((await garden.student(owner, studentId)).points).toBe(803)
  })
  it('未毕业更换种类保留成长周期和积分，原评价仍可撤回', async () => {
    const first = await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    const before = await garden.student(owner, studentId)
    await garden.changePet(owner, studentId, { petId: 'westie' })
    expect(await garden.student(owner, studentId)).toEqual({ ...before, pet_id: 'westie' })
    await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    expect((await garden.student(owner, studentId)).pet_exp).toBe(6)
    await garden.undo(owner, first.batchId)
    expect(await garden.student(owner, studentId)).toMatchObject({ pet_id: 'westie', pet_exp: 3, points: 3, generation: before.generation })
  })
  it('毕业后更换种类不重复发徽章，也不改变已获徽章和兑换', async () => {
    await garden.addRule(owner, { classId, name: { zh: '成长', en: 'Growth' }, points: 100, category: 'other' })
    const ruleId = (await garden.snapshot(owner)).rules.at(-1)!.id
    for (let index = 0; index < 7; index++) await garden.evaluate(owner, { studentIds: [studentId], ruleId })
    await garden.redeem(owner, { studentId, itemId: (await garden.snapshot(owner)).items.find(item => item.background_id === null)!.id })
    const before = await garden.snapshot(owner), badges = await garden.db.prepare('SELECT * FROM badges').all()
    await garden.changePet(owner, studentId, { petId: 'westie' })
    expect((await garden.snapshot(owner)).students[0]).toEqual({ ...before.students[0], pet_id: 'westie' })
    await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    expect(await garden.db.prepare('SELECT * FROM badges').all()).toEqual(badges)
    expect((await garden.snapshot(owner)).redemptions).toEqual(before.redemptions)
  })
  it('未毕业不能重新领养，已结束的宠物周期不允许撤回', async () => {
    await expect(async () => (await garden.adopt(owner, studentId, { petId: 'capybara' }))).rejects.toThrow('petNotGraduated')
    await garden.addRule(owner, { classId, name: { zh: '成长', en: 'Growth' }, points: 100, category: 'other' })
    const ruleId = (await garden.snapshot(owner)).rules.at(-1)!.id
    let batchId = ''
    for (let index = 0; index < 7; index++) batchId = (await garden.evaluate(owner, { studentIds: [studentId], ruleId })).batchId
    await garden.adopt(owner, studentId, { petId: 'capybara' })
    await expect(async () => (await garden.undo(owner, batchId))).rejects.toThrow('previousPetCycle')
  })
})
describe('商店、备份与级联删除', () => {
  it('徽章不足不能兑换，已消费徽章阻止无效撤回，退款后才可重算', async () => {
    const itemId = (await garden.snapshot(owner)).items.find(item => item.background_id === null)!.id
    await expect(async () => (await garden.redeem(owner, { studentId, itemId }))).rejects.toThrow('insufficientBadges')
    await garden.addRule(owner, { classId, name: { zh: '成长', en: 'Growth' }, points: 100, category: 'other' })
    const ruleId = (await garden.snapshot(owner)).rules.at(-1)!.id
    let batchId = ''
    for (let index = 0; index < 7; index++) batchId = (await garden.evaluate(owner, { studentIds: [studentId], ruleId })).batchId
    await garden.updateItem(owner, itemId, { name: { zh: '七枚奖励', en: 'Seven badge reward' }, cost: 7 })
    await garden.redeem(owner, { studentId, itemId })
    await expect(async () => (await garden.undo(owner, batchId))).rejects.toThrow('badgeAlreadySpent')
    const redemption = (await garden.snapshot(owner)).redemptions[0]
    await expect(async () => (await garden.undoRedemption(other, redemption.id))).rejects.toThrow('notFound')
    await garden.undoRedemption(owner, redemption.id)
    expect((await garden.student(owner, studentId)).spent_badges).toBe(0)
    await garden.undo(owner, batchId)
    expect((await garden.snapshot(owner)).students[0].badge_count).toBe(6)
  })
  it('备份完整恢复、重新映射编号，不影响其他教师', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    await garden.demo(other, 'en')
    const beforeOther = await exportBackup(garden, other)
    const backup = await exportBackup(garden, owner)
    expect(JSON.stringify(backup)).not.toContain('password')
    const restored = await restoreBackup(garden, owner, backup)
    expect(restored.imported).toBe(1)
    expect(restored.classIds).toHaveLength(1)
    const state = await garden.snapshot(owner, restored.classIds[0])
    expect((await garden.student(owner, studentId)).points).toBe(3)
    expect((await garden.snapshot(owner)).classes).toHaveLength(2)
    expect(state.students[0].id).not.toBe(studentId)
    expect(state.students[0].points).toBe(3)
    expect(state.records).toHaveLength(1)
    expect(state.rules).toHaveLength(83)
    expect(await exportBackup(garden, other)).toMatchObject({ classes: beforeOther.classes, students: beforeOther.students })
  })
  it('自定义原因和正负分随备份恢复到新副本，重映射整批仍可正常撤回', async () => {
    const second = (await garden.addStudents(owner, { classId, students: [{ name: '备份第二位' }] }))[0]
    await garden.adopt(owner, second, { petId: 'westie' })
    const added = await garden.evaluate(owner, { studentIds: [studentId, second], custom: { points: 40, reason: '  合作有进步  ' } })
    const deducted = await garden.evaluate(owner, { studentIds: [studentId, second], custom: { points: -7, reason: '  Please stay focused  ' } })
    await garden.evaluate(owner, { studentIds: [studentId, second], custom: { points: 1 } })
    const original = await garden.snapshot(owner, classId), beforeTemplates = await garden.db.prepare('SELECT * FROM rules WHERE class_id IS NULL ORDER BY id').all()
    const restored = await restoreBackup(garden, owner, await exportBackup(garden, owner))
    expect(restored.classIds).toHaveLength(1)
    const copyId = restored.classIds[0], copy = await garden.snapshot(owner, copyId)
    expect(copyId).not.toBe(classId)
    expect(copy.students).toHaveLength(2)
    expect(copy.students.every(row => row.points === 34 && row.pet_exp === 34 && ![studentId, second].includes(row.id))).toBe(true)
    expect(copy.rules).toHaveLength(original.rules.length)
    expect(await garden.db.prepare('SELECT * FROM rules WHERE class_id IS NULL ORDER BY id').all()).toEqual(beforeTemplates)
    const copiedAdded = copy.records.filter(row => row.points === 40), copiedDeducted = copy.records.filter(row => row.points === -7)
    expect(copiedAdded).toHaveLength(2)
    expect(copiedDeducted).toHaveLength(2)
    expect(copiedAdded.every(row => row.batch_id === copiedAdded[0].batch_id && row.batch_id !== added.batchId && row.reason.zh === '合作有进步' && row.reason.en === '合作有进步' && row.category === 'other')).toBe(true)
    expect(copiedDeducted.every(row => row.batch_id === copiedDeducted[0].batch_id && row.batch_id !== deducted.batchId && row.reason.zh === 'Please stay focused' && row.reason.en === 'Please stay focused' && row.category === 'other')).toBe(true)
    expect(copy.records.filter(row => row.points === 1)).toMatchObject([{ reason: { zh: '自定义加分', en: 'Custom bonus' } }, { reason: { zh: '自定义加分', en: 'Custom bonus' } }])
    await garden.undo(owner, copiedDeducted[0].batch_id)
    expect((await garden.snapshot(owner, copyId)).students.every(row => row.points === 41 && row.pet_exp === 41)).toBe(true)
    await garden.undo(owner, copiedAdded[0].batch_id)
    expect((await garden.snapshot(owner, copyId)).students.every(row => row.points === 1 && row.pet_exp === 1 && row.badge_count === 0)).toBe(true)
    expect(await garden.snapshot(owner, classId)).toMatchObject({ students: original.students, records: original.records, badges: original.badges, rules: original.rules })
    expect(await garden.db.pragma('foreign_key_check')).toEqual([])
  })
  it.each([-Number.MAX_SAFE_INTEGER, -1_000_000, 1_000_000, Number.MAX_SAFE_INTEGER])('v7备份往返保留大额%s分、原因与署名，副本使用新ID并可独立撤回', async points => {
    const reason = points > 0 ? '大额进步奖励' : '大额扣分说明'
    const batch = await garden.evaluate(owner, { studentIds: [studentId], custom: { points, reason } })
    const original = await garden.snapshot(owner, classId), backup = await exportBackup(garden, owner), version = await garden.db.pragma('user_version', { simple: true })
    expect(backup.version).toBe(8)
    expect(backup.evaluations).toMatchObject([{ points, reason: JSON.stringify({ zh: reason, en: reason }), actor_name: '甲老师', actor_subject: '语文' }])
    const restored = await restoreBackup(garden, owner, JSON.parse(JSON.stringify(backup)))
    expect(restored.classIds).toHaveLength(1)
    const copyId = restored.classIds[0], copy = await garden.snapshot(owner, copyId)
    expect(copyId).not.toBe(classId)
    expect(copy.students).toHaveLength(1)
    expect(copy.students[0].id).not.toBe(studentId)
    expect(copy.students[0]).toMatchObject({ points, pet_exp: Math.max(0, points), badge_count: points > 0 ? 7 : 0 })
    expect(copy.records).toHaveLength(1)
    expect(copy.records[0]).toMatchObject({ student_id: copy.students[0].id, points, reason: { zh: reason, en: reason }, category: 'other', actor_user_id: null, actor_name: '甲老师', actor_subject: '语文', undone: 0 })
    expect(copy.records[0].id).not.toBe(original.records[0].id)
    expect(copy.records[0].batch_id).not.toBe(batch.batchId)
    expect(copy.rules).toHaveLength(original.rules.length)
    expect(copy.rules.every(row => !original.rules.some(originalRow => originalRow.id === row.id))).toBe(true)
    await garden.undo(owner, copy.records[0].batch_id)
    const undone = await garden.snapshot(owner, copyId)
    expect(undone.students[0]).toMatchObject({ points: 0, pet_exp: 0, badge_count: 0 })
    expect(undone.records[0]).toMatchObject({ points, reason: { zh: reason, en: reason }, actor_name: '甲老师', actor_subject: '语文', undone: 1, undone_by_user_id: owner, undone_by_name: '甲老师' })
    expect(await garden.snapshot(owner, classId)).toMatchObject({ students: original.students, records: original.records, badges: original.badges, rules: original.rules })
    expect(await garden.db.pragma('user_version', { simple: true })).toBe(version)
    expect(await garden.db.pragma('foreign_key_check')).toEqual([])
  })
  it('损坏备份原子回滚，不删除现有数据', async () => {
    const backup = await exportBackup(garden, owner) as any
    backup.students[0].class_id = 'foreign-class'
    await expect(restoreBackup(garden, owner, backup)).rejects.toThrow('invalidBackup')
    expect((await garden.student(owner, studentId)).name).toBe('测试学生')
  })
  it('删除班级同时级联删除学生、评价、徽章和兑换', async () => {
    await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    await garden.deleteClass(owner, classId)
    for (const table of ['students', 'evaluations', 'badges', 'redemptions']) expect((await garden.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0)
  })
})
