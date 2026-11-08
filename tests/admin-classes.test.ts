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

describe('global read-only admin', () => {
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
    expect(Object.keys(result.classroom).sort()).toEqual(['id', 'name', 'owner_id', 'owner_name', 'owner_subject', 'created_at', 'active_students', 'archived_students', 'teacher_count'].sort())
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(result.archiveSupported).toBe(false)
    expect((await read('classes/missing')).status).toBe(404)
  })
  it('uses ABCD-14 archived_at without its migration being duplicated', async () => {
    await garden.db.exec('ALTER TABLE students ADD COLUMN archived_at INTEGER')
    const row = await garden.db.prepare('SELECT id FROM students LIMIT 1').get() as { id: string }
    await garden.db.prepare('UPDATE students SET archived_at = ? WHERE id = ?').run(Date.now(), row.id)
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
  it('does not give global admins ordinary class read/write access', async () => {
    const response = await PATCH(new NextRequest(`http://localhost/api/classes/${first}`, {
      method: 'PATCH', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Not allowed' })
    }), { params: Promise.resolve({ path: ['classes', first] }) })
    expect(response.status).toBe(404)
    const snapshot = await ordinaryGET(new NextRequest(`http://localhost/api/state?classId=${first}`, { headers: { Cookie: adminCookie } }), { params: Promise.resolve({ path: ['state'] }) })
    expect(snapshot.status).toBe(404)
    expect((await garden.snapshot(teacher, first)).classes.map(c => c.id)).toEqual([first])
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
      await remote.exec('ALTER TABLE students ADD COLUMN archived_at INTEGER')
      await remote.prepare('UPDATE students SET archived_at = 1 WHERE class_id = ?').run(first)
      expect(await g.adminClass(admin, first)).toMatchObject({ archiveSupported: true, classroom: { active_students: 0, archived_students: 2 } })
    } finally { remote.close() }
  })
})
