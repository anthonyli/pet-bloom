import type { Statement } from './database-adapter'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Garden } from './garden'
import { DomainError } from './errors'
import pets from '../data/pets.json'
import { replayGrowth, replayEvents, growthLevel, type GrowthEvent } from '../growth'
import { defaultGardenSettings, gardenSettingsSchema } from '../garden-settings'
import { MAX_BACKUP_BYTES, MAX_CLASS_IMAGE_BYTES, MAX_STORED_IMAGE_BYTES, shopCategoryIds, shopIconIds } from '../shop'
import { validateStoredImage } from './item-images'
import { versionFiveBackgroundIds, holidayBackgroundIds, versionSevenBackgroundIds } from '../pet-backgrounds'
import { initializeBackgroundItems } from './database-defaults'

const id = z.string().min(1).max(100)
const name = z.string().min(1).max(80)
const integer = z.number().int().safe()
const positive = integer.nonnegative()
const translated = (max: number, min = 1) => z.string().max(max * 12 + 100).refine(value => {
  try { return z.object({ zh: z.string().min(min).max(max), en: z.string().min(min).max(max) }).safeParse(JSON.parse(value)).success } catch { return false }
})
const category = z.enum(['study', 'behavior', 'health', 'other'])
const pet = z.string().refine(value => pets.some(item => item.id === value))
const flag = z.union([z.literal(0), z.literal(1)])
const badge = z.object({ id, student_id: id, generation: positive, pet_id: pet, earned_at: positive })
const item = z.object({ id, name: translated(80), cost: integer.min(1).max(100), active: flag })
const redemption = z.object({ id, student_id: id, item_id: id.nullable(), item_name: translated(80), cost: integer.min(1).max(100), created_at: positive, undone: flag })
const common = {
  classes: z.array(z.object({ id, name, created_at: positive })).max(200),
  students: z.array(z.object({ id, class_id: id, name, student_no: z.string().max(30), points: integer, pet_id: pet.nullable(), pet_exp: positive, generation: positive, spent_badges: positive, created_at: positive })).max(10000),
  rules: z.array(z.object({ id, name: translated(80), points: integer.min(-100).max(100).refine(v => v !== 0), category, custom: flag })).max(2000),
  evaluations: z.array(z.object({ id, batch_id: id, student_id: id, points: integer.min(-10000).max(10000), reason: translated(80), category, generation: positive, created_at: positive, undone: flag })).max(50000)
}
const legacySchema = z.object({ version: z.literal(1), ...common, badges: z.array(badge).max(10000), items: z.array(item), redemptions: z.array(redemption).max(10000) })
const schema = z.object({
  version: z.literal(2), ...common,
  badges: z.array(badge.extend({ level: integer.min(2).max(8) })).max(350000),
  items: z.array(item.extend({ description: translated(500, 0), category: z.enum(shopCategoryIds), icon: z.enum(shopIconIds), image: z.string().max(Math.ceil(MAX_STORED_IMAGE_BYTES / 3) * 4 + 100).nullable(), image_key: z.string().regex(/^[a-f0-9]{64}$/).nullable(), image_bytes: positive.max(MAX_STORED_IMAGE_BYTES), stock: integer.min(-1) })),
  redemptions: z.array(redemption.extend({ stock_deducted: flag })).max(10000)
})
type Backup = z.infer<typeof schema>
const currentSchema = schema.extend({
  version: z.literal(3),
  students: z.array(common.students.element.extend({ pet_exp: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER) })).max(10000),
  badges: z.array(schema.shape.badges.element.extend({ amount: integer.min(0).max(100), active: flag, source_event: id })).max(350000),
  settings: z.array(z.object({ id, version: positive, value: gardenSettingsSchema, created_at: positive })).min(1).max(10000),
  events: z.array(z.object({ id, seq: positive, student_id: id, generation: positive, kind: z.enum(['start', 'evaluation', 'rebase', 'undo', 'change']), settings_id: id, evaluation_id: id.nullable(), pet_id: pet.nullable(), initial_undone: flag, created_at: positive })).max(200000)
})
type CurrentBackup = z.infer<typeof currentSchema>

const actorText = {
  actor_name: z.string().max(40), actor_subject: z.string().max(60),
  undone_by_name: z.string().max(40), undone_by_subject: z.string().max(60)
}
const scope = { class_id: id.nullable() }
const scopedSchema = z.object({
  version: z.literal(4), exportedAt: z.string().datetime().optional(),
  classes: z.array(common.classes.element.strict()).max(200),
  students: z.array(currentSchema.shape.students.element.strict()).max(10000),
  rules: z.array(common.rules.element.extend(scope).strict()).max(201 * 2000),
  evaluations: z.array(common.evaluations.element.extend({ ...actorText, points: integer }).strict()).max(50000),
  badges: z.array(currentSchema.shape.badges.element.strict()).max(350000),
  items: z.array(schema.shape.items.element.extend(scope).strict()),
  redemptions: z.array(schema.shape.redemptions.element.extend(actorText).strict()).max(10000),
  settings: z.array(currentSchema.shape.settings.element.extend(scope).strict()).min(1).max(201 * 10000),
  events: z.array(currentSchema.shape.events.element.strict()).max(200000)
}).strict()
type ScopedBackup = z.infer<typeof scopedSchema>
const versionFiveBackgroundId = z.enum(versionFiveBackgroundIds).nullable()
const backgroundSchema = scopedSchema.extend({
  version: z.literal(5),
  students: z.array(scopedSchema.shape.students.element.extend({ background_id: versionFiveBackgroundId })).max(10000),
  items: z.array(scopedSchema.shape.items.element.extend({ background_id: versionFiveBackgroundId })),
  redemptions: z.array(scopedSchema.shape.redemptions.element.extend({ background_id: versionFiveBackgroundId })).max(10000)
})
const backgroundId = z.enum([...versionFiveBackgroundIds, ...holidayBackgroundIds]).nullable()
const holidaySchema = backgroundSchema.extend({
  version: z.literal(6),
  students: z.array(scopedSchema.shape.students.element.extend({ background_id: backgroundId })).max(10000),
  items: z.array(scopedSchema.shape.items.element.extend({ background_id: backgroundId })),
  redemptions: z.array(scopedSchema.shape.redemptions.element.extend({ background_id: backgroundId })).max(10000)
})
const currentBackgroundId = z.enum([...versionFiveBackgroundIds, ...holidayBackgroundIds, ...versionSevenBackgroundIds]).nullable()
const festivalSchema = holidaySchema.extend({
  version: z.literal(7),
  students: z.array(scopedSchema.shape.students.element.extend({ background_id: currentBackgroundId })).max(10000),
  items: z.array(scopedSchema.shape.items.element.extend({ background_id: currentBackgroundId })),
  redemptions: z.array(scopedSchema.shape.redemptions.element.extend({ background_id: currentBackgroundId })).max(10000)
})
type BackgroundBackup = z.infer<typeof festivalSchema>
const archiveSchema = festivalSchema.extend({
  version: z.literal(8),
  students: z.array(festivalSchema.shape.students.element.extend({ archived_at: positive.nullable() })).max(10000)
})
type ArchiveBackup = z.infer<typeof archiveSchema>

function upgradeBackgrounds(data: ScopedBackup): BackgroundBackup {
  return {
    ...data, version: 7,
    students: data.students.map(row => ({ ...row, background_id: null })),
    items: data.items.map(row => ({ ...row, background_id: null })),
    redemptions: data.redemptions.map(row => ({ ...row, background_id: null }))
  }
}
const rowKinds = ['classes', 'students', 'rules', 'evaluations', 'badges', 'items', 'redemptions', 'settings', 'events'] as const
const emptyActor = { actor_name: '', actor_subject: '', undone_by_name: '', undone_by_subject: '' }

function upgradeVersionTwo(data: Backup): CurrentBackup {
  validateConsistency(data)
  const settings = { id: randomUUID(), version: 0, value: defaultGardenSettings(), created_at: Date.now() }
  const events: CurrentBackup['events'] = [], sources = new Map<string, string>()
  for (const student of data.students) {
    const records = data.evaluations.filter(row => row.student_id === student.id)
    const badges = data.badges.filter(row => row.student_id === student.id)
    const generations = [...new Set([student.generation, ...records.map(row => row.generation), ...badges.map(row => row.generation)])].sort((a, b) => a - b)
    for (const generation of generations) {
      const history: GrowthEvent[] = []
      const add = (kind: GrowthEvent['kind'], evaluation_id: string | null, pet_id: string | null, initial_undone: 0 | 1, created_at: number) => {
        const event = { id: randomUUID(), seq: events.length + 1, student_id: student.id, generation, kind, settings_id: settings.id, evaluation_id, pet_id, initial_undone, created_at }
        events.push(event); history.push(event)
      }
      const petId = generation === student.generation ? student.pet_id : badges.find(row => row.generation === generation)?.pet_id || null
      if (generation > 0) add('start', null, petId, 0, student.created_at)
      for (const record of records.filter(row => row.generation === generation)) add('evaluation', record.id, null, record.undone, record.created_at)
      const result = replayEvents(history, new Map(records.map(row => [row.id, row])), new Map([[settings.id, settings.value]]))
      for (const [level, award] of result.levels) sources.set(`${student.id}:${generation}:${level}`, award.source_event)
    }
  }
  return { ...data, version: 3, settings: [settings], events, badges: data.badges.map(row => ({ ...row, amount: 1, active: 1, source_event: sources.get(`${row.student_id}:${row.generation}:${row.level}`)! })) }
}
function groupBy<T, K>(rows: T[], key: (row: T) => K) {
  const groups = new Map<K, T[]>()
  for (const row of rows) {
    const value = key(row)
    const group = groups.get(value)
    if (group) group.push(row)
    else groups.set(value, [row])
  }
  return groups
}

function upgradeLegacy(data: z.infer<typeof legacySchema>): Backup {
  const badges = data.badges.map(row => ({ ...row, level: 8 }))
  const recordsByStudent = groupBy(data.evaluations, row => row.student_id)
  const oldBadges = groupBy(data.badges, row => row.student_id)
  const redemptions = groupBy(data.redemptions.filter(row => !row.undone), row => row.student_id)
  const keys = new Set(badges.map(row => `${row.student_id}:${row.generation}:${row.level}`))
  for (const student of data.students) {
    const records = (recordsByStudent.get(student.id) || []).filter(row => !row.undone)
    const previousBadges = oldBadges.get(student.id) || []
    const spent = (redemptions.get(student.id) || []).reduce((sum, row) => sum + row.cost, 0)
    const exp = student.pet_id ? replayGrowth(records.filter(row => row.generation === student.generation)).exp : 0
    if (records.reduce((sum, row) => sum + row.points, 0) !== student.points || exp !== student.pet_exp || spent !== student.spent_badges || spent > previousBadges.length) throw new DomainError('invalidBackup')
    const petByGeneration = new Map(previousBadges.map(row => [row.generation, row.pet_id]))
    for (const [generation, generationRecords] of groupBy(records, row => row.generation)) {
      if (generation < 1 || generation > student.generation) continue
      const petId = petByGeneration.get(generation) || (generation === student.generation ? student.pet_id : null)
      if (!petId) continue
      for (const [level, earnedAt] of replayGrowth(generationRecords).levels) {
        const key = `${student.id}:${generation}:${level}`
        if (!keys.has(key)) {
          badges.push({ id: randomUUID(), student_id: student.id, generation, pet_id: petId, earned_at: earnedAt, level })
          keys.add(key)
        }
      }
    }
  }
  return { ...data, version: 2, badges, items: data.items.map(row => ({ ...row, description: JSON.stringify({ zh: '', en: '' }), category: 'other', icon: 'gift', image: null, image_key: null, image_bytes: 0, stock: -1 })), redemptions: data.redemptions.map(row => ({ ...row, stock_deducted: 0 })) }
}

function validateConsistency(data: Backup) {
  const students = new Map(data.students.map(row => [row.id, row]))
  for (const row of [...data.evaluations, ...data.badges, ...data.redemptions]) if (!students.has(row.student_id)) throw new DomainError('invalidBackup')
  const unique = new Set<string>()
  for (const row of data.badges) {
    const key = `${row.student_id}:${row.generation}:${row.level}`
    if (unique.has(key) || row.generation < 1 || row.generation > students.get(row.student_id)!.generation) throw new DomainError('invalidBackup')
    unique.add(key)
  }
  const recordsByStudent = groupBy(data.evaluations, row => row.student_id)
  const badgesByStudent = groupBy(data.badges, row => row.student_id)
  const redemptionsByStudent = groupBy(data.redemptions.filter(row => !row.undone), row => row.student_id)
  for (const student of data.students) {
    if ((student.pet_id === null) !== (student.generation === 0)) throw new DomainError('invalidBackup')
    const records = recordsByStudent.get(student.id) || []
    if (records.some(row => row.generation > student.generation)) throw new DomainError('invalidBackup')
    const active = records.filter(row => !row.undone)
    const generationRecords = groupBy(active, row => row.generation)
    const points = active.reduce((sum, row) => sum + row.points, 0)
    const current = replayGrowth(student.pet_id ? generationRecords.get(student.generation) || [] : [])
    const spent = (redemptionsByStudent.get(student.id) || []).reduce((sum, row) => sum + row.cost, 0)
    const badges = badgesByStudent.get(student.id) || []
    if (points !== student.points || current.exp !== student.pet_exp || spent !== student.spent_badges || spent > badges.length) throw new DomainError('invalidBackup')
    const generationBadges = groupBy(badges, row => row.generation)
    let expected = 0
    const generations = new Set([...generationRecords.keys(), ...generationBadges.keys()].filter(value => value > 0))
    for (const generation of generations) {
      const growth = replayGrowth(generationRecords.get(generation) || [])
      if (generation < student.generation && growth.exp < 700) throw new DomainError('invalidBackup')
      expected += growth.levels.size
      for (const row of generationBadges.get(generation) || []) if (!growth.levels.has(row.level)) throw new DomainError('invalidBackup')
    }
    if (badges.length !== expected) throw new DomainError('invalidBackup')
  }
  const itemIds = new Set(data.items.map(item => item.id))
  const pendingReturns = groupBy(data.redemptions.filter(row => row.stock_deducted && !row.undone), row => row.item_id)
  for (const item of data.items) if (item.stock >= 0 && item.stock > Number.MAX_SAFE_INTEGER - (pendingReturns.get(item.id)?.length || 0)) throw new DomainError('invalidBackup')
  for (const row of data.redemptions) if (row.stock_deducted && (!row.item_id || !itemIds.has(row.item_id))) throw new DomainError('invalidBackup')
}

function validateCurrent(data: CurrentBackup) {
  const fail = () => { throw new DomainError('invalidBackup') }
  const policies = new Map(data.settings.map(row => [row.id, row.value]))
  if (policies.size !== data.settings.length) fail()
  for (let i = 0; i < data.settings.length; i++) {
    const row = data.settings[i], previous = data.settings[i - 1]
    if (row.version !== i || (i === 0 && JSON.stringify(row.value) !== JSON.stringify(defaultGardenSettings())) || row.value.signedGrowth !== Boolean(previous?.value.signedGrowth || row.value.sickness || row.value.resetToEgg)) fail()
  }
  const students = new Map(data.students.map(row => [row.id, row]))
  const records = new Map(data.evaluations.map(row => [row.id, row]))
  const versions = new Map(data.settings.map(row => [row.id, row.version]))
  const seen = new Set<string>(), seenEvaluations = new Set<string>(), undone = new Set<string>()
  let seq = -1
  const byStudent = groupBy(data.events, row => row.student_id)
  const badgesByStudent = groupBy(data.badges, row => row.student_id)
  const recordsByStudent = groupBy(data.evaluations, row => row.student_id)
  const redemptions = groupBy(data.redemptions.filter(row => !row.undone), row => row.student_id)
  for (const event of data.events) {
    if (event.seq <= seq || seen.has(event.id) || !students.has(event.student_id) || !policies.has(event.settings_id)) fail()
    seq = event.seq; seen.add(event.id)
    if ((event.kind === 'evaluation' || event.kind === 'undo') !== (event.evaluation_id !== null)) fail()
    if ((event.kind === 'start' || event.kind === 'change') !== (event.pet_id !== null)) fail()
    if (event.initial_undone && (event.kind !== 'evaluation' || versions.get(event.settings_id) !== 0)) fail()
    if (event.kind === 'evaluation') {
      const record = records.get(event.evaluation_id!)
      if (!record || record.student_id !== event.student_id || record.generation !== event.generation || record.created_at !== event.created_at || seenEvaluations.has(record.id)) fail()
      seenEvaluations.add(event.evaluation_id!)
      if (event.initial_undone) undone.add(event.evaluation_id!)
    } else if (event.kind === 'undo') {
      const record = records.get(event.evaluation_id!)
      if (!record || !seenEvaluations.has(record.id) || undone.has(record.id) || record.student_id !== event.student_id || record.generation !== event.generation) fail()
      undone.add(event.evaluation_id!)
    }
  }
  if (seenEvaluations.size !== records.size) fail()
  for (const record of data.evaluations) if (Boolean(record.undone) !== undone.has(record.id)) fail()
  for (const row of [...data.badges, ...data.redemptions]) if (!students.has(row.student_id)) fail()
  for (const student of data.students) {
    if ((student.pet_id === null) !== (student.generation === 0)) fail()
    const events = byStudent.get(student.id) || [], history = groupBy(events, row => row.generation)
    const badges = badgesByStudent.get(student.id) || [], generationBadges = groupBy(badges, row => row.generation)
    const generations = [...history.keys()].sort((a, b) => a - b)
    if (generations.some((generation, index) => generation < 0 || generation > student.generation || (generation > 0 && generation !== index + (generations[0] === 0 ? 0 : 1)))) fail()
    if (student.generation > 0 && !history.has(student.generation)) fail()
    let exp = 0, expectedBadges = 0, previousVersion = 0
    for (const generation of generations) {
      const entries = history.get(generation)!
      if (generation > 0 && (entries[0]?.kind !== 'start' || entries.filter(row => row.kind === 'start').length !== 1)) fail()
      if (generation === 0 && entries.some(row => row.kind !== 'evaluation' && row.kind !== 'undo')) fail()
      for (const entry of entries) {
        const version = versions.get(entry.settings_id)!
        if (version < previousVersion || (entry.kind === 'change' && !policies.get(entry.settings_id)!.allowChangePet)) fail()
        previousVersion = version
      }
      let result: ReturnType<typeof replayEvents>
      try { result = replayEvents(entries, records, policies) } catch { return fail() }
      const finalPolicy = policies.get(entries.at(-1)!.settings_id)!
      if (generation > 0 && generation < student.generation && growthLevel(result.exp, finalPolicy.growth) < 8) fail()
      if (generation === student.generation) {
        exp = result.exp
        if (result.petId !== student.pet_id || (student.pet_id && entries.at(-1)!.settings_id !== data.settings.at(-1)!.id)) fail()
      }
      expectedBadges += result.locks.size
      const rows = generationBadges.get(generation) || []
      if (rows.length !== result.locks.size || new Set(rows.map(row => row.level)).size !== rows.length) fail()
      for (const row of rows) {
        const award = result.locks.get(row.level), active = result.levels.get(row.level)
        if (!award || row.amount !== award.amount || row.source_event !== award.source_event || Boolean(row.active) !== Boolean(active)) fail()
        const source = entries.find(entry => entry.id === row.source_event)
        if (!source || (versions.get(source.settings_id) !== 0 && (row.pet_id !== award!.pet_id || (active && row.earned_at !== active.earned_at)))) fail()
      }
    }
    const points = (recordsByStudent.get(student.id) || []).filter(row => !row.undone).reduce((sum, row) => sum + row.points, 0)
    const spent = (redemptions.get(student.id) || []).reduce((sum, row) => sum + row.cost, 0)
    const balance = badges.filter(row => row.active).reduce((sum, row) => sum + row.amount, 0)
    if (badges.length !== expectedBadges || points !== student.points || Math.abs(exp - student.pet_exp) > 1e-8 || spent !== student.spent_badges || spent > balance) fail()
  }
  const itemIds = new Set(data.items.map(row => row.id))
  const pending = groupBy(data.redemptions.filter(row => row.stock_deducted && !row.undone), row => row.item_id)
  for (const row of data.items) if (row.stock >= 0 && row.stock > Number.MAX_SAFE_INTEGER - (pending.get(row.id)?.length || 0)) fail()
  for (const row of data.redemptions) if (row.stock_deducted && (!row.item_id || !itemIds.has(row.item_id))) fail()
}

function validateIds(data: CurrentBackup | ScopedBackup | BackgroundBackup | ArchiveBackup) {
  for (const kind of rowKinds) {
    const ids = new Set<string>()
    for (const row of data[kind]) {
      if (ids.has(row.id)) throw new DomainError('invalidBackup')
      ids.add(row.id)
    }
  }
  const classes = new Set(data.classes.map(row => row.id))
  for (const student of data.students) if (!classes.has(student.class_id)) throw new DomainError('invalidBackup')
}

function splitLegacy(data: CurrentBackup): ScopedBackup {
  // 必须先校验原全局历史，避免拆班掩盖原策略链错误。
  const result: ScopedBackup = {
    ...data, version: 4,
    settings: data.settings.map(row => ({ ...row, class_id: null })),
    rules: data.rules.map(row => ({ ...row, class_id: null })),
    items: data.items.map(row => ({ ...row, class_id: null })),
    evaluations: data.evaluations.map(row => ({ ...row, ...emptyActor })),
    redemptions: [], events: []
  }
  const settings = new Map<string, Map<string, string>>(), items = new Map<string, Map<string, string>>()
  for (const classroom of data.classes) {
    const policies = new Map<string, string>(), products = new Map<string, string>()
    settings.set(classroom.id, policies); items.set(classroom.id, products)
    for (const row of data.settings) {
      const id = randomUUID(); policies.set(row.id, id)
      result.settings.push({ ...row, id, class_id: classroom.id })
    }
    for (const row of data.rules) result.rules.push({ ...row, id: randomUUID(), class_id: classroom.id })
    for (const row of data.items) {
      const id = randomUUID(); products.set(row.id, id)
      result.items.push({ ...row, id, class_id: classroom.id })
    }
  }
  const students = new Map(data.students.map(row => [row.id, row.class_id]))
  result.events = data.events.map(row => ({ ...row, settings_id: settings.get(students.get(row.student_id)!)!.get(row.settings_id)! }))
  result.redemptions = data.redemptions.map(row => ({
    ...row, ...emptyActor,
    item_id: row.item_id ? items.get(students.get(row.student_id)!)!.get(row.item_id) || null : null
  }))
  return result
}

function validateScoped(data: ScopedBackup | BackgroundBackup | ArchiveBackup) {
  validateIds(data)
  const fail = () => { throw new DomainError('invalidBackup') }
  const bundles = new Map<string | null, CurrentBackup>()
  const bundle = (classId: string | null) => {
    const value = bundles.get(classId)
    if (!value) return fail()
    return value
  }
  const empty = (classes: CurrentBackup['classes']): CurrentBackup => ({ version: 3, classes, students: [], rules: [], evaluations: [], badges: [], items: [], redemptions: [], settings: [], events: [] })
  bundles.set(null, empty([]))
  for (const classroom of data.classes) bundles.set(classroom.id, empty([classroom]))
  for (const row of data.settings) bundle(row.class_id).settings.push(row)
  for (const row of data.rules) bundle(row.class_id).rules.push(row)
  for (const row of data.items) bundle(row.class_id).items.push(row)
  const students = new Map(data.students.map(row => [row.id, row.class_id]))
  const studentBundle = (studentId: string) => {
    const classId = students.get(studentId)
    if (!classId) return fail()
    return bundle(classId)
  }
  for (const row of data.students) bundle(row.class_id).students.push(row)
  for (const row of data.evaluations) studentBundle(row.student_id).evaluations.push(row)
  for (const row of data.badges) studentBundle(row.student_id).badges.push(row)
  for (const row of data.redemptions) studentBundle(row.student_id).redemptions.push(row)
  let seq = -1
  for (const row of data.events) {
    if (row.seq <= seq) fail()
    seq = row.seq
    studentBundle(row.student_id).events.push(row)
  }
  const items = new Map(data.items.map(row => [row.id, row.class_id]))
  for (const row of data.redemptions) {
    if (row.item_id !== null && (!items.has(row.item_id) || items.get(row.item_id) !== students.get(row.student_id))) fail()
  }
  const batches = new Map<string, string>(), totals = new Map<string, number>()
  for (const row of data.evaluations) {
    const classId = students.get(row.student_id)!
    if (batches.has(row.batch_id) && batches.get(row.batch_id) !== classId) fail()
    batches.set(row.batch_id, classId)
    if (!row.undone) {
      const total = (totals.get(row.student_id) || 0) + row.points
      if (!Number.isSafeInteger(total)) fail()
      totals.set(row.student_id, total)
    }
  }
  for (const value of bundles.values()) {
    if (!value.settings.length || value.settings.length > 10000 || value.rules.length > 2000) fail()
    validateCurrent(value)
  }
}

function validateBackgrounds(data: BackgroundBackup | ArchiveBackup) {
  const fail = () => { throw new DomainError('invalidBackup') }
  const items = new Map(data.items.map(row => [row.id, row]))
  const scoped = new Map<string | null, Set<string>>()
  for (const row of data.items) {
    if (row.background_id === null) continue
    if (row.image !== null || row.stock !== -1) fail()
    const seen = scoped.get(row.class_id) || new Set<string>()
    if (seen.has(row.background_id)) fail()
    seen.add(row.background_id)
    scoped.set(row.class_id, seen)
  }
  const owned = new Map<string, Set<string>>()
  for (const row of data.redemptions) {
    const item = row.item_id === null ? undefined : items.get(row.item_id)
    if (row.background_id !== (item?.background_id ?? null)) fail()
    if (row.background_id === null || row.undone) continue
    const backgrounds = owned.get(row.student_id) || new Set<string>()
    if (backgrounds.has(row.background_id)) fail()
    backgrounds.add(row.background_id)
    owned.set(row.student_id, backgrounds)
  }
  for (const row of data.students) if (row.background_id !== null && !owned.get(row.id)?.has(row.background_id)) fail()
}

async function validateImages(items: CurrentBackup['items'] | ScopedBackup['items']) {
  const totals = new Map<string | null, number>()
  const validated = new Map<string, Awaited<ReturnType<typeof validateStoredImage>>>()
  for (const row of items) {
    if (row.image === null) {
      if (row.image_key !== null || row.image_bytes !== 0) throw new DomainError('invalidBackup')
    } else {
      let image = validated.get(row.image)
      if (!image) {
        try { image = await validateStoredImage(row.image) } catch { throw new DomainError('invalidBackup') }
        validated.set(row.image, image)
      }
      if (row.image_key !== image.image_key || row.image_bytes !== image.image_bytes) throw new DomainError('invalidBackup')
      const classId = 'class_id' in row ? row.class_id : null
      const total = (totals.get(classId) || 0) + image.image_bytes
      if (total > MAX_CLASS_IMAGE_BYTES) throw new DomainError('imageStorageFull', 409)
      totals.set(classId, total)
    }
  }
}

export async function exportBackup(garden: Garden, owner: string) {
  const db = garden.db
  return await db.transaction(async () => {
    await garden.requireProfile(owner)
    const resources = async (table: string, columns: string, order = 'r.rowid') => (await db.prepare(`
      SELECT ${columns} FROM ${table} r LEFT JOIN classes c ON c.id = r.class_id
      WHERE (r.class_id IS NULL AND r.owner_id = ?) OR c.owner_id = ?
      ORDER BY CASE WHEN r.class_id IS NULL THEN 0 ELSE 1 END, c.rowid, ${order}
    `).all(owner, owner))
    const data: ArchiveBackup = {
      version: 8, exportedAt: new Date().toISOString(),
      settings: (await resources('settings_versions', 'r.id, r.class_id, r.version, r.value, r.created_at', 'r.version') as { id: string; class_id: string | null; version: number; value: string; created_at: number }[]).map(row => ({ ...row, value: JSON.parse(row.value) })),
      rules: await resources('rules', 'r.id, r.class_id, r.name, r.points, r.category, r.custom') as ScopedBackup['rules'],
      items: await resources('items', 'r.id, r.class_id, r.name, r.cost, r.active, r.description, r.category, r.icon, r.image, r.image_key, r.image_bytes, r.stock, r.background_id') as BackgroundBackup['items'],
      classes: await db.prepare('SELECT id, name, created_at FROM classes WHERE owner_id = ? ORDER BY rowid').all(owner) as ScopedBackup['classes'],
      students: await db.prepare('SELECT s.id, s.class_id, s.name, s.student_no, s.points, s.pet_id, s.pet_exp, s.generation, s.spent_badges, s.created_at, s.background_id, s.archived_at FROM students s JOIN classes c ON c.id = s.class_id WHERE c.owner_id = ? ORDER BY s.rowid').all(owner) as ArchiveBackup['students'],
      evaluations: await db.prepare('SELECT e.id, e.batch_id, e.student_id, e.points, e.reason, e.category, e.generation, e.created_at, e.undone, e.actor_name, e.actor_subject, e.undone_by_name, e.undone_by_subject FROM evaluations e JOIN students s ON s.id = e.student_id JOIN classes c ON c.id = s.class_id WHERE c.owner_id = ? ORDER BY e.rowid').all(owner) as ScopedBackup['evaluations'],
      badges: await db.prepare('SELECT b.* FROM badges b JOIN students s ON s.id = b.student_id JOIN classes c ON c.id = s.class_id WHERE c.owner_id = ? ORDER BY b.rowid').all(owner) as ScopedBackup['badges'],
      redemptions: await db.prepare('SELECT r.id, r.student_id, r.item_id, r.item_name, r.cost, r.created_at, r.undone, r.stock_deducted, r.actor_name, r.actor_subject, r.undone_by_name, r.undone_by_subject, r.background_id FROM redemptions r JOIN students s ON s.id = r.student_id JOIN classes c ON c.id = s.class_id WHERE c.owner_id = ? ORDER BY r.rowid').all(owner) as BackgroundBackup['redemptions'],
      events: await db.prepare('SELECT e.* FROM growth_events e JOIN students s ON s.id = e.student_id JOIN classes c ON c.id = s.class_id WHERE c.owner_id = ? ORDER BY e.seq').all(owner) as ScopedBackup['events']
    }
    if (!archiveSchema.safeParse(data).success || Buffer.byteLength(JSON.stringify(data, null, 2)) > MAX_BACKUP_BYTES) throw new DomainError('backupTooLarge', 413)
    return data
  }).deferred()
}

export async function restoreBackup(garden: Garden, owner: string, input: unknown) {
  await garden.requireProfile(owner)
  let serialized: string | undefined
  try { serialized = JSON.stringify(input) } catch { throw new DomainError('invalidBackup') }
  if (serialized === undefined) throw new DomainError('invalidBackup')
  if (Buffer.byteLength(serialized) > MAX_BACKUP_BYTES) throw new DomainError('backupTooLarge', 413)
  const version = z.object({ version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]) }).parse(input).version
  let data: BackgroundBackup | ArchiveBackup
  if (version === 8) {
    const parsed = archiveSchema.safeParse(input)
    if (!parsed.success) throw new DomainError('invalidBackup')
    data = parsed.data
  } else if (version === 7) {
    const parsed = festivalSchema.safeParse(input)
    if (!parsed.success) throw new DomainError('invalidBackup')
    data = parsed.data
  } else if (version === 6) {
    const parsed = holidaySchema.safeParse(input)
    if (!parsed.success) throw new DomainError('invalidBackup')
    data = { ...parsed.data, version: 7 }
  } else if (version === 5) {
    const parsed = backgroundSchema.safeParse(input)
    if (!parsed.success) throw new DomainError('invalidBackup')
    data = { ...parsed.data, version: 7 }
  } else if (version === 4) {
    const parsed = scopedSchema.safeParse(input)
    if (!parsed.success) throw new DomainError('invalidBackup')
    validateScoped(parsed.data)
    data = upgradeBackgrounds(parsed.data)
  } else {
    const legacy = version === 3 ? currentSchema.parse(input) : upgradeVersionTwo(version === 1 ? upgradeLegacy(legacySchema.parse(input)) : schema.parse(input))
    validateCurrent(legacy)
    validateIds(legacy)
    const scoped = splitLegacy(legacy)
    validateScoped(scoped)
    data = upgradeBackgrounds(scoped)
  }
  validateScoped(data)
  validateBackgrounds(data)
  await validateImages(data.items)
  const mappings = new Map<string, string>()
  function add(kind: string, value: string) {
    const key = `${kind}:${value}`
    if (mappings.has(key)) throw new DomainError('invalidBackup')
    const mapped = randomUUID(); mappings.set(key, mapped); return mapped
  }
  function ref(kind: string, value: string) {
    const mapped = mappings.get(`${kind}:${value}`)
    if (!mapped) throw new DomainError('invalidBackup')
    return mapped
  }
  for (const kind of rowKinds) for (const row of data[kind]) add(kind, row.id)
  for (const row of data.evaluations) if (!mappings.has(`batch:${row.batch_id}`)) add('batch', row.batch_id)
  const classIds = data.classes.map(row => ref('classes', row.id)), db = garden.db
  return await db.transaction(async () => {
    await garden.requireProfile(owner)
    const statements: Statement[] = []
    for (const row of data.classes) {
      const classId = ref('classes', row.id)
      statements.push({ sql: 'INSERT INTO classes (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)', args: [classId, owner, row.name, row.created_at] })
      statements.push({ sql: 'INSERT INTO class_members (class_id, user_id, joined_at) VALUES (?, ?, ?)', args: [classId, owner, Date.now()] })
    }
    for (const row of data.settings) if (row.class_id !== null) statements.push({ sql: 'INSERT INTO settings_versions (id, owner_id, class_id, version, value, created_at) VALUES (?, ?, ?, ?, ?, ?)', args: [ref('settings', row.id), owner, ref('classes', row.class_id), row.version, JSON.stringify(row.value), row.created_at] })
    for (const row of data.students) statements.push({ sql: 'INSERT INTO students (id, class_id, name, student_no, points, pet_id, pet_exp, generation, spent_badges, created_at, background_id, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [ref('students', row.id), ref('classes', row.class_id), row.name, row.student_no, row.points, row.pet_id, row.pet_exp, row.generation, row.spent_badges, row.created_at, row.background_id, 'archived_at' in row ? row.archived_at : null] })
    for (const row of data.rules) if (row.class_id !== null) statements.push({ sql: 'INSERT INTO rules (id, owner_id, class_id, name, points, category, custom) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [ref('rules', row.id), owner, ref('classes', row.class_id), row.name, row.points, row.category, row.custom] })
    for (const row of data.evaluations) statements.push({ sql: 'INSERT INTO evaluations (id, batch_id, student_id, points, reason, category, generation, created_at, undone, actor_user_id, actor_name, actor_subject, undone_by_user_id, undone_by_name, undone_by_subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)', args: [ref('evaluations', row.id), ref('batch', row.batch_id), ref('students', row.student_id), row.points, row.reason, row.category, row.generation, row.created_at, row.undone, row.actor_name, row.actor_subject, row.undone_by_name, row.undone_by_subject] })
    for (const row of data.events) statements.push({ sql: 'INSERT INTO growth_events (id, student_id, generation, kind, settings_id, evaluation_id, pet_id, initial_undone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [ref('events', row.id), ref('students', row.student_id), row.generation, row.kind, ref('settings', row.settings_id), row.evaluation_id ? ref('evaluations', row.evaluation_id) : null, row.pet_id, row.initial_undone, row.created_at] })
    for (const row of data.badges) statements.push({ sql: 'INSERT INTO badges (id, student_id, generation, pet_id, earned_at, level, amount, active, source_event) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [ref('badges', row.id), ref('students', row.student_id), row.generation, row.pet_id, row.earned_at, row.level, row.amount, row.active, ref('events', row.source_event)] })
    for (const row of data.items) if (row.class_id !== null) statements.push({ sql: 'INSERT INTO items (id, owner_id, class_id, name, cost, active, description, category, icon, image, image_key, image_bytes, stock, background_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [ref('items', row.id), owner, ref('classes', row.class_id), row.name, row.cost, row.active, row.description, row.category, row.icon, row.image, row.image_key, row.image_bytes, row.stock, row.background_id] })
    for (const row of data.redemptions) statements.push({ sql: 'INSERT INTO redemptions (id, student_id, item_id, item_name, cost, created_at, undone, stock_deducted, actor_user_id, actor_name, actor_subject, undone_by_user_id, undone_by_name, undone_by_subject, background_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)', args: [ref('redemptions', row.id), ref('students', row.student_id), row.item_id ? ref('items', row.item_id) : null, row.item_name, row.cost, row.created_at, row.undone, row.stock_deducted, row.actor_name, row.actor_subject, row.undone_by_name, row.undone_by_subject, row.background_id] })
    await db.batch(statements)
    if (version < 5) for (const classId of classIds) await initializeBackgroundItems(db, owner, classId)
    else if (version === 5) for (const classId of classIds) await initializeBackgroundItems(db, owner, classId, [...holidayBackgroundIds, ...versionSevenBackgroundIds])
    else if (version === 6) for (const classId of classIds) await initializeBackgroundItems(db, owner, classId, versionSevenBackgroundIds)
    return { imported: classIds.length, classIds }
  }).immediate()
}
