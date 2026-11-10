import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createClient } from '@libsql/client'
import { GET } from '../app/api/admin/[...path]/route'
import { PATCH, GET as ordinaryGET } from '../app/api/[...path]/route'
import { database } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { ApplicationDatabase } from '../lib/server/database-adapter'
import { isGlobalAdmin } from '../lib/server/admin-access'
import { exportBackup } from '../lib/server/backup'

let garden: Garden, admin: string, teacher: string, coadmin: string, adminCookie: string, teacherCookie: string, coadminCookie: string
let first: string, second: string
async function read(path: string, cookie = adminCookie) {
  return GET(new NextRequest(`http://localhost/api/admin/${path}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ path: path.split('?')[0].split('/') }) })
}
beforeEach(async () => {
  vi.stubEnv('DATABASE_PATH', ':memory:')
  vi.stubEnv('PET_GARDEN_ADMIN_USER_IDS', '')
  garden = new Garden(database())
  async function user(name: string) {
    const result = await garden.register({ username: name, password: randomUUID() })
    await garden.saveProfile(result.user.id, { displayName: name, subject: 'Math', teachingRole: 'homeroom' })
    return { id: result.user.id, cookie: `pet-garden-session=${result.token}` }
  }
  const a = await user('review-admin'), b = await user('teacher'), c = await user('admin')
  admin = a.id; adminCookie = a.cookie; teacher = b.id; teacherCookie = b.cookie; coadmin = c.id; coadminCookie = c.cookie
  first = (await garden.createClass(teacher, { name: 'Alpha 100%_班' })).id
  second = (await garden.createClass(coadmin, { name: 'Beta 班' })).id
  await garden.db.prepare('INSERT INTO class_members (class_id, user_id, joined_at) VALUES (?, ?, ?)').run(first, coadmin, Date.now())
  await garden.addStudents(teacher, { classId: first, students: [{ name: 'PRIVATE student A' }, { name: 'PRIVATE student B' }] })
  vi.stubEnv('PET_GARDEN_ADMIN_USER_IDS', admin)
})
afterEach(() => {
  database().close()
  delete (globalThis as typeof globalThis & { petGardenDb?: unknown }).petGardenDb
  vi.unstubAllEnvs()
})

describe('global class admin', () => {
  it('defaults off, fails closed on malformed configuration, and never matches a substring', async () => {
    for (const value of ['', 'admin', `${admin},invalid`, `${admin}0`]) {
      vi.stubEnv('PET_GARDEN_ADMIN_USER_IDS', value)
      expect((await read('classes')).status).toBe(403)
    }
    vi.stubEnv('PET_GARDEN_ADMIN_USER_IDS', ` ${admin}, ${teacher} `)
    expect(isGlobalAdmin(admin)).toBe(true)
    expect((await read('classes')).status).toBe(200)
    await expect(garden.adminClasses(randomUUID(), {})).rejects.toMatchObject({ code: 'unauthorized' })
  })
  it('covers two owners across pages with stable ties and literal search', async () => {
    const one = await (await read('classes?page=1&pageSize=1')).json()
    const two = await (await read('classes?page=2&pageSize=1')).json()
    expect(one.total).toBe(2)
    expect(new Set([...one.classes, ...two.classes].map(c => c.id))).toEqual(new Set([first, second]))
    expect(await (await read('classes?page=1&pageSize=1')).json()).toEqual(one)
    for (const search of ['100%_', 'Alpha', '%_', '班']) {
      const result = await (await read(`classes?search=${encodeURIComponent(search)}`)).json()
      expect(result.total).toBe(search === '班' ? 2 : 1)
    }
    expect((await (await read('classes?search=missing')).json()).classes).toEqual([])
    expect((await (await read('classes?page=99')).json()).classes).toEqual([])
  })
  it('returns only whitelisted summaries, with no students, credentials, or class state', async () => {
    const response = await read(`classes/${first}`), result = await response.json()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Vary')).toBe('Cookie')
    expect(result.classroom).toMatchObject({ name: 'Alpha 100%_班', owner_id: teacher, active_students: 2, archived_students: 0, teacher_count: 2 })
    expect(Object.keys(result.classroom).sort()).toEqual(['id', 'name', 'owner_id', 'owner_name', 'owner_subject', 'created_at', 'active_students', 'archived_students', 'teacher_count', 'teachers'].sort())
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(result.archiveSupported).toBe(true)
    expect((await read('classes/missing')).status).toBe(404)
  })
  it('groups all teachers in one row per class ID, preserving distinct same-name classes and pagination', async () => {
    await garden.renameClass(coadmin, second, { name: 'Alpha 100%_班' })
    // The global admin may also already be a member: neither list may duplicate that class.
    await garden.joinClass(admin, await garden.createInvitation(teacher, first))
    const list = await garden.adminClasses(admin, { pageSize: 1 })
    const next = await garden.adminClasses(admin, { pageSize: 1, page: 2 })
    expect(list.total).toBe(2)
    expect(new Set([...list.classes, ...next.classes].map(row => row.id)).size).toBe(2)
    const shared = (await garden.adminClass(admin, first)).classroom
    expect(shared.teachers.map(row => row.user_id)).toEqual(expect.arrayContaining([teacher, coadmin, admin]))
    expect(shared.teachers).toHaveLength(3)
    expect(shared.teachers[0]).toMatchObject({ user_id: teacher, role: 'owner' })
    expect((await garden.snapshot(admin, first)).classes.filter(row => row.id === first)).toHaveLength(1)
  })
  it('supports class operations, undo, teacher management and backup with the real admin as actor', async () => {
    const [student] = await garden.addStudents(admin, { classId: first, students: [{ name: 'Admin student' }] })
    await garden.updateStudent(admin, student, { name: 'Updated student' })
    await garden.adopt(admin, student, { petId: 'panda' })
    await garden.addRule(admin, { classId: first, name: { zh: '管理员规则', en: 'Admin rule' }, points: 3, category: 'other' })
    const settings = await garden.settings(admin, first)
    await garden.saveSettings(admin, { classId: first, version: settings.version, value: settings.value })
    const otherScore = await garden.evaluate(teacher, { studentIds: [student], custom: { points: 100 } })
    const ownScore = await garden.evaluate(admin, { studentIds: [student], custom: { points: 5 } })
    let state = await garden.snapshot(admin, first)
    expect(state.records.find(row => row.batch_id === ownScore.batchId)).toMatchObject({ actor_user_id: admin, can_undo: true })
    expect(state.records.find(row => row.batch_id === otherScore.batchId)?.can_undo).toBe(true)
    const { id: itemId } = await garden.addItem(admin, { classId: first, name: { zh: '奖品', en: 'Prize' }, cost: 1 })
    await garden.updateItem(admin, itemId, { name: { zh: '新奖品', en: 'New prize' }, cost: 1 })
    await garden.redeem(teacher, { studentId: student, itemId })
    state = await garden.snapshot(admin, first)
    expect(state.redemptions[0].can_undo).toBe(true)
    await garden.undoRedemption(admin, state.redemptions[0].id)
    await garden.undo(admin, otherScore.batchId)
    expect((await garden.snapshot(admin, first)).records.find(row => row.batch_id === otherScore.batchId)).toMatchObject({ undone: 1, undone_by_user_id: admin })
    await garden.setStudentArchived(admin, student, true)
    await garden.setStudentArchived(admin, student, false)
    const teachersBefore = await garden.classTeachers(admin, first)
    expect(teachersBefore.teachers).toHaveLength(2)
    const backup = await exportBackup(garden, admin)
    expect(new Set(backup.classes.map(row => row.id))).toEqual(new Set([first, second]))
    expect(backup.settings.filter(row => row.class_id === null)).toHaveLength(1)
    expect((await exportBackup(garden, teacher)).classes.map(row => row.id)).toEqual([first])
    await expect(garden.removeTeacher(admin, first, teacher)).rejects.toMatchObject({ code: 'cannotRemoveOwner' })
    await garden.transferClass(admin, first, { userId: coadmin })
    await garden.removeTeacher(admin, first, teacher)
    expect((await garden.classroom(admin, first)).owner_id).toBe(coadmin)
    await garden.deleteClass(admin, second)
    await expect(garden.classroom(admin, second)).rejects.toMatchObject({ status: 404 })
    expect(await garden.db.prepare('SELECT * FROM class_members WHERE user_id = ?').all(admin)).toEqual([])
    vi.stubEnv('PET_GARDEN_ADMIN_USER_IDS', '')
    for (const action of [() => garden.evaluate(admin, { studentIds: [student], custom: { points: 1 } }), () => garden.deleteClass(admin, first), () => garden.transferClass(admin, first, { userId: teacher }), () => garden.classTeachers(admin, first)]) {
      await expect(action()).rejects.toMatchObject({ status: 404 })
    }
    expect((await exportBackup(garden, admin)).classes).toEqual([])
  })
  it('uses the migrated archived_at column and the student archive operation', async () => {
    const row = await garden.db.prepare('SELECT id FROM students LIMIT 1').get() as { id: string }
    await garden.setStudentArchived(teacher, row.id, true)
    const result = await (await read(`classes/${first}`)).json()
    expect(result).toMatchObject({ archiveSupported: true, classroom: { active_students: 1, archived_students: 1 } })
    expect((await (await read('classes')).json()).classes.find((c: { id: string }) => c.id === first)).toMatchObject(result.classroom)
  })
  it.each(['page=0', 'page=1.5', 'page=NaN', 'page=1000001', 'pageSize=0', 'pageSize=101', 'search=' + 'x'.repeat(81)])('bounds input: %s', async query => {
    expect((await read(`classes?${query}`)).status).toBe(400)
  })
  it('rejects unauthenticated and expired sessions, including direct detail requests', async () => {
    for (const path of ['classes', `classes/${first}`, 'access']) expect((await read(path, '')).status).toBe(401)
    await garden.db.prepare('UPDATE sessions SET expires_at = 0 WHERE user_id = ?').run(admin)
    expect((await read('classes')).status).toBe(401)
    expect((await read(`classes/${first}`)).status).toBe(401)
  })
  it('rejects teachers, class co-admins, and username admin, regardless of forged parameters', async () => {
    for (const cookie of [teacherCookie, coadminCookie]) {
      expect(await (await read('access', cookie)).json()).toEqual({ allowed: false })
      for (const path of ['classes', `classes/${first}`, `classes/${second}`, `classes?admin=true&role=admin&userId=${admin}`]) {
        expect((await read(path, cookie)).status).toBe(403)
      }
    }
  })
  it('revokes access on subsequent requests without cached roles', async () => {
    expect((await read('classes')).status).toBe(200)
    vi.stubEnv('PET_GARDEN_ADMIN_USER_IDS', '')
    expect((await read('classes')).status).toBe(403)
    expect((await read(`classes/${first}`)).status).toBe(403)
  })
  it('restores only existing co-admin permissions after global access is revoked', async () => {
    await garden.joinClass(admin, await garden.createInvitation(teacher, first))
    expect((await garden.classroom(admin, first, true)).role).toBe('global_admin')
    vi.stubEnv('PET_GARDEN_ADMIN_USER_IDS', '')
    expect((await garden.classroom(admin, first)).role).toBe('admin')
    await garden.renameClass(admin, first, { name: 'Co-managed class' })
    await expect(garden.deleteClass(admin, first)).rejects.toMatchObject({ status: 403 })
    expect((await exportBackup(garden, admin)).classes).toEqual([])
    const denied = await ordinaryGET(new NextRequest(`http://localhost/api/state?classId=${second}&role=global_admin`, { headers: { Cookie: teacherCookie } }), { params: Promise.resolve({ path: ['state'] }) })
    expect(denied.status).toBe(404)
  })
  it('lets global admins enter and edit classes without changing membership or ownership', async () => {
    const response = await PATCH(new NextRequest(`http://localhost/api/classes/${first}`, {
      method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Admin renamed' })
    }), { params: Promise.resolve({ path: ['classes', first] }) })
    expect(response.status).toBe(200)
    const snapshot = await ordinaryGET(new NextRequest(`http://localhost/api/state?classId=${first}`, { headers: { Cookie: adminCookie } }), { params: Promise.resolve({ path: ['state'] }) })
    expect(snapshot.status).toBe(200)
    expect((await snapshot.json()).classes.find((c: { id: string }) => c.id === first)).toMatchObject({ role: 'global_admin', owner_id: teacher, name: 'Admin renamed' })
    expect(await garden.db.prepare('SELECT * FROM class_members WHERE user_id = ?').all(admin)).toEqual([])
    expect((await garden.snapshot(teacher, first)).classes.map(c => c.id)).toEqual([first])
    expect(new Set((await garden.snapshot(admin)).classes.map(c => c.id))).toEqual(new Set([first, second]))
    vi.stubEnv('PET_GARDEN_ADMIN_USER_IDS', '')
    await expect(garden.renameClass(admin, first, { name: 'Denied' })).rejects.toMatchObject({ status: 404 })
    await expect(garden.snapshot(admin, first)).rejects.toMatchObject({ status: 404 })
    expect((await garden.snapshot(admin)).classes).toEqual([])
  })
  it('supports the libSQL driver for schema detection and aggregate queries', async () => {
    const remote = new ApplicationDatabase(undefined, createClient({ url: ':memory:' }))
    try {
      // Copy test schema/data only; this is local libSQL, not a remote Turso test.
      const schema = database().prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { sql: string }[]
      await remote.exec(schema.map(row => row.sql).join(';'))
      for (const table of ['users', 'classes', 'class_members', 'students']) {
        const rows = database().prepare(`SELECT * FROM ${table}`).all() as Record<string, string | number | null>[]
        for (const row of rows) await remote.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row))
      }
      const g = new Garden(remote)
      expect((await g.adminClasses(admin, {})).total).toBe(2)
      expect((await g.adminClass(admin, first)).classroom.teachers).toHaveLength(2)
      expect(await g.classroom(admin, first, true)).toMatchObject({ role: 'global_admin', owner_id: teacher })
      await g.renameClass(admin, first, { name: 'LibSQL admin edit' })
      expect((await g.adminClasses(admin, {})).archiveSupported).toBe(true)
      await remote.prepare('UPDATE students SET archived_at = 1 WHERE class_id = ?').run(first)
      expect(await g.adminClass(admin, first)).toMatchObject({ archiveSupported: true, classroom: { active_students: 0, archived_students: 2 } })
    } finally { remote.close() }
  })
})
