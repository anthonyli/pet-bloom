import { describe, it, expect } from 'vitest'
import { createClient } from '@libsql/client'
import { ApplicationDatabase, adaptDatabase } from '../lib/server/database-adapter'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { exportBackup, restoreBackup } from '../lib/server/backup'
import { randomUUID } from 'node:crypto'

for (const driver of ['sqlite', 'libsql'] as const) describe(driver, () => {
  const open = () => driver === 'sqlite' ? adaptDatabase(createDatabase(':memory:')) : new ApplicationDatabase(undefined, createClient({ url: ':memory:' }))
  it('rolls back the entire batch after a constraint error', async () => {
    const db = open()
    try {
      await db.exec('CREATE TABLE atomic_test (id INTEGER PRIMARY KEY)')
      await expect(db.batch([{ sql: 'INSERT INTO atomic_test VALUES (?)', args: [1] }, { sql: 'INSERT INTO atomic_test VALUES (?)', args: [1] }])).rejects.toThrow()
      expect(await db.prepare('SELECT * FROM atomic_test').all()).toEqual([])
    } finally { db.close() }
  })
  it('nested failure cannot be caught and partially committed', async () => {
    const db = open()
    try {
      await db.exec('CREATE TABLE nested_test (id INTEGER PRIMARY KEY)')
      await expect(db.transaction(async () => {
        await db.prepare('INSERT INTO nested_test VALUES (1)').run()
        try { await db.transaction(async () => { throw new Error('abort') })() } catch { /* intentionally swallowed */ }
      })()).rejects.toThrow('Nested transaction failed')
      expect(await db.prepare('SELECT * FROM nested_test').all()).toEqual([])
    } finally { db.close() }
  })
})

it('local concurrent request cannot leak into a transaction that rolls back', async () => {
  const raw = createDatabase(':memory:'), db = adaptDatabase(raw)
  expect(adaptDatabase(raw)).toBe(db)
  await db.exec('CREATE TABLE isolation_test (id INTEGER PRIMARY KEY)')
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { started = resolve })
  try {
    const first = db.transaction(async () => {
      await db.prepare('INSERT INTO isolation_test VALUES (1)').run()
      started(); await gate; throw new Error('rollback')
    })()
    const rejected = expect(first).rejects.toThrow('rollback')
    await ready
    const second = db.prepare('INSERT INTO isolation_test VALUES (2)').run()
    release(); await rejected; await second
    expect(await db.prepare('SELECT * FROM isolation_test').all()).toEqual([{ id: 2 }])
  } finally { db.close() }
})

it.skipIf(!process.env.TURSO_TEST_DATABASE_URL)('Singapore Turso: register, score, rollback, redemption, backup round-trip', async () => {
  const client = createClient({ url: process.env.TURSO_TEST_DATABASE_URL!, authToken: process.env.TURSO_TEST_AUTH_TOKEN })
  const db = new ApplicationDatabase(undefined, client), garden = new Garden(db)
  const users: string[] = []
  try {
    const started = Date.now()
    const register = async () => {
      const { user } = await garden.register({ username: `verify-${randomUUID().slice(0, 16)}`, password: randomUUID() })
      users.push(user.id)
      await garden.saveProfile(user.id, { displayName: '部署验证', subject: '科学', teachingRole: 'homeroom' })
      return user.id
    }
    const owner = await register()
    const { id } = await garden.createClass(owner, { name: '部署验证' })
    const ids = await garden.addStudents(owner, { classId: id, students: [{ name: '测试一' }, { name: '测试二' }] })
    for (const student of ids) await garden.adopt(owner, student, { petId: 'panda' })
    const batch = await garden.evaluate(owner, { studentIds: ids, custom: { points: 40 } })
    expect((await garden.snapshot(owner, id)).students.every(s => s.points === 40)).toBe(true)
    await expect(garden.evaluate(owner, { studentIds: [...ids, 'missing-student'], custom: { points: 2 } })).rejects.toThrow('notFound')
    const item = (await garden.snapshot(owner, id)).items.find(i => i.background_id === 'garden')!
    const results = await Promise.allSettled([garden.redeem(owner, { studentId: ids[0], itemId: item.id }), garden.redeem(owner, { studentId: ids[0], itemId: item.id })])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'backgroundAlreadyOwned' } })
    const backup = await exportBackup(garden, owner), importer = await register()
    const restored = await restoreBackup(garden, importer, backup)
    expect((await garden.snapshot(importer, restored.classIds[0])).students.every(s => s.points === 40)).toBe(true)
    const redemption = (await garden.snapshot(owner, id)).redemptions[0]
    await garden.undoRedemption(owner, redemption.id)
    await garden.undo(owner, batch.batchId)
    expect((await garden.snapshot(owner, id)).students.every(s => s.points === 0)).toBe(true)
    console.log(`Turso verification completed in ${Date.now() - started} ms`)
  } finally {
    for (const owner of users) {
      await db.prepare('DELETE FROM classes WHERE owner_id = ?').run(owner)
      await db.prepare('DELETE FROM users WHERE id = ?').run(owner)
    }
    db.close()
  }
}, 180000)
