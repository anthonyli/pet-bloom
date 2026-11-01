import { defaultGardenSettings, type GardenSettings, type GrowthStep } from './garden-settings'

export const growthThresholds = [0, 40, 100, 180, 280, 400, 540, 700] as const
const defaultSteps = defaultGardenSettings().growth
export function thresholdsFor(steps: GrowthStep[] = defaultSteps) {
  const thresholds = [0]
  for (const step of steps) thresholds.push(thresholds.at(-1)! + step.experience)
  return thresholds
}
export function growthLevel(exp: number, steps: GrowthStep[] = defaultSteps) {
  return Math.max(1, thresholdsFor(steps).filter(threshold => exp >= threshold).length)
}
export function growthProgress(exp: number, steps: GrowthStep[] = defaultSteps) {
  const thresholds = thresholdsFor(steps), level = growthLevel(exp, steps)
  if (level === 8) return { level, current: exp, required: thresholds[7], percentage: 100 }
  const current = exp - thresholds[level - 1], required = steps[level - 1].experience
  return { level, current, required, percentage: Math.max(0, Math.min(100, current / required * 100)) }
}
export function rebaseExperience(exp: number, before: GrowthStep[], after: GrowthStep[]) {
  if (exp < 0) return exp
  const progress = growthProgress(exp, before), thresholds = thresholdsFor(after)
  if (progress.level === 8) return thresholds[7] + Math.max(0, exp - thresholdsFor(before)[7])
  const end = thresholds[progress.level]
  return Math.min(thresholds[progress.level - 1] + progress.current / progress.required * after[progress.level - 1].experience, end - Math.max(1, end) * Number.EPSILON * 2)
}
export function replayGrowth(records: { points: number; created_at: number }[]) {
  let exp = 0
  const levels = new Map<number, number>()
  for (const record of records) {
    exp = Math.max(0, exp + record.points)
    for (let level = 2; level <= growthLevel(exp); level++) if (!levels.has(level)) levels.set(level, record.created_at)
  }
  return { exp, levels }
}

export interface GrowthEvent {
  id: string; seq: number; student_id: string; generation: number;
  kind: 'start' | 'evaluation' | 'rebase' | 'undo' | 'change'; settings_id: string;
  evaluation_id: string | null; pet_id: string | null; initial_undone: number; created_at: number
}
export interface GrowthEvaluation { id: string; student_id: string; generation: number; points: number; created_at: number; undone: number }
export interface GrowthAward { level: number; amount: number; earned_at: number; pet_id: string; source_event: string }

export function replayEvents(events: GrowthEvent[], evaluations: Map<string, GrowthEvaluation>, settings: Map<string, GardenSettings>) {
  const removed = new Set<string>(), locks = new Map<number, GrowthAward>()
  let steps = 0
  function apply(history: GrowthEvent[]) {
    let exp = 0, petId: string | null = null, policy: GardenSettings | undefined, lastFedAt = 0, adoptedAt = 0
    const levels = new Map<number, GrowthAward>()
    for (const event of history) {
      if (++steps > 2000000) throw new Error('growthHistoryTooLarge')
      const next = settings.get(event.settings_id)
      if (!next) throw new Error('invalidGrowthHistory')
      if (event.kind === 'start') { petId = event.pet_id; policy = next; adoptedAt = event.created_at; lastFedAt = adoptedAt }
      else if (event.kind === 'change') petId = event.pet_id
      else if (event.kind === 'rebase') { exp = rebaseExperience(exp, (policy || next).growth, next.growth); policy = next }
      else if (event.kind === 'evaluation') {
        const record = evaluations.get(event.evaluation_id!)
        if (!record || record.student_id !== event.student_id || record.generation !== event.generation) throw new Error('invalidGrowthHistory')
        if (event.initial_undone || removed.has(record.id)) continue
        if (petId && policy && JSON.stringify(policy.growth) !== JSON.stringify(next.growth)) throw new Error('invalidGrowthHistory')
        policy = next
        if (!petId) continue
        exp = next.signedGrowth ? exp + record.points : Math.max(0, exp + record.points)
        if (record.points > 0) lastFedAt = Math.max(lastFedAt, record.created_at)
        for (let level = 2; level <= growthLevel(exp, next.growth); level++) {
          if (levels.has(level)) continue
          if (!locks.has(level)) locks.set(level, { level, amount: next.growth[level - 2].badges, earned_at: record.created_at, pet_id: petId, source_event: event.id })
          levels.set(level, { ...locks.get(level)!, earned_at: record.created_at })
        }
      }
      if (!Number.isFinite(exp) || Math.abs(exp) > Number.MAX_SAFE_INTEGER) throw new Error('scoreLimitExceeded')
    }
    return { exp, levels, locks, lastFedAt, adoptedAt, petId }
  }
  const prefix: GrowthEvent[] = []
  let result = apply([])
  // 撤回改变有效历史；每次重放仍保留首次发放额度，防止改规则后重复领取。
  let segment: GrowthEvent[] = []
  for (const event of events) {
    prefix.push(event)
    if (event.kind === 'undo') {
      if (!event.evaluation_id || !prefix.some(previous => previous.kind === 'evaluation' && previous.evaluation_id === event.evaluation_id) || removed.has(event.evaluation_id)) throw new Error('invalidGrowthHistory')
      if (segment.length) apply(prefix.slice(0, -1))
      removed.add(event.evaluation_id)
      result = apply(prefix)
      segment = []
    } else segment.push(event)
  }
  if (segment.length) result = apply(prefix)
  return { ...result, removed }
}
