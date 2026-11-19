import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NextRequest } from 'next/server'
import { createDatabase } from '../lib/server/db'
import { database } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { exportBackup, restoreBackup } from '../lib/server/backup'
import { DomainError } from '../lib/server/errors'
import { errorMessage } from '../lib/i18n'
import { defaultGroupName, MAX_GROUPS_PER_CLASS } from '../lib/class-groups'
import { DELETE, GET, PATCH, POST } from '../app/api/[...path]/route'

let garden: Garden, owner: string, admin: string, outsider: string, classId: string, studentId: string, otherStudentId: string
const profile = { displayName: '甲老师', subject: '语文', teachingRole: 'homeroom' as const }

async function expectError(run: () => unknown, code: string, status: number) {
  let error: unknown
  try { await run() } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(DomainError)
  expect(error).toMatchObject({ code, status })
}
const state = (actor = owner, id = classId) => garden.snapshot(actor, id)
const memberships = async () => garden.db.prepare('SELECT group_id, student_id FROM class_group_members ORDER BY student_id').all()

describe('班级小组', () => {
  beforeEach(async () => {
    garden = new Garden(createDatabase(':memory:'))
    owner = (await garden.register({ username: 'group-owner', password: 'Owner-test-password' })).user.id
    admin = (await garden.register({ username: 'group-admin', password: 'Admin-test-password' })).user.id
    outsider = (await garden.register({ username: 'group-outsider', password: 'Outsider-test-password' })).user.id
    await garden.saveProfile(owner, profile)
    await garden.saveProfile(admin, { displayName: '乙老师', subject: '数学', teachingRole: 'subject' })
    await garden.saveProfile(outsider, { displayName: '丙老师', subject: '英语', teachingRole: 'other' })
    classId = (await garden.createClass(owner, { name: '一年级一班' })).id
    ;[studentId, otherStudentId] = await garden.addStudents(owner, { classId, students: [{ name: '林小橙', studentNo: '01' }, { name: '陈子禾', studentNo: '02' }] })
    const invitation = await garden.createInvitation(owner, classId)
    await garden.joinClass(admin, { code: invitation.code })
  })
  afterEach(() => garden.db.close())

  it('默认名称可直接创建，跳过已占用序号，改名后刷新仍保留', async () => {
    expect(defaultGroupName('zh', 1)).toBe('第 1 组')
    expect(defaultGroupName('en', 12)).toBe('Group 12')
    expect((await state()).groups).toEqual([])
    expect((await state()).students.every(student => student.group_id === null)).toBe(true)
    const first = await garden.createGroup(owner, classId, {})
    const second = await garden.createGroup(admin, classId, { locale: 'en' })
    expect(first.name).toBe('第 1 组')
    expect(second.name).toBe('Group 1')
    await garden.renameGroup(owner, first.id, { name: '  红队  ' })
    const renamed = await state()
    expect(renamed.groups.map(group => group.name).sort()).toEqual(['Group 1', '红队'])
    expect((await garden.createGroup(owner, classId, { locale: 'zh' })).name).toBe('第 1 组')
    await garden.renameGroup(owner, first.id, { name: '红队' })
    expect((await state()).groups.find(group => group.id === first.id)?.name).toBe('红队')
    const reopened = await state()
    expect(reopened.groups.find(group => group.id === first.id)?.name).toBe('红队')
    expect(reopened.students).toHaveLength(2)
  })

  it('拒绝空名称、超长名称和班内重名，原名称保持不变', async () => {
    const group = await garden.createGroup(owner, classId, { locale: 'zh' })
    const other = await garden.createGroup(owner, classId, { locale: 'zh' })
    for (const name of ['', '   ', '组'.repeat(81)]) {
      await expect(garden.renameGroup(owner, group.id, { name })).rejects.toThrow()
      expect((await state()).groups.find(row => row.id === group.id)?.name).toBe('第 1 组')
    }
    await expectError(async () => garden.renameGroup(owner, other.id, { name: '第 1 组' }), 'groupNameTaken', 409)
    expect((await state()).groups.find(row => row.id === other.id)?.name).toBe('第 2 组')
    expect(errorMessage('groupNameTaken', 'zh')).toContain('同名小组')
    expect(errorMessage('groupNameTaken', 'en')).toContain('already has a group')
    expect(errorMessage('groupLimit', 'zh')).toContain('200')
    expect(errorMessage('groupLimit', 'en')).toContain('200')
  })

  it('在班学生可以加入、移动和移出小组，未分组学生仍在班名单', async () => {
    const red = await garden.createGroup(owner, classId, { locale: 'zh' })
    const blue = await garden.createGroup(admin, classId, { locale: 'en' })
    await garden.setGroupMember(admin, red.id, studentId, true)
    expect((await state()).students.find(student => student.id === studentId)).toMatchObject({ group_id: red.id, name: '林小橙', points: 0 })
    expect((await state()).students.find(student => student.id === otherStudentId)?.group_id).toBeNull()
    await garden.setGroupMember(owner, blue.id, studentId, true)
    expect(await memberships()).toEqual([{ group_id: blue.id, student_id: studentId }])
    await garden.setGroupMember(owner, blue.id, studentId, false)
    expect(await memberships()).toEqual([])
    await garden.setGroupMember(owner, blue.id, studentId, false)
    expect((await state()).students.map(student => student.id).sort()).toEqual([otherStudentId, studentId].sort())
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 3, reason: '小组协作' } })
    await garden.renameClass(owner, classId, { name: '一年级一班 · 已改名' })
    const after = await state()
    expect(after.classes.find(row => row.id === classId)?.name).toBe('一年级一班 · 已改名')
    expect(after.students.find(student => student.id === studentId)).toMatchObject({ points: 3, group_id: null })
    expect(after.groups.map(group => group.name).sort()).toEqual(['Group 1', '第 1 组'])
    expect(after.records).toHaveLength(1)
  })

  it('归档保留成员与历史，归档学生不能加入小组，恢复后仍在原组', async () => {
    const group = await garden.createGroup(owner, classId, { locale: 'zh' })
    await garden.setGroupMember(owner, group.id, studentId, true)
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 5, reason: '归档前' } })
    await garden.setStudentArchived(owner, studentId, true, { reason: 'transfer', note: '随家人搬迁' })
    const archived = await state()
    expect(archived.students.map(student => student.id)).toEqual([otherStudentId])
    expect(archived.archived_students[0]).toMatchObject({ id: studentId, group_id: group.id, archive_reason: 'transfer', points: 5 })
    await expectError(async () => garden.setGroupMember(owner, group.id, studentId, true), 'studentArchived', 409)
    expect(await memberships()).toEqual([{ group_id: group.id, student_id: studentId }])
    await garden.setStudentArchived(owner, studentId, false)
    expect((await state()).students.find(student => student.id === studentId)).toMatchObject({ group_id: group.id, points: 5, archived_at: null })
  })

  it('其他教师、其他班级和学生删除都不会串改小组', async () => {
    const group = await garden.createGroup(owner, classId, { locale: 'zh' })
    await garden.setGroupMember(owner, group.id, studentId, true)
    const otherClass = (await garden.createClass(owner, { name: '二年级' })).id
    const foreignStudent = (await garden.addStudents(owner, { classId: otherClass, students: [{ name: '外班学生' }] }))[0]
    await expectError(async () => garden.createGroup(outsider, classId, {}), 'notFound', 404)
    await expectError(async () => garden.renameGroup(outsider, group.id, { name: '越权' }), 'notFound', 404)
    await expectError(async () => garden.setGroupMember(outsider, group.id, studentId, false), 'notFound', 404)
    await expectError(async () => garden.setGroupMember(owner, group.id, foreignStudent, true), 'notFound', 404)
    expect((await state(owner, otherClass)).groups).toEqual([])
    expect(await memberships()).toEqual([{ group_id: group.id, student_id: studentId }])
    await garden.deleteStudent(owner, studentId)
    expect(await memberships()).toEqual([])
    expect((await state()).groups.map(row => row.id)).toEqual([group.id])
    expect((await state()).students.map(row => row.id)).toEqual([otherStudentId])
    await garden.deleteClass(owner, classId)
    expect(await garden.db.prepare('SELECT COUNT(*) AS n FROM class_groups').get()).toEqual({ n: 0 })
    expect(await garden.db.prepare('SELECT COUNT(*) AS n FROM class_group_members').get()).toEqual({ n: 0 })
    expect(await garden.db.prepare('SELECT COUNT(*) AS n FROM students WHERE class_id = ?').get(classId)).toEqual({ n: 0 })
    expect((await state(owner, otherClass)).students[0].name).toBe('外班学生')
  })

  it('达到上限后拒绝新建，已有小组不受影响', async () => {
    const first = await garden.createGroup(owner, classId, { locale: 'zh' })
    const insert = garden.db.prepare('INSERT INTO class_groups (id, class_id, name, created_at) VALUES (?, ?, ?, ?)')
    for (let index = 2; index <= MAX_GROUPS_PER_CLASS; index++) await insert.run(`group-${index}`, classId, `补齐 ${index}`, index)
    await expectError(async () => garden.createGroup(owner, classId, { locale: 'en' }), 'groupLimit', 409)
    const limited = await state()
    expect(limited.groups).toHaveLength(MAX_GROUPS_PER_CLASS)
    expect(limited.groups.find(row => row.id === first.id)).toMatchObject({ name: '第 1 组' })
  })

  it('备份往返保留小组与成员，旧版备份仍可恢复且不会写入小组', async () => {
    const group = await garden.createGroup(owner, classId, { locale: 'zh' })
    await garden.renameGroup(owner, group.id, { name: '红队' })
    await garden.setGroupMember(owner, group.id, studentId, true)
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 8, reason: '备份前' } })
    const backup = await exportBackup(garden, owner)
    expect(backup.version).toBe(10)
    expect(backup.groups).toMatchObject([{ id: group.id, class_id: classId, name: '红队' }])
    expect(backup.group_students).toEqual([{ group_id: group.id, student_id: studentId }])
    const restored = await restoreBackup(garden, owner, structuredClone(backup))
    const index = backup.classes.findIndex(row => row.id === classId)
    const copy = await state(owner, restored.classIds[index])
    const copiedGroup = copy.groups.find(row => row.name === '红队')
    expect(copiedGroup?.id).not.toBe(group.id)
    expect(copy.students.find(student => student.name === '林小橙')).toMatchObject({ group_id: copiedGroup?.id, points: 8 })
    expect(copy.students.find(student => student.name === '陈子禾')?.group_id).toBeNull()
    expect(copy.records[0].reason).toEqual({ zh: '备份前', en: '备份前' })

    const { groups, group_students, ...withoutGroups } = backup
    const legacy = await restoreBackup(garden, owner, { ...withoutGroups, version: 9 as const })
    const legacyCopy = await state(owner, legacy.classIds[index])
    expect(legacyCopy.groups).toEqual([])
    expect(legacyCopy.students.every(student => student.group_id === null)).toBe(true)
    expect(legacyCopy.students.find(student => student.name === '林小橙')?.points).toBe(8)
    await expect(restoreBackup(garden, owner, { ...backup, version: 9 })).rejects.toThrow('invalidBackup')

    const crossed = structuredClone(backup)
    const otherClass = (await garden.createClass(owner, { name: '备份二班' })).id
    const foreign = (await garden.addStudents(owner, { classId: otherClass, students: [{ name: '备份外班' }] }))[0]
    const fresh = await exportBackup(garden, owner)
    fresh.group_students[0].student_id = fresh.students.find(student => student.id === foreign)!.id
    await expect(restoreBackup(garden, owner, fresh)).rejects.toMatchObject({ code: 'invalidBackup' })
    expect((await state()).groups.find(row => row.id === group.id)?.name).toBe('红队')
    const duplicate = structuredClone(backup)
    duplicate.groups.push({ ...duplicate.groups[0], id: 'duplicate-group' })
    await expect(restoreBackup(garden, owner, duplicate)).rejects.toThrow('invalidBackup')
    expect(await garden.db.prepare('SELECT student_id FROM class_group_members WHERE group_id = ?').all(group.id)).toEqual([{ student_id: studentId }])
    expect(crossed.groups).toHaveLength(1)
    expect(groups[0].name).toBe('红队')
    expect(group_students).toHaveLength(1)
    expect(await garden.db.pragma('foreign_key_check')).toEqual([])
  })
})

it('v10 本地库升级保留原有班级和学生，并补上空白小组表', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'class-groups-migration-'))
  const filename = join(directory, 'test.db')
  const initial = new Garden(createDatabase(filename))
  let initialOpen = true
  try {
    const teacher = (await initial.register({ username: 'migration-teacher', password: 'Migration-test-password' })).user.id
    await initial.saveProfile(teacher, profile)
    const classroom = (await initial.createClass(teacher, { name: '迁移班' })).id
    const student = (await initial.addStudents(teacher, { classId: classroom, students: [{ name: '迁移学生', studentNo: '07' }] }))[0]
    await initial.evaluate(teacher, { studentIds: [student], custom: { points: 4, reason: '迁移前' } })
    const beforeStudent = await initial.db.prepare('SELECT * FROM students').get()
    const beforeClass = await initial.db.prepare('SELECT * FROM classes').get()
    const beforeHistory = await initial.db.prepare('SELECT * FROM evaluations').all()
    await initial.db.exec('DROP TABLE class_group_members; DROP TABLE class_groups; PRAGMA user_version = 10')
    initial.db.close()
    initialOpen = false
    const upgraded = createDatabase(filename)
    try {
      expect(upgraded.pragma('user_version', { simple: true })).toBe(11)
      expect(upgraded.prepare('SELECT * FROM students').get()).toEqual(beforeStudent)
      expect(upgraded.prepare('SELECT * FROM classes').get()).toEqual(beforeClass)
      expect(upgraded.prepare('SELECT * FROM evaluations').all()).toEqual(beforeHistory)
      expect(upgraded.prepare('SELECT COUNT(*) AS n FROM class_groups').get()).toEqual({ n: 0 })
      expect(upgraded.prepare('SELECT COUNT(*) AS n FROM class_group_members').get()).toEqual({ n: 0 })
      upgraded.close()
      const reopened = createDatabase(filename)
      try {
        expect(reopened.pragma('user_version', { simple: true })).toBe(11)
        expect(reopened.prepare('SELECT name, points FROM students').get()).toEqual({ name: '迁移学生', points: 4 })
      } finally { reopened.close() }
    } finally { if (upgraded.open) upgraded.close() }
  } finally { if (initialOpen) initial.db.close(); rmSync(directory, { recursive: true, force: true }) }
})

describe('小组 HTTP 接口', () => {
  const handlers = { GET, POST, PATCH, DELETE }
  let cookie = '', otherCookie = '', httpClass = ''
  async function request(path: string, method: keyof typeof handlers = 'GET', data?: unknown, session = cookie) {
    const response = await handlers[method](new NextRequest(`http://localhost:3100/api/${path}`, {
      method,
      headers: { ...(session ? { Cookie: session } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), Origin: 'http://localhost:3100' },
      body: data === undefined ? undefined : JSON.stringify(data)
    }), { params: Promise.resolve({ path: path.split('?')[0].split('/') }) })
    return response
  }
  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 1, 4))
    process.env.DATABASE_PATH = ':memory:'
    const registered = await request('auth/register', 'POST', { username: `group-http-${Math.random().toString(36).slice(2)}`, password: 'Good-password-123' }, '')
    cookie = registered.headers.get('set-cookie')!.split(';')[0]
    const other = await request('auth/register', 'POST', { username: `group-http-b-${Math.random().toString(36).slice(2)}`, password: 'Good-password-456' }, '')
    otherCookie = other.headers.get('set-cookie')!.split(';')[0]
    expect((await request('auth/profile', 'PATCH', { displayName: 'API甲老师', subject: '语文', teachingRole: 'homeroom' })).status).toBe(200)
    expect((await request('auth/profile', 'PATCH', { displayName: 'API乙老师', subject: '数学', teachingRole: 'subject' }, otherCookie)).status).toBe(200)
    httpClass = (await (await request('classes', 'POST', { name: 'HTTP 小组班' })).json()).id
    expect((await request('students', 'POST', { classId: httpClass, students: [{ name: 'HTTP学生', studentNo: '01' }] })).status).toBe(200)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    database().close()
    delete (globalThis as typeof globalThis & { petGardenDb?: unknown }).petGardenDb
    delete process.env.DATABASE_PATH
  })

  it('创建、改名、加入和移出都会在刷新后保持，其他教师被拒绝', async () => {
    const created = await request(`classes/${httpClass}/groups`, 'POST', {})
    expect(created.status).toBe(200)
    const first = await created.json() as { id: string; name: string }
    expect(first.name).toBe('第 1 组')
    const english = await request(`classes/${httpClass}/groups`, 'POST', { locale: 'en' })
    expect((await english.json()).name).toBe('Group 1')
    const renamed = await request(`groups/${first.id}`, 'PATCH', { name: '  蓝队  ' })
    expect(renamed.status).toBe(200)
    const snapshot = await (await request(`state?classId=${httpClass}`)).json()
    const student = snapshot.students[0].id as string
    expect(snapshot.groups.find((group: { id: string }) => group.id === first.id).name).toBe('蓝队')
    expect((await request(`groups/${first.id}/members/${student}`, 'POST')).status).toBe(200)
    const joined = await (await request(`state?classId=${httpClass}`)).json()
    expect(joined.students[0].group_id).toBe(first.id)
    expect((await request(`groups/${first.id}/members/${student}`, 'DELETE')).status).toBe(200)
    const removed = await (await request(`state?classId=${httpClass}`)).json()
    expect(removed.students[0].group_id).toBeNull()
    expect(removed.groups.find((group: { id: string }) => group.id === first.id).name).toBe('蓝队')
    expect((await request(`classes/${httpClass}/groups`, 'POST', { locale: 'zh' }, otherCookie)).status).toBe(404)
    expect((await request(`groups/${first.id}`, 'PATCH', { name: '越权' }, otherCookie)).status).toBe(404)
    expect((await request(`groups/${first.id}`, 'PATCH', { name: '   ' })).status).toBe(400)
    expect(await (await request(`groups/${first.id}`, 'PATCH', { name: 'Group 1' })).json()).toEqual({ error: 'groupNameTaken' })
    const unchanged = await (await request(`state?classId=${httpClass}`)).json()
    expect(unchanged.groups.map((group: { name: string }) => group.name)).toEqual(['蓝队', 'Group 1'])
    expect(unchanged.students[0]).toMatchObject({ name: 'HTTP学生', student_no: '01', group_id: null })
  })
})
