import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { GET, POST, PATCH } from '../app/api/[...path]/route'
import { activeClasses, selectWorkspaceClass } from '../lib/class-access'
import { createDatabase, database } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { DomainError } from '../lib/server/errors'
import { exportBackup, restoreBackup } from '../lib/server/backup'

describe('selectWorkspaceClass', () => {
  const classes = [
    { id: 'old', graduated_at: 10 },
    { id: 'current', graduated_at: null },
    { id: 'later', graduated_at: null }
  ]
  it('keeps an explicit graduated class and otherwise chooses the first active class', () => {
    expect(selectWorkspaceClass(classes, 'old')).toBe('old')
    expect(selectWorkspaceClass(classes, 'missing')).toBe('current')
    expect(selectWorkspaceClass(classes)).toBe('current')
    expect(selectWorkspaceClass([{ id: 'only', graduated_at: 5 }])).toBe('')
    expect(activeClasses(classes).map(item => item.id)).toEqual(['current', 'later'])
  })
})

describe('班级毕业', () => {
  let garden: Garden, owner: string, colleague: string, outsider: string, older: string, newer: string, studentId: string
  const stamp = Date.UTC(2026, 10, 19, 2)
  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(stamp)
    garden = new Garden(createDatabase(':memory:'))
    const teacher = async (username: string, displayName: string) => {
      const id = (await garden.register({ username, password: 'Graduation-password-1' })).user.id
      await garden.saveProfile(id, { displayName, subject: '语文', teachingRole: 'homeroom' })
      return id
    }
    owner = await teacher('graduation-owner', '毕业甲老师')
    colleague = await teacher('graduation-colleague', '毕业乙老师')
    outsider = await teacher('graduation-outsider', '毕业丙老师')
    older = (await garden.createClass(owner, { name: '已毕业的旧班' })).id
    studentId = (await garden.addStudents(owner, { classId: older, students: [{ name: '旧班学生', studentNo: '01' }] }))[0]
    await garden.adopt(owner, studentId, { petId: 'panda' })
    await garden.evaluate(owner, { studentIds: [studentId], custom: { points: 3, reason: '保留下来的鼓励' } })
    newer = (await garden.createClass(owner, { name: '正在教的新班' })).id
    await garden.addStudents(owner, { classId: newer, students: [{ name: '新班学生' }] })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.PET_GARDEN_ADMIN_USER_IDS
    garden.db.close()
  })
  const rows = async () => Object.fromEntries(await Promise.all(['classes', 'students', 'evaluations', 'badges', 'redemptions'].map(async table => [table, await garden.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))

  it('负责人可毕业且不删除数据，再次提交保留原时间，共同管理员与其他教师被拒绝', async () => {
    const before = await rows()
    const invitation = await garden.createInvitation(owner, older)
    await garden.joinClass(colleague, { code: invitation.code })
    const graduated = await garden.graduateClass(owner, older)
    expect(graduated).toEqual({ id: older, graduated_at: stamp })
    vi.spyOn(Date, 'now').mockReturnValue(stamp + 60_000)
    expect(await garden.graduateClass(owner, older)).toEqual(graduated)
    const after = await rows()
    expect(after.students).toEqual(before.students)
    expect(after.evaluations).toEqual(before.evaluations)
    expect(after.badges).toEqual(before.badges)
    expect(after.redemptions).toEqual(before.redemptions)
    expect(after.classes).toEqual((before.classes as { id: string; graduated_at: number | null }[]).map(row => ({ ...row, graduated_at: row.id === older ? stamp : null })))
    await expect(garden.graduateClass(colleague, older)).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    await expect(garden.graduateClass(outsider, older)).rejects.toMatchObject({ code: 'notFound', status: 404 })
    expect(await rows()).toEqual(after)
    await garden.renameClass(owner, older, { name: '已毕业的旧班 · 改名' })
    expect(await garden.db.prepare('SELECT name, graduated_at FROM classes WHERE id = ?').get(older)).toEqual({ name: '已毕业的旧班 · 改名', graduated_at: stamp })
  })

  it('默认打开在教班级，显式打开毕业班级仍可读历史，其他教师看不到', async () => {
    await garden.graduateClass(owner, older)
    const home = await garden.snapshot(owner)
    expect(home.students.map(student => student.name)).toEqual(['新班学生'])
    expect(new Map(home.classes.map(item => [item.name, item.graduated_at]))).toEqual(new Map([['已毕业的旧班', stamp], ['正在教的新班', null]]))
    expect(activeClasses(home.classes).map(item => item.id)).toEqual([newer])
    const archived = await garden.snapshot(owner, older)
    expect(archived.students.map(student => student.name)).toEqual(['旧班学生'])
    expect(archived.records.map(record => record.reason)).toEqual([{ zh: '保留下来的鼓励', en: '保留下来的鼓励' }])
    const onlyGraduated = await garden.snapshot(colleague)
    expect(onlyGraduated.classes).toEqual([])
    const invitation = await garden.createInvitation(owner, older)
    await garden.joinClass(colleague, { code: invitation.code })
    const member = await garden.snapshot(colleague)
    expect(member.classes.map(item => item.id)).toEqual([older])
    expect(member.students).toEqual([])
    expect((await garden.snapshot(colleague, older)).students.map(student => student.name)).toEqual(['旧班学生'])
    const outsiderClass = (await garden.createClass(outsider, { name: '外人自己的班' })).id
    await garden.addStudents(outsider, { classId: outsiderClass, students: [{ name: '外人学生' }] })
    await expect(garden.snapshot(outsider, older)).rejects.toMatchObject({ code: 'notFound', status: 404 })
    expect((await garden.snapshot(outsider)).students.map(student => student.name)).toEqual(['外人学生'])
  })

  it('全局管理员可毕业任意可见班级，全部班级页仍保留该班', async () => {
    const admin = (await garden.register({ username: 'graduation-admin', password: 'Graduation-password-1' })).user.id
    await garden.saveProfile(admin, { displayName: '毕业管理员', subject: '数学', teachingRole: 'subject' })
    process.env.PET_GARDEN_ADMIN_USER_IDS = admin
    expect((await garden.graduateClass(admin, newer)).graduated_at).toBe(stamp)
    const page = await garden.adminClasses(admin, {})
    expect(page.classes.map(item => item.name).sort()).toEqual(['已毕业的旧班', '正在教的新班'])
    expect((await garden.snapshot(owner)).students.map(student => student.name)).toEqual(['旧班学生'])
    expect((await garden.snapshot(owner, newer)).classes.find(item => item.id === newer)?.graduated_at).toBe(stamp)
  })

  it('备份往返保留毕业时间，旧版备份恢复为在教班级', async () => {
    await garden.graduateClass(owner, older)
    const backup = await exportBackup(garden, owner)
    expect(backup.version).toBe(10)
    expect(backup.classes.find(item => item.id === older)).toMatchObject({ name: '已毕业的旧班', graduated_at: stamp })
    const restored = await restoreBackup(garden, outsider, backup)
    const index = backup.classes.findIndex(item => item.id === older)
    const copyId = restored.classIds[index]
    const copy = await garden.snapshot(outsider, copyId)
    expect(copy.classes.find(item => item.id === copyId)?.graduated_at).toBe(stamp)
    expect(copy.students.map(student => student.name)).toEqual(['旧班学生'])
    expect((await garden.snapshot(owner, older)).students).toHaveLength(1)
    const legacy = { ...backup, version: 9 as const, classes: backup.classes.map(({ graduated_at, ...row }) => row) }
    const legacyResult = await restoreBackup(garden, outsider, legacy)
    const legacyId = legacyResult.classIds[index]
    expect((await garden.snapshot(outsider, legacyId)).classes.find(item => item.id === legacyId)?.graduated_at).toBeNull()
    expect((await garden.snapshot(outsider, legacyId)).students.map(student => student.name)).toEqual(['旧班学生'])
  })

  it('v10 本地库升级后旧班级仍在教，已有学生和评价不变', () => {
    const directory = mkdtempSync(join(tmpdir(), 'class-graduation-'))
    const filename = join(directory, 'garden.db')
    let db = createDatabase(filename)
    try {
      db.exec(`
        INSERT INTO users (id, username, password, created_at) VALUES ('teacher', 'graduation-migration', 'unused', 1);
        INSERT INTO classes (id, owner_id, name, created_at) VALUES ('class', 'teacher', '历史班', 2);
        INSERT INTO students (id, class_id, name, points, created_at) VALUES ('student', 'class', '历史学生', 8, 3);
        INSERT INTO evaluations (id, batch_id, student_id, points, reason, category, generation, created_at) VALUES ('score', 'batch', 'student', 8, '{}', 'other', 0, 4);
        ALTER TABLE classes DROP COLUMN graduated_at;
        PRAGMA user_version = 10;
      `)
      const classroom = db.prepare('SELECT * FROM classes').get()
      const student = db.prepare('SELECT * FROM students').get()
      const history = db.prepare('SELECT * FROM evaluations').all()
      db.close()
      db = createDatabase(filename)
      expect(db.pragma('user_version', { simple: true })).toBe(11)
      expect(db.prepare('SELECT * FROM classes').get()).toEqual({ ...classroom as object, graduated_at: null })
      expect(db.prepare('SELECT * FROM students').get()).toEqual(student)
      expect(db.prepare('SELECT * FROM evaluations').all()).toEqual(history)
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})

describe('毕业班级 HTTP', () => {
  const handlers = { GET, POST, PATCH }
  let cookie: string, otherCookie: string, older: string, newer: string
  async function request(path: string, method: keyof typeof handlers = 'GET', data?: unknown, session = cookie) {
    return handlers[method](new NextRequest(`http://localhost:3100/api/${path}`, {
      method,
      headers: { ...(session ? { Cookie: session } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json', Origin: 'http://localhost:3100' } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data)
    }), { params: Promise.resolve({ path: path.split('?')[0].split('/') }) })
  }
  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 19, 3))
    const cached = globalThis as typeof globalThis & { petGardenDb?: { close: () => void } }
    cached.petGardenDb?.close()
    delete cached.petGardenDb
    process.env.DATABASE_PATH = ':memory:'
    const registered = await request('auth/register', 'POST', { username: `grad-http-${Math.random().toString(36).slice(2)}`, password: 'Good-password-123' }, '')
    cookie = registered.headers.get('set-cookie')!.split(';')[0]
    const other = await request('auth/register', 'POST', { username: `grad-http-b-${Math.random().toString(36).slice(2)}`, password: 'Good-password-456' }, '')
    otherCookie = other.headers.get('set-cookie')!.split(';')[0]
    expect((await request('auth/profile', 'PATCH', { displayName: '接口甲老师', subject: '语文', teachingRole: 'homeroom' })).status).toBe(200)
    expect((await request('auth/profile', 'PATCH', { displayName: '接口乙老师', subject: '数学', teachingRole: 'subject' }, otherCookie)).status).toBe(200)
    older = (await (await request('classes', 'POST', { name: '接口旧班' })).json()).id
    newer = (await (await request('classes', 'POST', { name: '接口新班' })).json()).id
    expect((await request('students', 'POST', { classId: older, students: [{ name: '接口旧学生' }] })).status).toBe(200)
    expect((await request('students', 'POST', { classId: newer, students: [{ name: '接口新学生' }] })).status).toBe(200)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    database().close()
    delete (globalThis as typeof globalThis & { petGardenDb?: unknown }).petGardenDb
    delete process.env.DATABASE_PATH
  })

  it('毕业后默认状态切到在教班级，显式查询仍返回原学生，其他账号返回 404', async () => {
    const graduated = await request(`classes/${older}/graduate`, 'POST', {})
    expect(graduated.status).toBe(200)
    const body = await graduated.json()
    expect(body.graduated_at).toBe(Date.UTC(2026, 10, 19, 3))
    expect((await request(`classes/${older}/graduate`, 'POST', {})).status).toBe(200)
    expect((await (await request(`classes/${older}/graduate`, 'POST', {})).json()).graduated_at).toBe(body.graduated_at)
    const home = await (await request('state')).json()
    expect(home.students.map((student: { name: string }) => student.name)).toEqual(['接口新学生'])
    expect(home.classes.find((item: { id: string }) => item.id === newer).graduated_at).toBeNull()
    expect(home.classes.find((item: { id: string }) => item.id === older).graduated_at).toBe(body.graduated_at)
    const viewed = await (await request(`state?classId=${older}`)).json()
    expect(viewed.students.map((student: { name: string }) => student.name)).toEqual(['接口旧学生'])
    const denied = await request(`classes/${older}/graduate`, 'POST', {}, otherCookie)
    expect(denied.status).toBe(404)
    expect(await denied.json()).toEqual({ error: 'notFound' })
    expect((await (await request(`state?classId=${older}`)).json()).students).toHaveLength(1)
  })
})
