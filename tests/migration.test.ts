import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { exportBackup, restoreBackup } from '../lib/server/backup'
import { defaultGardenSettings } from '../lib/garden-settings'
import { petBackgrounds, versionFiveBackgroundIds, holidayBackgroundIds, versionSevenBackgroundIds } from '../lib/pet-backgrounds'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function legacyDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'garden-migration-'))
  directories.push(directory)
  const path = join(directory, 'legacy.db')
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  // This is the shipped v1 schema, not a reduced mock schema tailored to the migration.
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
    INSERT INTO users VALUES ('teacher', 'legacy-teacher', 'fixture-hash-not-a-password', 1);
    INSERT INTO classes VALUES ('class', 'teacher', '旧班级', 1);
    INSERT INTO students (id, class_id, name, points, pet_id, pet_exp, generation, spent_badges, created_at) VALUES
      ('graduate', 'class', '毕业学生', 745, 'westie', 45, 2, 1, 1),
      ('regressed', 'class', '降级学生', 20, 'panda', 20, 1, 0, 1),
      ('egg', 'class', '未领养学生', 999, NULL, 0, 0, 0, 1);
    INSERT INTO evaluations VALUES
      ('old-graduation', 'batch-old', 'graduate', 700, '{"zh":"成长","en":"Growth"}', 'other', 1, 10, 0),
      ('new-cycle', 'batch-new', 'graduate', 45, '{"zh":"成长","en":"Growth"}', 'other', 2, 20, 0),
      ('earned', 'batch-earned', 'regressed', 100, '{"zh":"成长","en":"Growth"}', 'other', 1, 30, 0),
      ('deducted', 'batch-deducted', 'regressed', -80, '{"zh":"扣分","en":"Deduction"}', 'other', 1, 40, 0),
      ('unadopted', 'batch-unadopted', 'egg', 999, '{"zh":"成长","en":"Growth"}', 'other', 0, 50, 0);
    INSERT INTO badges VALUES ('original-badge', 'graduate', 1, 'panda', 11);
    INSERT INTO rules VALUES ('legacy-rule', 'teacher', '{"zh":"旧规则","en":"Legacy rule"}', 3, 'study', 1);
    INSERT INTO items VALUES ('reward', 'teacher', '{"zh":"奖励","en":"Reward"}', 1, 1);
    INSERT INTO redemptions VALUES ('spent', 'graduate', 'reward', '{"zh":"奖励","en":"Reward"}', 1, 15, 0);
    PRAGMA user_version = 1;
  `)
  return { path, db }
}
function versionTwoFixture(db: Database.Database) {
  db.exec(`
    ALTER TABLE badges RENAME TO old_badges;
    CREATE TABLE badges (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, generation INTEGER NOT NULL, pet_id TEXT NOT NULL, earned_at INTEGER NOT NULL, level INTEGER NOT NULL CHECK(level BETWEEN 2 AND 8), UNIQUE(student_id, generation, level));
    INSERT INTO badges SELECT id, student_id, generation, pet_id, earned_at, 8 FROM old_badges;
    DROP TABLE old_badges;
    INSERT INTO badges VALUES ('old-2','graduate',1,'panda',10,2), ('old-3','graduate',1,'panda',10,3), ('old-4','graduate',1,'panda',10,4), ('old-5','graduate',1,'panda',10,5), ('old-6','graduate',1,'panda',10,6), ('old-7','graduate',1,'panda',10,7), ('new-2','graduate',2,'westie',20,2), ('regressed-2','regressed',1,'panda',30,2), ('regressed-3','regressed',1,'panda',30,3);
    ALTER TABLE items ADD COLUMN description TEXT NOT NULL DEFAULT '{"zh":"","en":""}';
    ALTER TABLE items ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
    ALTER TABLE items ADD COLUMN icon TEXT NOT NULL DEFAULT 'gift';
    ALTER TABLE items ADD COLUMN image TEXT;
    ALTER TABLE items ADD COLUMN image_key TEXT;
    ALTER TABLE items ADD COLUMN image_bytes INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE items ADD COLUMN stock INTEGER NOT NULL DEFAULT -1 CHECK(stock >= -1);
    ALTER TABLE redemptions ADD COLUMN stock_deducted INTEGER NOT NULL DEFAULT 0;
    PRAGMA user_version = 2;
  `)
}
function versionThreeFixture() {
  const legacy = legacyDatabase(), db = legacy.db
  versionTwoFixture(db)
  db.exec(`
    CREATE TABLE settings_versions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, version INTEGER NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(owner_id, version));
    CREATE TABLE growth_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE, generation INTEGER NOT NULL, kind TEXT NOT NULL, settings_id TEXT NOT NULL REFERENCES settings_versions(id), evaluation_id TEXT REFERENCES evaluations(id) ON DELETE CASCADE, pet_id TEXT, initial_undone INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE INDEX growth_events_student ON growth_events(student_id, generation, seq);
    CREATE UNIQUE INDEX growth_evaluation_unique ON growth_events(evaluation_id) WHERE kind = 'evaluation';
    ALTER TABLE badges ADD COLUMN amount INTEGER NOT NULL DEFAULT 1 CHECK(amount BETWEEN 0 AND 100);
    ALTER TABLE badges ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1));
    ALTER TABLE badges ADD COLUMN source_event TEXT;
    INSERT INTO classes VALUES ('class-2', 'teacher', '第二个旧班级', 2);
    INSERT INTO students (id,class_id,name,points,pet_id,pet_exp,generation,spent_badges,created_at) VALUES ('second','class-2','另一班学生',40,'panda',40,1,1,2);
    INSERT INTO evaluations VALUES ('second-score','batch-second','second',40,'{"zh":"成长","en":"Growth"}','other',1,60,0);
    INSERT INTO badges (id,student_id,generation,pet_id,earned_at,level) VALUES ('second-badge','second',1,'panda',60,2);
    UPDATE items SET stock = 2 WHERE id = 'reward';
    UPDATE redemptions SET stock_deducted = 1 WHERE id = 'spent';
    INSERT INTO items (id,owner_id,name,cost,active,stock) VALUES ('removed','teacher','{"zh":"下架奖励","en":"Removed reward"}',1,0,0);
    INSERT INTO redemptions (id,student_id,item_id,item_name,cost,created_at,undone,stock_deducted) VALUES ('second-spent','second','removed','{"zh":"下架奖励","en":"Removed reward"}',1,70,0,1);
    UPDATE students SET points = 770, pet_exp = 48.5 WHERE id = 'graduate';
    UPDATE evaluations SET points = 70 WHERE id = 'new-cycle';
  `)
  const imageBytes = readFileSync(new URL('../public/pets/panda/lv1.webp', import.meta.url))
  db.prepare('UPDATE items SET image = ?, image_key = ?, image_bytes = ? WHERE id = ?').run(`data:image/webp;base64,${imageBytes.toString('base64')}`, createHash('sha256').update(imageBytes).digest('hex'), imageBytes.length, 'reward')
  const value = defaultGardenSettings(), changed = structuredClone(value)
  changed.growth[1].experience = 17
  for (const [id, version, policy] of [['policy-0', 0, value], ['policy-1', 1, changed]] as const) db.prepare('INSERT INTO settings_versions VALUES (?, ?, ?, ?, ?)').run(id, 'teacher', version, JSON.stringify(policy), version + 1)
  const insert = db.prepare('INSERT INTO growth_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
  for (const row of [
    [2,'g1-start','graduate',1,'start','policy-0',null,'panda',1],
    [4,'g1-e','graduate',1,'evaluation','policy-0','old-graduation',null,10],
    [8,'g2-start','graduate',2,'start','policy-0',null,'westie',19],
    [10,'g2-e','graduate',2,'evaluation','policy-0','new-cycle',null,20],
    [12,'r-start','regressed',1,'start','policy-0',null,'panda',1],
    [14,'r-e','regressed',1,'evaluation','policy-0','earned',null,30],
    [16,'r-d','regressed',1,'evaluation','policy-0','deducted',null,40],
    [18,'egg-e','egg',0,'evaluation','policy-0','unadopted',null,50],
    [20,'s-start','second',1,'start','policy-0',null,'panda',2],
    [22,'s-e','second',1,'evaluation','policy-0','second-score',null,60],
    [24,'g2-rebase','graduate',2,'rebase','policy-1',null,null,80],
    [26,'r-rebase','regressed',1,'rebase','policy-1',null,null,80],
    [28,'s-rebase','second',1,'rebase','policy-1',null,null,80]
  ]) insert.run(...row)
  db.exec(`
    UPDATE badges SET source_event = CASE WHEN student_id = 'graduate' AND generation = 1 THEN 'g1-e' WHEN student_id = 'graduate' THEN 'g2-e' WHEN student_id = 'regressed' THEN 'r-e' ELSE 's-e' END;
    PRAGMA user_version = 3;
  `)
  return legacy
}

const withFestivalBackground = (rows: unknown[]) => rows.map(row => ({ ...(row as Record<string, unknown>), festival_background_id: null, festival_background_expires_at: null }))
const withBackground = (rows: unknown[]) => rows.map(row => ({ ...(row as Record<string, unknown>), background_id: null }))
function expectBackgroundDefaults(db: Database.Database) {
  const owners = db.prepare('SELECT id FROM users ORDER BY id').all() as { id: string }[]
  const classes = db.prepare('SELECT id, owner_id FROM classes ORDER BY id').all() as { id: string; owner_id: string }[]
  const scopes = [...owners.map(row => ({ owner_id: row.id, class_id: null })), ...classes.map(row => ({ owner_id: row.owner_id, class_id: row.id }))]
  for (const scope of scopes) {
    const rows = db.prepare('SELECT owner_id, class_id, background_id, cost, stock, image, image_key, image_bytes, active FROM items WHERE owner_id = ? AND class_id IS ? AND background_id IS NOT NULL ORDER BY background_id').all(scope.owner_id, scope.class_id)
    expect(rows).toEqual(petBackgrounds.map(background => ({ ...scope, background_id: background.id, cost: 1, stock: -1, image: null, image_key: null, image_bytes: 0, active: 1 })).sort((a, b) => a.background_id.localeCompare(b.background_id)))
  }
  expect(db.prepare('SELECT background_id FROM students').all().every(row => (row as { background_id: unknown }).background_id === null)).toBe(true)
  expect(db.prepare('SELECT background_id FROM redemptions').all().every(row => (row as { background_id: unknown }).background_id === null)).toBe(true)
}

// 独立构建已发布v4结构与班级资源，不把v5库改个版本号冒充旧库。
function versionFourFixture() {
  const legacy = versionThreeFixture(), db = legacy.db
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
  for (const classId of ['class', 'class-2']) {
    db.prepare('INSERT INTO class_members VALUES (?, ?, 100)').run(classId, 'teacher')
    for (const { id } of db.prepare('SELECT id FROM settings_versions WHERE class_id IS NULL').all() as { id: string }[]) {
      const copiedId = `${classId}-${id}`
      db.prepare('INSERT INTO settings_versions SELECT ?, owner_id, version, value, created_at, ? FROM settings_versions WHERE id = ?').run(copiedId, classId, id)
      db.prepare('UPDATE growth_events SET settings_id = ? WHERE settings_id = ? AND student_id IN (SELECT id FROM students WHERE class_id = ?)').run(copiedId, id, classId)
    }
    for (const { id } of db.prepare('SELECT id FROM rules WHERE class_id IS NULL').all() as { id: string }[]) db.prepare('INSERT INTO rules SELECT ?, owner_id, name, points, category, custom, ? FROM rules WHERE id = ?').run(`${classId}-${id}`, classId, id)
    for (const { id } of db.prepare('SELECT id FROM items WHERE class_id IS NULL').all() as { id: string }[]) {
      const copiedId = `${classId}-${id}`
      db.prepare('INSERT INTO items SELECT ?, owner_id, name, cost, active, description, category, icon, image, image_key, image_bytes, stock, ? FROM items WHERE id = ?').run(copiedId, classId, id)
      db.prepare('UPDATE redemptions SET item_id = ? WHERE item_id = ? AND student_id IN (SELECT id FROM students WHERE class_id = ?)').run(copiedId, id, classId)
    }
  }
  db.prepare('INSERT INTO users (id, username, password, created_at) VALUES (?, ?, ?, 1)').run('no-classes', 'legacy-no-classes', 'fixture-hash-not-a-password')
  db.pragma('user_version = 4')
  return legacy
}

const v5BackgroundItemId = (owner: string, classId: string | null, backgroundId: string) => `v5-${owner}-${classId ?? 'template'}-${backgroundId}`
function versionFiveFixture() {
  const legacy = versionFourFixture(), db = legacy.db
  db.exec(`
    ALTER TABLE students ADD COLUMN background_id TEXT;
    ALTER TABLE items ADD COLUMN background_id TEXT;
    ALTER TABLE redemptions ADD COLUMN background_id TEXT;
    CREATE UNIQUE INDEX redemption_background_owned ON redemptions(student_id, background_id) WHERE undone = 0 AND background_id IS NOT NULL;
    CREATE UNIQUE INDEX items_class_background ON items(class_id, background_id) WHERE class_id IS NOT NULL AND background_id IS NOT NULL;
    CREATE UNIQUE INDEX items_template_background ON items(owner_id, background_id) WHERE class_id IS NULL AND background_id IS NOT NULL;
  `)
  const owners = db.prepare('SELECT id FROM users').all() as { id: string }[], classes = db.prepare('SELECT id, owner_id FROM classes').all() as { id: string; owner_id: string }[]
  const scopes = [...owners.map(row => ({ owner: row.id, classId: null })), ...classes.map(row => ({ owner: row.owner_id, classId: row.id }))]
  const insert = db.prepare('INSERT INTO items (id, owner_id, class_id, name, cost, active, description, category, icon, stock, background_id) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, -1, ?)')
  for (const scope of scopes) for (const backgroundId of versionFiveBackgroundIds) {
    const background = petBackgrounds.find(row => row.id === backgroundId)!
    insert.run(v5BackgroundItemId(scope.owner, scope.classId, backgroundId), scope.owner, scope.classId, JSON.stringify(background.name), JSON.stringify(background.description), 'other', 'gift', backgroundId)
  }
  db.pragma('user_version = 5')
  return legacy
}
function versionSixFixture() {
  // v6复用真实v5结构，仅追加冻结的28节日，不调用当前createDatabase或使用实时41项目录播种。
  const legacy = versionFiveFixture(), db = legacy.db
  const owners = db.prepare('SELECT id FROM users').all() as { id: string }[], classes = db.prepare('SELECT id, owner_id FROM classes').all() as { id: string; owner_id: string }[]
  const scopes = [...owners.map(row => ({ owner: row.id, classId: null })), ...classes.map(row => ({ owner: row.owner_id, classId: row.id }))]
  const insert = db.prepare('INSERT INTO items (id, owner_id, class_id, name, cost, active, description, category, icon, stock, background_id) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, -1, ?)')
  for (const scope of scopes) for (const backgroundId of holidayBackgroundIds) {
    const background = petBackgrounds.find(row => row.id === backgroundId)!
    insert.run(`v6-${scope.owner}-${scope.classId ?? 'template'}-${backgroundId}`, scope.owner, scope.classId, JSON.stringify(background.name), JSON.stringify(background.description), 'other', 'gift', backgroundId)
  }
  db.pragma('user_version = 6')
  return legacy
}
function versionSevenFixture() {
  const legacy = versionSixFixture(), db = legacy.db
  const owners = db.prepare('SELECT id FROM users').all() as { id: string }[], classes = db.prepare('SELECT id, owner_id FROM classes').all() as { id: string; owner_id: string }[]
  const scopes = [...owners.map(row => ({ owner: row.id, classId: null })), ...classes.map(row => ({ owner: row.owner_id, classId: row.id }))]
  const insert = db.prepare('INSERT INTO items (id, owner_id, class_id, name, cost, active, description, category, icon, stock, background_id) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, -1, ?)')
  for (const scope of scopes) for (const backgroundId of versionSevenBackgroundIds) {
    const background = petBackgrounds.find(row => row.id === backgroundId)!
    insert.run(`v7-${scope.owner}-${scope.classId ?? 'template'}-${backgroundId}`, scope.owner, scope.classId, JSON.stringify(background.name), JSON.stringify(background.description), 'other', 'gift', backgroundId)
  }
  db.pragma('user_version = 7')
  return legacy
}
const databaseRows = (db: Database.Database) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]))
}

describe('SQLite v1/v2/v3/v4/v5/v6/v7到v8真实迁移', () => {
  it('保留原毕业徽章ID和消费，补发旧周期及当前周期，不奖励未领养学生', () => {
    const legacy = legacyDatabase()
    legacy.db.close()
    const db = createDatabase(legacy.path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8)
      expectBackgroundDefaults(db)
      expect(db.prepare('SELECT * FROM badges WHERE id = ?').get('original-badge')).toMatchObject({ level: 8, earned_at: 11, pet_id: 'panda' })
      expect(db.prepare('SELECT * FROM badges WHERE student_id = ? AND generation = 1').all('graduate')).toHaveLength(7)
      expect(db.prepare('SELECT * FROM badges WHERE student_id = ? AND generation = 2').all('graduate')).toMatchObject([{ level: 2, pet_id: 'westie', earned_at: 20 }])
      expect(db.prepare('SELECT level, earned_at FROM badges WHERE student_id = ? ORDER BY level').all('regressed')).toEqual([{ level: 2, earned_at: 30 }, { level: 3, earned_at: 30 }])
      expect(db.prepare('SELECT * FROM badges WHERE student_id = ?').all('egg')).toEqual([])
      expect(db.prepare('SELECT spent_badges FROM students WHERE id = ?').get('graduate')).toEqual({ spent_badges: 1 })
      expect(db.prepare('SELECT stock, image, category, icon FROM items WHERE class_id = ? AND background_id IS NULL').get('class')).toEqual({ stock: -1, image: null, category: 'other', icon: 'gift' })
      expect(db.prepare('SELECT stock_deducted FROM redemptions').get()).toEqual({ stock_deducted: 0 })
      expect(db.prepare('SELECT class_id, user_id FROM class_members').all()).toEqual([{ class_id: 'class', user_id: 'teacher' }])
      expect(db.prepare('SELECT display_name, subject, teaching_role FROM users').get()).toEqual({ display_name: '', subject: '', teaching_role: '' })
      expect(db.prepare('SELECT actor_user_id, actor_name, actor_subject FROM evaluations').all().every(row => (row as { actor_user_id: unknown }).actor_user_id === null && (row as { actor_name: string }).actor_name === '' && (row as { actor_subject: string }).actor_subject === '')).toBe(true)
      expect(db.pragma('foreign_key_check')).toEqual([])
      const before = db.prepare('SELECT * FROM badges ORDER BY id').all(), resources = db.prepare('SELECT * FROM settings_versions ORDER BY id').all()
      db.close()
      const reopened = createDatabase(legacy.path)
      try {
        expect(reopened.prepare('SELECT * FROM badges ORDER BY id').all()).toEqual(before)
        expect(reopened.prepare('SELECT * FROM settings_versions ORDER BY id').all()).toEqual(resources)
        expect(reopened.prepare('SELECT * FROM class_members').all()).toHaveLength(1)
      } finally { reopened.close() }
    } finally { if (db.open) db.close() }
  })
  it('中途失败会连同表重建一起回滚，保留原版本和数据', () => {
    const legacy = legacyDatabase()
    legacy.db.exec('ALTER TABLE items ADD COLUMN description TEXT')
    legacy.db.close()
    expect(() => createDatabase(legacy.path)).toThrow()
    const check = new Database(legacy.path)
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(1)
      expect(check.prepare('SELECT * FROM badges').all()).toHaveLength(1)
      expect((check.pragma('table_info(badges)') as { name: string }[]).some(column => column.name === 'level')).toBe(false)
      expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'badges_v1'").get()).toBeUndefined()
      expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'class_members'").get()).toBeUndefined()
    } finally { check.close() }
  })
  it('真实v2数据库升级保留徽章并补齐有序成长事件', () => {
    const legacy = legacyDatabase()
    versionTwoFixture(legacy.db)
    legacy.db.close()
    const db = createDatabase(legacy.path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8)
      expectBackgroundDefaults(db)
      expect(db.prepare('SELECT amount, active, source_event FROM badges WHERE id = ?').get('original-badge')).toMatchObject({ amount: 1, active: 1, source_event: expect.any(String) })
      expect(db.prepare('SELECT kind FROM growth_events WHERE student_id = ? AND generation = 2 ORDER BY seq').all('graduate')).toEqual([{ kind: 'start' }, { kind: 'evaluation' }])
      expect(db.prepare('SELECT version FROM settings_versions WHERE class_id = ?').all('class')).toEqual([{ version: 0 }])
      expect(db.prepare('SELECT version FROM settings_versions WHERE class_id IS NULL').all()).toEqual([{ version: 0 }])
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
  it('v3两班复制完整资源链和有限库存，历史ID/seq/小数/奖励不变并按班重映射引用', () => {
    const legacy = versionThreeFixture()
    const beforeStudents = legacy.db.prepare('SELECT * FROM students ORDER BY id').all()
    const beforeBadges = legacy.db.prepare('SELECT * FROM badges ORDER BY id').all()
    const beforeEvents = legacy.db.prepare('SELECT * FROM growth_events ORDER BY seq').all() as { settings_id: string }[]
    const beforeRedemptions = legacy.db.prepare('SELECT * FROM redemptions ORDER BY id').all() as { item_id: string }[]
    const templates = legacy.db.prepare('SELECT * FROM settings_versions ORDER BY version').all()
    const oldItems = legacy.db.prepare('SELECT * FROM items ORDER BY id').all() as Record<string, unknown>[]
    legacy.db.close()
    const db = createDatabase(legacy.path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8)
      expectBackgroundDefaults(db)
      expect(db.prepare('SELECT * FROM students ORDER BY id').all()).toEqual(withFestivalBackground(withBackground(beforeStudents)))
      expect(db.prepare('SELECT * FROM badges ORDER BY id').all()).toEqual(beforeBadges)
      expect(db.prepare('SELECT id,owner_id,version,value,created_at FROM settings_versions WHERE class_id IS NULL ORDER BY version').all()).toEqual(templates)
      const events = db.prepare('SELECT * FROM growth_events ORDER BY seq').all() as { settings_id: string }[]
      expect(events.map(({ settings_id, ...row }) => row)).toEqual(beforeEvents.map(({ settings_id, ...row }) => row))
      expect(events.every((event, i) => event.settings_id !== beforeEvents[i].settings_id)).toBe(true)
      const redemptions = db.prepare('SELECT id,student_id,item_id,item_name,cost,created_at,undone,stock_deducted FROM redemptions ORDER BY id').all() as { item_id: string }[]
      expect(redemptions.map(({ item_id, ...row }) => row)).toEqual(beforeRedemptions.map(({ item_id, ...row }) => row))
      expect(redemptions.every((row, i) => row.item_id !== beforeRedemptions[i].item_id)).toBe(true)
      for (const classId of ['class', 'class-2']) {
        expect(db.prepare('SELECT version,value FROM settings_versions WHERE class_id = ? ORDER BY version').all(classId)).toEqual((templates as { version: number; value: string }[]).map(({ version, value }) => ({ version, value })))
        expect(db.prepare('SELECT name,points,category,custom FROM rules WHERE class_id = ?').all(classId)).toEqual([{ name: '{"zh":"旧规则","en":"Legacy rule"}', points: 3, category: 'study', custom: 1 }])
        expect(db.prepare('SELECT active,stock FROM items WHERE class_id = ? AND background_id IS NULL ORDER BY active DESC').all(classId)).toEqual([{ active: 1, stock: 2 }, { active: 0, stock: 0 }])
        const copiedItems = db.prepare('SELECT * FROM items WHERE class_id = ? AND background_id IS NULL ORDER BY active, name').all(classId) as Record<string, unknown>[]
        expect(copiedItems.map(({ id, class_id, ...row }) => row)).toEqual(oldItems.map(({ id, ...row }) => row).sort((a, b) => Number(a.active) - Number(b.active) || String(a.name).localeCompare(String(b.name))).map(row => ({ ...row, background_id: null })))
        expect(copiedItems.every(item => !oldItems.some(original => original.id === item.id))).toBe(true)
      }
      expect(db.prepare('SELECT class_id,user_id FROM class_members ORDER BY class_id').all()).toEqual([{ class_id: 'class', user_id: 'teacher' }, { class_id: 'class-2', user_id: 'teacher' }])
      expect(db.prepare('SELECT e.id FROM growth_events e JOIN students s ON s.id = e.student_id JOIN settings_versions v ON v.id = e.settings_id WHERE v.class_id != s.class_id OR v.class_id IS NULL').all()).toEqual([])
      expect(db.prepare('SELECT r.id FROM redemptions r JOIN students s ON s.id = r.student_id JOIN items i ON i.id = r.item_id WHERE i.class_id != s.class_id OR i.class_id IS NULL').all()).toEqual([])
      expect(db.prepare('SELECT actor_user_id,undone_by_user_id,actor_name,undone_by_name FROM redemptions').all()).toEqual(expect.arrayContaining([{ actor_user_id: null, undone_by_user_id: null, actor_name: '', undone_by_name: '' }]))
      const latest = db.prepare('SELECT * FROM settings_versions WHERE class_id = ? ORDER BY version DESC LIMIT 1').get('class') as { owner_id: string; value: string }
      expect(() => db.prepare('INSERT INTO settings_versions (id,owner_id,version,value,created_at,class_id) VALUES (?, ?, 2, ?, 100, ?)').run('next-class', latest.owner_id, latest.value, 'class')).not.toThrow()
      expect(() => db.prepare('INSERT INTO settings_versions (id,owner_id,version,value,created_at,class_id) VALUES (?, ?, 2, ?, 100, ?)').run('next-class-2', latest.owner_id, latest.value, 'class-2')).not.toThrow()
      expect(() => db.prepare('INSERT INTO settings_versions (id,owner_id,version,value,created_at,class_id) VALUES (?, ?, 2, ?, 100, NULL)').run('next-template', latest.owner_id, latest.value)).not.toThrow()
      expect(() => db.prepare('INSERT INTO settings_versions (id,owner_id,version,value,created_at,class_id) VALUES (?, ?, 2, ?, 100, NULL)').run('duplicate-template', latest.owner_id, latest.value)).toThrow()
      expect(() => db.prepare('INSERT INTO settings_versions (id,owner_id,version,value,created_at,class_id) VALUES (?, ?, 2, ?, 100, ?)').run('duplicate', latest.owner_id, latest.value, 'class')).toThrow()
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
  it.each([1, 2, 3] as const)('v%s物理删除商品留下的历史兑换迁移为空引用，双班不误关联且可导出恢复及退款', async version => {
    const legacy = version === 3 ? versionThreeFixture() : legacyDatabase()
    if (version === 2) versionTwoFixture(legacy.db)
    if (version < 3) legacy.db.exec(`
      INSERT INTO classes VALUES ('class-2', 'teacher', '另一个原班级', 2);
      INSERT INTO students (id,class_id,name,created_at) VALUES ('second','class-2','另班学生',2);
    `)
    if (version >= 2) legacy.db.prepare('UPDATE redemptions SET stock_deducted = 0 WHERE id = ?').run('spent')
    legacy.db.prepare('INSERT INTO redemptions (id,student_id,item_id,item_name,cost,created_at,undone) VALUES (?, ?, ?, ?, 2, 80, 1)').run('orphan-undone', 'second', 'reward', JSON.stringify({ zh: '原商品退款记录', en: 'Original refunded reward' }))
    legacy.db.prepare('DELETE FROM items WHERE id = ?').run('reward')
    legacy.db.prepare('INSERT INTO items (id,owner_id,name,cost,active) VALUES (?, ?, ?, 1, 1)').run('replacement-reward', 'teacher', JSON.stringify({ zh: '奖励', en: 'Reward' }))
    if (version >= 2) legacy.db.prepare('UPDATE items SET stock = 5 WHERE id = ?').run('replacement-reward')
    const historicalColumns = 'id,student_id,item_name,cost,created_at,undone'
    const originalHistory = legacy.db.prepare(`SELECT ${historicalColumns} FROM redemptions ORDER BY id`).all()
    const originalStudents = withFestivalBackground(withBackground(legacy.db.prepare('SELECT * FROM students ORDER BY id').all()))
    legacy.db.close()
    const db = createDatabase(legacy.path), garden = new Garden(db)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8)
      expectBackgroundDefaults(db)
      expect(db.prepare(`SELECT ${historicalColumns} FROM redemptions ORDER BY id`).all()).toEqual(originalHistory)
      expect(db.prepare('SELECT * FROM students ORDER BY id').all()).toEqual(originalStudents)
      expect(db.prepare("SELECT id,item_id,stock_deducted FROM redemptions WHERE id IN ('spent','orphan-undone') ORDER BY id").all()).toEqual([
        { id: 'orphan-undone', item_id: null, stock_deducted: 0 },
        { id: 'spent', item_id: null, stock_deducted: 0 }
      ])
      expect(db.prepare('SELECT r.id FROM redemptions r JOIN students s ON s.id = r.student_id JOIN items i ON i.id = r.item_id WHERE i.class_id IS NULL OR i.class_id != s.class_id').all()).toEqual([])
      expect(db.prepare('SELECT id FROM items WHERE name = ? AND class_id IS NOT NULL').all(JSON.stringify({ zh: '奖励', en: 'Reward' }))).toHaveLength(2)
      if (version === 3) expect(db.prepare('SELECT i.active,i.stock,i.class_id FROM redemptions r JOIN items i ON i.id = r.item_id WHERE r.id = ?').get('second-spent')).toEqual({ active: 0, stock: 0, class_id: 'class-2' })
      garden.saveProfile('teacher', { displayName: '历史教师', subject: '语文', teachingRole: 'homeroom' })
      const originalClasses = db.prepare('SELECT * FROM classes ORDER BY id').all()
      const migratedHistory = db.prepare('SELECT * FROM redemptions ORDER BY id').all() as { id: string }[]
      const backup = exportBackup(garden, 'teacher')
      expect(backup.version).toBe(7)
      expect(backup.redemptions.filter(row => ['spent', 'orphan-undone'].includes(row.id)).map(row => row.item_id)).toEqual([null, null])
      const imported = await restoreBackup(garden, 'teacher', backup)
      expect(imported.imported).toBe(2)
      expect(imported.classIds).toHaveLength(2)
      expect(imported.classIds.every(id => !['class', 'class-2'].includes(id))).toBe(true)
      expect(db.prepare("SELECT * FROM classes WHERE id IN ('class','class-2') ORDER BY id").all()).toEqual(originalClasses)
      expect(db.prepare("SELECT * FROM students WHERE class_id IN ('class','class-2') ORDER BY id").all()).toEqual(originalStudents)
      expect(db.prepare("SELECT * FROM redemptions WHERE student_id IN (SELECT id FROM students WHERE class_id IN ('class','class-2')) ORDER BY id").all()).toEqual(migratedHistory)
      expect(garden.snapshot('teacher').classes).toHaveLength(4)
      for (const [index, sourceClass] of backup.classes.entries()) {
        const restored = garden.snapshot('teacher', imported.classIds[index]), original = garden.snapshot('teacher', sourceClass.id)
        const studentValues = (state: typeof restored) => state.students.map(({ name, points, pet_exp, generation, spent_badges }) => ({ name, points, pet_exp, generation, spent_badges })).sort((a, b) => a.name.localeCompare(b.name))
        expect(studentValues(restored)).toEqual(studentValues(original))
        expect(restored.redemptions.map(({ item_name, cost, undone, stock_deducted }) => ({ item_name, cost, undone, stock_deducted }))).toEqual(original.redemptions.map(({ item_name, cost, undone, stock_deducted }) => ({ item_name, cost, undone, stock_deducted })))
      }
      const importedFirstClass = imported.classIds[backup.classes.findIndex(row => row.id === 'class')]
      const importedStudent = garden.snapshot('teacher', importedFirstClass).students.find(row => row.name === '毕业学生')!
      const importedRedemption = garden.snapshot('teacher', importedFirstClass).redemptions.find(row => row.student_id === importedStudent.id && row.undone === 0)!
      expect(db.prepare('SELECT item_id,stock_deducted FROM redemptions WHERE id = ?').get(importedRedemption.id)).toEqual({ item_id: null, stock_deducted: 0 })
      const inventory = db.prepare('SELECT id,class_id,stock,active FROM items ORDER BY id').all()
      for (const [redemptionId, studentId] of [['spent', 'graduate'], [importedRedemption.id, importedStudent.id]]) {
        expect(garden.student('teacher', studentId).spent_badges).toBe(1)
        garden.undoRedemption('teacher', redemptionId)
        expect(garden.student('teacher', studentId).spent_badges).toBe(0)
        expect(db.prepare('SELECT item_id,item_name,cost,undone,stock_deducted FROM redemptions WHERE id = ?').get(redemptionId)).toEqual({ item_id: null, item_name: JSON.stringify({ zh: '奖励', en: 'Reward' }), cost: 1, undone: 1, stock_deducted: 0 })
        expect(db.prepare('SELECT id,class_id,stock,active FROM items ORDER BY id').all()).toEqual(inventory)
        expect(() => garden.undoRedemption('teacher', redemptionId)).toThrow('notFound')
      }
      expect(db.prepare('SELECT item_id,item_name,cost,undone FROM redemptions WHERE id = ?').get('orphan-undone')).toEqual({ item_id: null, item_name: JSON.stringify({ zh: '原商品退款记录', en: 'Original refunded reward' }), cost: 2, undone: 1 })
      expect(db.prepare('SELECT r.id FROM redemptions r JOIN students s ON s.id = r.student_id JOIN items i ON i.id = r.item_id WHERE i.class_id IS NULL OR i.class_id != s.class_id').all()).toEqual([])
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
  it('v4复制阶段失败会回滚所有DDL和引用重建', () => {
    const legacy = versionThreeFixture()
    const before = legacy.db.prepare('SELECT * FROM growth_events ORDER BY seq').all()
    legacy.db.exec("CREATE TRIGGER reject_copy BEFORE INSERT ON rules WHEN NEW.id != 'legacy-rule' BEGIN SELECT RAISE(ABORT, 'fixture-copy-failure'); END")
    legacy.db.close()
    expect(() => createDatabase(legacy.path)).toThrow('fixture-copy-failure')
    const db = new Database(legacy.path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(3)
      expect(db.prepare('SELECT * FROM growth_events ORDER BY seq').all()).toEqual(before)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('settings_versions_v4','growth_events_v4','class_members','class_invites')").all()).toEqual([])
      expect((db.pragma('table_info(users)') as { name: string }[]).map(row => row.name)).not.toContain('display_name')
      expect(db.prepare('SELECT COUNT(*) AS n FROM settings_versions').get()).toEqual({ n: 2 })
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
  it('真实v4补null列与逐班逐教师41背景，旧数据/图片/署名不变且重开不重复或重新上架', () => {
    const legacy = versionFourFixture()
    const tables = ['users', 'classes', 'class_members', 'class_invites', 'settings_versions', 'rules', 'students', 'evaluations', 'growth_events', 'badges', 'items', 'redemptions']
    const before = Object.fromEntries(tables.map(table => [table, legacy.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    for (const table of ['students', 'items', 'redemptions']) expect((legacy.db.pragma(`table_info(${table})`) as { name: string }[]).some(row => row.name === 'background_id')).toBe(false)
    legacy.db.close()
    const db = createDatabase(legacy.path)
    let after: Record<string, unknown[]>
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8)
      expectBackgroundDefaults(db)
      for (const table of tables) {
        const rows = db.prepare(`SELECT * FROM ${table}${table === 'items' ? ' WHERE background_id IS NULL' : ''} ORDER BY rowid`).all()
        const expected = ['students', 'items', 'redemptions'].includes(table) ? withBackground(before[table]) : before[table]
        expect(rows).toEqual(table === 'students' ? withFestivalBackground(expected) : expected)
      }
      db.prepare("UPDATE items SET active = 0, cost = 3 WHERE class_id = 'class' AND background_id = 'garden'").run()
      after = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
    const reopened = createDatabase(legacy.path)
    try {
      expect(reopened.pragma('user_version', { simple: true })).toBe(8)
      for (const table of tables) expect(reopened.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(after![table])
      expect(reopened.prepare("SELECT active, cost FROM items WHERE class_id = 'class' AND background_id = 'garden'").get()).toEqual({ active: 0, cost: 3 })
      expect(reopened.prepare('SELECT COUNT(*) AS n FROM items WHERE background_id IS NOT NULL').get()).toEqual({ n: 4 * 41 })
    } finally { reopened.close() }
  })
  it('v5背景初始化中途失败回滚新增字段、已插入背景及版本，保留完整v4原表', () => {
    const legacy = versionFourFixture()
    const tables = legacy.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]
    const before = Object.fromEntries(tables.map(({ name }) => [name, legacy.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]))
    legacy.db.exec("CREATE TRIGGER reject_background_seed BEFORE INSERT ON items WHEN NEW.name LIKE '%星光%' BEGIN SELECT RAISE(ABORT, 'fixture-background-seed-failure'); END")
    legacy.db.close()
    expect(() => createDatabase(legacy.path)).toThrow('fixture-background-seed-failure')
    const db = new Database(legacy.path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(4)
      for (const { name } of tables) expect(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).toEqual(before[name])
      for (const table of ['students', 'items', 'redemptions']) expect((db.pragma(`table_info(${table})`) as { name: string }[]).some(row => row.name === 'background_id')).toBe(false)
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
  it('真实v4经v5/v6/v7时依次只插原四/28节日/9国内节日，不从实时目录扩大旧迁移', () => {
    const legacy = versionFourFixture()
    legacy.db.exec(`
      CREATE TABLE fixture_background_seed_audit (item_id TEXT NOT NULL, schema_version INTEGER NOT NULL);
      CREATE TRIGGER fixture_audit_background_seed AFTER INSERT ON items BEGIN
        INSERT INTO fixture_background_seed_audit SELECT NEW.id, user_version FROM pragma_user_version;
      END;
    `)
    legacy.db.close()
    const db = createDatabase(legacy.path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(8)
      expect(db.prepare('SELECT schema_version, COUNT(*) AS n FROM fixture_background_seed_audit GROUP BY schema_version ORDER BY schema_version').all()).toEqual([{ schema_version: 4, n: 4 * 4 }, { schema_version: 5, n: 4 * 28 }, { schema_version: 6, n: 4 * 9 }])
      const seeded = (version: number) => (db.prepare('SELECT DISTINCT i.background_id FROM fixture_background_seed_audit a JOIN items i ON i.id = a.item_id WHERE a.schema_version = ? ORDER BY i.background_id').all(version) as { background_id: string }[]).map(row => row.background_id)
      expect(seeded(4)).toEqual([...versionFiveBackgroundIds].sort())
      expect(seeded(5)).toEqual([...holidayBackgroundIds].sort())
      expect(seeded(6)).toEqual([...versionSevenBackgroundIds].sort())
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
  it('真实v5升级按阶段追加28+9，原四缺失/下架/班价/持有装备不变，无班用户模板也补且v7重开不补回删除项', () => {
    const legacy = versionFiveFixture(), db = legacy.db
    expect(db.pragma('user_version', { simple: true })).toBe(5)
    expect(db.prepare('SELECT DISTINCT background_id FROM items WHERE background_id IS NOT NULL ORDER BY background_id').all()).toEqual([...versionFiveBackgroundIds].sort().map(background_id => ({ background_id })))
    const ownedItem = v5BackgroundItemId('teacher', 'class', 'garden')
    db.prepare('INSERT INTO redemptions (id, student_id, item_id, item_name, cost, created_at, background_id, actor_user_id, actor_name, actor_subject) SELECT ?, ?, id, name, 1, 90, background_id, owner_id, ?, ? FROM items WHERE id = ?').run('v5-owned-garden', 'regressed', '历史v5教师', '科学', ownedItem)
    db.prepare("UPDATE students SET background_id = 'garden', spent_badges = 1 WHERE id = 'regressed'").run()
    db.prepare('UPDATE items SET active = 0, cost = 3 WHERE id = ?').run(ownedItem)
    db.prepare('UPDATE items SET cost = 5 WHERE id = ?').run(v5BackgroundItemId('teacher', 'class', 'starlight'))
    for (const id of [v5BackgroundItemId('teacher', 'class', 'beach'), v5BackgroundItemId('teacher', null, 'garden')]) db.prepare('DELETE FROM items WHERE id = ?').run(id)
    db.prepare('UPDATE items SET active = 0, cost = 7 WHERE id = ?').run(v5BackgroundItemId('no-classes', null, 'classroom'))
    const before = databaseRows(db), oldItems = before.items as { id: string }[], oldIds = new Set(oldItems.map(row => row.id))
    db.close()
    const migrated = createDatabase(legacy.path)
    let after: ReturnType<typeof databaseRows>
    try {
      expect(migrated.pragma('user_version', { simple: true })).toBe(8)
      for (const [table, rows] of Object.entries(before)) if (table !== 'items') expect(migrated.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).toEqual(table === 'students' ? withFestivalBackground(rows) : rows)
      const all = migrated.prepare('SELECT * FROM items ORDER BY rowid').all() as { id: string; owner_id: string; class_id: string | null; background_id: string | null; cost: number; active: number; stock: number; image: string | null; category: string }[]
      expect(all.filter(row => oldIds.has(row.id))).toEqual(oldItems)
      const added = all.filter(row => !oldIds.has(row.id))
      expect(added).toHaveLength(4 * (28 + 9))
      expect(added.every(row => new Set<string>([...holidayBackgroundIds, ...versionSevenBackgroundIds]).has(row.background_id!) && row.cost === 1 && row.stock === -1 && row.active === 1 && row.image === null && row.category === 'other')).toBe(true)
      expect(added.filter(row => new Set<string>(holidayBackgroundIds).has(row.background_id!))).toHaveLength(4 * 28)
      expect(added.filter(row => new Set<string>(versionSevenBackgroundIds).has(row.background_id!))).toHaveLength(4 * 9)
      for (const [owner, classId] of [['teacher', null], ['no-classes', null], ['teacher', 'class'], ['teacher', 'class-2']] as const) expect(added.filter(row => row.owner_id === owner && row.class_id === classId).map(row => row.background_id).sort()).toEqual([...holidayBackgroundIds, ...versionSevenBackgroundIds].sort())
      expect(migrated.prepare('SELECT background_id, spent_badges FROM students WHERE id = ?').get('regressed')).toEqual({ background_id: 'garden', spent_badges: 1 })
      expect(migrated.prepare('SELECT active, cost FROM items WHERE id = ?').get(ownedItem)).toEqual({ active: 0, cost: 3 })
      expect(migrated.prepare("SELECT id FROM items WHERE class_id = 'class' AND background_id = 'beach'").all()).toEqual([])
      expect(migrated.prepare("SELECT id FROM items WHERE owner_id = 'teacher' AND class_id IS NULL AND background_id = 'garden'").all()).toEqual([])
      migrated.prepare('DELETE FROM items WHERE class_id = ? AND background_id = ?').run('class-2', holidayBackgroundIds[0])
      migrated.prepare('UPDATE items SET active = 0, cost = 6 WHERE owner_id = ? AND class_id IS NULL AND background_id = ?').run('no-classes', holidayBackgroundIds[1])
      after = databaseRows(migrated)
      expect(migrated.pragma('foreign_key_check')).toEqual([])
    } finally { migrated.close() }
    const reopened = createDatabase(legacy.path)
    try { expect(databaseRows(reopened)).toEqual(after!); expect(reopened.pragma('user_version', { simple: true })).toBe(8) } finally { reopened.close() }
  })
  it('v6追加节日中途失败全表回滚并保留真实v5版本及原四状态，重试按28+9升级不补回旧缺失', () => {
    const legacy = versionFiveFixture(), db = legacy.db
    db.prepare('DELETE FROM items WHERE id = ?').run(v5BackgroundItemId('teacher', 'class', 'beach'))
    db.prepare('UPDATE items SET active = 0, cost = 8 WHERE id = ?').run(v5BackgroundItemId('teacher', 'class', 'garden'))
    const before = databaseRows(db), rejected = holidayBackgroundIds[1]
    db.exec(`CREATE TRIGGER reject_holiday_seed BEFORE INSERT ON items WHEN NEW.background_id = '${rejected.replaceAll("'", "''")}' BEGIN SELECT RAISE(ABORT, 'fixture-holiday-seed-failure'); END`)
    db.close()
    expect(() => createDatabase(legacy.path)).toThrow('fixture-holiday-seed-failure')
    const check = new Database(legacy.path)
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(5)
      expect(databaseRows(check)).toEqual(before)
      expect(check.prepare('SELECT DISTINCT background_id FROM items WHERE background_id IS NOT NULL ORDER BY background_id').all()).toEqual([...versionFiveBackgroundIds].sort().map(background_id => ({ background_id })))
      check.exec('DROP TRIGGER reject_holiday_seed')
    } finally { check.close() }
    const retried = createDatabase(legacy.path)
    try {
      expect(retried.pragma('user_version', { simple: true })).toBe(8)
      expect(retried.prepare("SELECT id FROM items WHERE class_id = 'class' AND background_id = 'beach'").all()).toEqual([])
      expect(retried.prepare('SELECT active, cost FROM items WHERE id = ?').get(v5BackgroundItemId('teacher', 'class', 'garden'))).toEqual({ active: 0, cost: 8 })
      const rows = retried.prepare('SELECT background_id FROM items WHERE background_id IS NOT NULL').all() as { background_id: string }[]
      expect(rows.filter(row => new Set<string>(holidayBackgroundIds).has(row.background_id))).toHaveLength(4 * 28)
      expect(rows.filter(row => new Set<string>(versionSevenBackgroundIds).has(row.background_id))).toHaveLength(4 * 9)
    } finally { retried.close() }
  })
  it('真实v6仅追加9国内节日到逐班及无班教师模板，冻结32内的缺失/下架/原价/持有装备不变且重开不复活', () => {
    const legacy = versionSixFixture(), db = legacy.db
    expect(db.pragma('user_version', { simple: true })).toBe(6)
    const frozenIds = [...versionFiveBackgroundIds, ...holidayBackgroundIds]
    expect(db.prepare('SELECT DISTINCT background_id FROM items WHERE background_id IS NOT NULL ORDER BY background_id').all()).toEqual([...frozenIds].sort().map(background_id => ({ background_id })))
    expect(db.prepare('SELECT COUNT(*) AS n FROM items WHERE background_id IS NOT NULL').get()).toEqual({ n: 4 * 32 })
    const gardenItem = v5BackgroundItemId('teacher', 'class', 'garden'), holidayItem = `v6-teacher-class-${holidayBackgroundIds[0]}`
    const insertOwned = db.prepare('INSERT INTO redemptions (id, student_id, item_id, item_name, cost, created_at, background_id, actor_user_id, actor_name, actor_subject) SELECT ?, ?, id, name, ?, 90, background_id, owner_id, ?, ? FROM items WHERE id = ?')
    insertOwned.run('v6-owned-garden', 'regressed', 1, '历史v6教师', '科学', gardenItem)
    insertOwned.run('v6-owned-holiday', 'graduate', 2, '历史v6教师', '科学', holidayItem)
    db.prepare("UPDATE students SET background_id = 'garden', spent_badges = 1 WHERE id = 'regressed'").run()
    db.prepare('UPDATE students SET background_id = ?, spent_badges = 3 WHERE id = ?').run(holidayBackgroundIds[0], 'graduate')
    db.prepare('UPDATE items SET active = 0, cost = 7 WHERE id = ?').run(gardenItem)
    db.prepare('UPDATE items SET active = 0, cost = 8 WHERE id = ?').run(holidayItem)
    db.prepare('UPDATE items SET cost = 5 WHERE id = ?').run(v5BackgroundItemId('teacher', 'class-2', 'starlight'))
    db.prepare('UPDATE items SET cost = 6 WHERE id = ?').run(`v6-no-classes-template-${holidayBackgroundIds[1]}`)
    for (const id of [v5BackgroundItemId('teacher', 'class', 'beach'), v5BackgroundItemId('teacher', null, 'garden'), `v6-teacher-class-2-${holidayBackgroundIds[2]}`, `v6-no-classes-template-${holidayBackgroundIds[3]}`]) db.prepare('DELETE FROM items WHERE id = ?').run(id)
    const before = databaseRows(db), oldItems = before.items as { id: string }[], oldIds = new Set(oldItems.map(row => row.id))
    db.close()
    const migrated = createDatabase(legacy.path)
    let after: ReturnType<typeof databaseRows>
    try {
      expect(migrated.pragma('user_version', { simple: true })).toBe(8)
      for (const [table, rows] of Object.entries(before)) if (table !== 'items') expect(migrated.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).toEqual(table === 'students' ? withFestivalBackground(rows) : rows)
      const all = migrated.prepare('SELECT * FROM items ORDER BY rowid').all() as { id: string; owner_id: string; class_id: string | null; background_id: string | null; cost: number; active: number; stock: number; image: string | null; image_key: string | null; image_bytes: number; category: string }[]
      expect(all.filter(row => oldIds.has(row.id))).toEqual(oldItems)
      const added = all.filter(row => !oldIds.has(row.id))
      expect(added).toHaveLength(4 * 9)
      expect(added.every(row => new Set<string>(versionSevenBackgroundIds).has(row.background_id!) && row.cost === 1 && row.stock === -1 && row.active === 1 && row.image === null && row.image_key === null && row.image_bytes === 0 && row.category === 'other')).toBe(true)
      for (const [owner, classId] of [['teacher', null], ['no-classes', null], ['teacher', 'class'], ['teacher', 'class-2']] as const) expect(added.filter(row => row.owner_id === owner && row.class_id === classId).map(row => row.background_id).sort()).toEqual([...versionSevenBackgroundIds].sort())
      expect(migrated.prepare("SELECT id FROM items WHERE class_id = 'class' AND background_id = 'beach'").all()).toEqual([])
      expect(migrated.prepare('SELECT id FROM items WHERE class_id = ? AND background_id = ?').all('class-2', holidayBackgroundIds[2])).toEqual([])
      expect(migrated.prepare('SELECT background_id, spent_badges FROM students WHERE id = ?').get('graduate')).toEqual({ background_id: holidayBackgroundIds[0], spent_badges: 3 })
      expect(migrated.prepare('SELECT active, cost FROM items WHERE id = ?').get(holidayItem)).toEqual({ active: 0, cost: 8 })
      migrated.prepare('DELETE FROM items WHERE class_id = ? AND background_id = ?').run('class', versionSevenBackgroundIds[0])
      migrated.prepare('UPDATE items SET active = 0, cost = 9 WHERE owner_id = ? AND class_id IS NULL AND background_id = ?').run('no-classes', versionSevenBackgroundIds[1])
      after = databaseRows(migrated)
      expect(migrated.pragma('foreign_key_check')).toEqual([])
    } finally { migrated.close() }
    const reopened = createDatabase(legacy.path)
    try { expect(reopened.pragma('user_version', { simple: true })).toBe(8); expect(databaseRows(reopened)).toEqual(after!) } finally { reopened.close() }
  })
  it.each([5, 6] as const)('真实v%s在v7追加9中途失败时连同前阶段全迁移零写入，重试保留旧缺失和下架', version => {
    const legacy = version === 5 ? versionFiveFixture() : versionSixFixture(), db = legacy.db
    db.prepare('DELETE FROM items WHERE id = ?').run(v5BackgroundItemId('teacher', 'class', 'beach'))
    db.prepare('UPDATE items SET active = 0, cost = 8 WHERE id = ?').run(v5BackgroundItemId('teacher', 'class', 'garden'))
    const rejected = versionSevenBackgroundIds[1]
    db.exec(`CREATE TRIGGER reject_v7_seed BEFORE INSERT ON items WHEN NEW.background_id = '${rejected.replaceAll("'", "''")}' BEGIN SELECT RAISE(ABORT, 'fixture-v7-seed-failure'); END`)
    const before = databaseRows(db), schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all()
    db.close()
    expect(() => createDatabase(legacy.path)).toThrow('fixture-v7-seed-failure')
    const check = new Database(legacy.path)
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(version)
      expect(databaseRows(check)).toEqual(before)
      expect(check.prepare('SELECT * FROM sqlite_master ORDER BY name').all()).toEqual(schema)
      expect(check.pragma('foreign_key_check')).toEqual([])
      check.exec('DROP TRIGGER reject_v7_seed')
    } finally { check.close() }
    const retried = createDatabase(legacy.path)
    try {
      expect(retried.pragma('user_version', { simple: true })).toBe(8)
      expect(retried.prepare("SELECT id FROM items WHERE class_id = 'class' AND background_id = 'beach'").all()).toEqual([])
      expect(retried.prepare('SELECT active, cost FROM items WHERE id = ?').get(v5BackgroundItemId('teacher', 'class', 'garden'))).toEqual({ active: 0, cost: 8 })
      const rows = retried.prepare('SELECT background_id FROM items WHERE background_id IS NOT NULL').all() as { background_id: string }[]
      expect(rows.filter(row => new Set<string>(holidayBackgroundIds).has(row.background_id))).toHaveLength(4 * 28)
      expect(rows.filter(row => new Set<string>(versionSevenBackgroundIds).has(row.background_id))).toHaveLength(4 * 9)
      expect(retried.pragma('foreign_key_check')).toEqual([])
    } finally { retried.close() }
  })
  it('真实v7到v8只补两个空临时列，原价格/下架/删除/拥有/长期背景与全表不变且重开幂等', () => {
    const legacy = versionSevenFixture(), db = legacy.db
    expect((db.pragma('table_info(students)') as { name: string }[]).map(row => row.name)).not.toContain('festival_background_id')
    const itemId = v5BackgroundItemId('teacher', 'class', 'garden')
    db.prepare('INSERT INTO redemptions (id, student_id, item_id, item_name, cost, created_at, background_id, actor_user_id, actor_name, actor_subject) SELECT ?, ?, id, name, 1, 90, background_id, owner_id, ?, ? FROM items WHERE id = ?').run('v7-owned-garden', 'regressed', '历史v7教师', '科学', itemId)
    db.prepare("UPDATE students SET background_id = 'garden', spent_badges = 1 WHERE id = 'regressed'").run()
    db.prepare('UPDATE items SET active = 0, cost = 8 WHERE id = ?').run(itemId)
    db.prepare('DELETE FROM items WHERE class_id = ? AND background_id = ?').run('class-2', 'diwali')
    const before = databaseRows(db)
    db.close()
    const migrated = createDatabase(legacy.path)
    let after: ReturnType<typeof databaseRows>
    try {
      expect(migrated.pragma('user_version', { simple: true })).toBe(8)
      for (const [table, rows] of Object.entries(before)) expect(migrated.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).toEqual(table === 'students' ? withFestivalBackground(rows) : rows)
      const columns = migrated.pragma('table_info(students)') as { name: string; type: string; dflt_value: unknown }[]
      expect(columns.slice(-2)).toMatchObject([{ name: 'festival_background_id', type: 'TEXT', dflt_value: null }, { name: 'festival_background_expires_at', type: 'INTEGER', dflt_value: null }])
      expect(migrated.pragma('foreign_key_check')).toEqual([])
      migrated.prepare('UPDATE students SET festival_background_id = ?, festival_background_expires_at = ? WHERE id = ?').run('national-day', Date.UTC(2026, 9, 1, 16), 'regressed')
      after = databaseRows(migrated)
    } finally { migrated.close() }
    const reopened = createDatabase(legacy.path)
    try {
      expect(reopened.pragma('user_version', { simple: true })).toBe(8)
      expect(databaseRows(reopened)).toEqual(after!)
    } finally { reopened.close() }
  })
  it('两个数据库连接同时排队兑换同背景只有一次扣费，退款后另一连接可重兑', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'garden-background-concurrency-'))
    directories.push(directory)
    const path = join(directory, 'shared.db'), first = new Garden(createDatabase(path))
    let second: Garden | undefined
    try {
      const owner = first.register({ username: 'concurrent-background', password: 'Concurrent-test-password' }).user.id
      first.saveProfile(owner, { displayName: '并发测试教师', subject: '科学', teachingRole: 'homeroom' })
      const classId = first.createClass(owner, { name: '并发背景班' }).id
      const studentId = first.addStudents(owner, { classId, students: [{ name: '并发背景学生' }] })[0]
      first.adopt(owner, studentId, { petId: 'panda' })
      first.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
      const itemId = first.snapshot(owner, classId).items.find(item => item.background_id === 'garden')!.id
      second = new Garden(createDatabase(path))
      const requests = await Promise.allSettled([first, second].map(connection => Promise.resolve().then(() => connection.redeem(owner, { studentId, itemId }))))
      expect(requests.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect((requests.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'backgroundAlreadyOwned', status: 409 })
      expect(first.snapshot(owner, classId).students[0]).toMatchObject({ spent_badges: 1, owned_background_ids: ['garden'] })
      expect(second.snapshot(owner, classId).redemptions).toHaveLength(1)
      first.setBackground(owner, studentId, { backgroundId: 'garden' })
      second.undoRedemption(owner, second.snapshot(owner, classId).redemptions[0].id)
      expect(() => first.setBackground(owner, studentId, { backgroundId: 'garden' })).toThrow('backgroundNotOwned')
      first.redeem(owner, { studentId, itemId })
      expect(second.snapshot(owner, classId).students[0]).toMatchObject({ background_id: null, spent_badges: 1, owned_background_ids: ['garden'] })
    } finally { second?.db.close(); first.db.close() }
  })
  it('不会把更高版本的数据库降级', () => {
    const legacy = legacyDatabase()
    legacy.db.pragma('user_version = 9')
    legacy.db.close()
    expect(() => createDatabase(legacy.path)).toThrow('数据库版本高于当前应用版本')
    const check = new Database(legacy.path)
    try { expect(check.pragma('user_version', { simple: true })).toBe(9) } finally { check.close() }
  })
})
