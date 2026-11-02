import { createClient } from '@libsql/client/web'
import { ApplicationDatabase, adaptDatabase } from './database-adapter'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { replayGrowth, replayEvents, type GrowthEvent, type GrowthEvaluation } from '../growth'
import { defaultGardenSettings } from '../garden-settings'
import { petBackgrounds, versionFiveBackgroundIds, holidayBackgroundIds, versionSevenBackgroundIds } from '../pet-backgrounds'
import schemaVersion from './schema-version.json'

function migrateVersionTwo(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > 2) throw new Error('数据库版本高于当前应用版本')
  if (version === 2) return
  db.transaction(() => {
    const current = db.pragma('user_version', { simple: true }) as number
    if (current === 2) return
    if (current !== 1) throw new Error('数据库版本无法迁移')
    db.exec(`
      ALTER TABLE badges RENAME TO badges_v1;
      CREATE TABLE badges (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, generation INTEGER NOT NULL, pet_id TEXT NOT NULL, earned_at INTEGER NOT NULL, level INTEGER NOT NULL CHECK(level BETWEEN 2 AND 8), UNIQUE(student_id, generation, level));
      INSERT INTO badges (id, student_id, generation, pet_id, earned_at, level) SELECT id, student_id, generation, pet_id, earned_at, 8 FROM badges_v1;
      DROP TABLE badges_v1;
      ALTER TABLE items ADD COLUMN description TEXT NOT NULL DEFAULT '{"zh":"","en":""}';
      ALTER TABLE items ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
      ALTER TABLE items ADD COLUMN icon TEXT NOT NULL DEFAULT 'gift';
      ALTER TABLE items ADD COLUMN image TEXT;
      ALTER TABLE items ADD COLUMN image_key TEXT;
      ALTER TABLE items ADD COLUMN image_bytes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE items ADD COLUMN stock INTEGER NOT NULL DEFAULT -1 CHECK(stock >= -1);
      ALTER TABLE redemptions ADD COLUMN stock_deducted INTEGER NOT NULL DEFAULT 0;
    `)
    const students = db.prepare('SELECT id, pet_id, generation FROM students').all() as { id: string; pet_id: string | null; generation: number }[]
    const insert = db.prepare('INSERT OR IGNORE INTO badges (id, student_id, generation, pet_id, earned_at, level) VALUES (?, ?, ?, ?, ?, ?)')
    for (const student of students) {
      const records = db.prepare('SELECT points, generation, created_at FROM evaluations WHERE student_id = ? AND undone = 0 ORDER BY rowid').all(student.id) as { points: number; generation: number; created_at: number }[]
      const generations = new Map<number, typeof records>()
      for (const record of records) {
        if (record.generation < 1 || record.generation > student.generation) continue
        const group = generations.get(record.generation)
        if (group) group.push(record)
        else generations.set(record.generation, [record])
      }
      for (const [generation, generationRecords] of generations) {
        const previous = db.prepare('SELECT pet_id FROM badges WHERE student_id = ? AND generation = ? LIMIT 1').get(student.id, generation) as { pet_id: string } | undefined
        const petId = previous?.pet_id || (generation === student.generation ? student.pet_id : null)
        if (!petId) continue
        const { levels } = replayGrowth(generationRecords)
        for (const [level, earnedAt] of levels) insert.run(randomUUID(), student.id, generation, petId, earnedAt, level)
      }
    }
    db.pragma('user_version = 2')
  }).immediate()
}

function migrateVersionThree(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > 3) throw new Error('数据库版本高于当前应用版本')
  if (version === 3) return
  db.transaction(() => {
    const current = db.pragma('user_version', { simple: true }) as number
    if (current === 3) return
    if (current < 2) migrateVersionTwo(db)
    db.exec(`
      CREATE TABLE settings_versions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(owner_id, version));
      CREATE TABLE growth_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, generation INTEGER NOT NULL, kind TEXT NOT NULL, settings_id TEXT NOT NULL REFERENCES settings_versions(id), evaluation_id TEXT REFERENCES evaluations(id) ON DELETE CASCADE, pet_id TEXT, initial_undone INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE INDEX growth_events_student ON growth_events(student_id, generation, seq);
      CREATE UNIQUE INDEX growth_evaluation_unique ON growth_events(evaluation_id) WHERE kind = 'evaluation';
      ALTER TABLE badges ADD COLUMN amount INTEGER NOT NULL DEFAULT 1 CHECK(amount BETWEEN 0 AND 100);
      ALTER TABLE badges ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1));
      ALTER TABLE badges ADD COLUMN source_event TEXT;
    `)
    const owners = db.prepare('SELECT id FROM users').all() as { id: string }[]
    const insert = db.prepare('INSERT INTO growth_events (id, student_id, generation, kind, settings_id, evaluation_id, pet_id, initial_undone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const owner of owners) {
      const settingsId = randomUUID(), value = defaultGardenSettings()
      db.prepare('INSERT INTO settings_versions VALUES (?, ?, 0, ?, ?)').run(settingsId, owner.id, JSON.stringify(value), Date.now())
      const students = db.prepare('SELECT s.* FROM students s JOIN classes c ON c.id = s.class_id WHERE c.owner_id = ? ORDER BY s.rowid').all(owner.id) as { id: string; pet_id: string | null; generation: number; created_at: number }[]
      for (const student of students) {
        const records = db.prepare('SELECT * FROM evaluations WHERE student_id = ? ORDER BY rowid').all(student.id) as GrowthEvaluation[]
        const badges = db.prepare('SELECT * FROM badges WHERE student_id = ?').all(student.id) as { generation: number; pet_id: string; level: number }[]
        const generations = [...new Set([student.generation, ...records.map(record => record.generation), ...badges.map(badge => badge.generation)])].sort((a, b) => a - b)
        for (const generation of generations) {
          const petId = generation === student.generation ? student.pet_id : badges.find(badge => badge.generation === generation)?.pet_id || null
          if (generation > 0) insert.run(randomUUID(), student.id, generation, 'start', settingsId, null, petId, 0, student.created_at)
          for (const record of records.filter(record => record.generation === generation)) insert.run(randomUUID(), student.id, generation, 'evaluation', settingsId, record.id, null, record.undone, record.created_at)
          const events = db.prepare('SELECT * FROM growth_events WHERE student_id = ? AND generation = ? ORDER BY seq').all(student.id, generation) as GrowthEvent[]
          const result = replayEvents(events, new Map(records.map(record => [record.id, record])), new Map([[settingsId, value]]))
          for (const [level, award] of result.levels) db.prepare('UPDATE badges SET source_event = ? WHERE student_id = ? AND generation = ? AND level = ?').run(award.source_event, student.id, generation, level)
        }
      }
    }
    db.pragma('user_version = 3')
  }).immediate()
}

function copyVersionFourDefaults(db: Database.Database, owner: string, classId: string) {
  const settings = new Map<string, string>(), items = new Map<string, string>()
  const policies = db.prepare('SELECT id FROM settings_versions WHERE owner_id = ? AND class_id IS NULL ORDER BY version').all(owner) as { id: string }[]
  for (const row of policies) {
    const id = randomUUID(); settings.set(row.id, id)
    db.prepare('INSERT INTO settings_versions (id, owner_id, version, value, created_at, class_id) SELECT ?, owner_id, version, value, created_at, ? FROM settings_versions WHERE id = ?').run(id, classId, row.id)
  }
  const rules = db.prepare('SELECT id FROM rules WHERE owner_id = ? AND class_id IS NULL ORDER BY rowid').all(owner) as { id: string }[]
  for (const row of rules) db.prepare('INSERT INTO rules (id, owner_id, name, points, category, custom, class_id) SELECT ?, owner_id, name, points, category, custom, ? FROM rules WHERE id = ?').run(randomUUID(), classId, row.id)
  const rewards = db.prepare('SELECT id FROM items WHERE owner_id = ? AND class_id IS NULL ORDER BY rowid').all(owner) as { id: string }[]
  for (const row of rewards) {
    const id = randomUUID(); items.set(row.id, id)
    db.prepare('INSERT INTO items (id, owner_id, name, cost, active, description, category, icon, image, image_key, image_bytes, stock, class_id) SELECT ?, owner_id, name, cost, active, description, category, icon, image, image_key, image_bytes, stock, ? FROM items WHERE id = ?').run(id, classId, row.id)
  }
  return { settings, items }
}

function migrateVersionFour(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > 4) throw new Error('数据库版本高于当前应用版本')
  if (version === 4) return
  db.transaction(() => {
    const current = db.pragma('user_version', { simple: true }) as number
    if (current === 4) return
    if (current < 3) migrateVersionThree(db)
    db.exec(`
      ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN subject TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN teaching_role TEXT NOT NULL DEFAULT '';
      ALTER TABLE rules ADD COLUMN class_id TEXT REFERENCES classes(id) ON DELETE CASCADE;
      ALTER TABLE items ADD COLUMN class_id TEXT REFERENCES classes(id) ON DELETE CASCADE;
      CREATE INDEX rules_class ON rules(class_id);
      CREATE INDEX items_class ON items(class_id);
      CREATE TABLE class_members (class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, joined_at INTEGER NOT NULL, PRIMARY KEY(class_id, user_id));
      CREATE INDEX class_members_user ON class_members(user_id);
      CREATE TABLE class_invites (class_id TEXT PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE, code_hash TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
      CREATE TABLE settings_versions_v4 (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL, class_id TEXT REFERENCES classes(id) ON DELETE CASCADE);
      INSERT INTO settings_versions_v4 (id, owner_id, version, value, created_at) SELECT id, owner_id, version, value, created_at FROM settings_versions;
      CREATE TABLE growth_events_v4 (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, generation INTEGER NOT NULL, kind TEXT NOT NULL, settings_id TEXT NOT NULL REFERENCES settings_versions_v4(id), evaluation_id TEXT REFERENCES evaluations(id) ON DELETE CASCADE, pet_id TEXT, initial_undone INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      INSERT INTO growth_events_v4 SELECT * FROM growth_events;
      DROP TABLE growth_events;
      DROP TABLE settings_versions;
      ALTER TABLE settings_versions_v4 RENAME TO settings_versions;
      ALTER TABLE growth_events_v4 RENAME TO growth_events;
      CREATE UNIQUE INDEX settings_template_version ON settings_versions(owner_id, version) WHERE class_id IS NULL;
      CREATE UNIQUE INDEX settings_class_version ON settings_versions(class_id, version) WHERE class_id IS NOT NULL;
      CREATE INDEX growth_events_student ON growth_events(student_id, generation, seq);
      CREATE UNIQUE INDEX growth_evaluation_unique ON growth_events(evaluation_id) WHERE kind = 'evaluation';
    `)
    for (const table of ['evaluations', 'redemptions']) db.exec(`
      ALTER TABLE ${table} ADD COLUMN actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE ${table} ADD COLUMN actor_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE ${table} ADD COLUMN actor_subject TEXT NOT NULL DEFAULT '';
      ALTER TABLE ${table} ADD COLUMN undone_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE ${table} ADD COLUMN undone_by_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE ${table} ADD COLUMN undone_by_subject TEXT NOT NULL DEFAULT '';
    `)
    db.prepare('UPDATE redemptions SET item_id = NULL WHERE item_id IS NOT NULL AND stock_deducted = 0 AND NOT EXISTS (SELECT 1 FROM items WHERE id = redemptions.item_id)').run()
    const classes = db.prepare('SELECT id, owner_id FROM classes ORDER BY rowid').all() as { id: string; owner_id: string }[]
    for (const classroom of classes) {
      db.prepare('INSERT INTO class_members (class_id, user_id, joined_at) VALUES (?, ?, ?)').run(classroom.id, classroom.owner_id, Date.now())
      const mappings = copyVersionFourDefaults(db, classroom.owner_id, classroom.id)
      for (const [before, after] of mappings.settings) db.prepare('UPDATE growth_events SET settings_id = ? WHERE settings_id = ? AND student_id IN (SELECT id FROM students WHERE class_id = ?)').run(after, before, classroom.id)
      for (const [before, after] of mappings.items) db.prepare('UPDATE redemptions SET item_id = ? WHERE item_id = ? AND student_id IN (SELECT id FROM students WHERE class_id = ?)').run(after, before, classroom.id)
    }
    db.pragma('user_version = 4')
  }).immediate()
}

export function initializeBackgroundItems(db: Database.Database, owner: string, classId: string | null = null, ids: readonly string[] = petBackgrounds.map(background => background.id)) {
  const insert = db.prepare('INSERT OR IGNORE INTO items (id, owner_id, class_id, name, cost, active, description, category, icon, stock, background_id) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, -1, ?)')
  for (const background of petBackgrounds.filter(value => ids.includes(value.id))) insert.run(randomUUID(), owner, classId, JSON.stringify(background.name), JSON.stringify(background.description), 'other', 'gift', background.id)
}

export function copyClassDefaults(db: Database.Database, owner: string, classId: string) {
  const mappings = copyVersionFourDefaults(db, owner, classId)
  const copyBackground = db.prepare('UPDATE items SET background_id = (SELECT background_id FROM items WHERE id = ?) WHERE id = ?')
  for (const [before, after] of mappings.items) copyBackground.run(before, after)
  return mappings
}

function migrateVersionFive(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > 5) throw new Error('数据库版本高于当前应用版本')
  if (version === 5) return
  db.transaction(() => {
    const current = db.pragma('user_version', { simple: true }) as number
    if (current === 5) return
    if (current < 4) migrateVersionFour(db)
    db.exec(`
      ALTER TABLE students ADD COLUMN background_id TEXT;
      ALTER TABLE items ADD COLUMN background_id TEXT;
      ALTER TABLE redemptions ADD COLUMN background_id TEXT;
      CREATE UNIQUE INDEX redemption_background_owned ON redemptions(student_id, background_id) WHERE undone = 0 AND background_id IS NOT NULL;
      CREATE UNIQUE INDEX items_class_background ON items(class_id, background_id) WHERE class_id IS NOT NULL AND background_id IS NOT NULL;
      CREATE UNIQUE INDEX items_template_background ON items(owner_id, background_id) WHERE class_id IS NULL AND background_id IS NOT NULL;
    `)
    const owners = db.prepare('SELECT id FROM users').all() as { id: string }[]
    for (const owner of owners) initializeBackgroundItems(db, owner.id, null, versionFiveBackgroundIds)
    const classes = db.prepare('SELECT id, owner_id FROM classes').all() as { id: string; owner_id: string }[]
    for (const classroom of classes) initializeBackgroundItems(db, classroom.owner_id, classroom.id, versionFiveBackgroundIds)
    db.pragma('user_version = 5')
  }).immediate()
}

function migrateVersionSix(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > 6) throw new Error('数据库版本高于当前应用版本')
  if (version === 6) return
  db.transaction(() => {
    const current = db.pragma('user_version', { simple: true }) as number
    if (current === 6) return
    if (current < 5) migrateVersionFive(db)
    const owners = db.prepare('SELECT id FROM users').all() as { id: string }[]
    for (const owner of owners) initializeBackgroundItems(db, owner.id, null, holidayBackgroundIds)
    const classes = db.prepare('SELECT id, owner_id FROM classes').all() as { id: string; owner_id: string }[]
    for (const classroom of classes) initializeBackgroundItems(db, classroom.owner_id, classroom.id, holidayBackgroundIds)
    db.pragma('user_version = 6')
  }).immediate()
}

function migrateVersionSeven(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > 7) throw new Error('数据库版本高于当前应用版本')
  if (version === 7) return
  db.transaction(() => {
    const current = db.pragma('user_version', { simple: true }) as number
    if (current === 7) return
    if (current < 6) migrateVersionSix(db)
    const owners = db.prepare('SELECT id FROM users').all() as { id: string }[]
    for (const owner of owners) initializeBackgroundItems(db, owner.id, null, versionSevenBackgroundIds)
    const classes = db.prepare('SELECT id, owner_id FROM classes').all() as { id: string; owner_id: string }[]
    for (const classroom of classes) initializeBackgroundItems(db, classroom.owner_id, classroom.id, versionSevenBackgroundIds)
    db.pragma('user_version = 7')
  }).immediate()
}

function migrateDatabase(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > 8) throw new Error('数据库版本高于当前应用版本')
  if (version === 8) return
  db.transaction(() => {
    const current = db.pragma('user_version', { simple: true }) as number
    if (current === 8) return
    if (current < 7) migrateVersionSeven(db)
    db.exec(`
      ALTER TABLE students ADD COLUMN festival_background_id TEXT;
      ALTER TABLE students ADD COLUMN festival_background_expires_at INTEGER;
    `)
    db.pragma('user_version = 8')
  }).immediate()
}

export function createDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true })
  const db = new Database(filename)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    if (filename !== ':memory:') db.pragma('journal_mode = WAL')
    if (db.pragma('user_version', { simple: true }) === 0) db.transaction(() => {
      if (db.pragma('user_version', { simple: true }) !== 0) return
      db.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL, password TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
        CREATE TABLE classes (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE INDEX classes_owner ON classes(owner_id);
        CREATE TABLE students (id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE, name TEXT NOT NULL, student_no TEXT NOT NULL DEFAULT '', points INTEGER NOT NULL DEFAULT 0, pet_id TEXT, pet_exp INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, spent_badges INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
        CREATE INDEX students_class ON students(class_id);
        CREATE TABLE rules (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, points INTEGER NOT NULL, category TEXT NOT NULL, custom INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX rules_owner ON rules(owner_id);
        CREATE TABLE evaluations (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, points INTEGER NOT NULL, reason TEXT NOT NULL, category TEXT NOT NULL, generation INTEGER NOT NULL, created_at INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX evaluations_student ON evaluations(student_id, created_at);
        CREATE TABLE badges (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, generation INTEGER NOT NULL, pet_id TEXT NOT NULL, earned_at INTEGER NOT NULL, UNIQUE(student_id, generation));
        CREATE TABLE items (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, cost INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE redemptions (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, item_id TEXT, item_name TEXT NOT NULL, cost INTEGER NOT NULL, created_at INTEGER NOT NULL, undone INTEGER NOT NULL DEFAULT 0);
        PRAGMA user_version = 1;
      `)
    }).immediate()
    migrateDatabase(db)
    return db
  } catch (error) { db.close(); throw error }
}

const globalDb = globalThis as typeof globalThis & { petGardenDb?: Database.Database }
export function database() {
  if (!globalDb.petGardenDb) globalDb.petGardenDb = createDatabase(process.env.DATABASE_PATH || './data/pet-garden.db')
  else migrateDatabase(globalDb.petGardenDb)
  return globalDb.petGardenDb
}

let remoteDatabase: Promise<ApplicationDatabase> | undefined
export async function applicationDatabase() {
  const url = process.env.DESKTOP_TOKEN ? undefined : process.env.TURSO_DATABASE_URL
  if (!url) {
    if (process.env.VERCEL) throw new Error('TURSO_DATABASE_URL is required on Vercel')
    return adaptDatabase(database())
  }
  if (!process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_AUTH_TOKEN is required')
  remoteDatabase ||= (async () => {
    const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
    const db = new ApplicationDatabase(undefined, client)
    try {
      const schema = await db.prepare('SELECT version FROM _pet_bloom_schema WHERE id = 1').get() as { version: number } | undefined
      // Cloud migrations are additive: the previous release must keep working
      // between migration commit and promotion of the new deployment.
      if (!schema || !Number.isInteger(schema.version) || schema.version < schemaVersion.current) throw new Error('Turso schema version mismatch; apply migrations before deploying')
      return db
    } catch (error) { client.close(); remoteDatabase = undefined; throw error }
  })()
  return remoteDatabase
}
