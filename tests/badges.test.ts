import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { exportBackup, restoreBackup } from '../lib/server/backup'
import { replayGrowth } from '../lib/growth'

let garden: Garden, owner: string, other: string, classId: string, studentId: string, ruleId: string
beforeEach(async () => {
  garden = new Garden(createDatabase(':memory:'))
  owner = (await garden.register({ username: 'badge-owner', password: 'Test-password-123' })).user.id
  other = (await garden.register({ username: 'badge-other', password: 'Test-password-456' })).user.id
  await garden.saveProfile(owner, { displayName: '徽章甲老师', subject: '语文', teachingRole: 'homeroom' })
  await garden.saveProfile(other, { displayName: '徽章乙老师', subject: '数学', teachingRole: 'subject' })
  classId = (await garden.createClass(owner, { name: '等级徽章班级' })).id
  studentId = (await garden.addStudents(owner, { classId, students: [{ name: '成长学生' }] }))[0]
  await garden.adopt(owner, studentId, { petId: 'panda' })
  await garden.addRule(owner, { classId, name: { zh: '成长跨级', en: 'Growth milestone' }, points: 100, category: 'other' })
  ruleId = (await garden.snapshot(owner, classId)).rules.at(-1)!.id
})
afterEach(() => garden.db.close())
const earn = async () => (await garden.evaluate(owner, { studentIds: [studentId], ruleId }))
const badges = async () => (await garden.snapshot(owner, classId)).badges
async function legacyBackup(version: 1 | 2 = 1) {
  const backup = await exportBackup(garden, owner)
  return {
    version,
    classes: backup.classes.filter(row => row.id === classId),
    students: backup.students.filter(row => row.class_id === classId).map(({ background_id, ...row }) => row),
    rules: backup.rules.filter(row => row.class_id === classId).map(({ class_id, ...row }) => row),
    evaluations: backup.evaluations.filter(row => backup.students.some(student => student.id === row.student_id && student.class_id === classId)).map(({ id, batch_id, student_id, points, reason, category, generation, created_at, undone }) => ({ id, batch_id, student_id, points, reason, category, generation, created_at, undone })),
    badges: backup.badges.filter(row => version === 2 || row.level === 8).map(({ id, student_id, generation, pet_id, earned_at, level }) => ({ id, student_id, generation, pet_id, earned_at, ...(version === 2 ? { level } : {}) })),
    items: backup.items.filter(row => row.class_id === classId && row.background_id === null).map(({ class_id, background_id, ...row }) => version === 2 ? row : ({ id: row.id, name: row.name, cost: row.cost, active: row.active })),
    redemptions: backup.redemptions.map(({ id, student_id, item_id, item_name, cost, created_at, undone, stock_deducted }) => ({ id, student_id, item_id, item_name, cost, created_at, undone, ...(version === 2 ? { stock_deducted } : {}) }))
  }
}
async function restoreCopy(backup: { classes: { id: string }[] }) {
  const index = backup.classes.findIndex(row => row.id === classId)
  const result = await restoreBackup(garden, owner, backup)
  classId = result.classIds[Math.max(0, index)]
  return result
}

describe('等级徽章账本', () => {
  it('起始没有徽章，一次跨级发多枚且每级只发一次', async () => {
    expect(await badges()).toHaveLength(0)
    await earn()
    expect((await badges()).map(badge => badge.level).sort()).toEqual([2, 3])
    const first = await badges()
    await garden.changePet(owner, studentId, { petId: 'westie' })
    expect(await badges()).toEqual(first)
    expect((await garden.snapshot(other)).badges).toEqual([])
  })
  it('扣分降级不回收已消费徽章，重升不会刷奖，撤回扣分仍不重复', async () => {
    await earn()
    await garden.redeem(owner, { studentId, itemId: (await garden.snapshot(owner, classId)).items.find(item => item.background_id === null)!.id })
    await garden.addRule(owner, { classId, name: { zh: '扣分', en: 'Deduction' }, points: -100, category: 'other' })
    const negative = (await garden.snapshot(owner, classId)).rules.at(-1)!.id
    const deducted = await garden.evaluate(owner, { studentIds: [studentId], ruleId: negative })
    expect((await garden.student(owner, studentId)).pet_exp).toBe(0)
    expect(await badges()).toHaveLength(2)
    await earn()
    expect(await badges()).toHaveLength(2)
    await garden.undo(owner, deducted.batchId)
    expect((await garden.student(owner, studentId)).pet_exp).toBe(200)
    expect(await badges()).toHaveLength(3)
  })
  it('撤回正分按有效历史最高成长收回，不仅看当前等级', async () => {
    const positive = await earn()
    await garden.addRule(owner, { classId, name: { zh: '扣分', en: 'Deduction' }, points: -100, category: 'other' })
    await garden.evaluate(owner, { studentIds: [studentId], ruleId: (await garden.snapshot(owner, classId)).rules.at(-1)!.id })
    expect(await badges()).toHaveLength(2)
    await garden.undo(owner, positive.batchId)
    expect(await badges()).toHaveLength(0)
    expect((await garden.student(owner, studentId)).pet_exp).toBe(0)
  })
  it('毕业新周期可以再次获得等级徽章，保留过去七枚', async () => {
    for (let i = 0; i < 7; i++) await earn()
    expect(await badges()).toHaveLength(7)
    await garden.adopt(owner, studentId, { petId: 'westie' })
    await earn()
    expect(await badges()).toHaveLength(9)
    expect((await badges()).filter(badge => badge.generation === 2).map(badge => badge.level).sort()).toEqual([2, 3])
  })
  it('撤回首次达成记录后，保留徽章的获得时间更新为新的首次有效达成时间', async () => {
    await garden.addRule(owner, { classId, name: { zh: '四十分', en: 'Forty points' }, points: 40, category: 'other' })
    const positive = (await garden.snapshot(owner, classId)).rules.at(-1)!.id
    await garden.addRule(owner, { classId, name: { zh: '扣四十分', en: 'Minus forty' }, points: -40, category: 'other' })
    const negative = (await garden.snapshot(owner, classId)).rules.at(-1)!.id
    const first = await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    const second = await garden.evaluate(owner, { studentIds: [studentId], ruleId: negative })
    const third = await garden.evaluate(owner, { studentIds: [studentId], ruleId: positive })
    for (const [batch, time] of [[first, 1000], [second, 2000], [third, 3000]] as const) await garden.db.prepare('UPDATE evaluations SET created_at = ? WHERE batch_id = ?').run(time, batch.batchId)
    const originalId = (await badges())[0].id
    await garden.db.prepare('UPDATE badges SET earned_at = 1000 WHERE id = ?').run(originalId)
    await garden.undo(owner, first.batchId)
    expect(await badges()).toMatchObject([{ id: originalId, level: 2, earned_at: 3000 }])
  })
  it('历史重放保留首次跨级时间，负分从零截断', () => {
    const growth = replayGrowth([{ points: -10, created_at: 1 }, { points: 100, created_at: 2 }, { points: -100, created_at: 3 }, { points: 40, created_at: 4 }])
    expect(growth.exp).toBe(40)
    expect([...growth.levels]).toEqual([[2, 2], [3, 2]])
  })
})

describe('新旧备份和图片恢复', () => {
  it('v1毕业徽章转换为七级奖励，保留兑换消费且不影响其他教师', async () => {
    for (let i = 0; i < 7; i++) await earn()
    await garden.redeem(owner, { studentId, itemId: (await garden.snapshot(owner, classId)).items.find(item => item.background_id === null)!.id })
    await garden.demo(other, 'en')
    const otherBefore = await exportBackup(garden, other)
    const legacy = await legacyBackup()
    expect(legacy.badges).toHaveLength(1)
    await restoreCopy(legacy)
    const restored = await garden.snapshot(owner, classId)
    expect(restored.badges).toHaveLength(7)
    expect(restored.students[0].spent_badges).toBe(1)
    expect(restored.items.every(item => item.stock === -1 && item.image === null)).toBe(true)
    expect(await exportBackup(garden, other)).toMatchObject({ students: otherBefore.students, badges: otherBefore.badges })
  })
  it('v1先验证旧余额，不能用补发掩盖无效消费', async () => {
    for (let i = 0; i < 7; i++) await earn()
    await garden.redeem(owner, { studentId, itemId: (await garden.snapshot(owner, classId)).items.find(item => item.background_id === null)!.id })
    const legacy = await legacyBackup()
    legacy.students[0].spent_badges = 2
    legacy.redemptions.push({ ...legacy.redemptions[0], id: 'forged-redemption' })
    await expect(restoreBackup(garden, owner, legacy)).rejects.toThrow('invalidBackup')
    expect((await garden.student(owner, studentId)).spent_badges).toBe(1)
  })
  it('含图片的v2恢复保留原字节、徽章、库存及退款语义', async () => {
    await earn()
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#663399' } }).png().toBuffer()
    const { id } = await garden.addItem(owner, { classId, name: { zh: '图片奖励', en: 'Image reward' }, cost: 1, stock: 1, image: `data:image/png;base64,${png.toString('base64')}` })
    await garden.redeem(owner, { studentId, itemId: id })
    const image = await garden.itemImage(owner, id)
    const backup = await legacyBackup(2)
    await restoreCopy(backup)
    const restored = await garden.snapshot(owner, classId)
    const item = restored.items.find(item => item.name.zh === '图片奖励')!
    expect(item.stock).toBe(0)
    expect(item.image).not.toContain('base64')
    expect(await garden.itemImage(owner, item.id)).toEqual(image)
    expect(restored.badges).toHaveLength(2)
    await garden.undoRedemption(owner, restored.redemptions[0].id)
    expect((await garden.snapshot(owner, classId)).items.find(row => row.id === item.id)?.stock).toBe(1)
    expect((await garden.snapshot(owner, classId)).students[0].spent_badges).toBe(0)
  })
  it('大量已移除商品的合法导出仍可原样恢复', async () => {
    await garden.db.transaction(async () => {
      for (let index = 0; index < 2001; index++) await garden.db.prepare('INSERT INTO items (id, owner_id, class_id, name, cost, active) VALUES (?, ?, ?, ?, 1, 0)').run(`removed-${index}`, owner, classId, JSON.stringify({ zh: '已移除', en: 'Removed' }))
    })()
    const backup = await exportBackup(garden, owner)
    expect(backup.items.length).toBeGreaterThan(2000)
    await restoreCopy(backup)
    expect((await exportBackup(garden, owner)).items.filter(row => row.class_id === classId && row.background_id === null)).toHaveLength(2004)
    expect((await exportBackup(garden, owner)).items.filter(row => row.class_id === classId && row.background_id !== null)).toHaveLength(41)
    expect((await garden.snapshot(owner, classId)).items.filter(row => row.background_id === null)).toHaveLength(3)
    expect((await garden.snapshot(owner, classId)).items.filter(row => row.background_id !== null)).toHaveLength(41)
  })
  it('退款库存会溢出的备份不能覆盖原数据', async () => {
    await earn()
    const { id } = await garden.addItem(owner, { classId, name: { zh: '库存奖励', en: 'Stock reward' }, cost: 1, stock: 1 })
    await garden.redeem(owner, { studentId, itemId: id })
    const backup = structuredClone(await exportBackup(garden, owner)) as any
    backup.items.find((item: any) => item.id === id).stock = Number.MAX_SAFE_INTEGER
    await expect(restoreBackup(garden, owner, backup)).rejects.toThrow('invalidBackup')
    expect((await garden.snapshot(owner, classId)).items.find(item => item.id === id)?.stock).toBe(0)
  })
  it('伪造等级、重复徽章和破损图片都不能覆盖原数据', async () => {
    await earn()
    for (const mutate of [
      (backup: any) => { backup.badges[0].level = 8 },
      (backup: any) => { backup.badges.push({ ...backup.badges[0], id: 'duplicate-badge' }) },
      (backup: any) => { backup.items[0].image = 'data:image/webp;base64,YmFk'; backup.items[0].image_key = '0'.repeat(64); backup.items[0].image_bytes = 3 }
    ]) {
      const backup = structuredClone(await exportBackup(garden, owner)) as any
      mutate(backup)
      await expect(restoreBackup(garden, owner, backup)).rejects.toThrow('invalidBackup')
      expect((await garden.student(owner, studentId)).pet_exp).toBe(100)
      expect(await badges()).toHaveLength(2)
    }
  })
})
