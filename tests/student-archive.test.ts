import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createClient } from '@libsql/client'
import { createDatabase } from '../lib/server/db'
import { ApplicationDatabase } from '../lib/server/database-adapter'
import { Garden } from '../lib/server/garden'
import { exportBackup, restoreBackup } from '../lib/server/backup'

for (const driver of ['sqlite', 'libsql'] as const) describe(`student archive (${driver})`, () => {
  let garden: Garden, owner: string, colleague: string, outsider: string, classId: string, studentId: string, activeId: string, directory: string
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'student-archive-'))
    const filename = join(directory, 'test.db'), raw = createDatabase(filename)
    if (driver === 'libsql') { raw.close(); garden = new Garden(new ApplicationDatabase(undefined, createClient({ url: `file:${filename}` }))) }
    else garden = new Garden(raw)
    async function register(name: string) {
      const { user } = await garden.register({ username: name, password: randomUUID() })
      await garden.saveProfile(user.id, { displayName: name, subject: '科学', teachingRole: 'subject' })
      return user.id
    }
    owner = await register('archive-owner'); colleague = await register('archive-colleague'); outsider = await register('archive-outsider')
    classId = (await garden.createClass(owner, { name: '归档测试班' })).id
    await garden.joinClass(colleague, await garden.createInvitation(owner, classId))
    ;[studentId, activeId] = await garden.addStudents(owner, { classId, students: [{ name: '转学学生', studentNo: '001' }, { name: '在班学生', studentNo: '002' }] })
    await garden.adopt(owner, studentId, { petId: 'panda' })
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 100, reason: '归档前成长' } })
    const item = (await garden.snapshot(owner, classId)).items.find(row => row.background_id === 'garden')!
    await garden.redeem(owner, { studentId, itemId: item.id })
    await garden.setBackground(owner, studentId, { backgroundId: 'garden' })
  })
  afterEach(async () => {
    garden.db.close()
    // Release native libSQL statement finalizers before Windows unlinks the database.
    if (process.platform === 'win32') global.gc?.()
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })
  const rows = async () => Object.fromEntries(await Promise.all(['students', 'evaluations', 'growth_events', 'badges', 'redemptions'].map(async table => [table, await garden.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))

  it('archives → excludes from roster → preserves profile and history → restores the same identity, idempotently', async () => {
    const before = await rows(), profile = (await garden.snapshot(owner, classId)).students.find(row => row.id === studentId)!
    const attempts = await Promise.allSettled([garden.setStudentArchived(colleague, studentId, true), garden.setStudentArchived(owner, studentId, true)])
    expect(attempts.some(result => result.status === 'fulfilled')).toBe(true)
    for (const result of attempts) if (result.status === 'rejected') expect(result.reason.code).toBe('SQLITE_BUSY')
    const archivedAt = (await garden.student(owner, studentId)).archived_at
    expect(archivedAt).toBeGreaterThan(0)
    await garden.setStudentArchived(owner, studentId, true)
    expect((await garden.student(owner, studentId)).archived_at).toBe(archivedAt)
    const snapshot = await garden.snapshot(colleague, classId)
    expect(snapshot.students.map(row => row.id)).toEqual([activeId])
    expect(snapshot.archived_students[0]).toEqual({ ...profile, archived_at: archivedAt })
    expect(snapshot.records).toHaveLength(1); expect(snapshot.redemptions).toHaveLength(1)
    const history = await garden.studentHistory(colleague, studentId)
    expect(history.entries.map(row => row.kind).sort()).toEqual(['evaluation', 'redemption'])
    expect(history.nextOffset).toBeNull()
    const after = await rows()
    for (const table of ['evaluations', 'growth_events', 'badges', 'redemptions']) expect(after[table]).toEqual(before[table])
    await garden.setStudentArchived(owner, studentId, false)
    await garden.setStudentArchived(colleague, studentId, false)
    expect(await rows()).toEqual(before)
    expect((await garden.snapshot(owner, classId)).archived_students).toEqual([])
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 1 } })
    expect((await garden.student(owner, studentId)).points).toBe(101)
  })
  it('persists reason and note, preserves them on retry, and clears them when restored', async () => {
    await garden.setStudentArchived(colleague, studentId, true, { reason: 'transfer', note: '  随家人搬迁\n转入另一学校  ' })
    const first = await garden.student(owner, studentId)
    expect(first).toMatchObject({ archive_reason: 'transfer', archive_note: '随家人搬迁\n转入另一学校' })
    await garden.setStudentArchived(owner, studentId, true, { reason: 'other', note: '重试不应覆盖' })
    expect(await garden.student(owner, studentId)).toEqual(first)
    await garden.setStudentArchived(owner, studentId, false)
    expect(await garden.student(owner, studentId)).toMatchObject({ archived_at: null, archive_reason: null, archive_note: null })
    await garden.setStudentArchived(owner, studentId, true, { reason: 'graduation', note: '  ' })
    expect(await garden.student(owner, studentId)).toMatchObject({ archive_reason: 'graduation', archive_note: null })
  })
  it('rejects invalid reasons and oversized notes without archiving or partially writing', async () => {
    const before = await rows()
    for (const input of [{ reason: 'unknown' }, { note: '字'.repeat(501) }, { note: 42 }]) {
      await expect(garden.setStudentArchived(owner, studentId, true, input)).rejects.toThrow()
      expect(await rows()).toEqual(before)
    }
    await garden.setStudentArchived(owner, studentId, true, { reason: 'leave', note: '字'.repeat(500) })
    const backup = await exportBackup(garden, owner)
    for (const invalid of [{ archive_reason: 'invalid' }, { archive_note: '字'.repeat(501) }]) {
      await expect(restoreBackup(garden, outsider, { ...backup, students: backup.students.map(row => ({ ...row, ...invalid })) })).rejects.toThrow('invalidBackup')
    }
  })
  it('rejects stale daily actions and rolls back a mixed batch, without affecting another class', async () => {
    const otherClass = (await garden.createClass(owner, { name: '另一个班' })).id
    const otherStudent = (await garden.addStudents(owner, { classId: otherClass, students: [{ name: '另一班学生' }] }))[0]
    await garden.setStudentArchived(owner, studentId, true)
    const before = await rows(), snapshot = await garden.snapshot(owner, classId)
    const actions = [
      () => garden.evaluate(owner, { studentIds: [activeId, studentId], custom: { points: 3 } }),
      () => garden.evaluate(owner, { studentIds: [studentId], ruleId: snapshot.rules[0].id }),
      () => garden.redeem(owner, { studentId, itemId: snapshot.items[0].id }),
      () => garden.adopt(owner, studentId, { petId: 'panda' }),
      () => garden.changePet(owner, studentId, { petId: 'panda' }),
      () => garden.setBackground(owner, studentId, { backgroundId: null }),
      () => garden.updateStudent(owner, studentId, { name: 'changed' })
    ]
    for (const action of actions) await expect(action()).rejects.toMatchObject({ code: 'studentArchived', status: 409 })
    expect(await rows()).toEqual(before)
    await garden.evaluate(owner, { studentIds: [otherStudent], custom: { points: 2 } })
    expect((await garden.snapshot(owner, otherClass)).students[0].points).toBe(2)
  })
  it('checks membership for archive, restore, list and history, including revoked co-admin access and deleted classes', async () => {
    for (const actor of [outsider, colleague]) {
      if (actor === colleague) await garden.removeTeacher(owner, classId, colleague)
      await expect(garden.setStudentArchived(actor, studentId, true)).rejects.toMatchObject({ status: 404 })
      await expect(garden.setStudentArchived(actor, studentId, false)).rejects.toMatchObject({ status: 404 })
      await expect(garden.studentHistory(actor, studentId)).rejects.toMatchObject({ status: 404 })
      await expect(garden.snapshot(actor, classId)).rejects.toMatchObject({ status: 404 })
    }
    await garden.deleteClass(owner, classId)
    await expect(garden.setStudentArchived(owner, studentId, false)).rejects.toMatchObject({ status: 404 })
    expect((await garden.snapshot(owner)).classes).toEqual([])
  })
  it('paginates older individual history beyond the class latest-200 window', async () => {
    for (let i = 0; i < 205; i++) await garden.evaluate(owner, { studentIds: [activeId], custom: { points: 1, reason: `record-${i}` } })
    await garden.setStudentArchived(owner, activeId, true)
    const ids: string[] = []; let offset: number | null = 0
    while (offset !== null) {
      const page = await garden.studentHistory(owner, activeId, offset)
      expect(page.entries.length).toBeLessThanOrEqual(50)
      ids.push(...page.entries.map(row => row.id)); offset = page.nextOffset
    }
    expect(new Set(ids).size).toBe(205)
    expect((await garden.studentHistory(owner, studentId)).entries).toHaveLength(2)
    await expect(garden.studentHistory(owner, activeId, -1)).rejects.toThrow()
  })
  it('round-trips archive details and histories in v9; accepts genuine v7 and v8 as active and rejects corrupt timestamps atomically', async () => {
    await garden.setStudentArchived(owner, studentId, true)
    await garden.setStudentArchived(owner, studentId, false)
    await garden.setStudentArchived(owner, studentId, true, { reason: 'transfer', note: '随家人搬迁' })
    const backup = await exportBackup(garden, owner)
    expect(backup.version).toBe(9)
    const { classIds } = await restoreBackup(garden, outsider, backup)
    const copy = await garden.snapshot(outsider, classIds[0])
    expect(copy.students).toHaveLength(1); expect(copy.archived_students).toHaveLength(1)
    expect(copy.archived_students[0]).toMatchObject({ archived_at: backup.students.find(row => row.id === studentId)!.archived_at, points: 100, background_id: 'garden', spent_badges: 1, archive_reason: 'transfer', archive_note: '随家人搬迁' })
    expect(copy.archived_students[0].id).not.toBe(studentId)
    expect((await garden.studentHistory(outsider, copy.archived_students[0].id)).entries).toHaveLength(2)
    await garden.setStudentArchived(outsider, copy.archived_students[0].id, false)
    expect((await garden.snapshot(outsider, classIds[0])).students).toHaveLength(2)
    const legacy = { ...backup, version: 7, students: backup.students.map(({ archived_at, archive_reason, archive_note, ...row }) => row) }
    const old = await restoreBackup(garden, outsider, legacy)
    expect((await garden.snapshot(outsider, old.classIds[0])).archived_students).toEqual([])
    const v8 = { ...backup, version: 8, students: backup.students.map(({ archive_reason, archive_note, ...row }) => row) }
    const oldArchive = await restoreBackup(garden, outsider, v8)
    expect((await garden.snapshot(outsider, oldArchive.classIds[0])).archived_students[0]).toMatchObject({ archive_reason: null, archive_note: null, points: 100 })
    for (const archived_at of [-1, 'yesterday', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const before = await rows(), classes = (await garden.snapshot(outsider)).classes
      await expect(restoreBackup(garden, outsider, { ...backup, students: backup.students.map(row => ({ ...row, archived_at })) })).rejects.toThrow('invalidBackup')
      expect(await rows()).toEqual(before); expect((await garden.snapshot(outsider)).classes).toEqual(classes)
    }
  })
})


it('v8 local migration preserves all rows, defaults to active, and persists archives across reopening', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'archive-migration-')), filename = join(directory, 'test.db')
  let db = createDatabase(filename)
  try {
    db.exec(`ALTER TABLE students DROP COLUMN archive_reason; ALTER TABLE students DROP COLUMN archive_note; ALTER TABLE students DROP COLUMN archived_at; PRAGMA user_version = 8;
      INSERT INTO users (id, username, password, created_at) VALUES ('u', 'migration-fixture', 'unused', 1);
      INSERT INTO classes (id, owner_id, name, created_at) VALUES ('c', 'u', 'Class', 2);
      INSERT INTO students (id, class_id, name, points, created_at) VALUES ('s', 'c', 'Student', 12, 3);
      INSERT INTO evaluations (id, batch_id, student_id, points, reason, category, generation, created_at) VALUES ('e', 'b', 's', 12, '{}', 'other', 0, 4);
    `)
    const student = db.prepare('SELECT * FROM students').get(), history = db.prepare('SELECT * FROM evaluations').all()
    db.close(); db = createDatabase(filename)
    expect(db.pragma('user_version', { simple: true })).toBe(10)
    expect(db.prepare('SELECT * FROM students').get()).toEqual({ ...student as object, archived_at: null, archive_reason: null, archive_note: null })
    expect(db.prepare('SELECT * FROM evaluations').all()).toEqual(history)
    db.prepare('UPDATE students SET archived_at = 123 WHERE id = ?').run('s')
    db.close(); db = createDatabase(filename)
    expect(db.prepare('SELECT archived_at FROM students').get()).toEqual({ archived_at: 123 })
    expect(db.prepare('SELECT * FROM evaluations').all()).toEqual(history)
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})


it('v9 migration preserves existing archived students and persists their new details on reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'archive-details-migration-')), filename = join(directory, 'test.db')
  let db = createDatabase(filename)
  try {
    db.exec(`ALTER TABLE students DROP COLUMN archive_reason; ALTER TABLE students DROP COLUMN archive_note; PRAGMA user_version = 9;
      INSERT INTO users (id, username, password, created_at) VALUES ('u', 'migration-fixture', 'unused', 1);
      INSERT INTO classes (id, owner_id, name, created_at) VALUES ('c', 'u', 'Class', 2);
      INSERT INTO students (id, class_id, name, points, created_at, archived_at) VALUES ('s', 'c', 'Student', 12, 3, 123);
    `)
    const before = db.prepare('SELECT * FROM students').get()
    db.close(); db = createDatabase(filename)
    expect(db.pragma('user_version', { simple: true })).toBe(10)
    expect(db.prepare('SELECT * FROM students').get()).toEqual({ ...before as object, archive_reason: null, archive_note: null })
    db.prepare('UPDATE students SET archive_reason = ?, archive_note = ? WHERE id = ?').run('transfer', '搬迁', 's')
    db.close(); db = createDatabase(filename)
    expect(db.prepare('SELECT archived_at, archive_reason, archive_note FROM students').get()).toEqual({ archived_at: 123, archive_reason: 'transfer', archive_note: '搬迁' })
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})
