import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Garden } from '../lib/server/garden'
import { createDatabase } from '../lib/server/db'
import { exportBackup, restoreBackup } from '../lib/server/backup'
import { defaultGardenSettings, gardenSettingsSchema, type GardenSettings } from '../lib/garden-settings'
import { growthLevel, growthProgress, rebaseExperience } from '../lib/growth'

let garden: Garden, owner: string, classId: string, student: string
beforeEach(async () => {
  garden = new Garden(createDatabase(':memory:'))
  owner = (await garden.register({ username: 'settings-teacher', password: 'test-password-123' })).user.id
  await garden.saveProfile(owner, { displayName: '成长老师', subject: '科学', teachingRole: 'homeroom' })
  classId = (await garden.createClass(owner, { name: '成长配置班' })).id
  student = (await garden.addStudents(owner, { classId, students: [{ name: '学生' }] }))[0]
  await garden.adopt(owner, student, { petId: 'panda' })
})
afterEach(() => { vi.useRealTimers(); garden.db.close() })
async function save(edit: (value: GardenSettings) => void) {
  const current = await garden.settings(owner, classId), value = structuredClone(current.value)
  edit(value)
  await garden.saveSettings(owner, { classId, version: current.version, value })
}
async function score(points: number, students = [student]) {
  await garden.addRule(owner, { classId, name: { zh: '评分', en: 'Score' }, category: 'other', points })
  return await garden.evaluate(owner, { studentIds: students, ruleId: (await garden.snapshot(owner, classId)).rules.at(-1)!.id })
}
const state = async () => (await garden.snapshot(owner, classId))
async function restoreCopy(backup: { classes: { id: string }[] }) {
  const index = backup.classes.findIndex(row => row.id === classId)
  const result = await restoreBackup(garden, owner, backup)
  classId = result.classIds[Math.max(0, index)]
  return result
}

describe('可配置成长与历史回放', () => {
  it('默认配置保留截零语义，不改变旧成长', async () => {
    await score(-2); await score(3)
    expect((await state()).students[0]).toMatchObject({ points: 1, pet_exp: 3, badge_count: 0 })
    expect((await garden.settings(owner, classId)).value).toEqual(defaultGardenSettings())
  })
  it('七段正经验、零奖励、负分线、日期和时区严格校验', () => {
    for (const edit of [
      (v: GardenSettings) => { v.growth.pop() },
      (v: GardenSettings) => { v.growth[0].experience = 0 },
      (v: GardenSettings) => { v.growth[0].badges = -1 },
      (v: GardenSettings) => { v.hunger.minutes = 0 },
      (v: GardenSettings) => { v.hunger.timeZone = 'invalid' },
      (v: GardenSettings) => { v.hunger.holidays = [{ start: '2026-02-30', end: '2026-03-01' }] },
      (v: GardenSettings) => { v.hunger.holidays = [{ start: '2026-05-02', end: '2026-05-01' }] },
      (v: GardenSettings) => { v.eggThreshold = 0 }
    ]) {
      const value = defaultGardenSettings(); edit(value)
      expect(gardenSettingsSchema.safeParse(value).success).toBe(false)
    }
  })
  it('保留等级与比例，多次换算保留余量，不补发奖励', async () => {
    await score(70)
    await save(v => { v.growth = v.growth.map(row => ({ ...row, experience: 15, badges: 15 })) })
    expect((await state()).students[0]).toMatchObject({ pet_exp: 22.5, badge_count: 1 })
    expect(growthProgress(22.5, (await garden.settings(owner, classId)).value.growth)).toMatchObject({ level: 2, percentage: 50 })
    await save(v => { v.growth[1].experience = 17 })
    expect((await state()).students[0].pet_exp).toBe(23.5)
    await score(9)
    expect((await state()).students[0]).toMatchObject({ pet_exp: 32.5, badge_count: 16 })
    expect((await state()).badges.map(row => row.amount).sort((a, b) => a - b)).toEqual([1, 15])
  })
  it('撤回规则切换前的评分，不会被固定经验锚点吞掉', async () => {
    const first = await score(20)
    await save(v => { v.growth[0].experience = 80 })
    await score(20)
    await save(v => { v.growth[0].experience = 40 })
    expect((await state()).students[0].pet_exp).toBe(30)
    await garden.undo(owner, first.batchId)
    expect((await state()).students[0]).toMatchObject({ points: 20, pet_exp: 10 })
  })
  it('首次奖励额度锁定，撤回后按新规则重获也不刷奖', async () => {
    await save(v => { v.growth[0] = { experience: 10, badges: 4 } })
    const first = await score(10)
    await save(v => { v.growth[0].badges = 15 })
    await garden.undo(owner, first.batchId)
    expect((await state()).students[0].badge_count).toBe(0)
    expect(await garden.db.prepare('SELECT active, amount FROM badges').get()).toEqual({ active: 0, amount: 4 })
    await restoreCopy(await exportBackup(garden, owner))
    student = (await state()).students[0].id
    await score(10)
    expect((await state()).students[0].badge_count).toBe(4)
    const backup = await exportBackup(garden, owner)
    await restoreCopy(backup)
    expect((await state()).students[0].badge_count).toBe(4)
  })
  it('0枚奖励仍记录里程碑，修改奖励不追补', async () => {
    await save(v => { v.growth[0] = { experience: 10, badges: 0 } })
    await score(10)
    expect((await state()).badges).toMatchObject([{ level: 2, amount: 0 }])
    await save(v => { v.growth[0].badges = 10 })
    await score(-10); await score(10)
    expect((await state()).students[0].badge_count).toBe(0)
  })
  it('多枚奖励可兑换，撤回不足时整批评分、事件和徽章一起回滚', async () => {
    await save(v => { v.growth[0] = { experience: 10, badges: 3 } })
    const second = (await garden.addStudents(owner, { classId: (await state()).classes[0].id, students: [{ name: '第二位' }] }))[0]
    await garden.adopt(owner, second, { petId: 'westie' })
    const batch = await score(10, [student, second])
    await garden.redeem(owner, { studentId: second, itemId: (await state()).items.find(item => item.background_id === null)!.id })
    const before = await exportBackup(garden, owner)
    await expect(async () => (await garden.undo(owner, batch.batchId))).rejects.toThrow('badgeAlreadySpent')
    expect(await exportBackup(garden, owner)).toMatchObject({ students: before.students, events: before.events, badges: before.badges, evaluations: before.evaluations })
  })
  it('已毕业换门槛仍毕业，可新领养；旧周期不可撤回', async () => {
    await save(v => { v.growth = v.growth.map(row => ({ ...row, experience: 1 })) })
    const batch = await score(8)
    await save(v => { v.growth = v.growth.map(row => ({ ...row, experience: 100 })) })
    expect((await state()).students[0].pet_exp).toBe(701)
    await garden.adopt(owner, student, { petId: 'westie' })
    expect((await state()).students[0]).toMatchObject({ pet_exp: 0, generation: 2, badge_count: 7 })
    await expect(async () => (await garden.undo(owner, batch.batchId))).rejects.toThrow('previousPetCycle')
  })
  it('教师配置隔离、禁止换宠服务端生效，不影响首次领养', async () => {
    const other = (await garden.register({ username: 'another-teacher', password: 'test-password-456' })).user.id
    await garden.saveProfile(other, { displayName: '其他老师', subject: '数学', teachingRole: 'subject' })
    const otherClass = (await garden.createClass(other, { name: '独立配置班' })).id
    await save(v => { v.allowChangePet = false })
    expect((await garden.settings(other, otherClass)).value.allowChangePet).toBe(true)
    await expect(async () => (await garden.changePet(owner, student, { petId: 'westie' }))).rejects.toThrow('petChangeDisabled')
    const id = (await garden.addStudents(owner, { classId: (await state()).classes[0].id, students: [{ name: '首次领养' }] }))[0]
    await expect(garden.adopt(owner, id, { petId: 'panda' })).resolves.toBeUndefined()
  })
  it('旧版本保存冲突不覆盖数据，客户端不能伪造运算语义', async () => {
    const old = await garden.settings(owner, classId)
    await save(v => { v.allowChangePet = false })
    await expect(async () => (await garden.saveSettings(owner, { classId, version: old.version, value: old.value }))).rejects.toThrow('settingsChanged')
    await save(v => { v.signedGrowth = true })
    expect((await garden.settings(owner, classId)).value.signedGrowth).toBe(false)
  })
  it('按卡片积分立即变蛋，不要求旧成长值同时低于积分线', async () => {
    await score(-11)
    await save(v => { v.sickness = true; v.resetToEgg = true })
    expect((await state()).students[0]).toMatchObject({ points: -11, pet_exp: 0, status: { form: 'egg' } })
    await score(-2)
    const before = (await state()).students[0]
    expect(before).toMatchObject({ points: -13, pet_exp: -2, status: { form: 'egg' } })
    await save(v => { v.growth[0].experience = 100 })
    expect((await state()).students[0]).toMatchObject({ points: -13, pet_exp: -2, pet_id: before.pet_id, generation: before.generation, status: { form: 'egg' } })
    await restoreCopy(await exportBackup(garden, owner))
    student = (await state()).students[0].id
    expect((await state()).students[0]).toMatchObject({ points: -13, pet_exp: -2, status: { form: 'egg' } })
    const recovery = await score(4)
    expect((await state()).students[0]).toMatchObject({ points: -9, pet_exp: 2, status: { form: 'sick' } })
    await garden.undo(owner, recovery.batchId)
    expect((await state()).students[0]).toMatchObject({ points: -13, pet_exp: -2, status: { form: 'egg' } })
    await save(v => { v.eggThreshold = -20 })
    expect((await state()).students[0].status?.form).toBe('sick')
  })
  it('Lv.1 按卡片负积分立即生病，不要求成长值也为负', async () => {
    await score(-7)
    expect((await state()).students[0]).toMatchObject({ points: -7, pet_exp: 0, status: { form: 'normal' } })
    await save(v => { v.sickness = true })
    const before = (await state()).students[0]
    expect(before).toMatchObject({ points: -7, pet_exp: 0, status: { form: 'sick' } })
    await score(2)
    expect((await state()).students[0]).toMatchObject({ points: -5, pet_exp: 2, status: { form: 'sick' } })
    const recovery = await score(5)
    expect((await state()).students[0]).toMatchObject({ points: 0, pet_exp: 7, status: { form: 'normal' } })
    await garden.undo(owner, recovery.batchId)
    expect((await state()).students[0]).toMatchObject({ points: -5, pet_exp: 2, status: { form: 'sick' } })
    await save(v => { v.sickness = false })
    expect((await state()).students[0]).toMatchObject({ points: -5, pet_exp: 2, status: { form: 'normal' } })
    await save(v => { v.sickness = true })
    await restoreCopy(await exportBackup(garden, owner))
    expect((await state()).students[0]).toMatchObject({ points: -5, pet_exp: 2, pet_id: before.pet_id, generation: before.generation, status: { form: 'sick' } })
  })
  it('关闭状态不清空负债，重新加分仍先偿还', async () => {
    await save(v => { v.sickness = true })
    await score(-10)
    await save(v => { v.sickness = false })
    expect((await state()).students[0]).toMatchObject({ pet_exp: -10, status: { form: 'normal' } })
    await score(3)
    expect((await state()).students[0].pet_exp).toBe(-7)
  })
  it('饥饿起点为领养或有效加分，扣分不喂养，撤回加分恢复起点', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T08:00:00Z'))
    await save(v => { v.hunger = { ...v.hunger, enabled: true, minutes: 60, excludeWeekends: false, excludeHolidays: false } })
    const id = (await garden.addStudents(owner, { classId: (await state()).classes[0].id, students: [{ name: '计时学生' }] }))[0]
    await garden.adopt(owner, id, { petId: 'panda' })
    vi.advanceTimersByTime(3600000)
    expect((await state()).students.find(row => row.id === id)?.status?.hungry).toBe(true)
    const positive = await score(1, [id])
    expect((await state()).students.find(row => row.id === id)?.status?.hungry).toBe(false)
    await score(-1, [id])
    await garden.undo(owner, positive.batchId)
    expect((await state()).students.find(row => row.id === id)?.status?.hungry).toBe(true)
  })
  it('新版备份完整往返，小数经验、状态、配置和事件引用重映射', async () => {
    await score(70)
    await save(v => { v.growth[1].experience = 17; v.sickness = true; v.hunger.enabled = true })
    const backup = await exportBackup(garden, owner)
    const settings = backup.settings.filter(row => row.class_id === classId).at(-1)!
    await restoreCopy(backup)
    expect((await state()).settings.value).toEqual(gardenSettingsSchema.parse(settings.value))
    expect((await state()).students[0].pet_exp).toBe(48.5)
    expect((await state()).students[0].id).not.toBe(student)
    expect((await state()).badges[0].id).not.toBe((backup.badges[0] as { id: string }).id)
  })
  it('伪造奖励、事件引用、顺序、经验和撤回状态全部拒绝且不覆盖', async () => {
    await save(v => { v.growth[0] = { experience: 10, badges: 4 } }); await score(10)
    const backup = await exportBackup(garden, owner)
    for (const mutate of [
      (v: any) => { v.badges[0].amount = 100 },
      (v: any) => { v.badges[0].active = 0 },
      (v: any) => { v.events[0].settings_id = 'foreign' },
      (v: any) => { v.events[1].seq = v.events[0].seq },
      (v: any) => { v.students[0].pet_exp = 999 },
      (v: any) => { v.evaluations[0].undone = 1 },
      (v: any) => { v.badges[0].source_event = v.events[0].id }
    ]) {
      const copy = structuredClone(backup); mutate(copy)
      await expect(restoreBackup(garden, owner, copy)).rejects.toThrow('invalidBackup')
      expect((await state()).students[0]).toMatchObject({ id: student, pet_exp: 10, badge_count: 4 })
    }
  })
  it('独立v2旧格式可导入默认设置，撤回记录保留截零语义', async () => {
    const text = JSON.stringify({ zh: '旧记录', en: 'Legacy' })
    const backup = {
      version: 2,
      classes: [{ id: 'c', name: '旧班级', created_at: 1 }],
      students: [{ id: 's', class_id: 'c', name: '旧学生', student_no: '', points: 40, pet_id: 'panda', pet_exp: 40, generation: 1, spent_badges: 0, created_at: 1 }],
      rules: [],
      evaluations: [
        { id: 'e0', batch_id: 'b0', student_id: 's', points: -10, reason: text, category: 'other', generation: 1, created_at: 2, undone: 1 },
        { id: 'e1', batch_id: 'b1', student_id: 's', points: 40, reason: text, category: 'other', generation: 1, created_at: 3, undone: 0 }
      ],
      badges: [{ id: 'badge', student_id: 's', generation: 1, pet_id: 'panda', earned_at: 4, level: 2 }],
      items: [], redemptions: []
    }
    await restoreCopy(backup)
    expect((await state()).settings.value).toEqual(defaultGardenSettings())
    expect((await state()).students[0]).toMatchObject({ points: 40, pet_exp: 40, badge_count: 1 })
    const originalBadge = (await state()).badges[0]
    await save(v => { v.allowChangePet = false })
    expect((await state()).badges[0]).toEqual(originalBadge)
    expect((await state()).badges[0].earned_at).toBe(4)
    await restoreCopy(await exportBackup(garden, owner))
    expect((await state()).students[0].pet_exp).toBe(40)
  })
  it('负数仍Lv.1，极接近升级边界换算不会意外跨级', () => {
    const before = defaultGardenSettings().growth, after = before.map(row => ({ ...row, experience: 1 }))
    expect(growthLevel(-100)).toBe(1)
    expect(growthLevel(rebaseExperience(100 - 1e-13, before, after), after)).toBe(2)
  })
})
