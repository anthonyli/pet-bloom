import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { exportBackup, restoreBackup } from '../lib/server/backup'
import { defaultGardenSettings } from '../lib/garden-settings'
import { MAX_BACKUP_BYTES } from '../lib/shop'

let garden: Garden, owner: string, importer: string
const rule = { name: { zh: '测试规则', en: 'Test rule' }, points: 1, category: 'other' }

beforeEach(async () => {
  garden = new Garden(createDatabase(':memory:'))
  const teacher = async (username: string) => {
    const { user } = await garden.register({ username, password: randomUUID() })
    await garden.saveProfile(user.id, { displayName: username, subject: '数学', teachingRole: 'subject' })
    return user.id
  }
  owner = await teacher('limit-owner')
  importer = await teacher('limit-importer')
})
afterEach(() => garden.db.close())

async function fillRules(classId: string | null, count: number) {
  const { total } = await garden.db.prepare('SELECT COUNT(*) AS total FROM rules WHERE owner_id = ? AND class_id IS ?').get(owner, classId) as { total: number }
  for (let i = total; i < count; i++) {
    if (classId !== null) await garden.addRule(owner, { ...rule, classId })
    // Templates have no editing API; seed this legacy/persisted-data boundary directly.
    else await garden.db.prepare('INSERT INTO rules (id, owner_id, class_id, name, points, category, custom) VALUES (?, ?, NULL, ?, 1, ?, 1)').run(randomUUID(), owner, JSON.stringify(rule.name), rule.category)
  }
}

async function fillSettings(classId: string | null, count: number) {
  const { total } = await garden.db.prepare('SELECT COUNT(*) AS total FROM settings_versions WHERE owner_id = ? AND class_id IS ?').get(owner, classId) as { total: number }
  const insert = garden.db.prepare('INSERT INTO settings_versions (id, owner_id, class_id, version, value, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  await garden.db.transaction(async () => {
    for (let version = total; version < count; version++) {
      await insert.run(randomUUID(), owner, classId, version, JSON.stringify(defaultGardenSettings()), Date.now())
    }
  }).immediate()
}

describe('备份导出与恢复的分组记录上限', () => {
  it.each(['class', 'template'] as const)('%s 的 2000 条规则可往返，2001 条拒绝导出和恢复', async scope => {
    const classroom = await garden.createClass(owner, { name: '规则边界' })
    const classId = scope === 'class' ? classroom.id : null
    await fillRules(classId, 2000)
    const backup = await exportBackup(garden, owner)
    expect(backup.rules.filter(row => row.class_id === classId)).toHaveLength(2000)
    expect(Buffer.byteLength(JSON.stringify(backup, null, 2))).toBeLessThan(4 * 1024 * 1024)
    const restored = await restoreBackup(garden, importer, backup)
    expect(restored.imported).toBe(1)
    if (classId !== null) expect((await garden.snapshot(importer, restored.classIds[0])).rules).toHaveLength(2000)

    const overLimit = structuredClone(backup)
    overLimit.rules.push({ ...backup.rules.find(row => row.class_id === classId)!, id: randomUUID() })
    await expect(restoreBackup(garden, importer, overLimit)).rejects.toMatchObject({ code: 'invalidBackup' })
    await fillRules(classId, 2001)
    await expect(exportBackup(garden, owner)).rejects.toMatchObject({ code: 'backupTooLarge', status: 413 })
    const { total } = await garden.db.prepare('SELECT COUNT(*) AS total FROM rules WHERE owner_id = ? AND class_id IS ?').get(owner, classId) as { total: number }
    expect(total).toBe(2001)
  })

  it('两班和个人模板分别计数，别人的超限班级不影响本人导出', async () => {
    const first = await garden.createClass(owner, { name: '甲班' })
    const second = await garden.createClass(owner, { name: '乙班' })
    await fillRules(null, 2000)
    await fillRules(first.id, 1200)
    await fillRules(second.id, 1200)
    const backup = await exportBackup(garden, owner)
    expect(backup.rules).toHaveLength(4400)
    const result = await restoreBackup(garden, importer, backup)
    expect(result.imported).toBe(2)
    for (const classId of result.classIds) expect((await garden.snapshot(importer, classId)).rules).toHaveLength(1200)

    await fillRules(second.id, 2001)
    await expect(exportBackup(garden, owner)).rejects.toMatchObject({ code: 'backupTooLarge', status: 413 })
    const unrelated = await exportBackup(garden, importer)
    expect(unrelated.classes.map(row => row.id)).toEqual(result.classIds)
  })

  it.each(['class', 'template'] as const)('%s 的 10000 个设置版本可往返，10001 个拒绝导出和恢复', async scope => {
    const classroom = await garden.createClass(owner, { name: '设置边界' })
    const classId = scope === 'class' ? classroom.id : null
    await fillSettings(classId, 10000)
    const backup = await exportBackup(garden, owner)
    expect(backup.settings.filter(row => row.class_id === classId)).toHaveLength(10000)
    expect(backup.settings.length).toBeGreaterThan(10000)
    // This boundary fits the desktop/self-hosted budget; cloud's 4 MB cap applies earlier.
    expect(Buffer.byteLength(JSON.stringify(backup, null, 2))).toBeLessThan(MAX_BACKUP_BYTES)
    const result = await restoreBackup(garden, importer, backup)
    expect(result.imported).toBe(1)
    if (classId !== null) expect((await garden.settings(importer, result.classIds[0])).version).toBe(9999)

    const overLimit = structuredClone(backup)
    overLimit.settings.push({ ...backup.settings.find(row => row.class_id === classId)!, id: randomUUID(), version: 10000 })
    await expect(restoreBackup(garden, importer, overLimit)).rejects.toMatchObject({ code: 'invalidBackup' })
    await fillSettings(classId, 10001)
    await expect(exportBackup(garden, owner)).rejects.toMatchObject({ code: 'backupTooLarge', status: 413 })
  }, 30000)
})
