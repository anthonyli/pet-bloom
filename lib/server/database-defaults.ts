import { randomUUID } from 'node:crypto'
import { petBackgrounds } from '../pet-backgrounds'
import type { ApplicationDatabase, Statement } from './database-adapter'

export async function copyClassDefaults(db: ApplicationDatabase, owner: string, classId: string) {
  const statements: Statement[] = []
  for (const [table, columns] of [
    ['settings_versions', 'owner_id, version, value, created_at'],
    ['rules', 'owner_id, name, points, category, custom'],
    ['items', 'owner_id, name, cost, active, description, category, icon, image, image_key, image_bytes, stock, background_id']
  ]) {
    const rows = await db.prepare(`SELECT id FROM ${table} WHERE owner_id = ? AND class_id IS NULL ORDER BY rowid`).all(owner) as { id: string }[]
    for (const row of rows) statements.push({
      sql: `INSERT INTO ${table} (id, class_id, ${columns}) SELECT ?, ?, ${columns} FROM ${table} WHERE id = ?`,
      args: [randomUUID(), classId, row.id]
    })
  }
  await db.batch(statements)
}

export async function initializeBackgroundItems(db: ApplicationDatabase, owner: string, classId: string | null = null, ids: readonly string[] = petBackgrounds.map(background => background.id)) {
  await db.batch(petBackgrounds.filter(value => ids.includes(value.id)).map(background => ({
    sql: 'INSERT OR IGNORE INTO items (id, owner_id, class_id, name, cost, active, description, category, icon, stock, background_id) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, -1, ?)',
    args: [randomUUID(), owner, classId, JSON.stringify(background.name), JSON.stringify(background.description), 'other', 'gift', background.id]
  })))
}
