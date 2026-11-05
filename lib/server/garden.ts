import type { Statement } from './database-adapter'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { adaptDatabase, type ApplicationDatabase } from './database-adapter'
import { z } from 'zod'
import petsData from '../data/pets.json'
import rulesData from '../data/rules.json'
import type { User, Student, Classroom, Rule, Evaluation, ShopItem, Redemption, Snapshot, Badge, TeachingRole, ClassTeachers, InvitationPreview } from '../types'
import { growthLevel, growthProgress, replayEvents, type GrowthEvent, type GrowthEvaluation } from '../growth'
import { defaultGardenSettings, gardenSettingsSchema, type GardenSettings, type SettingsVersion } from '../garden-settings'
import { petStatus } from '../pet-status'
import { MAX_CLASS_IMAGE_BYTES, shopCategoryIds, shopIconIds } from '../shop'
import { teacherProfileSchema } from '../teacher'
import { copyClassDefaults, initializeBackgroundItems } from './database-defaults'
import { petBackgroundById } from '../pet-backgrounds'
import { getFestivalBackgrounds } from './festival-backgrounds'
import { normalizeItemImage } from './item-images'
import { DomainError } from './errors'
import { credentials, credentialError } from '../credentials'
export { credentials } from '../credentials'

function parseCredentials(input: unknown) {
  const result = credentials.safeParse(input)
  if (!result.success) throw new DomainError(credentialError(result.error))
  return result.data
}

const text = z.string().trim().min(1).max(80)
const localized = z.object({ zh: text, en: text })
const category = z.enum(['study', 'behavior', 'health', 'other'])
const petIds = new Set(petsData.map(pet => pet.id))
const itemSchema = z.object({ name: localized, description: z.object({ zh: z.string().trim().max(500), en: z.string().trim().max(500) }).default({ zh: '', en: '' }), cost: z.number().int().min(1).max(100), category: z.enum(shopCategoryIds).default('other'), icon: z.enum(shopIconIds).default('gift'), stock: z.number().int().safe().min(-1).default(-1), image: z.string().nullable().optional() })
export const level = growthLevel
export const progress = growthProgress
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const now = () => Date.now()
const uuid = () => randomUUID()

export class Garden {
  public db: ApplicationDatabase
  constructor(db: Database.Database | ApplicationDatabase) { this.db = adaptDatabase(db) }
  private async latestSettings(owner: string, classId?: string): Promise<SettingsVersion> {
    const row = (classId
      ? (await this.db.prepare('SELECT id, version, value, created_at FROM settings_versions WHERE class_id = ? ORDER BY version DESC LIMIT 1').get(classId))
      : (await this.db.prepare('SELECT id, version, value, created_at FROM settings_versions WHERE owner_id = ? AND class_id IS NULL ORDER BY version DESC LIMIT 1').get(owner))) as Omit<SettingsVersion, 'value'> & { value: string }
    return { ...row, value: gardenSettingsSchema.parse(JSON.parse(row.value)) }
  }
  async settings(actor: string, classId: string): Promise<SettingsVersion> {
    await this.classroom(actor, classId)
    return await this.latestSettings(actor, classId)
  }
  async saveSettings(actor: string, input: unknown) {
    const data = z.object({ classId: text, version: z.number().int().nonnegative(), value: gardenSettingsSchema }).parse(input)
    return await this.db.transaction(async () => {
      const classroom = await this.classroom(actor, data.classId), current = await this.latestSettings(actor, data.classId)
      if (current.version !== data.version) throw new DomainError('settingsChanged', 409)
      const value = { ...data.value, signedGrowth: current.value.signedGrowth || data.value.sickness || data.value.resetToEgg }
      const id = uuid(), version = current.version + 1
      await this.db.prepare('INSERT INTO settings_versions (id, owner_id, version, value, created_at, class_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, classroom.owner_id, version, JSON.stringify(value), now(), data.classId)
      if (current.value.hunger.timeZone !== value.hunger.timeZone) await this.db.prepare('UPDATE students SET festival_background_id = NULL, festival_background_expires_at = NULL WHERE class_id = ?').run(data.classId)
      const students = await this.db.prepare('SELECT * FROM students WHERE class_id = ? AND pet_id IS NOT NULL').all(data.classId) as Student[]
      for (const student of students) {
        await this.addGrowthEvent(student, 'rebase', id)
        await this.recalculate(student.id)
      }
      return { id, version }
    }).immediate()
  }
  private async addGrowthEvent(student: Pick<Student, 'id' | 'generation'>, kind: GrowthEvent['kind'], settingsId: string, evaluationId: string | null = null, petId: string | null = null) {
    const createdAt = kind === 'evaluation' ? (await this.db.prepare('SELECT created_at FROM evaluations WHERE id = ?').get(evaluationId) as { created_at: number }).created_at : now()
    await this.db.prepare('INSERT INTO growth_events (id, student_id, generation, kind, settings_id, evaluation_id, pet_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(uuid(), student.id, student.generation, kind, settingsId, evaluationId, petId, createdAt)
  }
  private async growthHistory(id: string, generation: number) {
    const events = await this.db.prepare('SELECT * FROM growth_events WHERE student_id = ? AND generation = ? ORDER BY seq').all(id, generation) as GrowthEvent[]
    const records = await this.db.prepare('SELECT * FROM evaluations WHERE student_id = ? AND generation = ? ORDER BY rowid').all(id, generation) as GrowthEvaluation[]
    const policies = await this.db.prepare('SELECT DISTINCT v.id, v.value FROM settings_versions v JOIN growth_events e ON e.settings_id = v.id WHERE e.student_id = ? AND e.generation = ?').all(id, generation) as { id: string; value: string }[]
    try {
      return replayEvents(events, new Map(records.map(record => [record.id, record])), new Map(policies.map(policy => [policy.id, JSON.parse(policy.value) as GardenSettings])))
    } catch (error) {
      if (error instanceof Error && (error.message === 'growthHistoryTooLarge' || error.message === 'scoreLimitExceeded')) throw new DomainError(error.message, 409)
      throw error
    }
  }
  async user(id: string): Promise<User> {
    const row = await this.db.prepare('SELECT id, username, display_name, subject, teaching_role FROM users WHERE id = ?').get(id) as Omit<User, 'teaching_role' | 'profile_complete'> & { teaching_role: TeachingRole | '' } | undefined
    if (!row) throw new DomainError('unauthorized', 401)
    return { ...row, teaching_role: row.teaching_role || null, profile_complete: Boolean(row.display_name && row.subject && row.teaching_role) }
  }
  async requireProfile(actor: string) {
    const user = await this.user(actor)
    if (!user.profile_complete) throw new DomainError('profileRequired', 409)
    return user
  }
  async saveProfile(actor: string, input: unknown) {
    const data = teacherProfileSchema.parse(input)
    await this.user(actor)
    await this.db.prepare('UPDATE users SET display_name = ?, subject = ?, teaching_role = ? WHERE id = ?').run(data.displayName, data.subject, data.teachingRole, actor)
    return await this.user(actor)
  }
  async register(input: unknown) {
    const data = parseCredentials(input)
    const id = uuid(), salt = randomBytes(16).toString('hex')
    const password = `${salt}:${scryptSync(data.password, salt, 64).toString('hex')}`
    return await this.db.transaction(async () => {
      if (await this.db.prepare('SELECT id FROM users WHERE username = ?').get(data.username)) throw new DomainError('usernameTaken', 409)
      const statements: Statement[] = []
      statements.push({ sql: 'INSERT INTO users (id, username, password, created_at) VALUES (?, ?, ?, ?)', args: [id, data.username, password, now()] })
      statements.push({ sql: 'INSERT INTO settings_versions (id, owner_id, version, value, created_at) VALUES (?, ?, 0, ?, ?)', args: [uuid(), id, JSON.stringify(defaultGardenSettings()), now()] })
      for (const rule of rulesData) statements.push({ sql: 'INSERT INTO rules (id, owner_id, name, points, category, custom) VALUES (?, ?, ?, ?, ?, 0)', args: [uuid(), id, JSON.stringify(rule.name), rule.points, rule.category] })
      for (const item of [
        { zh: '优先选择座位', en: 'Choose a seat', cost: 1 },
        { zh: '课堂小助手', en: 'Classroom helper', cost: 1 },
        { zh: '自选班级游戏', en: 'Choose a class game', cost: 2 }
      ]) statements.push({ sql: 'INSERT INTO items (id, owner_id, name, cost, active, category, icon) VALUES (?, ?, ?, ?, 1, ?, ?)', args: [uuid(), id, JSON.stringify({ zh: item.zh, en: item.en }), item.cost, item.cost === 2 ? 'entertainment' : 'privilege', item.cost === 2 ? 'gamepad' : 'crown'] })
      await this.db.batch(statements)
      await initializeBackgroundItems(this.db, id)
      return await this.session(id)
    })()
  }
  async login(input: unknown) {
    const { username, password } = parseCredentials(input)
    const user = await this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as { id: string; password: string } | undefined
    // 不存在的账号仍执行哈希，减少账号探测的时序差异
    const [salt, expected] = (user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':')
    const actual = scryptSync(password, salt, 64)
    if (!user || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) throw new DomainError('invalidCredentials', 401)
    return await this.session(user.id)
  }
  async session(userId: string) {
    const token = randomBytes(32).toString('hex')
    await this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now())
    await this.db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(hash(token), userId, now() + 30 * 86400000)
    return { token, user: await this.user(userId) }
  }
  async authenticate(token: string | undefined) {
    if (!token) throw new DomainError('unauthorized', 401)
    const row = await this.db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?').get(hash(token), now()) as { user_id: string } | undefined
    if (!row) throw new DomainError('unauthorized', 401)
    return row.user_id
  }
  async logout(token: string) { await this.db.prepare('DELETE FROM sessions WHERE token = ?').run(hash(token)) }
  async classroom(actor: string, id: string, ownerOnly = false): Promise<Classroom> {
    await this.requireProfile(actor)
    const value = await this.db.prepare("SELECT c.*, CASE WHEN c.owner_id = ? THEN 'owner' ELSE 'admin' END AS role FROM classes c JOIN class_members m ON m.class_id = c.id WHERE c.id = ? AND m.user_id = ?").get(actor, id, actor) as Classroom | undefined
    if (!value) throw new DomainError('notFound', 404)
    if (ownerOnly && value.role !== 'owner') throw new DomainError('forbidden', 403)
    return value
  }
  async student(actor: string, id: string): Promise<Student> {
    const row = await this.db.prepare('SELECT * FROM students WHERE id = ?').get(id) as Student | undefined
    if (!row) throw new DomainError('notFound', 404)
    await this.classroom(actor, row.class_id)
    return row
  }
  async createClass(actor: string, input: unknown) {
    const { name } = z.object({ name: text }).parse(input)
    return await this.db.transaction(async () => {
      await this.requireProfile(actor)
      const id = uuid()
      await this.db.prepare('INSERT INTO classes (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, actor, name, now())
      await this.db.prepare('INSERT INTO class_members (class_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, actor, now())
      await copyClassDefaults(this.db, actor, id)
      return { id }
    }).immediate()
  }
  async renameClass(actor: string, id: string, input: unknown) {
    const { name } = z.object({ name: text }).parse(input)
    await this.db.transaction(async () => {
      await this.classroom(actor, id)
      await this.db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(name, id)
    }).immediate()
  }
  async deleteClass(actor: string, id: string) {
    await this.db.transaction(async () => {
      await this.classroom(actor, id, true)
      await this.db.prepare('DELETE FROM classes WHERE id = ?').run(id)
    }).immediate()
  }
  async classTeachers(actor: string, classId: string): Promise<ClassTeachers> {
    const classroom = await this.classroom(actor, classId)
    const rows = await this.db.prepare("SELECT u.id AS user_id, u.display_name, u.subject, NULLIF(u.teaching_role, '') AS teaching_role, CASE WHEN u.id = ? THEN 'owner' ELSE 'admin' END AS role, m.joined_at FROM class_members m JOIN users u ON u.id = m.user_id WHERE m.class_id = ? ORDER BY u.id = ? DESC, m.joined_at, u.id").all(classroom.owner_id, classId, classroom.owner_id) as ClassTeachers['teachers']
    const invitation = await this.db.prepare('SELECT created_at, expires_at FROM class_invites WHERE class_id = ? AND expires_at > ?').get(classId, now()) as ClassTeachers['invitation'] | undefined
    return { teachers: rows, invitation: invitation || null }
  }
  async createInvitation(actor: string, classId: string) {
    return await this.db.transaction(async () => {
      await this.classroom(actor, classId)
      const raw = randomBytes(12).toString('hex').toUpperCase(), createdAt = now(), expiresAt = createdAt + 7 * 86400000
      await this.db.prepare('INSERT INTO class_invites (class_id, code_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(class_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, created_by = excluded.created_by, created_at = excluded.created_at').run(classId, hash(raw), expiresAt, actor, createdAt)
      return { code: raw.match(/.{4}/g)!.join('-'), expires_at: expiresAt }
    }).immediate()
  }
  async revokeInvitation(actor: string, classId: string) {
    await this.db.transaction(async () => {
      await this.classroom(actor, classId)
      await this.db.prepare('DELETE FROM class_invites WHERE class_id = ?').run(classId)
    }).immediate()
  }
  async previewInvitation(actor: string, input: unknown): Promise<InvitationPreview> {
    await this.requireProfile(actor)
    const { code } = z.object({ code: z.string().trim().max(100).transform(value => value.replace(/[\s-]/g, '').toUpperCase()).pipe(z.string().regex(/^[A-F0-9]{24}$/)) }).parse(input)
    const row = await this.db.prepare('SELECT c.id, c.name, u.display_name AS owner_name, i.expires_at FROM class_invites i JOIN classes c ON c.id = i.class_id JOIN users u ON u.id = c.owner_id WHERE i.code_hash = ? AND i.expires_at > ?').get(hash(code), now()) as Omit<InvitationPreview, 'already_member'> | undefined
    if (!row) throw new DomainError('invalidInvitation', 404)
    return { ...row, already_member: Boolean(await this.db.prepare('SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?').get(row.id, actor)) }
  }
  async joinClass(actor: string, input: unknown) {
    return await this.db.transaction(async () => {
      const invitation = await this.previewInvitation(actor, input)
      await this.db.prepare('INSERT OR IGNORE INTO class_members (class_id, user_id, joined_at) VALUES (?, ?, ?)').run(invitation.id, actor, now())
      return { id: invitation.id }
    }).immediate()
  }
  async removeTeacher(actor: string, classId: string, userId: string) {
    await this.db.transaction(async () => {
      const classroom = await this.classroom(actor, classId, true)
      if (classroom.owner_id === userId) throw new DomainError('cannotRemoveOwner', 409)
      if (!(await this.db.prepare('DELETE FROM class_members WHERE class_id = ? AND user_id = ?').run(classId, userId)).changes) throw new DomainError('memberNotFound', 404)
      await this.db.prepare('DELETE FROM class_invites WHERE class_id = ?').run(classId)
    }).immediate()
  }
  async leaveClass(actor: string, classId: string) {
    await this.db.transaction(async () => {
      const classroom = await this.classroom(actor, classId)
      if (classroom.role === 'owner') throw new DomainError('transferRequired', 409)
      await this.db.prepare('DELETE FROM class_members WHERE class_id = ? AND user_id = ?').run(classId, actor)
    }).immediate()
  }
  async transferClass(actor: string, classId: string, input: unknown) {
    const { userId } = z.object({ userId: text }).parse(input)
    await this.db.transaction(async () => {
      await this.classroom(actor, classId, true)
      if (actor === userId) throw new DomainError('cannotTransferSelf', 409)
      if (!(await this.db.prepare('SELECT 1 FROM class_members WHERE class_id = ? AND user_id = ?').get(classId, userId))) throw new DomainError('memberNotFound', 404)
      await this.requireProfile(userId)
      await this.db.prepare('UPDATE classes SET owner_id = ? WHERE id = ?').run(userId, classId)
      for (const table of ['settings_versions', 'rules', 'items']) await this.db.prepare(`UPDATE ${table} SET owner_id = ? WHERE class_id = ?`).run(userId, classId)
      await this.db.prepare('DELETE FROM class_invites WHERE class_id = ?').run(classId)
    }).immediate()
  }
  async addStudents(actor: string, input: unknown) {
    const data = z.object({ classId: text, students: z.array(z.object({ name: text, studentNo: z.string().trim().max(30).default('') })).min(1).max(500) }).parse(input)
    return await this.db.transaction(async () => {
      await this.classroom(actor, data.classId)
      const ids = data.students.map(() => uuid())
      await this.db.batch(data.students.map((student, index) => ({
        sql: 'INSERT INTO students (id, class_id, name, student_no, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [ids[index], data.classId, student.name, student.studentNo, now()]
      })))
      return ids
    }).immediate()
  }
  async updateStudent(actor: string, id: string, input: unknown) {
    const data = z.object({ name: text, studentNo: z.string().trim().max(30).default('') }).parse(input)
    await this.db.transaction(async () => {
      await this.student(actor, id)
      await this.db.prepare('UPDATE students SET name = ?, student_no = ? WHERE id = ?').run(data.name, data.studentNo, id)
    }).immediate()
  }
  async deleteStudent(actor: string, id: string) {
    await this.db.transaction(async () => {
      await this.student(actor, id)
      await this.db.prepare('DELETE FROM students WHERE id = ?').run(id)
    }).immediate()
  }
  async adopt(actor: string, id: string, input: unknown) {
    const { petId } = z.object({ petId: text.refine(value => petIds.has(value)) }).parse(input)
    return await this.db.transaction(async () => {
      const student = await this.student(actor, id), settings = await this.settings(actor, student.class_id)
      if (student.pet_id && level(student.pet_exp, settings.value.growth) < 8) throw new DomainError('petNotGraduated', 409)
      await this.db.prepare('UPDATE students SET pet_id = ?, pet_exp = 0, generation = generation + 1 WHERE id = ?').run(petId, id)
      await this.addGrowthEvent({ id, generation: student.generation + 1 }, 'start', settings.id, null, petId)
    }).immediate()
  }
  async changePet(actor: string, id: string, input: unknown) {
    const { petId } = z.object({ petId: text.refine(value => petIds.has(value)) }).parse(input)
    return await this.db.transaction(async () => {
      const student = await this.student(actor, id), settings = await this.settings(actor, student.class_id)
      if (!student.pet_id) throw new DomainError('invalidInput')
      if (!settings.value.allowChangePet) throw new DomainError('petChangeDisabled', 409)
      await this.db.prepare('UPDATE students SET pet_id = ? WHERE id = ?').run(petId, id)
      await this.addGrowthEvent(student, 'change', settings.id, null, petId)
    }).immediate()
  }
  private async recalculate(id: string, refreshTimes = false) {
    const student = await this.db.prepare('SELECT * FROM students WHERE id = ?').get(id) as Student
    const records = await this.db.prepare('SELECT points, generation, created_at FROM evaluations WHERE student_id = ? AND undone = 0 ORDER BY rowid').all(id) as { points: number; generation: number; created_at: number }[]
    const points = records.reduce((total, record) => {
      const next = total + record.points
      if (!Number.isSafeInteger(next)) throw new DomainError('scoreLimitExceeded', 409)
      return next
    }, 0)
    const current = await this.growthHistory(id, student.generation)
    const activeBefore = new Set((await this.db.prepare('SELECT level FROM badges WHERE student_id = ? AND generation = ? AND active = 1').all(id, student.generation) as { level: number }[]).map(row => row.level))
    await this.db.prepare('UPDATE badges SET active = 0 WHERE student_id = ? AND generation = ?').run(id, student.generation)
    for (const [level, award] of current.locks) {
      const active = current.levels.get(level)
      await this.db.prepare('INSERT INTO badges (id, student_id, generation, pet_id, earned_at, level, amount, active, source_event) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(student_id, generation, level) DO UPDATE SET active = excluded.active, earned_at = CASE WHEN ? AND excluded.active = 1 THEN excluded.earned_at ELSE badges.earned_at END').run(uuid(), id, student.generation, award.pet_id, active?.earned_at ?? award.earned_at, level, award.amount, active ? 1 : 0, award.source_event, refreshTimes || !activeBefore.has(level) ? 1 : 0)
    }
    const count = (await this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS count FROM badges WHERE student_id = ? AND active = 1').get(id) as { count: number }).count
    if (student.spent_badges > count) throw new DomainError('badgeAlreadySpent', 409)
    await this.db.prepare('UPDATE students SET points = ?, pet_exp = ? WHERE id = ?').run(points, current.exp, id)
  }
  async evaluate(actor: string, input: unknown) {
    const selection = { studentIds: z.array(text).min(1).max(500) }
    const parsed = z.union([
      z.object({ ...selection, ruleId: text, custom: z.never().optional() }),
      z.object({ ...selection, ruleId: z.never().optional(), custom: z.object({ points: z.number().int().safe().refine(value => value !== 0), reason: z.string().trim().max(80).default('') }).strict() })
    ]).safeParse(input)
    if (!parsed.success) throw new DomainError('invalidEvaluation')
    const data = parsed.data
    return await this.db.transaction(async () => {
      const user = await this.requireProfile(actor), batchId = uuid()
      const students = await Promise.all([...new Set(data.studentIds)].map(async id => (await this.student(actor, id))))
      if (new Set(students.map(student => student.class_id)).size !== 1) throw new DomainError('invalidInput')
      const classId = students[0].class_id, settings = await this.settings(actor, classId)
      const rule = data.custom ? {
        name: JSON.stringify(data.custom.reason ? { zh: data.custom.reason, en: data.custom.reason } : data.custom.points > 0 ? { zh: '自定义加分', en: 'Custom bonus' } : { zh: '自定义扣分', en: 'Custom deduction' }),
        points: data.custom.points,
        category: 'other'
      } : await this.db.prepare('SELECT name, points, category FROM rules WHERE id = ? AND class_id = ?').get(data.ruleId, classId) as { name: string; points: number; category: string } | undefined
      if (!rule) throw new DomainError('notFound', 404)
      for (const student of students) {
        const evaluationId = uuid()
        await this.db.prepare('INSERT INTO evaluations (id, batch_id, student_id, points, reason, category, generation, created_at, undone, actor_user_id, actor_name, actor_subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)').run(evaluationId, batchId, student.id, rule.points, rule.name, rule.category, student.generation, now(), actor, user.display_name, user.subject)
        await this.addGrowthEvent(student, 'evaluation', settings.id, evaluationId)
        await this.recalculate(student.id)
      }
      return { batchId }
    }).immediate()
  }
  async undo(actor: string, batchId: string) {
    return await this.db.transaction(async () => {
      const user = await this.requireProfile(actor)
      const records = await this.db.prepare('SELECT id, student_id, generation, actor_user_id FROM evaluations WHERE batch_id = ? AND undone = 0').all(batchId) as { id: string; student_id: string; generation: number; actor_user_id: string | null }[]
      if (!records.length) throw new DomainError('notFound', 404)
      const students = await Promise.all(records.map(async record => (await this.student(actor, record.student_id))))
      if (new Set(students.map(student => student.class_id)).size !== 1) throw new DomainError('invalidInput')
      const classId = students[0].class_id, classroom = await this.classroom(actor, classId)
      if (classroom.role !== 'owner' && records.some(record => record.actor_user_id !== actor)) throw new DomainError('operationNotOwned', 403)
      for (let i = 0; i < records.length; i++) if (students[i].generation !== records[i].generation) throw new DomainError('previousPetCycle', 409)
      const settings = await this.settings(actor, classId)
      for (const record of records) {
        await this.db.prepare('UPDATE evaluations SET undone = 1, undone_by_user_id = ?, undone_by_name = ?, undone_by_subject = ? WHERE id = ?').run(actor, user.display_name, user.subject, record.id)
        await this.addGrowthEvent({ id: record.student_id, generation: record.generation }, 'undo', settings.id, record.id)
      }
      for (const id of new Set(records.map(record => record.student_id))) await this.recalculate(id, true)
    }).immediate()
  }
  async addRule(actor: string, input: unknown) {
    const data = z.object({ classId: text, name: localized, points: z.number().int().min(-100).max(100).refine(value => value !== 0), category }).parse(input)
    await this.db.transaction(async () => {
      const classroom = await this.classroom(actor, data.classId)
      await this.db.prepare('INSERT INTO rules (id, owner_id, name, points, category, custom, class_id) VALUES (?, ?, ?, ?, ?, 1, ?)').run(uuid(), classroom.owner_id, JSON.stringify(data.name), data.points, data.category, data.classId)
    }).immediate()
  }
  async deleteRule(actor: string, id: string) {
    await this.db.transaction(async () => {
      const row = await this.db.prepare('SELECT class_id FROM rules WHERE id = ? AND custom = 1 AND class_id IS NOT NULL').get(id) as { class_id: string } | undefined
      if (!row) throw new DomainError('notFound', 404)
      await this.classroom(actor, row.class_id)
      await this.db.prepare('DELETE FROM rules WHERE id = ?').run(id)
    }).immediate()
  }
  async addItem(actor: string, input: unknown) {
    const data = itemSchema.extend({ classId: text }).parse(input)
    await this.classroom(actor, data.classId)
    const image = data.image === undefined || data.image === null ? { image: null, image_key: null, image_bytes: 0 } : await normalizeItemImage(data.image)
    return await this.db.transaction(async () => {
      const classroom = await this.classroom(actor, data.classId)
      await this.checkImageBudget(data.classId, '', image.image_bytes)
      const id = uuid()
      await this.db.prepare('INSERT INTO items (id, owner_id, class_id, name, cost, active, description, category, icon, image, image_key, image_bytes, stock) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)').run(id, classroom.owner_id, data.classId, JSON.stringify(data.name), data.cost, JSON.stringify(data.description), data.category, data.icon, image.image, image.image_key, image.image_bytes, data.stock)
      return { id }
    }).immediate()
  }
  private async classItem(actor: string, id: string) {
    const row = await this.db.prepare('SELECT * FROM items WHERE id = ? AND active = 1 AND class_id IS NOT NULL').get(id) as { id: string; class_id: string; name: string; cost: number; stock: number; image: string | null; image_key: string | null; image_bytes: number; background_id: string | null } | undefined
    if (!row) throw new DomainError('notFound', 404)
    await this.classroom(actor, row.class_id)
    return row
  }
  async updateItem(actor: string, id: string, input: unknown) {
    const existing = await this.classItem(actor, id)
    if (existing.background_id) {
      const { cost } = itemSchema.pick({ cost: true }).parse(input)
      return await this.db.transaction(async () => {
        await this.classItem(actor, id)
        await this.db.prepare('UPDATE items SET cost = ? WHERE id = ?').run(cost, id)
      }).immediate()
    }
    const data = itemSchema.parse(input)
    const image = data.image === undefined ? undefined : data.image === null ? { image: null, image_key: null, image_bytes: 0 } : await normalizeItemImage(data.image)
    return await this.db.transaction(async () => {
      const current = await this.classItem(actor, id), savedImage = image || current
      await this.checkImageBudget(current.class_id, id, savedImage.image_bytes)
      if (data.stock >= 0) {
        const { pending } = await this.db.prepare('SELECT COUNT(*) AS pending FROM redemptions WHERE item_id = ? AND stock_deducted = 1 AND undone = 0').get(id) as { pending: number }
        if (data.stock > Number.MAX_SAFE_INTEGER - pending) throw new DomainError('stockLimitExceeded', 409)
      }
      await this.db.prepare('UPDATE items SET name = ?, cost = ?, description = ?, category = ?, icon = ?, image = ?, image_key = ?, image_bytes = ?, stock = ? WHERE id = ?').run(JSON.stringify(data.name), data.cost, JSON.stringify(data.description), data.category, data.icon, savedImage.image, savedImage.image_key, savedImage.image_bytes, data.stock, id)
    }).immediate()
  }
  private async checkImageBudget(classId: string, excludedId: string, bytes: number) {
    const { total } = await this.db.prepare('SELECT COALESCE(SUM(image_bytes), 0) AS total FROM items WHERE class_id = ? AND id != ?').get(classId, excludedId) as { total: number }
    if (total + bytes > MAX_CLASS_IMAGE_BYTES) throw new DomainError('imageStorageFull', 409)
  }
  async itemImage(actor: string, id: string) {
    const item = await this.classItem(actor, id)
    if (!item.image) throw new DomainError('notFound', 404)
    return { data: Buffer.from(item.image.split(',')[1], 'base64'), key: item.image_key! }
  }
  async deleteItem(actor: string, id: string) {
    await this.db.transaction(async () => {
      await this.classItem(actor, id)
      await this.db.prepare('UPDATE items SET active = 0, image = NULL, image_key = NULL, image_bytes = 0 WHERE id = ?').run(id)
    }).immediate()
  }
  async setBackground(actor: string, studentId: string, input: unknown) {
    const parsed = z.object({ backgroundId: z.string().nullable() }).safeParse(input)
    return await this.db.transaction(async () => {
      const student = await this.student(actor, studentId)
      if (!parsed.success || (parsed.data.backgroundId !== null && !petBackgroundById(parsed.data.backgroundId))) throw new DomainError('invalidBackground')
      const { backgroundId } = parsed.data
      if (backgroundId === null || (await this.db.prepare('SELECT 1 FROM redemptions WHERE student_id = ? AND background_id = ? AND undone = 0').get(studentId, backgroundId))) {
        await this.db.prepare('UPDATE students SET background_id = ?, festival_background_id = NULL, festival_background_expires_at = NULL WHERE id = ?').run(backgroundId, studentId)
        return
      }
      const settings = await this.latestSettings(actor, student.class_id)
      const offer = getFestivalBackgrounds(now(), settings.value.hunger.timeZone).backgrounds.find(row => row.background_id === backgroundId)
      if (!offer) throw new DomainError('backgroundNotOwned', 409)
      await this.db.prepare('UPDATE students SET festival_background_id = ?, festival_background_expires_at = ? WHERE id = ?').run(backgroundId, offer.expires_at, studentId)
    }).immediate()
  }
  async redeem(actor: string, input: unknown) {
    const { studentId, itemId } = z.object({ studentId: text, itemId: text }).parse(input)
    return await this.db.transaction(async () => {
      const user = await this.requireProfile(actor), student = await this.student(actor, studentId), item = await this.classItem(actor, itemId)
      if (item.class_id !== student.class_id) throw new DomainError('notFound', 404)
      if (item.background_id && (await this.db.prepare('SELECT 1 FROM redemptions WHERE student_id = ? AND background_id = ? AND undone = 0').get(studentId, item.background_id))) throw new DomainError('backgroundAlreadyOwned', 409)
      if (item.stock === 0) throw new DomainError('outOfStock', 409)
      const badges = (await this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS count FROM badges WHERE student_id = ? AND active = 1').get(studentId) as { count: number }).count
      if (badges - student.spent_badges < item.cost) throw new DomainError('insufficientBadges', 409)
      const deducted = item.stock > 0 ? 1 : 0
      if (deducted) await this.db.prepare('UPDATE items SET stock = stock - 1 WHERE id = ?').run(itemId)
      await this.db.prepare('UPDATE students SET spent_badges = spent_badges + ? WHERE id = ?').run(item.cost, studentId)
      await this.db.prepare('INSERT INTO redemptions (id, student_id, item_id, item_name, cost, created_at, undone, stock_deducted, actor_user_id, actor_name, actor_subject, background_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)').run(uuid(), studentId, itemId, item.name, item.cost, now(), deducted, actor, user.display_name, user.subject, item.background_id)
    }).immediate()
  }
  async undoRedemption(actor: string, id: string) {
    return await this.db.transaction(async () => {
      const user = await this.requireProfile(actor)
      const row = await this.db.prepare('SELECT * FROM redemptions WHERE id = ? AND undone = 0').get(id) as { student_id: string; item_id: string | null; cost: number; stock_deducted: number; actor_user_id: string | null; background_id: string | null } | undefined
      if (!row) throw new DomainError('notFound', 404)
      const student = await this.student(actor, row.student_id), classroom = await this.classroom(actor, student.class_id)
      if (classroom.role !== 'owner' && row.actor_user_id !== actor) throw new DomainError('operationNotOwned', 403)
      if (row.stock_deducted && row.item_id) {
        const item = await this.db.prepare('SELECT stock FROM items WHERE id = ? AND class_id = ?').get(row.item_id, student.class_id) as { stock: number } | undefined
        if (!item) throw new DomainError('notFound', 404)
        if (item.stock >= Number.MAX_SAFE_INTEGER) throw new DomainError('stockLimitExceeded', 409)
      }
      await this.db.prepare('UPDATE students SET spent_badges = spent_badges - ? WHERE id = ?').run(row.cost, row.student_id)
      if (row.background_id) await this.db.prepare('UPDATE students SET background_id = NULL WHERE id = ? AND background_id = ?').run(row.student_id, row.background_id)
      if (row.stock_deducted && row.item_id) await this.db.prepare('UPDATE items SET stock = stock + 1 WHERE id = ? AND class_id = ? AND stock >= 0').run(row.item_id, student.class_id)
      await this.db.prepare('UPDATE redemptions SET undone = 1, undone_by_user_id = ?, undone_by_name = ?, undone_by_subject = ? WHERE id = ?').run(actor, user.display_name, user.subject, id)
    }).immediate()
  }
  async snapshot(actor: string, classId?: string): Promise<Snapshot> {
    return await this.db.transaction(async () => {
      const timestamp = now()
      const user = await this.user(actor)
      const classes = user.profile_complete ? await this.db.prepare("SELECT c.*, CASE WHEN c.owner_id = ? THEN 'owner' ELSE 'admin' END AS role FROM classes c JOIN class_members m ON m.class_id = c.id WHERE m.user_id = ? ORDER BY c.created_at, c.id").all(actor, actor) as Classroom[] : []
      const selected = user.profile_complete ? classId || classes[0]?.id : undefined
      const classroom = selected ? (await this.classroom(actor, selected)) : undefined
      const settings = await this.latestSettings(actor, selected)
      const festival_backgrounds = getFestivalBackgrounds(timestamp, settings.value.hunger.timeZone)
      const offers = new Map(festival_backgrounds.backgrounds.map(offer => [offer.background_id, offer.expires_at]))
      const students = selected ? await this.db.prepare('SELECT s.*, (SELECT COALESCE(SUM(amount), 0) FROM badges b WHERE b.student_id = s.id AND b.active = 1) AS badge_count FROM students s WHERE class_id = ? ORDER BY created_at, id').all(selected) as Student[] : []
      const owned = new Map<string, string[]>()
      const backgroundRedemptions = selected ? await this.db.prepare('SELECT r.student_id, r.background_id FROM redemptions r JOIN students s ON s.id = r.student_id WHERE s.class_id = ? AND r.undone = 0 AND r.background_id IS NOT NULL ORDER BY r.rowid').all(selected) as { student_id: string; background_id: string }[] : []
      for (const row of backgroundRedemptions) {
        const backgrounds = owned.get(row.student_id) || []
        backgrounds.push(row.background_id)
        owned.set(row.student_id, backgrounds)
      }
      for (const student of students) {
        student.owned_background_ids = owned.get(student.id) || []
        const expiresAt = student.festival_background_id ? offers.get(student.festival_background_id) : undefined
        if (expiresAt !== undefined && student.festival_background_expires_at !== null && student.festival_background_expires_at > timestamp) {
          student.festival_background_expires_at = Math.min(student.festival_background_expires_at, expiresAt)
        } else {
          student.festival_background_id = null
          student.festival_background_expires_at = null
        }
        student.status = petStatus(student.pet_id, student.points, student.pet_exp, (await this.growthHistory(student.id, student.generation)).lastFedAt, settings.value, timestamp)
      }
      const rules = selected ? (await this.db.prepare('SELECT id, name, points, category, custom FROM rules WHERE class_id = ? ORDER BY rowid').all(selected) as (Omit<Rule, 'name'> & { name: string })[]).map(rule => ({ ...rule, name: JSON.parse(rule.name) })) : []
      const records = selected ? (await this.db.prepare('SELECT e.*, s.name AS student_name FROM evaluations e JOIN students s ON s.id = e.student_id WHERE s.class_id = ? ORDER BY e.rowid DESC LIMIT 200').all(selected) as (Omit<Evaluation, 'reason'> & { reason: string })[]).map(record => ({ ...record, reason: JSON.parse(record.reason), can_undo: !record.undone && (classroom!.role === 'owner' || record.actor_user_id === actor) })) : []
      const items = selected ? (await this.db.prepare('SELECT id, name, cost, active, description, category, icon, image_key, stock, background_id FROM items WHERE class_id = ? AND active = 1 ORDER BY rowid').all(selected) as (Omit<ShopItem, 'name' | 'description' | 'image'> & { name: string; description: string; image_key: string | null })[]).map(({ image_key, ...item }) => ({ ...item, name: JSON.parse(item.name), description: JSON.parse(item.description), image: image_key ? `/api/items/${item.id}/image?v=${image_key}` : null })) : []
      const badges = selected ? await this.db.prepare('SELECT b.* FROM badges b JOIN students s ON s.id = b.student_id WHERE s.class_id = ? AND b.active = 1 ORDER BY b.earned_at DESC, b.level DESC').all(selected) as Badge[] : []
      const redemptions = selected ? (await this.db.prepare('SELECT r.*, s.name AS student_name FROM redemptions r JOIN students s ON s.id = r.student_id WHERE s.class_id = ? ORDER BY r.rowid DESC LIMIT 200').all(selected) as (Omit<Redemption, 'item_name'> & { item_name: string })[]).map(item => ({ ...item, item_name: JSON.parse(item.item_name), can_undo: !item.undone && (classroom!.role === 'owner' || item.actor_user_id === actor) })) : []
      return { user, settings, classes, students, badges, rules, records, items, redemptions, festival_backgrounds }
    }).deferred()
  }
  async demo(owner: string, locale: string) {
    return await this.db.transaction(async () => {
      const user = await this.requireProfile(owner)
      const { id } = await this.createClass(owner, { name: locale === 'en' ? 'Demo · Class 3A' : '演示 · 三年级一班' })
      const names = locale === 'en' ? ['Olivia', 'Noah', 'Amelia', 'Leo', 'Sophie', 'Ethan'] : ['林小橙', '陈子禾', '沈星语', '周一诺', '许沐晴', '陆小川']
      const ids = await this.addStudents(owner, { classId: id, students: names.map((name, i) => ({ name, studentNo: String(i + 1).padStart(2, '0') })) })
      const petNames = ['westie', 'capybara', 'silver-cat', 'panda', 'nine-tail-fox', 'koel-duck']
      const amounts = [106, 45, 182, 22, 285, 68]
      for (const [index, studentId] of ids.entries()) {
        await this.adopt(owner, studentId, { petId: petNames[index] })
        const evaluationId = uuid()
        await this.db.prepare('INSERT INTO evaluations (id, batch_id, student_id, points, reason, category, generation, created_at, undone, actor_user_id, actor_name, actor_subject) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?)').run(evaluationId, uuid(), studentId, amounts[index], JSON.stringify({ zh: '演示成长记录', en: 'Demo growth record' }), 'other', now(), owner, user.display_name, user.subject)
        await this.addGrowthEvent({ id: studentId, generation: 1 }, 'evaluation', (await this.settings(owner, id)).id, evaluationId)
        await this.recalculate(studentId)
      }
      return { id }
    }).immediate()
  }
}
