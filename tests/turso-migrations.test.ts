import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { createClient, type Client } from '@libsql/client'
import { createDatabase } from '../lib/server/db'
import { ApplicationDatabase } from '../lib/server/database-adapter'
import { Garden } from '../lib/server/garden'
import schemaVersion from '../lib/server/schema-version.json'
// @ts-expect-error Standalone Node.js deployment module.
import { loadMigrations, inspectState, createVerifiedBackup, migrate, validateExpansion, expectedSchema } from '../scripts/lib/turso-migrations.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const folders: string[] = []
const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  for (const directory of folders.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture(statements?: string[]) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pet-bloom-migration-'))
  folders.push(directory)
  const migrationDirectory = path.join(directory, 'migrations')
  await mkdir(migrationDirectory)
  await copyFile(path.join(root, 'migrations/turso/008-baseline.json'), path.join(migrationDirectory, '008-baseline.json'))
  if (statements) await writeFile(path.join(migrationDirectory, '009-expand.json'), JSON.stringify({ version: 9, name: 'expand', kind: 'expand', statements }))
  const migrations = await loadMigrations(migrationDirectory, statements ? 9 : 8)
  const filename = path.join(directory, 'source.db')
  const db = createDatabase(filename)
  db.exec('ALTER TABLE students DROP COLUMN archive_reason; ALTER TABLE students DROP COLUMN archive_note; ALTER TABLE students DROP COLUMN archived_at; PRAGMA user_version = 8')
  db.exec(`
    CREATE TABLE _pet_bloom_schema (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, initialized_at INTEGER NOT NULL);
    INSERT INTO _pet_bloom_schema VALUES (1,8,123);
    INSERT INTO users (id,username,password,created_at) VALUES ('teacher','教师甲','test-password-hash',100);
    INSERT INTO sessions VALUES ('test-session','teacher',9999999999999);
    INSERT INTO classes VALUES ('class','teacher','一班',101);
    INSERT INTO students (id,class_id,name,student_no,points,pet_id,generation,created_at) VALUES ('student','class','学生甲','0001',40,'panda',1,102);
    INSERT INTO evaluations (id,batch_id,student_id,points,reason,category,generation,created_at) VALUES ('score','batch','student',40,'保留记录','other',1,103);
    INSERT INTO settings_versions (id,owner_id,version,value,created_at,class_id) VALUES ('settings','teacher',0,'{}',100,'class');
    INSERT INTO growth_events (seq,id,student_id,generation,kind,settings_id,evaluation_id,created_at) VALUES (9007199254740993,'event','student',1,'evaluation','settings','score',103);
  `)
  db.close()
  const client = createClient({ url: `file:${filename}`, intMode: 'bigint' })
  clients.push(client)
  const backup = (state: unknown) => createVerifiedBackup({
    directory: path.join(directory, 'backups'), state, source: 'test-fixture',
    exportDatabase: async (destination: string) => {
      const source = new Database(filename)
      try { await source.backup(destination) } finally { source.close() }
    }
  })
  return { directory, migrationDirectory, filename, migrations, client, backup }
}

describe('Turso migrations preserve existing data', () => {
  it('applies the committed archive expansion to v8 with a verified backup and no history loss', async () => {
    const f = await fixture()
    const migrations = await loadMigrations(path.join(root, 'migrations/turso'), schemaVersion.current)
    const before = (await f.client.execute('SELECT * FROM evaluations')).rows
    await migrate(f.client, migrations, f.backup)
    expect((await f.client.execute('SELECT archived_at, archive_reason, archive_note, points FROM students')).rows[0]).toEqual({ archived_at: null, archive_reason: null, archive_note: null, points: 40n })
    expect((await f.client.execute('SELECT * FROM evaluations')).rows).toEqual(before)
    expect((await inspectState(f.client, migrations)).pending).toEqual([])
  })

  it('keeps desktop schema version and the committed cloud schema in sync', async () => {
    const migrations = await loadMigrations(path.join(root, 'migrations/turso'), schemaVersion.current)
    const db = createDatabase(':memory:')
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(migrations.at(-1).version)
      const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
      expect(schema).toEqual(expectedSchema(migrations, schemaVersion.current))
    } finally { db.close() }
  })

  it('adopts v8 without reinitializing, and reruns without backup or writes', async () => {
    const f = await fixture()
    const initial = await inspectState(f.client, f.migrations)
    expect(initial.pending.map((item: { version: number }) => item.version)).toEqual([8])
    expect((await f.client.execute("SELECT name FROM sqlite_master WHERE name='_pet_bloom_migrations'")).rows).toHaveLength(0)
    const result = await migrate(f.client, f.migrations, f.backup)
    expect(result.applied).toEqual([8])
    expect((await f.client.execute('SELECT password FROM users')).rows[0].password).toBe('test-password-hash')
    const again = await migrate(f.client, f.migrations, () => { throw new Error('must not back up a no-op') })
    expect(again.applied).toEqual([])
    expect((await f.client.execute('SELECT * FROM _pet_bloom_migrations')).rows).toHaveLength(1)
  })

  it('restores a full pre-migration snapshot, including sessions, rowids and large integer sequences', async () => {
    const f = await fixture(['ALTER TABLE students ADD COLUMN note TEXT', 'CREATE INDEX students_note ON students(note)', 'CREATE TABLE migration_example (id INTEGER PRIMARY KEY, payload BLOB)'])
    const result = await migrate(f.client, f.migrations, f.backup)
    expect(result.applied).toEqual([8, 9])
    expect((await f.client.execute('SELECT points,note FROM students')).rows[0]).toMatchObject({ points: 40n, note: null })
    const restored = new Database(result.backup, { readonly: true })
    try {
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(restored.prepare('SELECT version FROM _pet_bloom_schema').pluck().get()).toBe(8)
      expect(restored.prepare('SELECT token FROM sessions').pluck().get()).toBe('test-session')
      expect(restored.prepare('SELECT reason FROM evaluations').pluck().get()).toBe('保留记录')
      expect(restored.prepare('SELECT seq FROM growth_events').safeIntegers().pluck().get()).toBe(9007199254740993n)
      expect((restored.pragma('table_info(students)') as { name: string }[]).some(row => row.name === 'note')).toBe(false)
    } finally { restored.close() }
    expect((await stat(result.backup)).mode & 0o777).toBe(0o600)
    const manifest = JSON.parse(await readFile(path.join(path.dirname(result.backup), 'manifest.json'), 'utf8'))
    expect(manifest.tables.find((table: { name: string }) => table.name === 'users').count).toBe(1)
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/)
    // The old application's explicit column queries still read the same rows.
    expect((await f.client.execute('SELECT name,student_no,points FROM students')).rows[0]).toMatchObject({ name: '学生甲', student_no: '0001', points: 40n })
  })

  it('stops before any write when backup or rehearsal fails', async () => {
    const f = await fixture(['ALTER TABLE students ADD COLUMN note TEXT'])
    await expect(migrate(f.client, f.migrations, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect((await f.client.execute('SELECT version FROM _pet_bloom_schema')).rows[0].version).toBe(8n)
    expect((await f.client.execute("SELECT name FROM sqlite_master WHERE name='_pet_bloom_migrations'")).rows).toHaveLength(0)
    expect((await f.client.execute('SELECT points FROM students')).rows[0].points).toBe(40n)
  })

  it('keeps authentication working when a newer schema adds a session column', async () => {
    const f = await fixture(['ALTER TABLE sessions ADD COLUMN device TEXT'])
    await migrate(f.client, f.migrations, f.backup)
    const garden = new Garden(new ApplicationDatabase(undefined, f.client))
    const login = await garden.session('teacher')
    expect(login.user.id).toBe('teacher')
    expect(await garden.authenticate(login.token)).toBe('teacher')
    expect((await f.client.execute('SELECT COUNT(*) AS count FROM sessions')).rows[0].count).toBe(2n)
  })

  it('refuses an unmarked database or a downgrade without creating metadata', async () => {
    const f = await fixture()
    await f.client.execute('UPDATE _pet_bloom_schema SET version=9')
    await expect(inspectState(f.client, f.migrations)).rejects.toThrow('downgrades')
    await f.client.execute('DROP TABLE _pet_bloom_schema')
    await expect(inspectState(f.client, f.migrations)).rejects.toThrow('initialization')
    expect((await f.client.execute("SELECT name FROM sqlite_master WHERE name='_pet_bloom_migrations'")).rows).toHaveLength(0)
  })

  it('rolls back all DDL and history if new concurrent data makes a later statement fail', async () => {
    const f = await fixture(['ALTER TABLE students ADD COLUMN note TEXT', 'CREATE UNIQUE INDEX student_name_unique ON students(name)'])
    await expect(migrate(f.client, f.migrations, async (state: unknown) => {
      const snapshot = await f.backup(state)
      await f.client.execute("INSERT INTO students (id,class_id,name,created_at) VALUES ('second','class','学生甲',105)")
      return snapshot
    })).rejects.toThrow()
    expect((await f.client.execute('SELECT COUNT(*) AS count FROM students')).rows[0].count).toBe(2n)
    expect((await f.client.execute('PRAGMA table_info(students)')).rows.some(row => row.name === 'note')).toBe(false)
    expect((await f.client.execute('SELECT version FROM _pet_bloom_schema')).rows[0].version).toBe(8n)
    expect((await f.client.execute("SELECT name FROM sqlite_master WHERE name LIKE '_pet_bloom_migration%'")).rows).toHaveLength(0)
  })

  it('rejects a stale runner after another migration commits', async () => {
    const f = await fixture(['ALTER TABLE students ADD COLUMN note TEXT'])
    await expect(migrate(f.client, f.migrations, async (state: unknown) => {
      const snapshot = await f.backup(state)
      await migrate(f.client, f.migrations, f.backup)
      return snapshot
    })).rejects.toThrow()
    expect((await inspectState(f.client, f.migrations)).pending).toHaveLength(0)
    expect((await f.client.execute('SELECT version FROM _pet_bloom_migrations ORDER BY version')).rows.map(row => row.version)).toEqual([8n, 9n])
  })

  it('detects changed migration files and untracked schema changes', async () => {
    const f = await fixture()
    await migrate(f.client, f.migrations, f.backup)
    await expect(inspectState(f.client, [{ ...f.migrations[0], checksum: 'edited' }])).rejects.toThrow('checksums')
    await f.client.execute('ALTER TABLE students ADD COLUMN unexpected TEXT')
    await expect(inspectState(f.client, f.migrations)).rejects.toThrow('drift')
  })

  it.each([
    'DROP TABLE students', 'DELETE FROM users', 'UPDATE students SET points=0',
    'ALTER TABLE students DROP COLUMN points', 'ALTER TABLE students RENAME TO old_students',
    'ALTER TABLE students ADD COLUMN note TEXT NOT NULL',
    'ALTER TABLE students ADD COLUMN note TEXT; DELETE FROM students',
    'CREATE TRIGGER erase AFTER INSERT ON students BEGIN DELETE FROM students; END',
    'CREATE TABLE _pet_bloom_migrations (id INTEGER)', 'PRAGMA writable_schema=ON'
  ])('rejects destructive or incompatible SQL: %s', sql => {
    expect(() => validateExpansion(sql)).toThrow()
  })

  it('allows literal defaults without interpreting their contents as SQL', () => {
    expect(() => validateExpansion("ALTER TABLE students ADD COLUMN note TEXT DEFAULT 'a; b''s note'")).not.toThrow()
  })
})
