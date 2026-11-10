import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { exportBackup, restoreBackup } from '../lib/server/backup'
import { defaultGardenSettings, type GardenSettings } from '../lib/garden-settings'
import { MAX_BACKUP_BYTES, MAX_CLASS_IMAGE_BYTES } from '../lib/shop'
import { validateStoredImage } from '../lib/server/item-images'
import { petBackgrounds, versionFiveBackgroundIds, holidayBackgroundIds, versionSevenBackgroundIds } from '../lib/pet-backgrounds'

type Backup = Awaited<ReturnType<typeof exportBackup>>
let garden: Garden, owner: string, colleague: string, importer: string
const localized = (value: string) => ({ zh: value, en: value })
const text = JSON.stringify(localized('历史记录'))

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 1, 4))
  garden = new Garden(createDatabase(':memory:'))
  const teacher = async (username: string, displayName: string, subject: string) => {
    const id = (await garden.register({ username, password: 'test-password-123' })).user.id
    await garden.saveProfile(id, { displayName, subject, teachingRole: 'subject' })
    return id
  }
  owner = (await teacher('backup-owner', '原负责人', '语文'))
  colleague = (await teacher('backup-colleague', '共同教师', '数学'))
  importer = (await teacher('backup-importer', '导入教师', '科学'))
})
afterEach(() => { vi.restoreAllMocks(); garden.db.close() })

async function classroom(actor = owner, name = '备份班级') {
  const id = (await garden.createClass(actor, { name })).id
  const studentId = (await garden.addStudents(actor, { classId: id, students: [{ name: `${name}学生` }] }))[0]
  await garden.adopt(actor, studentId, { petId: 'panda' })
  return { id, studentId }
}
async function join(actor: string, classId: string) {
  const invitation = await garden.createInvitation(owner, classId)
  await garden.joinClass(actor, { code: invitation.code })
  return invitation
}
async function settings(actor: string, classId: string, edit: (value: GardenSettings) => void) {
  const current = await garden.settings(actor, classId), value = structuredClone(current.value)
  edit(value)
  await garden.saveSettings(actor, { classId, version: current.version, value })
}
async function score(actor: string, classId: string, studentId: string, points: number) {
  await garden.addRule(actor, { classId, name: localized(`评分 ${points}`), points, category: 'other' })
  const ruleId = (await garden.snapshot(actor, classId)).rules.at(-1)!.id
  return await garden.evaluate(actor, { studentIds: [studentId], ruleId })
}
async function templates(actor: string) {
  return Object.fromEntries(await Promise.all(['settings_versions', 'rules', 'items'].map(async table => [table, (await garden.db.prepare(`SELECT * FROM ${table} WHERE owner_id = ? AND class_id IS NULL ORDER BY rowid`).all(actor))])))
}
async function databaseState() {
  const tables = await garden.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
  return Object.fromEntries(await Promise.all(tables.map(async ({ name }) => [name, (await garden.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())])))
}

// v4没有背景列或背景商品；逐项剥除，不能只改当前导出的version。
async function versionFour(source?: Backup) {
  source ??= await exportBackup(garden, owner)
  return {
    ...source,
    version: 4 as const,
    students: source.students.map(({ background_id, archived_at, ...row }) => row),
    items: source.items.filter(row => row.background_id === null).map(({ background_id, ...row }) => row),
    redemptions: source.redemptions.map(({ background_id, ...row }) => row)
  }
}
// v5有背景列，但白名单固定为原四，不能把当前41项目录直接当旧版夹具。
async function versionFive(source?: Backup) {
  source ??= await exportBackup(garden, owner)
  const originalIds = new Set<string>(versionFiveBackgroundIds)
  return { ...source, version: 5 as const, students: source.students.map(({ archived_at, ...row }) => row), items: source.items.filter(row => row.background_id === null || originalIds.has(row.background_id)) }
}
async function versionSix(source?: Backup) {
  source ??= await exportBackup(garden, owner)
  const frozenIds = new Set<string>([...versionFiveBackgroundIds, ...holidayBackgroundIds])
  return { ...source, version: 6 as const, students: source.students.map(({ archived_at, ...row }) => row), items: source.items.filter(row => row.background_id === null || frozenIds.has(row.background_id)) }
}
async function backgroundBackup(version: 5 | 6 | 7) {
  return version === 5 ? (await versionFive()) : version === 6 ? (await versionSix()) : (await versionSeven())
}
async function versionSeven() {
  const source = await exportBackup(garden, owner)
  return { ...source, version: 7 as const, students: source.students.map(({ archived_at, ...row }) => row) }
}
async function expectImportedBackgroundDefaults(classId: string) {
  const rows = (await garden.snapshot(importer, classId)).items.filter(row => row.background_id !== null)
  expect(rows).toHaveLength(41)
  expect(rows.map(row => row.background_id).sort()).toEqual(petBackgrounds.map(row => row.id).sort())
  expect(rows.every(row => row.cost === 1 && row.stock === -1 && row.image === null)).toBe(true)
  for (const student of (await garden.snapshot(importer, classId)).students) expect(student).toMatchObject({ background_id: null, owned_background_ids: [] })
}

// 独立旧格式夹具，不能用改写 version 的当前导出来替代旧全局资源结构。
function versionThree() {
  const changed = defaultGardenSettings()
  changed.growth[1].experience = 17
  changed.sickness = true
  changed.signedGrowth = true
  return {
    version: 3,
    classes: [{ id: 'class-a', name: '旧三版甲班', created_at: 1 }, { id: 'class-b', name: '旧三版乙班', created_at: 1 }],
    students: [
      { id: 'student-a', class_id: 'class-a', name: '小数成长', student_no: '1', points: 70, pet_id: 'panda', pet_exp: 48.5, generation: 1, spent_badges: 1, created_at: 1 },
      { id: 'student-b', class_id: 'class-b', name: '负数成长', student_no: '2', points: -3, pet_id: 'panda', pet_exp: -3, generation: 1, spent_badges: 1, created_at: 1 }
    ],
    settings: [{ id: 'policy-0', version: 0, value: defaultGardenSettings(), created_at: 1 }, { id: 'policy-1', version: 1, value: changed, created_at: 3 }],
    rules: [{ id: 'old-rule', name: text, points: 70, category: 'other', custom: 1 }],
    evaluations: [
      { id: 'score-a', batch_id: 'batch-a', student_id: 'student-a', points: 70, reason: text, category: 'other', generation: 1, created_at: 2, undone: 0 },
      { id: 'score-b', batch_id: 'batch-b', student_id: 'student-b', points: 40, reason: text, category: 'other', generation: 1, created_at: 4, undone: 0 },
      { id: 'score-negative', batch_id: 'batch-negative', student_id: 'student-b', points: -43, reason: text, category: 'other', generation: 1, created_at: 5, undone: 0 }
    ],
    events: [
      { id: 'start-a', seq: 1, student_id: 'student-a', generation: 1, kind: 'start', settings_id: 'policy-0', evaluation_id: null, pet_id: 'panda', initial_undone: 0, created_at: 1 },
      { id: 'event-a', seq: 2, student_id: 'student-a', generation: 1, kind: 'evaluation', settings_id: 'policy-0', evaluation_id: 'score-a', pet_id: null, initial_undone: 0, created_at: 2 },
      { id: 'start-b', seq: 3, student_id: 'student-b', generation: 1, kind: 'start', settings_id: 'policy-0', evaluation_id: null, pet_id: 'panda', initial_undone: 0, created_at: 1 },
      { id: 'rebase-a', seq: 4, student_id: 'student-a', generation: 1, kind: 'rebase', settings_id: 'policy-1', evaluation_id: null, pet_id: null, initial_undone: 0, created_at: 3 },
      { id: 'rebase-b', seq: 5, student_id: 'student-b', generation: 1, kind: 'rebase', settings_id: 'policy-1', evaluation_id: null, pet_id: null, initial_undone: 0, created_at: 3 },
      { id: 'event-b', seq: 6, student_id: 'student-b', generation: 1, kind: 'evaluation', settings_id: 'policy-1', evaluation_id: 'score-b', pet_id: null, initial_undone: 0, created_at: 4 },
      { id: 'event-negative', seq: 7, student_id: 'student-b', generation: 1, kind: 'evaluation', settings_id: 'policy-1', evaluation_id: 'score-negative', pet_id: null, initial_undone: 0, created_at: 5 }
    ],
    badges: [
      { id: 'badge-a', student_id: 'student-a', generation: 1, pet_id: 'panda', earned_at: 2, level: 2, amount: 1, active: 1, source_event: 'event-a' },
      { id: 'badge-b', student_id: 'student-b', generation: 1, pet_id: 'panda', earned_at: 4, level: 2, amount: 1, active: 1, source_event: 'event-b' }
    ],
    items: [{ id: 'old-item', name: text, cost: 1, active: 0, description: JSON.stringify(localized('')), category: 'other', icon: 'gift', image: null, image_key: null, image_bytes: 0, stock: 3 }],
    redemptions: [
      { id: 'redemption-a', student_id: 'student-a', item_id: 'old-item', item_name: text, cost: 1, created_at: 6, undone: 0, stock_deducted: 1 },
      { id: 'redemption-b', student_id: 'student-b', item_id: 'old-item', item_name: text, cost: 1, created_at: 6, undone: 0, stock_deducted: 1 }
    ]
  }
}
function versionOneOrTwo(version: 1 | 2) {
  return {
    version,
    classes: [{ id: 'legacy-class', name: `旧${version}版`, created_at: 1 }],
    students: [{ id: 'legacy-student', class_id: 'legacy-class', name: '旧学生', student_no: '', points: 700, pet_id: 'panda', pet_exp: 700, generation: 1, spent_badges: 1, created_at: 1 }],
    rules: [],
    evaluations: [{ id: 'legacy-score', batch_id: 'legacy-batch', student_id: 'legacy-student', points: 700, reason: text, category: 'other', generation: 1, created_at: 2, undone: 0 }],
    badges: (version === 1 ? [8] : [2, 3, 4, 5, 6, 7, 8]).map(level => ({ id: `legacy-badge-${level}`, student_id: 'legacy-student', generation: 1, pet_id: 'panda', earned_at: 2, ...(version === 2 ? { level } : {}) })),
    items: [{ id: 'legacy-item', name: text, cost: 1, active: 1, ...(version === 2 ? { description: JSON.stringify(localized('')), category: 'other', icon: 'gift', image: null, image_key: null, image_bytes: 0, stock: 2 } : {}) }],
    redemptions: [{ id: 'legacy-redemption', student_id: 'legacy-student', item_id: 'legacy-item', item_name: text, cost: 1, created_at: 3, undone: 0, ...(version === 2 ? { stock_deducted: 1 } : {}) }]
  }
}

describe('协作备份 v7 的负责人边界与非破坏导入', () => {
  it('平铺独立模板和班级资源，只导出当前负责人班级；转让不导出成员或授权标识', async () => {
    const first = await classroom(), second = await classroom(owner, '不转让班级')
    const invitation = await join(colleague, first.id)
    await score(colleague, first.id, first.studentId, 3)
    await settings(owner, first.id, value => { value.sickness = true })
    const before = await exportBackup(garden, owner)
    expect(before.version).toBe(8)
    expect(before.classes.map(row => row.id)).toEqual([first.id, second.id])
    expect(before.settings.filter(row => row.class_id === first.id).map(row => row.version)).toEqual([0, 1])
    expect(before.settings.filter(row => row.class_id === second.id).map(row => row.version)).toEqual([0])
    expect(before.settings.filter(row => row.class_id === null)).toHaveLength(1)
    expect(before.rules.some(row => row.class_id === null)).toBe(true)
    expect(before.items.some(row => row.class_id === null)).toBe(true)
    expect(before.evaluations[0]).toMatchObject({ actor_name: '共同教师', actor_subject: '数学' })
    const encoded = JSON.stringify(before)
    for (const secret of [owner, colleague, importer, invitation.code, 'actor_user_id', 'undone_by_user_id', 'owner_id', 'members', 'code_hash', 'sessions', 'password']) expect(encoded).not.toContain(secret)
    expect((await exportBackup(garden, colleague)).classes).toEqual([])

    await garden.transferClass(owner, first.id, { userId: colleague })
    const formerOwner = await exportBackup(garden, owner), newOwner = await exportBackup(garden, colleague)
    expect(formerOwner.classes.map(row => row.id)).toEqual([second.id])
    expect(formerOwner.students.map(row => row.id)).toEqual([second.studentId])
    for (const resources of [formerOwner.settings, formerOwner.rules, formerOwner.items]) expect(resources.every(row => row.class_id === null || row.class_id === second.id)).toBe(true)
    expect(formerOwner.evaluations).toEqual([])
    expect(newOwner.classes.map(row => row.id)).toEqual([first.id])
    expect(newOwner.evaluations).toEqual(before.evaluations)
    expect(newOwner.settings.filter(row => row.class_id === first.id)).toEqual(before.settings.filter(row => row.class_id === first.id))
    expect((await garden.classroom(owner, first.id)).role).toBe('admin')
  })

  it('同步导出在同一读事务中查询资料、负责人、资源和业务历史', async () => {
    await classroom()
    const prepare = garden.db.prepare.bind(garden.db), transactions: boolean[] = []
    vi.spyOn(garden.db, 'prepare').mockImplementation((...args) => {
      transactions.push(garden.db.inTransaction)
      return prepare(...args)
    })
    await exportBackup(garden, owner)
    expect(transactions.length).toBeGreaterThan(5)
    expect(transactions.every(Boolean)).toBe(true)
    expect(garden.db.inTransaction).toBe(false)
  })

  it('恢复始终新建副本，保留共管和负责的原班及模板，actor只恢复文本且仅导入者为成员', async () => {
    const first = await classroom(), second = await classroom(owner, '负数班级')
    await join(colleague, first.id)
    await join(importer, first.id)
    await settings(owner, first.id, value => { value.growth[0] = { experience: 10, badges: 4 }; value.sickness = true })
    const originalAward = await score(colleague, first.id, first.studentId, 10)
    await settings(owner, first.id, value => { value.growth[0].badges = 9 })
    await garden.undo(owner, originalAward.batchId)
    await score(colleague, first.id, first.studentId, 10)
    await score(colleague, first.id, first.studentId, 7)
    await settings(owner, first.id, value => { value.growth[1].experience = 17 })
    await settings(owner, second.id, value => { value.sickness = true })
    await score(owner, second.id, second.studentId, -5)
    const { id: itemId } = await garden.addItem(owner, { classId: first.id, name: localized('可退款商品'), cost: 1, stock: 2 })
    await garden.redeem(colleague, { studentId: first.studentId, itemId })
    await garden.undoRedemption(owner, (await garden.snapshot(owner, first.id)).redemptions[0].id)
    await garden.redeem(colleague, { studentId: first.studentId, itemId })
    await garden.deleteItem(owner, itemId)
    const invitation = await garden.createInvitation(owner, first.id)
    const ownClass = await classroom(importer, '导入者原班')
    const beforeTemplates = await templates(importer), beforeOwner = await exportBackup(garden, owner), beforeMember = await garden.classTeachers(owner, first.id)
    const originalState = await garden.snapshot(owner, first.id), source = await exportBackup(garden, owner)
    const result = await restoreBackup(garden, importer, source)
    expect(result.imported).toBe(2)
    expect(result.classIds).toHaveLength(2)
    expect(result.classIds.every(id => !source.classes.some(row => row.id === id))).toBe(true)
    expect(await templates(importer)).toEqual(beforeTemplates)
    expect((await garden.student(importer, ownClass.studentId)).class_id).toBe(ownClass.id)
    expect(await garden.snapshot(owner, first.id)).toEqual(originalState)
    expect(await garden.classTeachers(owner, first.id)).toEqual(beforeMember)
    expect((await garden.previewInvitation(importer, { code: invitation.code })).id).toBe(first.id)
    expect(await exportBackup(garden, owner)).toMatchObject({ classes: beforeOwner.classes, students: beforeOwner.students, settings: beforeOwner.settings, evaluations: beforeOwner.evaluations })

    for (const classId of result.classIds) {
      expect(await garden.classroom(importer, classId)).toMatchObject({ owner_id: importer, role: 'owner' })
      expect(await garden.db.prepare('SELECT user_id FROM class_members WHERE class_id = ?').all(classId)).toEqual([{ user_id: importer }])
      expect(await garden.db.prepare('SELECT * FROM class_invites WHERE class_id = ?').all(classId)).toEqual([])
      await expect(async () => (await garden.classroom(owner, classId))).rejects.toThrow('notFound')
      for (const table of ['settings_versions', 'rules', 'items']) expect(await garden.db.prepare(`SELECT DISTINCT owner_id FROM ${table} WHERE class_id = ?`).all(classId)).toEqual([{ owner_id: importer }])
    }
    const copy = await garden.snapshot(importer, result.classIds[0]), negativeCopy = await garden.snapshot(importer, result.classIds[1])
    expect(copy.students[0]).toMatchObject({ points: 17, pet_exp: originalState.students[0].pet_exp, spent_badges: 1, badge_count: 4 })
    expect(copy.badges[0]).toMatchObject({ amount: 4, active: 1 })
    expect(negativeCopy.students[0]).toMatchObject({ points: -5, pet_exp: -5 })
    const imported = await exportBackup(garden, importer), newStudents = new Set([copy.students[0].id, negativeCopy.students[0].id])
    for (const records of [imported.evaluations, imported.redemptions]) for (const record of records.filter(row => newStudents.has(row.student_id))) {
      const table = 'batch_id' in record ? 'evaluations' : 'redemptions'
      expect(source[table].some(row => row.id === record.id)).toBe(false)
      expect(await garden.db.prepare(`SELECT actor_user_id, undone_by_user_id FROM ${table} WHERE id = ?`).get(record.id)).toEqual({ actor_user_id: null, undone_by_user_id: null })
    }
    const copiedScores = imported.evaluations.filter(row => row.student_id === copy.students[0].id)
    expect(copiedScores.map(row => [row.actor_name, row.actor_subject, row.undone_by_name, row.undone_by_subject])).toEqual(source.evaluations.filter(row => row.student_id === first.studentId).map(row => [row.actor_name, row.actor_subject, row.undone_by_name, row.undone_by_subject]))
    const deletedProduct = imported.items.find(row => row.class_id === result.classIds[0] && row.active === 0)!
    expect(deletedProduct).toMatchObject({ stock: 1 })
    const redemption = imported.redemptions.find(row => row.student_id === copy.students[0].id && !row.undone)!
    expect(redemption.item_id).toBe(deletedProduct.id)
    await garden.undoRedemption(importer, redemption.id)
    expect((await garden.db.prepare('SELECT stock FROM items WHERE id = ?').get(deletedProduct.id) as { stock: number }).stock).toBe(2)
    const secondImport = await restoreBackup(garden, importer, source)
    expect(secondImport.classIds.every(id => !result.classIds.includes(id))).toBe(true)
    expect((await garden.classroom(importer, ownClass.id)).id).toBe(ownClass.id)
  })

  it('未使用的模板也完整校验，恢复不将模板写入当前教师', async () => {
    const source = await exportBackup(garden, owner), before = await databaseState()
    expect(await restoreBackup(garden, importer, source)).toEqual({ imported: 0, classIds: [] })
    expect(await databaseState()).toEqual(before)
    const policy = source.settings.find(row => row.class_id === null)!
    policy.value.signedGrowth = true
    await expect(restoreBackup(garden, importer, source)).rejects.toThrow('invalidBackup')
    expect(await databaseState()).toEqual(before)
  })

  it('逐班拒绝跨班策略、商品、评价、徽章和批次，不写入任何数据', async () => {
    const first = await classroom(), second = await classroom(owner, '第二班')
    await score(owner, first.id, first.studentId, 40)
    await score(owner, second.id, second.studentId, 40)
    await garden.redeem(owner, { studentId: first.studentId, itemId: (await garden.snapshot(owner, first.id)).items.find(item => item.background_id === null)!.id })
    const source = await exportBackup(garden, owner), before = await databaseState()
    const mutations: ((data: Backup) => void)[] = [
      data => { data.events.find(row => row.student_id === first.studentId)!.settings_id = data.settings.find(row => row.class_id === second.id)!.id },
      data => { data.redemptions[0].item_id = data.items.find(row => row.class_id === second.id)!.id },
      data => { data.redemptions[0].item_id = data.items.find(row => row.class_id === null)!.id },
      data => { data.settings.find(row => row.class_id === first.id)!.class_id = second.id },
      data => { data.items.find(row => row.id === data.redemptions[0].item_id)!.class_id = second.id },
      data => { data.rules.find(row => row.class_id === first.id)!.class_id = 'missing-class' },
      data => { data.evaluations[0].student_id = second.studentId },
      data => { data.badges[0].student_id = second.studentId },
      data => { data.evaluations[1].batch_id = data.evaluations[0].batch_id },
      data => { data.students[0].class_id = 'missing-class' }
    ]
    for (const mutate of mutations) {
      const copy = structuredClone(source); mutate(copy)
      await expect(restoreBackup(garden, importer, copy)).rejects.toThrow('invalidBackup')
      expect(await databaseState()).toEqual(before)
    }
  })

  it('拒绝伪造授权、重复编号和错误链/事件/经验/奖励，即使其它班级有效也整笔拒绝', async () => {
    const first = await classroom(), second = await classroom(owner, '有效班级')
    await settings(owner, first.id, value => { value.sickness = true })
    await score(owner, first.id, first.studentId, 40)
    const source = await exportBackup(garden, owner), before = await databaseState()
    const invalid = [
      { ...source, members: [{ class_id: first.id, user_id: colleague }] },
      { ...source, classes: source.classes.map(row => ({ ...row, owner_id: colleague })) },
      { ...source, evaluations: source.evaluations.map(row => ({ ...row, actor_user_id: colleague })) },
      { ...source, redemptions: [{ id: 'forged', undone_by_user_id: colleague }] }
    ]
    for (const copy of invalid) await expect(restoreBackup(garden, importer, copy)).rejects.toThrow('invalidBackup')
    const mutations: ((data: Backup) => void)[] = [
      data => { data.classes.push(data.classes[0]) },
      data => { data.students.push(data.students[0]) },
      data => { data.settings = data.settings.filter(row => !(row.class_id === first.id && row.version === 0)) },
      data => { data.settings.find(row => row.class_id === first.id && row.version === 1)!.value.signedGrowth = false },
      data => { data.events[1].seq = data.events[0].seq },
      data => { data.events.at(-1)!.generation = 2 },
      data => { data.students[0].pet_exp = 999 },
      data => { data.evaluations[0].undone = 1 },
      data => { data.badges[0].amount = 99 },
      data => { data.badges[0].source_event = data.events.find(row => row.student_id === second.studentId)!.id }
    ]
    for (const mutate of mutations) {
      const copy = structuredClone(source); mutate(copy)
      await expect(restoreBackup(garden, importer, copy)).rejects.toThrow('invalidBackup')
    }
    expect(await databaseState()).toEqual(before)
  })

  it.each(([4, 5, 6, 7] as const).flatMap(version => [-1, 1].map(direction => ({ version, direction }))))('v$version拒绝$direction倍镜像中单笔安全但累计中途溢出、最终积分因精度丢失伪装一致的备份', async ({ version, direction }) => {
    const classId = (await garden.createClass(owner, { name: '累计精度验证班' })).id
    const studentId = (await garden.addStudents(owner, { classId, students: [{ name: '未领养积分学生' }] }))[0]
    for (const points of [-1, -2, 1]) await garden.evaluate(owner, { studentIds: [studentId], custom: { points: points * direction } })
    const source = version === 4 ? (await versionFour()) : (await backgroundBackup(version)), poison = structuredClone(source)
    expect(source.version).toBe(version)
    expect(source.students.find(row => row.id === studentId)).toMatchObject({ pet_id: null, generation: 0, points: -2 * direction, pet_exp: 0 })
    const records = poison.evaluations.filter(row => row.student_id === studentId && !row.undone)
    expect(records).toHaveLength(3)
    const values = [-Number.MAX_SAFE_INTEGER, -2, Number.MAX_SAFE_INTEGER].map(points => points * direction)
    expect(values.every(Number.isSafeInteger)).toBe(true)
    expect(Number.isSafeInteger(values[0] + values[1])).toBe(false)
    const rounded = values.reduce((sum, points) => sum + points, 0)
    const exact = values.reduce((sum, points) => sum + BigInt(points), BigInt(0))
    expect(rounded).toBe(-direction)
    expect(exact).toBe(BigInt(-2 * direction))
    expect(BigInt(rounded)).not.toBe(exact)
    records.forEach((record, index) => { record.points = values[index] })
    const student = poison.students.find(row => row.id === studentId)!
    student.points = rounded
    expect(student).toMatchObject({ pet_id: null, generation: 0, pet_exp: 0 })
    const events = poison.events.filter(row => row.student_id === studentId)
    expect(events).toHaveLength(3)
    expect(events.every(row => row.kind === 'evaluation' && row.generation === 0 && row.pet_id === null && records.some(record => record.id === row.evaluation_id))).toBe(true)
    expect(poison.events).toEqual(source.events)
    expect(poison.rules).toEqual(source.rules)
    const before = await databaseState()
    await expect(restoreBackup(garden, importer, poison)).rejects.toThrow('invalidBackup')
    expect(await databaseState()).toEqual(before)
  })

  it('图片验证后才写库，拒绝未引用模板图片的字节/哈希伪造', async () => {
    await classroom()
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#6d4aff' } }).webp().toBuffer()
    const stored = await validateStoredImage(`data:image/webp;base64,${image.toString('base64')}`)
    const source = await exportBackup(garden, owner), templateItem = source.items.find(row => row.class_id === null && row.background_id === null)!
    Object.assign(templateItem, stored)
    const before = await databaseState()
    for (const mutate of [
      (row: typeof templateItem) => { row.image_key = '0'.repeat(64) },
      (row: typeof templateItem) => { row.image_bytes++ },
      (row: typeof templateItem) => { row.image = 'data:image/webp;base64,YmFk' },
      (row: typeof templateItem) => { row.image = null }
    ]) {
      const copy = structuredClone(source)
      mutate(copy.items.find(row => row.class_id === null && row.background_id === null)!)
      await expect(restoreBackup(garden, importer, copy)).rejects.toThrow('invalidBackup')
      expect(await databaseState()).toEqual(before)
    }
    expect((await restoreBackup(garden, importer, source)).imported).toBe(1)
  })

  it('单班图片额度独立计数，允许多个各自合规班级的总图片超过10MB', async () => {
    const first = await classroom(), second = await classroom(owner, '图片第二班')
    const bytes = await sharp(randomBytes(512 * 512 * 3), { raw: { width: 512, height: 512, channels: 3 } }).webp({ quality: 82 }).toBuffer()
    const image = await validateStoredImage(`data:image/webp;base64,${bytes.toString('base64')}`)
    const source = await exportBackup(garden, owner), count = Math.floor(MAX_CLASS_IMAGE_BYTES / image.image_bytes)
    const product = source.items.find(row => row.class_id === first.id && row.background_id === null)!
    source.items = [first.id, second.id, null].flatMap(classId => Array.from({ length: count }, (_, index) => ({ ...product, ...image, id: `${classId}-image-${index}`, class_id: classId })))
    expect(source.items.reduce((sum, row) => sum + row.image_bytes, 0)).toBeGreaterThan(MAX_CLASS_IMAGE_BYTES)
    expect(Buffer.byteLength(JSON.stringify(source))).toBeLessThan(MAX_BACKUP_BYTES)
    const beforeTemplates = await templates(importer)
    expect((await restoreBackup(garden, importer, source)).imported).toBe(2)
    expect(await templates(importer)).toEqual(beforeTemplates)
    const beforeCount = await garden.db.prepare('SELECT COUNT(*) AS n FROM classes').get()
    source.items.push({ ...product, ...image, id: 'one-over-class-limit', class_id: first.id })
    await expect(restoreBackup(garden, importer, source)).rejects.toThrow('imageStorageFull')
    source.items.pop()
    source.items.push({ ...product, ...image, id: 'one-over-template-limit', class_id: null })
    await expect(restoreBackup(garden, importer, source)).rejects.toThrow('imageStorageFull')
    expect(await garden.db.prepare('SELECT COUNT(*) AS n FROM classes').get()).toEqual(beforeCount)
  }, 15000)

  it('保留50MB总上限，拒绝超限输入而不触及数据库', async () => {
    const before = await databaseState()
    await expect(restoreBackup(garden, importer, { version: 4, payload: 'x'.repeat(MAX_BACKUP_BYTES) })).rejects.toThrow('backupTooLarge')
    expect(await databaseState()).toEqual(before)
  })

  it('最终写入使用事务；插入后续资源失败回滚新班级、成员和资源而不删原数据', async () => {
    await classroom()
    const source = await exportBackup(garden, owner), before = await databaseState()
    await garden.db.exec("CREATE TRIGGER reject_backup_students BEFORE INSERT ON students BEGIN SELECT RAISE(ABORT, 'forced-backup-failure'); END")
    await expect(restoreBackup(garden, importer, source)).rejects.toThrow('forced-backup-failure')
    expect(await databaseState()).toEqual(before)
  })

  it('导出及恢复均要求已完善教师资料', async () => {
    const incomplete = (await garden.register({ username: 'incomplete-backup', password: 'test-password-123' })).user.id
    await expect(async () => (await exportBackup(garden, incomplete))).rejects.toThrow('profileRequired')
    await expect(restoreBackup(garden, incomplete, await exportBackup(garden, owner))).rejects.toThrow('profileRequired')
  })
})

describe('背景v5/v6/v7快照与旧版升级备份', () => {
  it('免费装扮中v7备份只保留原长期背景，恢复临时列为空且不改原班或已有导入班', async () => {
    vi.mocked(Date.now).mockReturnValue(Date.UTC(2026, 9, 1, 4))
    const first = await classroom(), existing = await classroom(importer, '已有导入班')
    await garden.evaluate(owner, { studentIds: [first.studentId], custom: { points: 40 } })
    const product = (await garden.snapshot(owner, first.id)).items.find(row => row.background_id === 'garden')!
    await garden.redeem(owner, { studentId: first.studentId, itemId: product.id })
    await garden.setBackground(owner, first.studentId, { backgroundId: 'garden' })
    await garden.setBackground(owner, first.studentId, { backgroundId: 'national-day' })
    await garden.setBackground(importer, existing.studentId, { backgroundId: 'national-day' })
    const original = await garden.snapshot(owner, first.id), originalExisting = await garden.snapshot(importer, existing.id), source = await exportBackup(garden, owner)
    expect(source.version).toBe(8)
    expect(source.students[0].background_id).toBe('garden')
    expect(Object.keys(source.students[0]).sort()).toEqual(['id', 'class_id', 'name', 'student_no', 'points', 'pet_id', 'pet_exp', 'generation', 'spent_badges', 'created_at', 'background_id', 'archived_at'].sort())
    expect(JSON.stringify(source)).not.toContain('festival_background')
    expect(source.redemptions.map(row => row.background_id)).toEqual(['garden'])
    const result = await restoreBackup(garden, importer, JSON.parse(JSON.stringify(source)))
    expect((await garden.snapshot(importer, result.classIds[0])).students[0]).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], festival_background_id: null, festival_background_expires_at: null, spent_badges: 1 })
    expect(await garden.snapshot(owner, first.id)).toEqual(original)
    expect(await garden.snapshot(importer, existing.id)).toEqual({ ...originalExisting, classes: (await garden.snapshot(importer, existing.id)).classes })
  })

  it('未拥有的免费背景不能伪造成备份长期装备，临时字段污染也按严格v7拒绝且全表零写入', async () => {
    vi.mocked(Date.now).mockReturnValue(Date.UTC(2026, 9, 1, 4))
    const first = await classroom()
    await garden.setBackground(owner, first.studentId, { backgroundId: 'national-day' })
    const source = await exportBackup(garden, owner), before = await databaseState()
    expect(source.students[0].background_id).toBeNull()
    const permanentPoison = structuredClone(source)
    permanentPoison.students[0].background_id = 'national-day'
    await expect(restoreBackup(garden, importer, permanentPoison)).rejects.toThrow('invalidBackup')
    expect(await databaseState()).toEqual(before)
    const temporaryPoison = structuredClone(source)
    Object.assign(temporaryPoison.students[0], { festival_background_id: 'national-day', festival_background_expires_at: Date.UTC(2026, 9, 1, 16) })
    await expect(restoreBackup(garden, importer, temporaryPoison)).rejects.toThrow('invalidBackup')
    expect(await databaseState()).toEqual(before)
    const restored = await restoreBackup(garden, importer, source)
    expect((await garden.snapshot(importer, restored.classIds[0])).students[0]).toMatchObject({ background_id: null, owned_background_ids: [], festival_background_id: null, festival_background_expires_at: null })
  })

  it.each(([5, 6, 7] as const).flatMap(version => [Number.MAX_SAFE_INTEGER - 700, -Number.MAX_SAFE_INTEGER, 1_000_000, -1_000_000].map(points => ({ version, points }))))('v$version背景与大额$points评分往返保持装备/所有权/下架/退款历史，重映射新ID并清actor关联且不改原班', async ({ version, points }) => {
    const first = await classroom(), existing = await classroom(importer, '导入者保留班')
    await join(colleague, first.id)
    await score(owner, first.id, first.studentId, 100)
    await garden.evaluate(owner, { studentIds: [first.studentId], custom: { points: 600 } })
    const initial = await garden.snapshot(owner, first.id), product = initial.items.find(row => row.background_id === 'garden')!, beach = initial.items.find(row => row.background_id === 'beach')!
    await garden.updateItem(owner, product.id, { cost: 2 })
    await garden.redeem(colleague, { studentId: first.studentId, itemId: product.id })
    await garden.redeem(colleague, { studentId: first.studentId, itemId: beach.id })
    const beachRedemption = (await garden.snapshot(owner, first.id)).redemptions.find(row => row.background_id === 'beach')!
    await garden.undoRedemption(owner, beachRedemption.id)
    await garden.setBackground(colleague, first.studentId, { backgroundId: 'garden' })
    await garden.deleteItem(owner, product.id)
    await garden.evaluate(colleague, { studentIds: [first.studentId], custom: { points, reason: '背景往返大额评分' } })
    const original = await garden.snapshot(owner, first.id), source = await backgroundBackup(version), beforeTemplates = await templates(importer), originalImport = await garden.snapshot(importer, existing.id)
    expect(source.version).toBe(version)
    expect(source.students.find(row => row.id === first.studentId)).toMatchObject({ background_id: 'garden', spent_badges: 2 })
    expect(source.items.find(row => row.id === product.id)).toMatchObject({ background_id: 'garden', active: 0, cost: 2, stock: -1 })
    expect(source.redemptions.find(row => row.background_id === 'garden')).toMatchObject({ background_id: 'garden', cost: 2, actor_name: '共同教师', actor_subject: '数学', undone: 0 })
    expect(source.redemptions.find(row => row.background_id === 'beach')).toMatchObject({ background_id: 'beach', undone: 1, undone_by_name: '原负责人' })
    expect(JSON.stringify(source)).not.toContain('owned_background_ids')
    const restored = await restoreBackup(garden, importer, JSON.parse(JSON.stringify(source)))
    expect(restored.classIds).toHaveLength(1)
    const copyId = restored.classIds[0], copy = await garden.snapshot(importer, copyId), student = copy.students[0]
    expect(copyId).not.toBe(first.id)
    expect(student.id).not.toBe(first.studentId)
    expect(student).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], points: original.students[0].points, pet_exp: original.students[0].pet_exp, spent_badges: 2 })
    expect(copy.items.filter(row => row.background_id !== null)).toHaveLength(40)
    expect(copy.items.some(row => row.background_id === 'garden')).toBe(false)
    const copied = await exportBackup(garden, importer), copiedProduct = copied.items.find(row => row.class_id === copyId && row.background_id === 'garden')!, redemption = copy.redemptions.find(row => row.background_id === 'garden')!
    expect(copiedProduct).toMatchObject({ active: 0, background_id: 'garden', stock: -1, cost: 2 })
    expect(copiedProduct.id).not.toBe(product.id)
    expect(redemption).toMatchObject({ item_id: copiedProduct.id, student_id: student.id, actor_user_id: null, actor_name: '共同教师', background_id: 'garden' })
    expect(source.redemptions.some(row => row.id === redemption.id)).toBe(false)
    for (const table of ['redemptions', 'evaluations']) {
      const rows = await garden.db.prepare(`SELECT actor_user_id, undone_by_user_id FROM ${table} WHERE student_id = ?`).all(student.id)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every(row => (row as { actor_user_id: unknown; undone_by_user_id: unknown }).actor_user_id === null && (row as { undone_by_user_id: unknown }).undone_by_user_id === null)).toBe(true)
    }
    expect(await garden.db.prepare('SELECT user_id FROM class_members WHERE class_id = ?').all(copyId)).toEqual([{ user_id: importer }])
    await garden.setBackground(importer, student.id, { backgroundId: null })
    await garden.setBackground(importer, student.id, { backgroundId: 'garden' })
    await garden.undoRedemption(importer, redemption.id)
    expect((await garden.snapshot(importer, copyId)).students[0]).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    expect(await garden.db.prepare('SELECT stock, active FROM items WHERE id = ?').get(copiedProduct.id)).toEqual({ stock: -1, active: 0 })
    expect(await garden.snapshot(owner, first.id)).toEqual(original)
    expect(await garden.snapshot(importer, existing.id)).toEqual({ ...originalImport, classes: (await garden.snapshot(importer, existing.id)).classes })
    expect(await templates(importer)).toEqual(beforeTemplates)
    expect(await garden.db.pragma('foreign_key_check')).toEqual([])
  })

  it.each([5, 6, 7] as const)('v%s不重补被下架或从备份删除的原四背景商品，保持每班自定义价格和独立副本', async version => {
    const first = await classroom(), second = await classroom(owner, '独立背景价格班')
    const firstItem = (await garden.snapshot(owner, first.id)).items.find(row => row.background_id === 'garden')!, secondItem = (await garden.snapshot(owner, second.id)).items.find(row => row.background_id === 'garden')!
    await garden.updateItem(owner, firstItem.id, { cost: 5 })
    await garden.deleteItem(owner, secondItem.id)
    const source = await backgroundBackup(version)
    source.items = source.items.filter(row => !(row.class_id === first.id && row.background_id === 'beach'))
    const { classIds } = await restoreBackup(garden, importer, source)
    const firstCopy = classIds[source.classes.findIndex(row => row.id === first.id)], secondCopy = classIds[source.classes.findIndex(row => row.id === second.id)]
    expect((await garden.snapshot(importer, firstCopy)).items.filter(row => row.background_id !== null)).toHaveLength(40)
    expect((await garden.snapshot(importer, firstCopy)).items.find(row => row.background_id === 'garden')).toMatchObject({ cost: 5, stock: -1 })
    expect((await garden.snapshot(importer, firstCopy)).items.some(row => row.background_id === 'beach')).toBe(false)
    expect((await garden.snapshot(importer, secondCopy)).items.filter(row => row.background_id !== null)).toHaveLength(40)
    expect((await garden.snapshot(importer, secondCopy)).items.some(row => row.background_id === 'garden')).toBe(false)
    const imported = await exportBackup(garden, importer)
    expect(imported.items.filter(row => row.class_id === firstCopy && row.background_id !== null)).toHaveLength(40)
    expect(imported.items.find(row => row.class_id === secondCopy && row.background_id === 'garden')).toMatchObject({ active: 0, cost: 1, stock: -1 })
  })

  it.each([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 1_000_000, -1_000_000])('真实v4不含背景字段仍支持%s大额评分，导入副本补null与41背景而不污染模板', async points => {
    const first = await classroom(), beforeTemplates = await templates(importer)
    await garden.evaluate(owner, { studentIds: [first.studentId], custom: { points, reason: 'v4大额评分' } })
    const source = await versionFour()
    expect(source.version).toBe(4)
    for (const rows of [source.students, source.items, source.redemptions]) for (const row of rows) expect(row).not.toHaveProperty('background_id')
    const original = await garden.snapshot(owner, first.id), { classIds } = await restoreBackup(garden, importer, source)
    await expectImportedBackgroundDefaults(classIds[0])
    const state = await garden.snapshot(importer, classIds[0])
    expect(state.students[0]).toMatchObject({ points, pet_exp: Math.max(0, points) })
    expect(state.records[0]).toMatchObject({ points, actor_user_id: null, actor_name: '原负责人' })
    expect(await garden.snapshot(owner, first.id)).toEqual(original)
    expect(await templates(importer)).toEqual(beforeTemplates)
    expect((await exportBackup(garden, importer)).version).toBe(8)
  })

  it('真实v4普通商品退款记录保留null背景及署名，补新商品而不改变原班', async () => {
    const first = await classroom()
    await join(colleague, first.id)
    await score(owner, first.id, first.studentId, 40)
    const item = await garden.addItem(owner, { classId: first.id, name: localized('v4旧商品'), cost: 1, stock: 2 })
    await garden.redeem(colleague, { studentId: first.studentId, itemId: item.id })
    await garden.deleteItem(owner, item.id)
    const source = await versionFour(), original = await garden.snapshot(owner, first.id), { classIds } = await restoreBackup(garden, importer, source)
    await expectImportedBackgroundDefaults(classIds[0])
    const state = await garden.snapshot(importer, classIds[0]), redemption = state.redemptions[0]
    expect(redemption).toMatchObject({ background_id: null, actor_user_id: null, actor_name: '共同教师', stock_deducted: 1 })
    await garden.undoRedemption(importer, redemption.id)
    expect((await garden.snapshot(importer, classIds[0])).students[0].spent_badges).toBe(0)
    expect(await garden.db.prepare('SELECT stock, active, background_id FROM items WHERE id = ?').get(redemption.item_id)).toEqual({ stock: 2, active: 0, background_id: null })
    expect(await garden.snapshot(owner, first.id)).toEqual(original)
  })

  it('真实v5原四拥有/装备/下架/缺失恢复仅加28+9，导出7后再次恢复不补任何缺失，模板和原班均不变', async () => {
    const first = await classroom(), existing = await classroom(importer, '已有导入班')
    await join(colleague, first.id)
    await garden.evaluate(owner, { studentIds: [first.studentId], custom: { points: 700 } })
    const items = (await garden.snapshot(owner, first.id)).items, gardenItem = items.find(row => row.background_id === 'garden')!, beach = items.find(row => row.background_id === 'beach')!
    await garden.updateItem(owner, gardenItem.id, { cost: 2 })
    await garden.updateItem(owner, beach.id, { cost: 4 })
    await garden.redeem(colleague, { studentId: first.studentId, itemId: gardenItem.id })
    await garden.setBackground(colleague, first.studentId, { backgroundId: 'garden' })
    await garden.deleteItem(owner, beach.id)
    const source = await versionFive()
    source.items = source.items.filter(row => row.background_id !== 'starlight')
    expect(source.items.every(row => row.background_id === null || new Set<string>(versionFiveBackgroundIds).has(row.background_id))).toBe(true)
    const original = await garden.snapshot(owner, first.id), originalExisting = await garden.snapshot(importer, existing.id), beforeTemplates = await templates(importer)
    const firstRestore = await restoreBackup(garden, importer, source), copiedClassId = firstRestore.classIds[0], copy = await garden.snapshot(importer, copiedClassId)
    expect(copy.students[0]).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 2, points: 700 })
    expect(copy.students[0].id).not.toBe(first.studentId)
    expect(copy.items.filter(row => row.background_id !== null)).toHaveLength(39)
    expect(copy.items.some(row => row.background_id === 'starlight' || row.background_id === 'beach')).toBe(false)
    const firstExport = await exportBackup(garden, importer), copiedProducts = firstExport.items.filter(row => row.class_id === copiedClassId && row.background_id !== null)
    expect(firstExport.version).toBe(8)
    expect(copiedProducts).toHaveLength(40)
    expect(copiedProducts.find(row => row.background_id === 'beach')).toMatchObject({ active: 0, cost: 4 })
    expect(copiedProducts.find(row => row.background_id === 'garden')).toMatchObject({ active: 1, cost: 2 })
    expect(copiedProducts.filter(row => new Set<string>(holidayBackgroundIds).has(row.background_id!)).map(row => row.background_id).sort()).toEqual([...holidayBackgroundIds].sort())
    await garden.db.prepare('DELETE FROM items WHERE class_id = ? AND background_id = ?').run(copiedClassId, holidayBackgroundIds[0])
    await garden.deleteItem(importer, (await garden.snapshot(importer, copiedClassId)).items.find(row => row.background_id === holidayBackgroundIds[1])!.id)
    const secondExport = await exportBackup(garden, importer), expectedProducts = secondExport.items.filter(row => row.class_id === copiedClassId && row.background_id !== null)
    const beforeSecond = await garden.snapshot(importer, copiedClassId), secondRestore = await restoreBackup(garden, importer, secondExport), secondClassId = secondRestore.classIds[secondExport.classes.findIndex(row => row.id === copiedClassId)]
    const copiedAgain = await garden.snapshot(importer, secondClassId), finalExport = await exportBackup(garden, importer)
    expect(secondClassId).not.toBe(copiedClassId)
    expect(copiedAgain.students[0]).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 2 })
    expect(copiedAgain.students[0].id).not.toBe(copy.students[0].id)
    const productValues = (rows: typeof expectedProducts) => rows.map(({ background_id, cost, active, stock }) => ({ background_id, cost, active, stock })).sort((a, b) => a.background_id!.localeCompare(b.background_id!))
    expect(productValues(finalExport.items.filter(row => row.class_id === secondClassId && row.background_id !== null))).toEqual(productValues(expectedProducts))
    expect(await garden.snapshot(importer, copiedClassId)).toEqual({ ...beforeSecond, classes: (await garden.snapshot(importer, copiedClassId)).classes })
    expect(await garden.snapshot(owner, first.id)).toEqual(original)
    expect(await garden.snapshot(importer, existing.id)).toEqual({ ...originalExisting, classes: (await garden.snapshot(importer, existing.id)).classes })
    expect(await templates(importer)).toEqual(beforeTemplates)
  })

  it('真实v6恢复仅补9，原四/28缺失下架价格及持有装备不动；v7再恢复不补被删或下架的新9且不改模板和原班', async () => {
    const first = await classroom(), existing = await classroom(importer, 'v6导入者原班')
    await join(colleague, first.id)
    await garden.evaluate(owner, { studentIds: [first.studentId], custom: { points: 700 } })
    const ownedId = holidayBackgroundIds[0], absentHoliday = holidayBackgroundIds[1]
    const owned = (await garden.snapshot(owner, first.id)).items.find(row => row.background_id === ownedId)!, originalGarden = (await garden.snapshot(owner, first.id)).items.find(row => row.background_id === 'garden')!
    await garden.updateItem(owner, owned.id, { cost: 2 })
    await garden.updateItem(owner, originalGarden.id, { cost: 5 })
    await garden.redeem(colleague, { studentId: first.studentId, itemId: owned.id })
    await garden.setBackground(colleague, first.studentId, { backgroundId: ownedId })
    await garden.deleteItem(owner, owned.id)
    await garden.deleteItem(owner, originalGarden.id)
    const source = await versionSix()
    expect(source.version).toBe(6)
    expect(new Set(source.items.filter(row => row.background_id !== null).map(row => row.background_id)).size).toBe(32)
    expect(source.items.every(row => row.background_id === null || new Set<string>([...versionFiveBackgroundIds, ...holidayBackgroundIds]).has(row.background_id))).toBe(true)
    source.items = source.items.filter(row => !(row.class_id === first.id && (row.background_id === 'beach' || row.background_id === absentHoliday)))
    const original = await garden.snapshot(owner, first.id), beforeTemplates = await templates(importer), originalExisting = await garden.snapshot(importer, existing.id)
    const { classIds } = await restoreBackup(garden, importer, source), copyId = classIds[0], copy = await garden.snapshot(importer, copyId)
    expect(copy.students[0]).toMatchObject({ background_id: ownedId, owned_background_ids: [ownedId], spent_badges: 2 })
    expect(copy.students[0].id).not.toBe(first.studentId)
    const exported = await exportBackup(garden, importer)
    expect(exported.version).toBe(8)
    const products = exported.items.filter(row => row.class_id === copyId && row.background_id !== null), kept = source.items.filter(row => row.class_id === first.id && row.background_id !== null)
    const values = (rows: typeof products) => rows.map(({ background_id, cost, active, stock }) => ({ background_id, cost, active, stock })).sort((a, b) => a.background_id!.localeCompare(b.background_id!))
    expect(products).toHaveLength(kept.length + 9)
    expect(values(products.filter(row => !new Set<string>(versionSevenBackgroundIds).has(row.background_id!)))).toEqual(values(kept))
    expect(products.filter(row => new Set<string>(versionSevenBackgroundIds).has(row.background_id!)).map(row => row.background_id).sort()).toEqual([...versionSevenBackgroundIds].sort())
    expect(products.filter(row => new Set<string>(versionSevenBackgroundIds).has(row.background_id!)).every(row => row.cost === 1 && row.stock === -1 && row.active === 1 && row.image === null)).toBe(true)
    expect(products.some(row => row.background_id === 'beach' || row.background_id === absentHoliday)).toBe(false)
    expect(products.find(row => row.background_id === ownedId)).toMatchObject({ cost: 2, active: 0, stock: -1 })
    expect(products.find(row => row.background_id === 'garden')).toMatchObject({ cost: 5, active: 0, stock: -1 })
    expect(copy.redemptions[0]).toMatchObject({ background_id: ownedId, cost: 2, actor_user_id: null, actor_name: '共同教师', actor_subject: '数学' })
    await garden.db.prepare('DELETE FROM items WHERE class_id = ? AND background_id = ?').run(copyId, versionSevenBackgroundIds[0])
    const removed = (await garden.snapshot(importer, copyId)).items.find(row => row.background_id === versionSevenBackgroundIds[1])!
    await garden.updateItem(importer, removed.id, { cost: 9 })
    await garden.deleteItem(importer, removed.id)
    const secondSource = await exportBackup(garden, importer), expected = secondSource.items.filter(row => row.class_id === copyId && row.background_id !== null), beforeSecond = await garden.snapshot(importer, copyId)
    expect(secondSource.version).toBe(8)
    const second = await restoreBackup(garden, importer, secondSource), secondId = second.classIds[secondSource.classes.findIndex(row => row.id === copyId)]
    const final = await exportBackup(garden, importer), secondCopy = await garden.snapshot(importer, secondId)
    expect(values(final.items.filter(row => row.class_id === secondId && row.background_id !== null))).toEqual(values(expected))
    expect(secondCopy.items.some(row => row.background_id === versionSevenBackgroundIds[0] || row.background_id === versionSevenBackgroundIds[1])).toBe(false)
    expect(secondCopy.students[0]).toMatchObject({ background_id: ownedId, owned_background_ids: [ownedId], spent_badges: 2 })
    await garden.setBackground(importer, secondCopy.students[0].id, { backgroundId: ownedId })
    await garden.undoRedemption(importer, secondCopy.redemptions[0].id)
    expect((await garden.snapshot(importer, secondId)).students[0]).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    expect(await garden.snapshot(importer, copyId)).toEqual({ ...beforeSecond, classes: (await garden.snapshot(importer, copyId)).classes })
    expect(await garden.snapshot(owner, first.id)).toEqual(original)
    expect(await garden.snapshot(importer, existing.id)).toEqual({ ...originalExisting, classes: (await garden.snapshot(importer, existing.id)).classes })
    expect(await templates(importer)).toEqual(beforeTemplates)
    expect(await garden.db.pragma('foreign_key_check')).toEqual([])
  })

  it.each(versionSevenBackgroundIds)('真实v6冻结32白名单，伪装新增%s的学生/商品/兑换自洽或仅模板污染均全表零写入拒绝', async backgroundId => {
    const first = await classroom()
    await garden.evaluate(owner, { studentIds: [first.studentId], custom: { points: 700 } })
    const product = (await garden.snapshot(owner, first.id)).items.find(row => row.background_id === 'garden')!
    await garden.redeem(owner, { studentId: first.studentId, itemId: product.id })
    await garden.setBackground(owner, first.studentId, { backgroundId: 'garden' })
    const source = await versionSix(), before = await databaseState()
    expect(source.version).toBe(6)
    const mutations: ((data: typeof source) => void)[] = [
      data => {
        Object.assign(data.students.find(row => row.id === first.studentId)!, { background_id: backgroundId })
        Object.assign(data.items.find(row => row.id === product.id)!, { background_id: backgroundId })
        Object.assign(data.redemptions.find(row => row.item_id === product.id)!, { background_id: backgroundId })
      },
      data => { Object.assign(data.students.find(row => row.id === first.studentId)!, { background_id: backgroundId }) },
      data => { Object.assign(data.items.find(row => row.id === product.id)!, { background_id: backgroundId }) },
      data => { Object.assign(data.redemptions.find(row => row.item_id === product.id)!, { background_id: backgroundId }) },
      data => { Object.assign(data.items.find(row => row.class_id === null && row.background_id === 'garden')!, { background_id: backgroundId }) }
    ]
    for (const mutate of mutations) {
      const poison = structuredClone(source); mutate(poison)
      await expect(restoreBackup(garden, importer, poison)).rejects.toThrow('invalidBackup')
      expect(await databaseState()).toEqual(before)
    }
  })

  it.each([...holidayBackgroundIds, ...versionSevenBackgroundIds])('真实v5白名单固定原四，节日%s即使装备/商品/兑换自洽仍拒绝且全表零写入', async holidayId => {
    const first = await classroom()
    await garden.evaluate(owner, { studentIds: [first.studentId], custom: { points: 700 } })
    const product = (await garden.snapshot(owner, first.id)).items.find(row => row.background_id === 'garden')!
    await garden.redeem(owner, { studentId: first.studentId, itemId: product.id })
    await garden.setBackground(owner, first.studentId, { backgroundId: 'garden' })
    const source = await versionFive(), before = await databaseState(), coherent = structuredClone(source)
    Object.assign(coherent.students.find(row => row.id === first.studentId)!, { background_id: holidayId })
    Object.assign(coherent.items.find(row => row.id === product.id)!, { background_id: holidayId })
    Object.assign(coherent.redemptions.find(row => row.item_id === product.id)!, { background_id: holidayId })
    await expect(restoreBackup(garden, importer, coherent)).rejects.toThrow('invalidBackup')
    expect(await databaseState()).toEqual(before)
    const templatePoison = structuredClone(source)
    Object.assign(templatePoison.items.find(row => row.class_id === null && row.background_id === 'garden')!, { background_id: holidayId })
    await expect(restoreBackup(garden, importer, templatePoison)).rejects.toThrow('invalidBackup')
    expect(await databaseState()).toEqual(before)
  })

  it.each([
    ...holidayBackgroundIds.map(holidayId => ({ version: 6 as const, holidayId })),
    ...[...holidayBackgroundIds, ...versionSevenBackgroundIds].map(holidayId => ({ version: 7 as const, holidayId }))
  ])('v$version节日$holidayId持有装备备份往返保留新ID及署名，退款不改变原班', async ({ version, holidayId }) => {
    const first = await classroom()
    await join(colleague, first.id)
    await garden.evaluate(owner, { studentIds: [first.studentId], custom: { points: 700 } })
    const product = (await garden.snapshot(owner, first.id)).items.find(row => row.background_id === holidayId)!
    await garden.redeem(colleague, { studentId: first.studentId, itemId: product.id })
    await garden.setBackground(colleague, first.studentId, { backgroundId: holidayId })
    await garden.deleteItem(owner, product.id)
    const original = await garden.snapshot(owner, first.id), source = await backgroundBackup(version), beforeTemplates = await templates(importer)
    expect(source.version).toBe(version)
    expect(JSON.stringify(source)).not.toContain('owned_background_ids')
    const result = await restoreBackup(garden, importer, JSON.parse(JSON.stringify(source))), copy = await garden.snapshot(importer, result.classIds[0]), redemption = copy.redemptions[0]
    expect(copy.students[0]).toMatchObject({ background_id: holidayId, owned_background_ids: [holidayId], spent_badges: 1 })
    expect(copy.students[0].id).not.toBe(first.studentId)
    expect(redemption).toMatchObject({ background_id: holidayId, actor_user_id: null, actor_name: '共同教师', actor_subject: '数学', stock_deducted: 0 })
    expect(redemption.id).not.toBe(original.redemptions[0].id)
    expect(redemption.item_id).not.toBe(product.id)
    expect(copy.items.some(row => row.background_id === holidayId)).toBe(false)
    await garden.setBackground(importer, copy.students[0].id, { backgroundId: holidayId })
    await garden.undoRedemption(importer, redemption.id)
    expect((await garden.snapshot(importer, result.classIds[0])).students[0]).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    expect(await garden.snapshot(owner, first.id)).toEqual(original)
    expect(await templates(importer)).toEqual(beforeTemplates)
  })

  it.each([6, 7] as const)('v%s节日无持有装备、重复持有、跨班/模板商品、快照错配和未知目录全部零写入拒绝', async version => {
    const first = await classroom(), second = await classroom(owner, '节日隔离班'), holidayId = holidayBackgroundIds[0], another = holidayBackgroundIds[1]
    await garden.evaluate(owner, { studentIds: [first.studentId], custom: { points: 700 } })
    const product = (await garden.snapshot(owner, first.id)).items.find(row => row.background_id === holidayId)!
    await garden.redeem(owner, { studentId: first.studentId, itemId: product.id })
    await garden.setBackground(owner, first.studentId, { backgroundId: holidayId })
    const source = await backgroundBackup(version), before = await databaseState(), mutations: [string, (data: Awaited<ReturnType<typeof backgroundBackup>>) => void][] = [
      ['节日未知目录', data => { Object.assign(data.students[0], { background_id: 'not-approved-holiday' }); Object.assign(data.items.find(row => row.id === product.id)!, { background_id: 'not-approved-holiday' }); Object.assign(data.redemptions[0], { background_id: 'not-approved-holiday' }) }],
      ['节日未持有装备', data => { data.students[0].background_id = another }],
      ['节日重复有效持有', data => { data.redemptions.push({ ...data.redemptions[0], id: 'duplicate-holiday-redemption' }); data.students[0].spent_badges++ }],
      ['节日跨班引用', data => { data.redemptions[0].item_id = data.items.find(row => row.class_id === second.id && row.background_id === holidayId)!.id }],
      ['节日模板引用', data => { data.redemptions[0].item_id = data.items.find(row => row.class_id === null && row.background_id === holidayId)!.id }],
      ['节日商品兑换快照不符', data => { data.redemptions[0].background_id = another; data.students[0].background_id = null }],
      ['节日退款但继续装备', data => { data.redemptions[0].undone = 1; data.students[0].spent_badges = 0 }],
      ['节日目录category不能写商品category', data => { Object.assign(data.items.find(row => row.id === product.id)!, { category: 'chinese' }) }]
    ]
    for (const [label, mutation] of mutations) {
      const copy = structuredClone(source); mutation(copy)
      await expect(restoreBackup(garden, importer, copy), label).rejects.toThrow('invalidBackup')
      expect(await databaseState(), label).toEqual(before)
    }
  })

  it.each([5, 6, 7] as const)('v%s目录、重复有效持有、装备无持有、商品快照不符、跨班引用或派生字段伪造全部invalidBackup且全表零写入', async version => {
    const first = await classroom(), second = await classroom(owner, '有效背景第二班')
    await score(owner, first.id, first.studentId, 100)
    const product = (await garden.snapshot(owner, first.id)).items.find(row => row.background_id === 'garden')!
    await garden.redeem(owner, { studentId: first.studentId, itemId: product.id })
    await garden.setBackground(owner, first.studentId, { backgroundId: 'garden' })
    const source = await backgroundBackup(version), before = await databaseState()
    const mutate: [string, (data: typeof source) => void][] = [
      ['学生目录白名单', data => { Object.assign(data.students.find(row => row.id === first.studentId)!, { background_id: 'unknown' }) }],
      ['商品目录白名单', data => { Object.assign(data.items.find(row => row.id === product.id)!, { background_id: '../../secret' }) }],
      ['兑换目录白名单', data => { Object.assign(data.redemptions[0], { background_id: 'unknown' }) }],
      ['未引用模板仍校验白名单', data => { Object.assign(data.items.find(row => row.class_id === null)!, { background_id: 'unknown' }) }],
      ['背景不能有限库存', data => { data.items.find(row => row.id === product.id)!.stock = 3 }],
      ['背景不能伪造售罄库存', data => { data.items.find(row => row.id === product.id)!.stock = 0 }],
      ['背景不能导入上传图片', data => { const background = data.items.find(row => row.id === product.id)!; background.image = 'data:image/webp;base64,YmFk'; background.image_key = '0'.repeat(64); background.image_bytes = 3 }],
      ['重复有效持有', data => { data.redemptions.push({ ...data.redemptions[0], id: 'duplicate-active-background' }); data.students.find(row => row.id === first.studentId)!.spent_badges++ }],
      ['不同商品同背景也不能重复持有', data => { data.items.push({ ...data.items.find(row => row.id === product.id)!, id: 'duplicate-background-item' }); data.redemptions.push({ ...data.redemptions[0], id: 'duplicate-active-item-background', item_id: 'duplicate-background-item' }); data.students.find(row => row.id === first.studentId)!.spent_badges++ }],
      ['目录中未持有装备', data => { data.students.find(row => row.id === first.studentId)!.background_id = 'beach' }],
      ['退款后仍装备', data => { data.redemptions[0].undone = 1; data.students.find(row => row.id === first.studentId)!.spent_badges = 0 }],
      ['兑换快照不同于商品', data => { data.redemptions[0].background_id = 'beach'; data.students.find(row => row.id === first.studentId)!.background_id = null }],
      ['商品背景不同于兑换', data => { data.items.find(row => row.id === product.id)!.background_id = 'beach' }],
      ['普通商品不能伪造背景快照', data => { data.redemptions[0].item_id = data.items.find(row => row.class_id === first.id && row.background_id === null)!.id }],
      ['背景商品不能伪造普通快照', data => { data.redemptions[0].background_id = null; data.students.find(row => row.id === first.studentId)!.background_id = null }],
      ['同背景跨班商品', data => { data.redemptions[0].item_id = data.items.find(row => row.class_id === second.id && row.background_id === 'garden')!.id }],
      ['模板商品不能充当班级兑换', data => { data.redemptions[0].item_id = data.items.find(row => row.class_id === null && row.background_id === 'garden')!.id }],
      ['学生派生所有权不能导入', data => { Object.assign(data.students[0], { owned_background_ids: ['garden', 'beach'] }) }],
      ['顶层派生所有权不能导入', data => { Object.assign(data, { owned_background_ids: ['garden'] }) }],
      ['学生背景字段不能缺失', data => { Reflect.deleteProperty(data.students[0], 'background_id') }],
      ['商品背景字段不能缺失', data => { Reflect.deleteProperty(data.items[0], 'background_id') }],
      ['兑换背景字段不能缺失', data => { Reflect.deleteProperty(data.redemptions[0], 'background_id') }],
      ['评分仍拒绝不安全整数', data => { data.evaluations[0].points = Number.MAX_SAFE_INTEGER + 1 }]
    ]
    for (const [label, mutation] of mutate) {
      const copy = structuredClone(source); mutation(copy)
      await expect(restoreBackup(garden, importer, copy), label).rejects.toThrow('invalidBackup')
      expect(await databaseState(), label).toEqual(before)
    }
  })
})

describe('真实 v1/v2/v3 导入继续先运行原有完整校验', () => {
  it('v3全局资源先校验，再逐班克隆完整策略链/商品并映射历史，保留负数及小数经验', async () => {
    const existing = await classroom(importer), beforeTemplates = await templates(importer), source = versionThree()
    const { imported, classIds } = await restoreBackup(garden, importer, source)
    expect(imported).toBe(2)
    expect(await templates(importer)).toEqual(beforeTemplates)
    expect((await garden.student(importer, existing.studentId)).id).toBe(existing.studentId)
    const first = await garden.snapshot(importer, classIds[0]), second = await garden.snapshot(importer, classIds[1])
    expect(first.students[0]).toMatchObject({ pet_exp: 48.5, points: 70, spent_badges: 1 })
    expect(second.students[0]).toMatchObject({ pet_exp: -3, points: -3, spent_badges: 1 })
    expect(first.settings.value).toEqual(second.settings.value)
    expect(first.settings.id).not.toBe(second.settings.id)
    const backup = await exportBackup(garden, importer)
    for (const classId of classIds) {
      await expectImportedBackgroundDefaults(classId)
      const policies = backup.settings.filter(row => row.class_id === classId), policyIds = new Set(policies.map(row => row.id))
      expect(policies.map(row => row.version)).toEqual([0, 1])
      expect(policies[0].value).toEqual(defaultGardenSettings())
      const studentId = backup.students.find(row => row.class_id === classId)!.id
      expect(backup.events.filter(row => row.student_id === studentId).every(row => policyIds.has(row.settings_id))).toBe(true)
      const product = backup.items.find(row => row.class_id === classId && row.active === 0)!
      expect(product).toMatchObject({ stock: 3 })
      const redemption = backup.redemptions.find(row => row.student_id === studentId)!
      expect(redemption.item_id).toBe(product.id)
      expect(await garden.db.prepare('SELECT actor_user_id, actor_name, undone_by_user_id FROM redemptions WHERE id = ?').get(redemption.id)).toEqual({ actor_user_id: null, actor_name: '', undone_by_user_id: null })
      await garden.undoRedemption(importer, redemption.id)
      expect((await garden.db.prepare('SELECT stock FROM items WHERE id = ?').get(product.id) as { stock: number }).stock).toBe(4)
    }
    expect((await restoreBackup(garden, owner, await exportBackup(garden, importer))).imported).toBe(3)
  })

  it.each([1, 2] as const)('真实v%s的旧奖锁、默认配置和退款库存正确升级为独立班级', async version => {
    const source = versionOneOrTwo(version), existing = await classroom(importer)
    const result = await restoreBackup(garden, importer, source)
    expect(result.imported).toBe(1)
    expect((await garden.student(importer, existing.studentId)).id).toBe(existing.studentId)
    const state = await garden.snapshot(importer, result.classIds[0])
    expect(state.students[0]).toMatchObject({ points: 700, pet_exp: 700, spent_badges: 1, badge_count: 7 })
    expect(state.badges).toHaveLength(7)
    expect(state.settings.value).toEqual(defaultGardenSettings())
    await expectImportedBackgroundDefaults(result.classIds[0])
    const ordinary = state.items.find(row => row.background_id === null)!
    expect(ordinary).toMatchObject({ stock: version === 1 ? -1 : 2, background_id: null })
    expect(state.redemptions[0].background_id).toBeNull()
    await garden.undoRedemption(importer, state.redemptions[0].id)
    expect((await garden.snapshot(importer, result.classIds[0])).items.find(row => row.id === ordinary.id)!.stock).toBe(version === 1 ? -1 : 3)
    expect((await restoreBackup(garden, owner, await exportBackup(garden, importer))).imported).toBe(2)
  })

  it('不允许先按班级拆分来掩盖v3全局链、顺序、奖锁、经验或退款溢出错误', async () => {
    const source = versionThree(), before = await databaseState()
    const mutations: ((data: Awaited<ReturnType<typeof versionThree>>) => void)[] = [
      data => { data.settings[0].value.sickness = true },
      data => { data.settings[1].value.signedGrowth = false },
      data => { data.events[3].seq = data.events[0].seq },
      data => { data.events[0].settings_id = 'missing-policy' },
      data => { data.badges[0].amount = 99 },
      data => { data.students[0].pet_exp = 70 },
      data => { data.items[0].stock = Number.MAX_SAFE_INTEGER }
    ]
    for (const mutate of mutations) {
      const copy = structuredClone(source); mutate(copy)
      await expect(restoreBackup(garden, importer, copy)).rejects.toThrow('invalidBackup')
      expect(await databaseState()).toEqual(before)
    }
  })
})
