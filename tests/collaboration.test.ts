import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { DomainError } from '../lib/server/errors'
import * as itemImages from '../lib/server/item-images'
import { MAX_CLASS_IMAGE_BYTES } from '../lib/shop'

let garden: Garden, owner: string, admin: string, outsider: string, classX: string, classY: string, studentX: string, studentY: string
const profile = (displayName: string, subject = '语文', teachingRole: 'homeroom' | 'subject' | 'other' = 'subject') => ({ displayName, subject, teachingRole })
const snapshot = (actor = owner, classId = classX) => garden.snapshot(actor, classId)
const classState = (actor: string, classId: string) => {
  const state = snapshot(actor, classId)
  return { ...state, classes: state.classes.filter(row => row.id === classId) }
}
const imageInput = async () => `data:image/png;base64,${(await sharp({ create: { width: 32, height: 24, channels: 4, background: '#6950ac' } }).png().toBuffer()).toString('base64')}`
function expectError(run: () => unknown, code: string, status: number) {
  let error: unknown
  try { run() } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(DomainError)
  expect(error).toMatchObject({ code, status })
}
function addRule(actor: string, classId: string, points: number) {
  garden.addRule(actor, { classId, name: { zh: `评分${points}`, en: `Score ${points}` }, category: 'other', points })
  return garden.snapshot(actor, classId).rules.at(-1)!.id
}
const templates = () => Object.fromEntries(['rules', 'items', 'settings_versions'].map(table => [table, garden.db.prepare(`SELECT * FROM ${table} WHERE class_id IS NULL ORDER BY id`).all()]))
const history = () => Object.fromEntries(['students', 'evaluations', 'growth_events', 'badges', 'redemptions'].map(table => [table, garden.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
function join(actor: string, classId = classX) {
  const invitation = garden.createInvitation(owner, classId)
  expect(garden.joinClass(actor, { code: invitation.code })).toEqual({ id: classId })
  return invitation
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 1, 4))
  garden = new Garden(createDatabase(':memory:'))
  owner = garden.register({ username: 'collaboration-owner', password: 'Owner-test-password' }).user.id
  admin = garden.register({ username: 'collaboration-admin', password: 'Admin-test-password' }).user.id
  outsider = garden.register({ username: 'collaboration-outsider', password: 'Outsider-test-password' }).user.id
  garden.saveProfile(owner, profile('甲老师', '语文', 'homeroom'))
  garden.saveProfile(admin, profile('乙老师', '数学'))
  garden.saveProfile(outsider, profile('丙老师', '英语', 'other'))
  classX = garden.createClass(owner, { name: '共享一班' }).id
  classY = garden.createClass(owner, { name: '私有二班' }).id
  studentX = garden.addStudents(owner, { classId: classX, students: [{ name: '一班学生' }] })[0]
  studentY = garden.addStudents(owner, { classId: classY, students: [{ name: '二班学生' }] })[0]
  garden.adopt(owner, studentX, { petId: 'panda' })
  garden.adopt(owner, studentY, { petId: 'westie' })
  join(admin)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); garden.db.close() })

describe('真实账号、资料与班级身份', () => {
  it('注册保留真实会话及独立模板，资料未完成不能业务操作，空班不泄露模板', () => {
    const session = garden.register({ username: 'new-collaborator', password: 'Real-session-password' })
    expect(garden.authenticate(session.token)).toBe(session.user.id)
    expect(session.user.profile_complete).toBe(false)
    const initial = garden.snapshot(session.user.id)
    expect(initial.user.profile_complete).toBe(false)
    expect(initial.classes).toEqual([])
    expect(initial.rules).toEqual([])
    expect(initial.items).toEqual([])
    expect(garden.db.prepare('SELECT COUNT(*) AS n FROM rules WHERE owner_id = ? AND class_id IS NULL').get(session.user.id)).toEqual({ n: 83 })
    expect(garden.db.prepare('SELECT COUNT(*) AS n FROM items WHERE owner_id = ? AND class_id IS NULL AND background_id IS NULL').get(session.user.id)).toEqual({ n: 3 })
    expect(garden.db.prepare('SELECT COUNT(*) AS n FROM items WHERE owner_id = ? AND class_id IS NULL AND background_id IS NOT NULL').get(session.user.id)).toEqual({ n: 41 })
    expect(garden.db.prepare('SELECT version FROM settings_versions WHERE owner_id = ? AND class_id IS NULL').all(session.user.id)).toEqual([{ version: 0 }])
    expectError(() => garden.createClass(session.user.id, { name: '绕过资料' }), 'profileRequired', 409)
    const code = garden.createInvitation(owner, classX).code
    expectError(() => garden.previewInvitation(session.user.id, { code }), 'profileRequired', 409)
    expectError(() => garden.joinClass(session.user.id, { code }), 'profileRequired', 409)
    garden.saveProfile(session.user.id, profile(' 新老师 ', ' 科学 ', 'other'))
    expect(garden.user(session.user.id)).toMatchObject({ display_name: '新老师', subject: '科学', teaching_role: 'other', profile_complete: true })
    const created = garden.createClass(session.user.id, { name: '新班级' }).id
    expect(garden.snapshot(session.user.id, created).rules).toHaveLength(83)
    expect(garden.snapshot(session.user.id, created).classes[0]).toMatchObject({ id: created, owner_id: session.user.id, role: 'owner' })
  })
  it('教师身份只是资料，伪造负责人字段或改为班主任不能提权', () => {
    expect(() => garden.saveProfile(admin, profile('', '数学'))).toThrow()
    expect(() => garden.saveProfile(admin, profile('乙老师', ''))).toThrow()
    expect(() => garden.saveProfile(admin, { ...profile('乙老师'), teachingRole: 'owner' })).toThrow()
    garden.saveProfile(admin, { ...profile('乙班主任', '数学', 'homeroom'), owner_id: admin, role: 'owner', userId: owner })
    expect(garden.user(owner).display_name).toBe('甲老师')
    expect(snapshot(admin).user).toMatchObject({ id: admin, display_name: '乙班主任', teaching_role: 'homeroom' })
    expect(snapshot(admin).classes).toEqual([expect.objectContaining({ id: classX, owner_id: owner, role: 'admin' })])
    expectError(() => garden.deleteClass(admin, classX), 'forbidden', 403)
    expectError(() => garden.transferClass(admin, classX, { userId: owner }), 'forbidden', 403)
  })
  it('负责人自动作为成员，成员列表/快照保留当前操作者，不列出未共享班级', () => {
    expect(garden.db.prepare('SELECT class_id,user_id FROM class_members WHERE user_id = ? ORDER BY class_id').all(owner)).toEqual([classX, classY].sort().map(class_id => ({ class_id, user_id: owner })))
    expect(garden.classTeachers(admin, classX).teachers).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: owner, display_name: '甲老师', role: 'owner' }),
      expect.objectContaining({ user_id: admin, display_name: '乙老师', role: 'admin' })
    ]))
    expect(snapshot(admin).user.id).toBe(admin)
    expect(snapshot(admin).classes.map(row => row.id)).toEqual([classX])
    expect(garden.snapshot(outsider).classes).toEqual([])
    expectError(() => garden.snapshot(admin, classY), 'notFound', 404)
    expectError(() => garden.classTeachers(outsider, classX), 'notFound', 404)
  })
})

describe('邀请码生命周期与即时成员授权', () => {
  it('7天多人邀请码只持久化强摘要，预览不包含学生，重复加入幂等', () => {
    const invitation = garden.createInvitation(admin, classX)
    expect(invitation.code.length).toBeGreaterThanOrEqual(24)
    expect(invitation.expires_at - Date.now()).toBeGreaterThan(7 * 86400000 - 2000)
    expect(invitation.expires_at - Date.now()).toBeLessThanOrEqual(7 * 86400000)
    const stored = garden.db.prepare('SELECT * FROM class_invites WHERE class_id = ?').get(classX) as { code_hash: string }
    expect(stored.code_hash).toBe(createHash('sha256').update(invitation.code.replace(/-/g, '').toUpperCase()).digest('hex'))
    expect(JSON.stringify(stored)).not.toContain(invitation.code)
    const preview = garden.previewInvitation(outsider, { code: invitation.code })
    expect(preview).toEqual({ id: classX, name: '共享一班', owner_name: '甲老师', already_member: false, expires_at: invitation.expires_at })
    expect(garden.joinClass(outsider, { code: invitation.code })).toEqual({ id: classX })
    expect(garden.joinClass(outsider, { code: invitation.code })).toEqual({ id: classX })
    expect(garden.previewInvitation(outsider, { code: invitation.code }).already_member).toBe(true)
    expect(garden.db.prepare('SELECT COUNT(*) AS n FROM class_members WHERE class_id = ?').get(classX)).toEqual({ n: 3 })
    expect(garden.classTeachers(owner, classX).invitation).toMatchObject({ expires_at: invitation.expires_at })
    expect(JSON.stringify(garden.classTeachers(owner, classX))).not.toContain(invitation.code)
  })
  it('重生成与主动停用立即废弃旧码，管理员也可邀请但陌生人不可', () => {
    const first = garden.createInvitation(owner, classX), next = garden.createInvitation(admin, classX)
    expect(next.code).not.toBe(first.code)
    expectError(() => garden.joinClass(outsider, { code: first.code }), 'invalidInvitation', 404)
    expectError(() => garden.previewInvitation(outsider, { code: first.code }), 'invalidInvitation', 404)
    expectError(() => garden.createInvitation(outsider, classX), 'notFound', 404)
    expectError(() => garden.revokeInvitation(outsider, classX), 'notFound', 404)
    garden.revokeInvitation(admin, classX)
    expectError(() => garden.joinClass(outsider, { code: next.code }), 'invalidInvitation', 404)
    expect(garden.classTeachers(owner, classX).invitation).toBeNull()
    expect(() => garden.previewInvitation(outsider, { code: '' })).toThrow()
    expect(() => garden.previewInvitation(outsider, { code: '../../private' })).toThrow()
  })
  it('有效期边界由服务端检查，过期不能预览或加入且不创建成员', () => {
    vi.useFakeTimers()
    const invitation = garden.createInvitation(owner, classX)
    vi.setSystemTime(invitation.expires_at - 1)
    expect(garden.previewInvitation(outsider, { code: invitation.code }).id).toBe(classX)
    vi.setSystemTime(invitation.expires_at + 1)
    expectError(() => garden.previewInvitation(outsider, { code: invitation.code }), 'invalidInvitation', 404)
    expectError(() => garden.joinClass(outsider, { code: invitation.code }), 'invalidInvitation', 404)
    expect(garden.db.prepare('SELECT * FROM class_members WHERE class_id = ? AND user_id = ?').get(classX, outsider)).toBeUndefined()
  })
  it('移除立即拒绝所有班级数据并废弃旧码，历史和学生不删除', () => {
    const batch = garden.evaluate(admin, { studentIds: [studentX], ruleId: snapshot(admin).rules[0].id })
    const invitation = garden.createInvitation(admin, classX), before = history()
    expectError(() => garden.removeTeacher(admin, classX, owner), 'forbidden', 403)
    expectError(() => garden.removeTeacher(outsider, classX, admin), 'notFound', 404)
    expectError(() => garden.removeTeacher(owner, classX, outsider), 'memberNotFound', 404)
    garden.removeTeacher(owner, classX, admin)
    expect(history()).toEqual(before)
    expect(garden.snapshot(admin).classes).toEqual([])
    expectError(() => garden.snapshot(admin, classX), 'notFound', 404)
    expectError(() => garden.student(admin, studentX), 'notFound', 404)
    expectError(() => garden.undo(admin, batch.batchId), 'notFound', 404)
    expectError(() => garden.createInvitation(admin, classX), 'notFound', 404)
    expectError(() => garden.joinClass(admin, { code: invitation.code }), 'invalidInvitation', 404)
    expectError(() => garden.joinClass(outsider, { code: invitation.code }), 'invalidInvitation', 404)
    expect(snapshot().records[0].actor_name).toBe('乙老师')
  })
})

describe('两班业务资源与权限隔离', () => {
  it('管理员可管理已加入班级的学生/规则/设置/商品，但不能读取或修改另一班', async () => {
    garden.renameClass(admin, classX, { name: '共同管理的一班' })
    garden.updateStudent(admin, studentX, { name: '共同修改的学生', studentNo: '08' })
    garden.changePet(admin, studentX, { petId: 'capybara' })
    const added = garden.addStudents(admin, { classId: classX, students: [{ name: '共同新增学生' }] })[0]
    garden.adopt(admin, added, { petId: 'westie' })
    const ownRule = addRule(admin, classX, 3)
    garden.evaluate(admin, { studentIds: [studentX], ruleId: ownRule })
    const settings = garden.settings(admin, classX), value = structuredClone(settings.value)
    value.allowChangePet = false
    garden.saveSettings(admin, { classId: classX, version: settings.version, value })
    const item = await garden.addItem(admin, { classId: classX, name: { zh: '共享商品', en: 'Shared reward' }, cost: 1, stock: 2, image: await imageInput() })
    expect(garden.itemImage(admin, item.id).data.length).toBeGreaterThan(0)
    await garden.updateItem(admin, item.id, { name: { zh: '管理员编辑', en: 'Admin edit' }, cost: 2, stock: 3 })
    expect(snapshot().students.find(row => row.id === studentX)).toMatchObject({ name: '共同修改的学生', student_no: '08', pet_id: 'capybara', points: 3 })
    expect(snapshot().items.find(row => row.id === item.id)).toMatchObject({ stock: 3, cost: 2 })
    for (const actor of [admin, outsider]) {
      expectError(() => garden.settings(actor, classY), 'notFound', 404)
      expectError(() => garden.renameClass(actor, classY, { name: '越权' }), 'notFound', 404)
      expectError(() => garden.deleteClass(actor, classY), 'notFound', 404)
      expectError(() => garden.updateStudent(actor, studentY, { name: '越权' }), 'notFound', 404)
      expectError(() => garden.deleteStudent(actor, studentY), 'notFound', 404)
      expectError(() => garden.changePet(actor, studentY, { petId: 'panda' }), 'notFound', 404)
      expectError(() => garden.addRule(actor, { classId: classY, name: { zh: '越权', en: 'Foreign' }, category: 'other', points: 1 }), 'notFound', 404)
      await expect(garden.addItem(actor, { classId: classY, name: { zh: '越权', en: 'Foreign' }, cost: 1 })).rejects.toMatchObject({ code: 'notFound', status: 404 })
    }
    expectError(() => garden.itemImage(outsider, item.id), 'notFound', 404)
    expectError(() => garden.deleteItem(outsider, item.id), 'notFound', 404)
    garden.deleteItem(admin, item.id)
    garden.deleteRule(admin, ownRule)
    garden.deleteStudent(admin, added)
    expect(snapshot().students).toHaveLength(1)
  })
  it('规则/成长设置/有限库存按班隔离，不rebase另一班或修改个人模板', async () => {
    const beforeTemplates = templates(), beforeY = classState(owner, classY), eventsY = garden.db.prepare('SELECT * FROM growth_events WHERE student_id = ? ORDER BY seq').all(studentY)
    const rule = addRule(admin, classX, 70)
    garden.evaluate(admin, { studentIds: [studentX], ruleId: rule })
    const settings = garden.settings(admin, classX), value = structuredClone(settings.value)
    value.growth[1].experience = 17
    garden.saveSettings(admin, { classId: classX, version: settings.version, value })
    const item = await garden.addItem(admin, { classId: classX, name: { zh: '独立库存', en: 'Independent stock' }, cost: 1, stock: 1 })
    garden.redeem(admin, { studentId: studentX, itemId: item.id })
    expect(snapshot().students[0].pet_exp).toBe(48.5)
    expect(snapshot().items.find(row => row.id === item.id)?.stock).toBe(0)
    expect(classState(owner, classY)).toEqual(beforeY)
    expect(garden.db.prepare('SELECT * FROM growth_events WHERE student_id = ? ORDER BY seq').all(studentY)).toEqual(eventsY)
    expect(templates()).toEqual(beforeTemplates)
  })
  it('跨班规则、商品和批量评分即使同一负责人也拒绝且整批不写入', async () => {
    const ruleX = snapshot().rules[0].id, ruleY = snapshot(owner, classY).rules[0].id
    const before = history()
    expect(() => garden.evaluate(owner, { studentIds: [studentX, studentY], ruleId: ruleX })).toThrow()
    expect(() => garden.evaluate(owner, { studentIds: [studentY], ruleId: ruleX })).toThrow()
    expect(() => garden.evaluate(admin, { studentIds: [studentX], ruleId: ruleY })).toThrow()
    expectError(() => garden.redeem(owner, { studentId: studentX, itemId: snapshot(owner, classY).items.find(item => item.background_id === null)!.id }), 'notFound', 404)
    expect(history()).toEqual(before)
    expect(garden.settings(owner, classX).id).not.toBe(garden.settings(owner, classY).id)
    expect(ruleX).not.toBe(ruleY)
  })
  it('自定义批量评分同样拒绝同负责人跨班、无权和已移除教师，成长与模板整体不写入', () => {
    const before = history(), beforeTemplates = templates(), beforeRules = garden.db.prepare('SELECT * FROM rules ORDER BY id').all()
    expectError(() => garden.evaluate(owner, { studentIds: [studentX, studentY], custom: { points: 40 } }), 'invalidInput', 400)
    expect(history()).toEqual(before)
    expectError(() => garden.evaluate(admin, { studentIds: [studentX, studentY], custom: { points: -3 } }), 'notFound', 404)
    expect(history()).toEqual(before)
    expectError(() => garden.evaluate(outsider, { studentIds: [studentX], custom: { points: 40 } }), 'notFound', 404)
    garden.removeTeacher(owner, classX, admin)
    expectError(() => garden.evaluate(admin, { studentIds: [studentX], custom: { points: 40 } }), 'notFound', 404)
    expect(history()).toEqual(before)
    expect(templates()).toEqual(beforeTemplates)
    expect(garden.db.prepare('SELECT * FROM rules ORDER BY id').all()).toEqual(beforeRules)
  })
  it('同一教师两班图片额度互不占用，管理员也不能越过当前班限额', async () => {
    const image = await imageInput(), first = await garden.addItem(owner, { classId: classX, name: { zh: '一班图片', en: 'Class X image' }, cost: 1, image })
    garden.db.prepare('UPDATE items SET image_bytes = ? WHERE id = ?').run(MAX_CLASS_IMAGE_BYTES, first.id)
    await expect(garden.addItem(admin, { classId: classX, name: { zh: '超额', en: 'Over budget' }, cost: 1, image })).rejects.toThrow('imageStorageFull')
    const second = await garden.addItem(owner, { classId: classY, name: { zh: '二班图片', en: 'Class Y image' }, cost: 1, image })
    expect(garden.itemImage(owner, second.id).data.length).toBeGreaterThan(0)
    expectError(() => garden.itemImage(admin, second.id), 'notFound', 404)
  })
  it.each(['create', 'update'] as const)('图片真实处理期间被移除后%s操作在写入事务内重新鉴权', async operation => {
    const input = { classId: classX, name: { zh: '异步图片', en: 'Asynchronous image' }, cost: 1, stock: 3 }
    const existing = await garden.addItem(owner, input), before = garden.db.prepare('SELECT * FROM items ORDER BY id').all()
    const image = await imageInput(), normalize = itemImages.normalizeItemImage
    let ready!: () => void, release!: () => void
    const processing = new Promise<void>(resolve => { ready = resolve }), resume = new Promise<void>(resolve => { release = resolve })
    // Only pause the image-input boundary; run Sharp and every database operation for real.
    vi.spyOn(itemImages, 'normalizeItemImage').mockImplementation(async value => {
      const normalized = await normalize(value)
      ready()
      await resume
      return normalized
    })
    const pending = operation === 'create' ? garden.addItem(admin, { ...input, image }) : garden.updateItem(admin, existing.id, { ...input, stock: 99, image })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'notFound', status: 404 })
    await processing
    try { garden.removeTeacher(owner, classX, admin) } finally { release() }
    await rejected
    expect(garden.db.prepare('SELECT * FROM items ORDER BY id').all()).toEqual(before)
  })
})

describe('操作归属、署名与整批撤回', () => {
  it('自定义批次保存真实评分教师快照，管理员仅能撤本人，负责人撤整批并保存撤回署名', () => {
    const second = garden.addStudents(admin, { classId: classX, students: [{ name: '自定义共同评分学生' }] })[0]
    garden.adopt(admin, second, { petId: 'panda' })
    const beforeTemplates = templates(), beforeRules = garden.db.prepare('SELECT * FROM rules ORDER BY id').all()
    const own = garden.evaluate(owner, { studentIds: [studentX, second], custom: { points: 3, reason: '共同进步' } })
    const theirs = garden.evaluate(admin, { studentIds: [studentX, second], custom: { points: -2, reason: 'Keep focused' } })
    const records = snapshot(admin).records
    expect(records.filter(row => row.batch_id === own.batchId)).toHaveLength(2)
    expect(records.filter(row => row.batch_id === own.batchId)).toEqual([expect.objectContaining({ actor_user_id: owner, actor_name: '甲老师', actor_subject: '语文', can_undo: false }), expect.objectContaining({ actor_user_id: owner, actor_name: '甲老师', actor_subject: '语文', can_undo: false })])
    expect(records.filter(row => row.batch_id === theirs.batchId).every(row => row.actor_user_id === admin && row.actor_name === '乙老师' && row.actor_subject === '数学' && row.can_undo)).toBe(true)
    const before = history()
    expectError(() => garden.undo(admin, own.batchId), 'operationNotOwned', 403)
    expect(history()).toEqual(before)
    garden.saveProfile(admin, profile('乙新称呼', '科学'))
    garden.undo(admin, theirs.batchId)
    const undone = snapshot().records.filter(row => row.batch_id === theirs.batchId)
    expect(undone).toHaveLength(2)
    for (const row of undone) expect(row).toMatchObject({ actor_user_id: admin, actor_name: '乙老师', actor_subject: '数学', undone: 1, undone_by_user_id: admin, undone_by_name: '乙新称呼', undone_by_subject: '科学', can_undo: false })
    const next = garden.evaluate(admin, { studentIds: [studentX, second], custom: { points: 5 } })
    garden.saveProfile(owner, profile('甲新称呼', '美术', 'homeroom'))
    garden.undo(owner, next.batchId)
    for (const row of snapshot().records.filter(row => row.batch_id === next.batchId)) expect(row).toMatchObject({ actor_user_id: admin, actor_name: '乙新称呼', actor_subject: '科学', undone: 1, undone_by_user_id: owner, undone_by_name: '甲新称呼', undone_by_subject: '美术' })
    expect(snapshot().students.every(row => row.points === 3 && row.pet_exp === 3)).toBe(true)
    expect(templates()).toEqual(beforeTemplates)
    expect(garden.db.prepare('SELECT * FROM rules ORDER BY id').all()).toEqual(beforeRules)
  })
  it.each(['top-level', 'custom'] as const)('自定义评分%s伪造actor不能冒用负责人身份', location => {
    const forged = { actor_user_id: owner, actor_name: '伪造教师', actor_subject: '伪造科目', userId: owner, owner_id: owner, role: 'owner' }
    const before = history()
    let batch: { batchId: string } | undefined, error: unknown
    try { batch = garden.evaluate(admin, location === 'custom' ? { studentIds: [studentX], custom: { points: 3, ...forged } } : { studentIds: [studentX], custom: { points: 3 }, ...forged }) } catch (caught) { error = caught }
    if (error) {
      expect(error).toBeInstanceOf(DomainError)
      expect(error).toMatchObject({ code: 'invalidEvaluation', status: 400 })
      expect(history()).toEqual(before)
    } else {
      expect(batch).toBeDefined()
      expect(snapshot().records.find(row => row.batch_id === batch!.batchId)).toMatchObject({ actor_user_id: admin, actor_name: '乙老师', actor_subject: '数学' })
      expect(snapshot().records.some(row => row.actor_name === '伪造教师')).toBe(false)
    }
  })
  it('自定义整批撤回遇到非本人记录不能只撤可见子集', () => {
    const second = garden.addStudents(admin, { classId: classX, students: [{ name: '自定义整批第二位' }] })[0]
    garden.adopt(admin, second, { petId: 'westie' })
    const batch = garden.evaluate(admin, { studentIds: [studentX, second], custom: { points: 40 } })
    garden.db.prepare('UPDATE evaluations SET actor_user_id = ? WHERE batch_id = ? AND student_id = ?').run(owner, batch.batchId, second)
    const before = history()
    expectError(() => garden.undo(admin, batch.batchId), 'operationNotOwned', 403)
    expect(history()).toEqual(before)
    garden.undo(owner, batch.batchId)
    expect(snapshot().records.filter(row => row.batch_id === batch.batchId).every(row => row.undone === 1)).toBe(true)
    expect(snapshot().students.every(row => row.points === 0 && row.pet_exp === 0 && row.badge_count === 0)).toBe(true)
  })
  it('管理员只能撤回本人评分，负责人可撤回全班；改名不改历史署名，撤回保存当时署名', () => {
    const rule = addRule(owner, classX, 3)
    const own = garden.evaluate(owner, { studentIds: [studentX], ruleId: rule }), theirs = garden.evaluate(admin, { studentIds: [studentX], ruleId: rule })
    expect(snapshot(admin).records.find(row => row.batch_id === own.batchId)).toMatchObject({ actor_user_id: owner, actor_name: '甲老师', actor_subject: '语文', can_undo: false })
    expect(snapshot(admin).records.find(row => row.batch_id === theirs.batchId)).toMatchObject({ actor_user_id: admin, actor_name: '乙老师', actor_subject: '数学', can_undo: true })
    expectError(() => garden.undo(admin, own.batchId), 'operationNotOwned', 403)
    garden.saveProfile(admin, profile('乙老师新称呼', '科学'))
    garden.undo(admin, theirs.batchId)
    expect(snapshot().records.find(row => row.batch_id === theirs.batchId)).toMatchObject({ actor_user_id: admin, actor_name: '乙老师', actor_subject: '数学', undone: 1, undone_by_user_id: admin, undone_by_name: '乙老师新称呼', undone_by_subject: '科学', can_undo: false })
    const next = garden.evaluate(admin, { studentIds: [studentX], ruleId: rule })
    garden.undo(owner, next.batchId)
    expect(snapshot().records.find(row => row.batch_id === next.batchId)).toMatchObject({ actor_name: '乙老师新称呼', undone_by_user_id: owner, undone_by_name: '甲老师' })
    expect(garden.student(owner, studentX).points).toBe(3)
  })
  it('兑换按实际教师署名与撤回权限退款，旧actorNULL历史只能负责人撤', () => {
    const rule = addRule(owner, classX, 100)
    garden.evaluate(owner, { studentIds: [studentX], ruleId: rule })
    const itemId = snapshot().items.find(item => item.background_id === null)!.id
    garden.redeem(owner, { studentId: studentX, itemId })
    garden.redeem(admin, { studentId: studentX, itemId })
    const ownerRow = snapshot().redemptions.find(row => row.actor_user_id === owner)!, adminRow = snapshot().redemptions.find(row => row.actor_user_id === admin)!
    expect(adminRow).toMatchObject({ actor_name: '乙老师', actor_subject: '数学', can_undo: true })
    expect(snapshot(admin).redemptions.find(row => row.id === ownerRow.id)?.can_undo).toBe(false)
    expectError(() => garden.undoRedemption(admin, ownerRow.id), 'operationNotOwned', 403)
    garden.saveProfile(admin, profile('乙新称呼', '美术'))
    garden.undoRedemption(admin, adminRow.id)
    expect(snapshot().redemptions.find(row => row.id === adminRow.id)).toMatchObject({ actor_name: '乙老师', actor_subject: '数学', undone_by_user_id: admin, undone_by_name: '乙新称呼', undone_by_subject: '美术', can_undo: false })
    garden.db.prepare("UPDATE redemptions SET actor_user_id = NULL, actor_name = '', actor_subject = '' WHERE id = ?").run(ownerRow.id)
    expectError(() => garden.undoRedemption(admin, ownerRow.id), 'operationNotOwned', 403)
    garden.undoRedemption(owner, ownerRow.id)
    const historical = garden.evaluate(owner, { studentIds: [studentX], ruleId: rule })
    garden.db.prepare("UPDATE evaluations SET actor_user_id = NULL, actor_name = '', actor_subject = '' WHERE batch_id = ?").run(historical.batchId)
    expect(snapshot(admin).records.find(row => row.batch_id === historical.batchId)?.can_undo).toBe(false)
    expectError(() => garden.undo(admin, historical.batchId), 'operationNotOwned', 403)
    garden.undo(owner, historical.batchId)
    expect(garden.student(owner, studentX).spent_badges).toBe(0)
  })
  it('不允许过滤同批中的他人记录后仅撤一部分', () => {
    const second = garden.addStudents(admin, { classId: classX, students: [{ name: '同批第二位' }] })[0]
    garden.adopt(admin, second, { petId: 'panda' })
    const batch = garden.evaluate(admin, { studentIds: [studentX, second], ruleId: snapshot(admin).rules[0].id })
    garden.db.prepare('UPDATE evaluations SET actor_user_id = ? WHERE batch_id = ? AND student_id = ?').run(owner, batch.batchId, second)
    const before = history()
    expectError(() => garden.undo(admin, batch.batchId), 'operationNotOwned', 403)
    expect(history()).toEqual(before)
    garden.undo(owner, batch.batchId)
    expect(snapshot().records.filter(row => row.batch_id === batch.batchId).every(row => row.undone === 1)).toBe(true)
  })
  it('同batch ID横跨班级时拒绝完整批次，不能只撤有权限的可见子集', () => {
    const batchX = garden.evaluate(admin, { studentIds: [studentX], ruleId: snapshot(admin).rules[0].id })
    const batchY = garden.evaluate(owner, { studentIds: [studentY], ruleId: snapshot(owner, classY).rules[0].id })
    garden.db.prepare('UPDATE evaluations SET batch_id = ? WHERE batch_id = ?').run(batchX.batchId, batchY.batchId)
    const before = history()
    expect(() => garden.undo(admin, batchX.batchId)).toThrow()
    expect(history()).toEqual(before)
    expect(() => garden.undo(owner, batchX.batchId)).toThrow()
    expect(history()).toEqual(before)
  })
  it('成员自己的撤回仍遵守已消费徽章保护，失败保留事件、奖励、积分及库存', () => {
    const ruleId = addRule(admin, classX, 40), batch = garden.evaluate(admin, { studentIds: [studentX], ruleId })
    garden.redeem(owner, { studentId: studentX, itemId: snapshot().items.find(item => item.background_id === null)!.id })
    const before = history()
    expectError(() => garden.undo(admin, batch.batchId), 'badgeAlreadySpent', 409)
    expect(history()).toEqual(before)
    garden.undoRedemption(owner, snapshot().redemptions[0].id)
    garden.undo(admin, batch.batchId)
    expect(garden.student(owner, studentX)).toMatchObject({ points: 0, pet_exp: 0, spent_badges: 0 })
  })
})

describe('协作背景持有、装扮与退款权限', () => {
  it('管理员给学生兑换与装扮按真实教师署名，负责人可退他人兑换并清除装备', () => {
    garden.evaluate(owner, { studentIds: [studentX], custom: { points: 700 } })
    const item = snapshot().items.find(row => row.background_id === 'garden')!
    garden.redeem(admin, { studentId: studentX, itemId: item.id, actor_user_id: owner, actor_name: '伪造负责人', owner_id: admin, role: 'owner' })
    garden.setBackground(admin, studentX, { backgroundId: 'garden', actor_user_id: owner, owned_background_ids: ['garden', 'beach'] })
    const redemption = snapshot().redemptions[0]
    expect(redemption).toMatchObject({ actor_user_id: admin, actor_name: '乙老师', actor_subject: '数学', background_id: 'garden', can_undo: true })
    expect(snapshot().students[0]).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 1 })
    garden.saveProfile(owner, profile('负责人新名', '科学', 'homeroom'))
    garden.undoRedemption(owner, redemption.id)
    expect(snapshot().students[0]).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    expect(snapshot().redemptions[0]).toMatchObject({ actor_user_id: admin, actor_name: '乙老师', undone_by_user_id: owner, undone_by_name: '负责人新名', undone_by_subject: '科学', undone: 1, can_undo: false })
  })
  it('管理员只能退本人背景，其他管理员和actorNULL历史不提权；失败不清装备或消费', () => {
    join(outsider)
    garden.evaluate(owner, { studentIds: [studentX], custom: { points: 700 } })
    const item = snapshot().items.find(row => row.background_id === 'garden')!
    garden.redeem(admin, { studentId: studentX, itemId: item.id })
    garden.setBackground(owner, studentX, { backgroundId: 'garden' })
    const redemptionId = snapshot().redemptions[0].id, before = history()
    expect(snapshot(outsider).redemptions[0].can_undo).toBe(false)
    expectError(() => garden.undoRedemption(outsider, redemptionId), 'operationNotOwned', 403)
    expect(history()).toEqual(before)
    garden.db.prepare('UPDATE redemptions SET actor_user_id = NULL WHERE id = ?').run(redemptionId)
    const legacyBefore = history()
    expectError(() => garden.undoRedemption(admin, redemptionId), 'operationNotOwned', 403)
    expect(history()).toEqual(legacyBefore)
    garden.undoRedemption(owner, redemptionId)
    expect(snapshot().students[0]).toMatchObject({ background_id: null, owned_background_ids: [] })
  })
  it.each(['remove', 'leave'] as const)('%s失去成员权限后立即不能兑换、装扮或退款本人背景，学生持有不受影响', action => {
    garden.evaluate(owner, { studentIds: [studentX], custom: { points: 700 } })
    const item = snapshot().items.find(row => row.background_id === 'garden')!, nextItem = snapshot().items.find(row => row.background_id === 'beach')!
    garden.redeem(admin, { studentId: studentX, itemId: item.id })
    garden.setBackground(admin, studentX, { backgroundId: 'garden' })
    const redemptionId = snapshot().redemptions[0].id, before = history()
    if (action === 'remove') garden.removeTeacher(owner, classX, admin)
    else garden.leaveClass(admin, classX)
    expectError(() => garden.redeem(admin, { studentId: studentX, itemId: nextItem.id, userId: owner, role: 'owner' }), 'notFound', 404)
    expectError(() => garden.setBackground(admin, studentX, { backgroundId: null, actor_user_id: owner, classId: classX }), 'notFound', 404)
    expectError(() => garden.undoRedemption(admin, redemptionId), 'notFound', 404)
    expect(history()).toEqual(before)
    expect(snapshot().students[0]).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 1 })
    garden.undoRedemption(owner, redemptionId)
    expect(snapshot().students[0]).toMatchObject({ background_id: null, owned_background_ids: [] })
  })
  it('背景商品价格/装扮按班隔离，成员不能装备另班学生；转让保留学生所有权及署名', async () => {
    const first = snapshot().items.find(row => row.background_id === 'garden')!, second = snapshot(owner, classY).items.find(row => row.background_id === 'garden')!
    const beforeTemplates = templates()
    await garden.updateItem(admin, first.id, { name: first.name, cost: 2, stock: 3 })
    expect(snapshot().items.find(row => row.id === first.id)).toMatchObject({ cost: 2, stock: -1, background_id: 'garden', image: null })
    garden.evaluate(owner, { studentIds: [studentX, studentX], custom: { points: 100 } })
    garden.redeem(admin, { studentId: studentX, itemId: first.id })
    garden.setBackground(admin, studentX, { backgroundId: 'garden' })
    const beforeY = classState(owner, classY), beforeHistory = history()
    expect(snapshot(owner, classY).items.find(row => row.id === second.id)).toMatchObject({ cost: 1, stock: -1 })
    expect(snapshot(owner, classY).students[0]).toMatchObject({ background_id: null, owned_background_ids: [] })
    expectError(() => garden.setBackground(admin, studentY, { backgroundId: 'garden' }), 'notFound', 404)
    expectError(() => garden.redeem(owner, { studentId: studentX, itemId: second.id }), 'notFound', 404)
    expect(history()).toEqual(beforeHistory)
    garden.transferClass(owner, classX, { userId: admin })
    expect(history()).toEqual(beforeHistory)
    expect(classState(owner, classY)).toEqual(beforeY)
    expect(templates()).toEqual(beforeTemplates)
    expect(snapshot(admin).students[0]).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'] })
    garden.undoRedemption(admin, snapshot(admin).redemptions[0].id)
    expect(snapshot(admin).students[0]).toMatchObject({ background_id: null, owned_background_ids: [] })
  })
})

describe('负责人转让、退出与删除', () => {
  it('负责人不能直接退出/移除自己或转让自己，无权对象不能改变成员及所属', () => {
    const before = garden.db.prepare('SELECT * FROM class_members ORDER BY class_id,user_id').all()
    expectError(() => garden.leaveClass(owner, classX), 'transferRequired', 409)
    expectError(() => garden.removeTeacher(owner, classX, owner), 'cannotRemoveOwner', 409)
    expectError(() => garden.transferClass(owner, classX, { userId: owner }), 'cannotTransferSelf', 409)
    expectError(() => garden.transferClass(owner, classX, { userId: outsider }), 'memberNotFound', 404)
    expectError(() => garden.transferClass(admin, classX, { userId: owner }), 'forbidden', 403)
    expectError(() => garden.transferClass(outsider, classX, { userId: admin }), 'notFound', 404)
    expect(garden.db.prepare('SELECT * FROM class_members ORDER BY class_id,user_id').all()).toEqual(before)
    expect(snapshot().classes.find(row => row.id === classX)?.owner_id).toBe(owner)
  })
  it('转让完整保留配置/学生/成长/署名/库存，旧负责人留管理员，别班和模板不变且废弃旧码', async () => {
    const ruleId = addRule(admin, classX, 100)
    garden.evaluate(admin, { studentIds: [studentX], ruleId: ruleId })
    const item = await garden.addItem(admin, { classId: classX, name: { zh: '转让奖励', en: 'Transferred reward' }, cost: 1, stock: 2, image: await imageInput() })
    garden.redeem(admin, { studentId: studentX, itemId: item.id })
    const invitation = garden.createInvitation(owner, classX), beforeHistory = history(), beforeTemplates = templates(), beforeY = classState(owner, classY), beforeImage = garden.itemImage(owner, item.id)
    const resources = Object.fromEntries(['rules', 'items', 'settings_versions'].map(table => [table, garden.db.prepare(`SELECT * FROM ${table} WHERE class_id = ? ORDER BY id`).all(classX).map(row => { const { owner_id, ...rest } = row as Record<string, unknown>; return rest })]))
    garden.transferClass(owner, classX, { userId: admin })
    expect(history()).toEqual(beforeHistory)
    expect(templates()).toEqual(beforeTemplates)
    expect(classState(owner, classY)).toEqual(beforeY)
    expect(garden.itemImage(admin, item.id)).toEqual(beforeImage)
    for (const table of ['rules', 'items', 'settings_versions']) {
      const rows = garden.db.prepare(`SELECT * FROM ${table} WHERE class_id = ? ORDER BY id`).all(classX) as Record<string, unknown>[]
      expect(rows.every(row => row.owner_id === admin)).toBe(true)
      expect(rows.map(({ owner_id, ...rest }) => rest)).toEqual(resources[table])
    }
    expect(snapshot(owner).classes.find(row => row.id === classX)).toMatchObject({ owner_id: admin, role: 'admin' })
    expect(snapshot(admin).classes[0]).toMatchObject({ owner_id: admin, role: 'owner' })
    expect(snapshot(admin).records[0]).toMatchObject({ actor_user_id: admin, actor_name: '乙老师' })
    expect(garden.classTeachers(admin, classX).teachers).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: owner, role: 'admin' }), expect.objectContaining({ user_id: admin, role: 'owner' })]))
    expectError(() => garden.joinClass(outsider, { code: invitation.code }), 'invalidInvitation', 404)
    expectError(() => garden.deleteClass(owner, classX), 'forbidden', 403)
    expectError(() => garden.removeTeacher(owner, classX, admin), 'forbidden', 403)
    garden.leaveClass(owner, classX)
    expectError(() => garden.snapshot(owner, classX), 'notFound', 404)
    expect(garden.student(admin, studentX).points).toBe(100)
    expect(garden.snapshot(owner, classY).students[0].id).toBe(studentY)
  })
  it('共同管理员退出不删历史；负责人删除仅级联本班成员、资源及邀请，不影响另一班', () => {
    garden.evaluate(admin, { studentIds: [studentX], ruleId: snapshot(admin).rules[0].id })
    const before = history()
    garden.leaveClass(admin, classX)
    expect(history()).toEqual(before)
    expectError(() => garden.leaveClass(admin, classX), 'notFound', 404)
    expectError(() => garden.createInvitation(admin, classX), 'notFound', 404)
    join(admin)
    const beforeY = classState(owner, classY), beforeTemplates = templates()
    garden.deleteClass(owner, classX)
    expectError(() => garden.snapshot(admin, classX), 'notFound', 404)
    for (const table of ['class_members', 'class_invites', 'rules', 'items', 'settings_versions']) expect(garden.db.prepare(`SELECT * FROM ${table} WHERE class_id = ?`).all(classX)).toEqual([])
    expect(garden.db.prepare('SELECT * FROM evaluations WHERE student_id = ?').all(studentX)).toEqual([])
    expect(garden.db.prepare('SELECT * FROM growth_events WHERE student_id = ?').all(studentX)).toEqual([])
    expect(classState(owner, classY)).toEqual(beforeY)
    expect(templates()).toEqual(beforeTemplates)
    expect(garden.db.pragma('foreign_key_check')).toEqual([])
  })
})
