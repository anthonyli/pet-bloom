import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, chmod, open, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const marker = '_pet_bloom_schema'
const journal = '_pet_bloom_migrations'
const guard = '_pet_bloom_migration_guard'
const counts = '_pet_bloom_migration_counts'
const quote = value => `"${value.replaceAll('"', '""')}"`
export class MigrationError extends Error {}
const assert = (condition, message) => { if (!condition) throw new MigrationError(message) }
const hash = value => createHash('sha256').update(value).digest('hex')
const stringify = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? Number(v) : v)
const schemaQuery = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name"
const isBusiness = name => ![marker, journal].includes(name)

// Intentionally small SQL grammar: one statement, no comments, no data writes,
// no triggers, no renames or drops. Quoted literals may contain semicolons.
export function validateExpansion(sql) {
  assert(typeof sql === 'string', '迁移 SQL 必须是文本 / Migration SQL must be text')
  const tokens = sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|\b[A-Za-z_][A-Za-z_0-9]*\b|\s+|./gs) ?? []
  const code = tokens.filter(token => !/^\s+$/.test(token))
  if (code.at(-1) === ';') code.pop()
  assert(!code.includes(';') && !code.some((token, i) => (token === '-' && code[i + 1] === '-') || (token === '/' && code[i + 1] === '*')),
    '只允许单条无注释 SQL / Only one uncommented SQL statement is allowed')
  // Identifiers must be plain identifiers. This also protects migration metadata.
  const identifier = '[A-Za-z][A-Za-z_0-9]*'
  const plain = code.join(' ')
  const allowed = new RegExp(`^(CREATE TABLE ${identifier} \\(|CREATE (UNIQUE )?INDEX ${identifier} ON ${identifier} \\(|ALTER TABLE ${identifier} ADD COLUMN ${identifier} (TEXT|INTEGER|REAL|BLOB)\\b)`, 'i')
  assert(allowed.test(plain), '自动迁移只允许新增表、索引或字段 / Automatic migrations only allow additive DDL')
  assert(!code.some(token => /^['"]/.test(token) ? /^"(?:_pet_bloom_|sqlite_)/i.test(token) : /^(?:_pet_bloom_|sqlite_)/i.test(token)),
    '迁移不能操作版本元数据 / Migration metadata is reserved')
  // A new column must be optional for old application writes. Restrict its
  // definition to a nullable type and optional literal default; no constraints.
  if (/^ALTER /i.test(plain)) {
    const literal = "(?:NULL|[-+]? ?[0-9]+(?: \\. [0-9]+)?|'(?:''|[^'])*')"
    assert(new RegExp(`^ALTER TABLE ${identifier} ADD COLUMN ${identifier} (TEXT|INTEGER|REAL|BLOB)( DEFAULT ${literal})?$`, 'i').test(plain),
      '新增字段必须兼容旧版本写入 / New columns must be nullable with an optional literal default')
  }
  return sql
}

export async function loadMigrations(directory, currentVersion) {
  const names = (await readdir(directory)).filter(name => /^\d{3,}-[a-z0-9-]+\.json$/.test(name)).sort()
  const migrations = []
  for (const filename of names) {
    const raw = await readFile(path.join(directory, filename), 'utf8')
    const migration = JSON.parse(raw)
    assert(migration.version === Number(filename.split('-')[0]), '迁移文件名与版本不符 / Migration filename/version mismatch')
    assert(migration.version === 8 + migrations.length, '迁移版本必须从 v8 连续递增 / Migration versions must be contiguous from v8')
    assert(typeof migration.name === 'string' && migration.name.length > 0, '迁移缺少名称 / Missing migration name')
    if (!migrations.length) {
      assert(migration.kind === 'baseline' && Array.isArray(migration.schema), '缺少 v8 基线 / Missing v8 baseline')
    } else {
      assert(migration.kind === 'expand' && migration.statements?.length > 0, '迁移必须声明 expand / Migration must declare expand')
      migration.statements.forEach(validateExpansion)
    }
    migrations.push({ ...migration, checksum: hash(raw), filename })
  }
  assert(migrations.at(-1)?.version === currentVersion, '代码版本与迁移目录不一致 / Code schema version and migrations disagree')
  // Check that every new DDL statement is valid against all earlier schemas.
  expectedSchema(migrations, currentVersion)
  return migrations
}

export function expectedSchema(migrations, version) {
  const db = new Database(':memory:')
  try {
    // Tables before indexes; FK enforcement is not needed for empty schema creation.
    for (const object of [...migrations[0].schema].sort((a, b) => (a.type === 'table' ? 0 : 1) - (b.type === 'table' ? 0 : 1))) db.exec(object.sql)
    for (const migration of migrations.slice(1).filter(item => item.version <= version)) {
      for (const sql of migration.statements) { validateExpansion(sql); db.exec(sql) }
    }
    return db.prepare(schemaQuery).all()
  } finally { db.close() }
}

// sqlite_master preserves SQL formatting; normalization is only used for schema
// comparison. Quoted string values retain their exact whitespace.
function canonicalSql(sql) {
  return sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|\S+/g)?.join(' ').trim().replace(/;$/, '')
}
const canonicalSchema = objects => stringify(objects.filter(item => isBusiness(item.name)).map(item => ({ ...item, sql: canonicalSql(item.sql) })))

export async function inspectState(client, migrations) {
  const schema = (await client.execute(schemaQuery)).rows.map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql }))
  assert(schema.some(item => item.name === marker), '云库缺少 v8 标记；禁止自动初始化已有库 / Missing v8 marker; refusing implicit initialization')
  const statements = [`SELECT id,version FROM ${marker}`]
  const hasJournal = schema.some(item => item.name === journal)
  if (hasJournal) statements.push(`SELECT version,name,checksum FROM ${journal} ORDER BY version`)
  const results = await client.batch(statements, 'read')
  const rows = results[0].rows
  assert(rows.length === 1 && Number(rows[0].id) === 1, '数据库版本标记异常 / Invalid schema marker')
  const version = Number(rows[0].version)
  assert(Number.isInteger(version) && version >= 8 && version <= migrations.at(-1).version,
    '数据库版本不受当前代码支持，禁止降级 / Unsupported database version; downgrades are forbidden')
  const history = hasJournal ? results[1].rows.map(row => ({ version: Number(row.version), name: row.name, checksum: row.checksum })) : []
  if (!hasJournal) assert(version === 8, '只有 v8 可以接管为基线 / Only v8 may be adopted as a baseline')
  else {
    const applied = migrations.filter(item => item.version <= version)
    assert(history.length === applied.length && history.every((row, i) => row.version === applied[i].version && row.name === applied[i].name && row.checksum === applied[i].checksum),
      '迁移历史缺失或校验和改变 / Migration history is missing or its checksums changed')
  }
  assert(canonicalSchema(schema) === canonicalSchema(expectedSchema(migrations, version)),
    '实际表结构与迁移记录不符 / Database schema drift detected')
  return { schema, version, history, pending: migrations.filter(item => !history.some(row => row.version === item.version)) }
}

// Use one server-side write batch, avoiding long interactive transactions over
// the network. Assertions abort the same transaction as DDL and version updates.
export function migrationBatch(state) {
  const statements = [{ sql: `CREATE TABLE ${guard} (ok INTEGER NOT NULL CHECK(ok = 1))`, args: [] }]
  const check = (condition, args = []) => statements.push({ sql: `INSERT INTO ${guard} SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END`, args })
  check(`(SELECT COUNT(*) FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != ?) = ?`, [guard, state.schema.length])
  for (const item of state.schema) check('(SELECT COUNT(*) FROM sqlite_master WHERE type=? AND name=? AND sql=?) = 1', [item.type, item.name, item.sql])
  check(`(SELECT COUNT(*) FROM ${marker}) = 1 AND (SELECT version FROM ${marker} WHERE id=1) = ?`, [state.version])
  if (state.history.length) {
    check(`(SELECT COUNT(*) FROM ${journal}) = ?`, [state.history.length])
    for (const item of state.history) check(`(SELECT COUNT(*) FROM ${journal} WHERE version=? AND name=? AND checksum=?) = 1`, [item.version, item.name, item.checksum])
  }
  statements.push({ sql: `CREATE TABLE IF NOT EXISTS ${journal} (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)`, args: [] })
  statements.push({ sql: `CREATE TABLE ${counts} (name TEXT PRIMARY KEY, total INTEGER NOT NULL)`, args: [] })
  const tables = state.schema.filter(item => item.type === 'table' && isBusiness(item.name))
  for (const table of tables) statements.push({ sql: `INSERT INTO ${counts} SELECT ?,COUNT(*) FROM ${quote(table.name)}`, args: [table.name] })
  for (const migration of state.pending) {
    if (migration.kind !== 'baseline') for (const sql of migration.statements) statements.push({ sql: validateExpansion(sql), args: [] })
    statements.push({ sql: `INSERT INTO ${journal} (version,name,checksum,applied_at) VALUES (?,?,?,?)`, args: [migration.version, migration.name, migration.checksum, Date.now()] })
  }
  for (const table of tables) check(`(SELECT COUNT(*) FROM ${quote(table.name)}) = (SELECT total FROM ${counts} WHERE name=?)`, [table.name])
  check('(SELECT COUNT(*) FROM pragma_foreign_key_check) = 0')
  statements.push({ sql: `UPDATE ${marker} SET version=? WHERE id=1 AND version=?`, args: [state.pending.at(-1).version, state.version] })
  check(`(SELECT version FROM ${marker} WHERE id=1) = ?`, [state.pending.at(-1).version])
  statements.push({ sql: `DROP TABLE ${counts}`, args: [] }, { sql: `DROP TABLE ${guard}`, args: [] })
  assert(Buffer.byteLength(JSON.stringify(statements)) < 900_000 && statements.length <= 500,
    '迁移过大，必须拆分发布 / Migration exceeds the atomic batch budget; split releases')
  return statements
}

function fingerprint(db, table, columns) {
  const digest = createHash('sha256')
  const rowid = ['_rowid_', 'rowid', 'oid'].find(name => !columns.includes(name))
  const withoutRowid = /WITHOUT\s+ROWID/i.test(db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table).sql)
  assert(withoutRowid || rowid, '无法验证隐含 rowid / Cannot verify implicit rowid')
  const names = columns.map(quote)
  const selection = withoutRowid ? names : [rowid, ...names]
  let count = 0
  for (const row of db.prepare(`SELECT ${selection.join(',')} FROM ${quote(table)} ORDER BY ${selection.join(',')}`).raw().safeIntegers().iterate()) {
    digest.update(JSON.stringify(row, (_, value) => typeof value === 'bigint' ? { integer: value.toString() } : Buffer.isBuffer(value) ? { blob: value.toString('base64') } : value) + '\n')
    count++
  }
  return { count, sha256: digest.digest('hex') }
}

export function rehearseBackup(filename, state) {
  const db = new Database(filename, { fileMustExist: true })
  try {
    db.pragma('foreign_keys = ON')
    assert(db.pragma('integrity_check', { simple: true }) === 'ok', '备份完整性检查失败 / Backup integrity check failed')
    assert(db.pragma('foreign_key_check').length === 0, '备份外键检查失败 / Backup foreign key check failed')
    const schema = db.prepare(schemaQuery).all()
    assert(canonicalSchema(schema) === canonicalSchema(state.schema), '备份结构已变化，请重新检查 / Backup schema changed; rerun preflight')
    const tables = schema.filter(item => item.type === 'table' && isBusiness(item.name)).map(item => {
      const columns = db.pragma(`table_xinfo(${quote(item.name)})`).map(row => row.name)
      return { name: item.name, columns, ...fingerprint(db, item.name, columns) }
    })
    // Always roll the rehearsal back: the backup must remain pre-migration.
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const statement of migrationBatch(state)) db.prepare(statement.sql).run(...statement.args)
      for (const table of tables) assert(stringify(fingerprint(db, table.name, table.columns)) === stringify({ count: table.count, sha256: table.sha256 }),
        '迁移演练改变了已有数据 / Rehearsal changed existing data')
      assert(db.pragma('integrity_check', { simple: true }) === 'ok', '迁移后完整性检查失败 / Post-migration integrity check failed')
    } finally { db.exec('ROLLBACK') }
    return tables.map(({ name, count, sha256 }) => ({ name, count, sha256 }))
  } finally { db.close() }
}

export async function createVerifiedBackup({ directory, exportDatabase, state, source }) {
  const folder = path.join(directory, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  await chmod(folder, 0o700)
  const raw = path.join(folder, 'export.db'), snapshot = path.join(folder, 'snapshot.db')
  await exportDatabase(raw)
  // SQLite backup API includes exported WAL frames in one self-contained file.
  const exported = new Database(raw, { fileMustExist: true })
  try { await exported.backup(snapshot) } finally { exported.close() }
  await chmod(snapshot, 0o600)
  const tables = rehearseBackup(snapshot, state)
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(snapshot)) digest.update(chunk)
  const metadata = { source, createdAt: new Date().toISOString(), schemaVersion: state.version, pending: state.pending.map(item => item.version), sha256: digest.digest('hex'), tables }
  await writeFile(path.join(folder, 'manifest.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  for (const filename of [snapshot, path.join(folder, 'manifest.json')]) {
    const handle = await open(filename, 'r+')
    try { await handle.sync() } finally { await handle.close() }
  }
  return { filename: snapshot, ...metadata }
}

export async function migrate(client, migrations, backup) {
  const state = await inspectState(client, migrations)
  if (!state.pending.length) return { version: state.version, applied: [], backup: null }
  // Backup and restore rehearsal must succeed before the first cloud write.
  const snapshot = await backup(state)
  assert(snapshot?.filename && snapshot?.sha256, '未取得已验证备份，迁移中止 / No verified backup; migration aborted')
  await client.batch(migrationBatch(state), 'write')
  const after = await inspectState(client, migrations)
  assert(!after.pending.length, '提交结果尚未确认，请重新检查状态 / Commit outcome unconfirmed; check migration status')
  return { version: after.version, applied: state.pending.map(item => item.version), backup: snapshot.filename }
}
