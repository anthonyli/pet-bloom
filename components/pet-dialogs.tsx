'use client'
import { useId, useRef, useState } from 'react'
import { Award, Search, Plus, Minus, PawPrint, MessageSquare, ListFilter, TrendingUp, BookOpen, HandHeart, HeartPulse, Shapes, RefreshCw } from 'lucide-react'
import { Button, Dialog, Input, cn } from '@/components/ui'
import { translator, errorMessage, studentPetImage, petById, growth, formatGrowth, categories, categoryName } from '@/lib/i18n'
import type { GrowthStep } from '@/lib/garden-settings'
import type { Locale, Student } from '@/lib/types'
import { api, ApiError, type GardenClient } from './use-garden'

export function GrowthBar({ exp, locale, steps }: { exp: number; locale: Locale; steps: GrowthStep[] }) {
  const p = growth(exp, steps), t = translator(locale)
  return <div><div className="mb-2 flex justify-between text-xs text-muted"><span className="inline-flex items-center gap-1"><TrendingUp size={12} aria-hidden="true" />{p.level === 8 ? t('已毕业', 'Graduated') : t('成长值', 'Growth')}</span><span className="tabular">{formatGrowth(p.current, locale)} / {formatGrowth(p.required, locale)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#ece7fa]" role="progressbar" aria-label={t('宠物成长进度', 'Pet growth progress')} aria-valuenow={Math.round(p.percentage)} aria-valuemin={0} aria-valuemax={100} title={`${Math.round(p.percentage)}%`}><div className="growth-fill h-full rounded-full bg-primary" style={{ width: `${p.percentage}%` }} /></div></div>
}
export function PetStateLabel({ student, locale }: { student: Student; locale: Locale }) {
  const t = translator(locale), status = student.status
  if (!status || status.form === 'unadopted' || (status.form === 'normal' && !status.hungry)) return null
  return <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-[#925020]">{status.form === 'egg' ? <span>{t('蛋形态 · 加分可恢复', 'Egg state · earn points to recover')}</span> : status.form === 'sick' ? <span>{t('生病了 · 加分可恢复', 'Sick · earn points to recover')}</span> : null}{status.hungry && <span>{t('饥饿提醒', 'Hungry')}</span>}</span>
}
type CustomEvaluation = { points: number; reason: string }
type EvaluationChoice = { ruleId: string } | { custom: CustomEvaluation }

function CustomEvaluationForm({ positive, locale, disabled, onSubmit }: { positive: boolean; locale: Locale; disabled: boolean; onSubmit: (value: CustomEvaluation) => Promise<string> }) {
  const t = translator(locale), id = useId(), scoreInput = useRef<HTMLInputElement>(null), reasonInput = useRef<HTMLInputElement>(null), submitting = useRef(false)
  const [points, setPoints] = useState(positive ? '1' : '-1'), [reason, setReason] = useState(''), [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ field: 'points' | 'reason' | null; message: string } | null>(null)
  const minimum = positive ? 1 : Number.MIN_SAFE_INTEGER, maximum = positive ? Number.MAX_SAFE_INTEGER : -1, score = Number(points)
  const validScore = points.trim() !== '' && Number.isSafeInteger(score) && score >= minimum && score <= maximum
  const title = positive ? t('自定义加分', 'Custom bonus') : t('自定义扣分', 'Custom deduction')
  function step(change: number) {
    const current = points.trim() && Number.isSafeInteger(score) ? score : 0
    setPoints(String(Math.min(maximum, Math.max(minimum, current + change)))); setError(null)
  }
  return <form noValidate aria-busy={saving} aria-labelledby={`${id}-title`} className={cn('min-w-0 rounded-2xl border p-3', positive ? 'border-[#d0eadb] bg-[#f4fbf6]' : 'border-[#f0d6dc] bg-[#fff7f8]')} onSubmit={async event => {
    event.preventDefault()
    if (disabled || submitting.current) return
    if (!validScore) { setError({ field: 'points', message: Number.isInteger(score) && !Number.isSafeInteger(score) ? t('分数过大，无法准确保存，请减小后重试。', 'This score is too large to save accurately. Use a smaller whole score.') : positive ? t('加分请输入正整数。', 'Enter a positive whole score.') : t('扣分请输入负整数。', 'Enter a negative whole score.') }); scoreInput.current?.focus(); return }
    if (reason.trim().length > 80) { setError({ field: 'reason', message: t('原因最多 80 字，请缩短后提交。', 'Use no more than 80 characters for the reason.') }); reasonInput.current?.focus(); return }
    setError(null); submitting.current = true; setSaving(true)
    try {
      const failure = await onSubmit({ points: score, reason: reason.trim() })
      if (failure) setError({ field: null, message: failure })
    } finally { submitting.current = false; setSaving(false) }
  }}>
    <fieldset disabled={disabled || saving} className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-title`} className={cn('flex min-w-24 flex-1 items-center gap-1.5 text-[13px] font-semibold', positive ? 'text-success' : 'text-danger')}>{positive ? <Plus size={15} aria-hidden="true" /> : <Minus size={15} aria-hidden="true" />}{title}</h3>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Button type="button" variant="ghost" className={cn('min-h-11 min-w-11 px-0 py-1.5 sm:min-h-9 sm:min-w-9', positive ? 'text-success hover:bg-[#e5f5eb]' : 'text-danger hover:bg-[#fdebef]')} disabled={validScore && score <= minimum} aria-label={positive ? t('减小自定义加分', 'Decrease bonus score') : t('减小自定义扣分数值', 'Decrease deduction score')} onClick={() => step(-1)}><Minus size={16} aria-hidden="true" /></Button>
          <Input ref={scoreInput} id={`${id}-points`} type="number" inputMode={positive ? 'numeric' : 'text'} min={positive ? 1 : undefined} max={positive ? undefined : -1} step={1} required value={points} aria-label={positive ? t('自定义加分分值', 'Custom bonus points') : t('自定义扣分分值', 'Custom deduction points')} aria-invalid={error?.field === 'points' || undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setPoints(event.target.value); setError(null) }} style={{ width: `calc(${Math.min(points.length, 17)}ch + 2.5rem)` }} className={cn('h-11 min-h-11 min-w-20 shrink-0 px-2 py-1.5 text-center text-sm font-semibold tabular sm:h-9 sm:min-h-9 sm:min-w-24', positive ? 'text-success' : 'text-danger')} />
          <Button type="button" variant="ghost" className={cn('min-h-11 min-w-11 px-0 py-1.5 sm:min-h-9 sm:min-w-9', positive ? 'text-success hover:bg-[#e5f5eb]' : 'text-danger hover:bg-[#fdebef]')} disabled={validScore && score >= maximum} aria-label={positive ? t('增大自定义加分', 'Increase bonus score') : t('增大自定义扣分数值', 'Increase deduction score')} onClick={() => step(1)}><Plus size={16} aria-hidden="true" /></Button>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Input ref={reasonInput} id={`${id}-reason`} value={reason} aria-label={positive ? t('加分原因（选填）', 'Bonus reason (optional)') : t('扣分原因（选填）', 'Deduction reason (optional)')} placeholder={positive ? t('加分原因（选填）', 'Reason (optional)') : t('扣分原因（选填）', 'Reason (optional)')} aria-invalid={error?.field === 'reason' || undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setReason(event.target.value); setError(null) }} className="h-11 min-h-11 min-w-0 flex-1 px-2.5 py-1.5 text-[13px] sm:h-9 sm:min-h-9" />
        <Button type="submit" variant="primary" busy={saving} className={cn('h-11 min-h-11 shrink-0 px-3 py-1.5 text-[13px] font-medium hover:brightness-95 sm:h-9 sm:min-h-9', positive ? 'border-success bg-success hover:border-success hover:bg-success' : 'border-danger bg-danger hover:border-danger hover:bg-danger')} aria-label={positive ? t('提交自定义加分', 'Submit custom bonus') : t('提交自定义扣分', 'Submit custom deduction')}>{t('提交', 'Submit')}</Button>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="text-sm leading-relaxed text-danger">{error.message}</p>}
    </fieldset>
  </form>
}

export function EvaluationDialog({ client, locale, studentIds, onClose, onAdopt, onBadges }: { client: GardenClient; locale: Locale; studentIds: string[]; onClose: () => void; onAdopt: (student: Student) => void; onBadges: (student: Student) => void }) {
  const t = translator(locale), [category, setCategory] = useState('study'), [sign, setSign] = useState('all'), [search, setSearch] = useState('')
  const [recovery, setRecovery] = useState<'saved' | 'unknown' | null>(null), [ruleError, setRuleError] = useState('')
  const submitting = useRef(false), submittedBatch = useRef('')
  const steps = client.state!.settings.value.growth
  const students = client.state!.students.filter(student => studentIds.includes(student.id))
  const student = students.length === 1 ? students[0] : null
  const pet = student ? petById(student.pet_id) : null
  const rules = client.state!.rules.filter(rule => rule.category === category && (sign === 'all' || (sign === 'positive' ? rule.points > 0 : rule.points < 0)) && rule.name[locale].toLowerCase().includes(search.toLowerCase()))
  const disabled = client.busy || recovery !== null
  async function submit(choice: EvaluationChoice) {
    if (submitting.current || disabled || submittedBatch.current) return ''
    submitting.current = true; setRuleError('')
    let failure = '', uncertain = false
    try {
      const ok = await client.run(async () => {
        try { submittedBatch.current = (await api<{ batchId: string }>('evaluations', 'POST', { studentIds, ...choice })).batchId }
        catch (error) { uncertain = error instanceof ApiError && error.status === 0; failure = errorMessage(error instanceof ApiError ? error.code === 'invalidInput' ? 'invalidEvaluation' : error.code : 'serverError', locale); throw error }
      }, t('评价已保存，成长正在发生。', 'Saved. A little more growth!'))
      if (ok) onClose()
      else if (submittedBatch.current || uncertain) { setRecovery(submittedBatch.current ? 'saved' : 'unknown'); return '' }
      return failure
    } finally { submitting.current = false }
  }
  return <Dialog open onClose={onClose} wide icon={MessageSquare} title={student ? `${t('评价', 'Encourage')} ${student.name}` : `${t('批量评价', 'Batch evaluation')} · ${students.length}`} description={t('选择常用评价，或直接输入本次分数。积分与宠物成长同步更新。', 'Choose a rule or enter a score for this evaluation. Points and pet growth update together.')} className="flex max-h-[90dvh] flex-col overflow-hidden">
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2">
    {student && <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl bg-[#f5f2ff] p-4">
      <img src={studentPetImage(student, steps)} alt={pet?.name[locale] || t('等待领养的宠物蛋', 'Pet egg waiting for adoption')} className={cn('size-20 shrink-0 rounded-xl bg-white object-contain', student.status?.form === 'sick' && 'grayscale')} />
      <div className="min-w-0 flex-1 basis-40">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">{pet?.name[locale] || t('等待领养', 'Waiting to adopt')} · Lv.{growth(student.pet_exp, steps).level}</span>
          <Button className="min-h-10 gap-1.5 border-[#ead89d] bg-[#fff0c4] px-3 text-xs text-[#795c1c] hover:border-[#c4a75c] hover:bg-[#ffe6a4]" disabled={client.busy} aria-haspopup="dialog" onClick={() => onBadges(student)}><Award size={16} aria-hidden="true" />{t('查看徽章', 'View badges')}<span className="tabular">{Math.max(0, student.badge_count - student.spent_badges)} {t('可用', 'available')}</span></Button>
        </div>
        <div className="mb-3"><PetStateLabel student={student} locale={locale} /></div>
        <GrowthBar exp={student.pet_exp} locale={locale} steps={steps} />
      </div>
      {growth(student.pet_exp, steps).level === 8 && <Button onClick={() => onAdopt(student)}><PawPrint size={16} aria-hidden="true" />{t('领养新宠物', 'Adopt again')}</Button>}
    </div>}
    {recovery && <div role="alert" className="mb-5 space-y-3 rounded-xl border border-line bg-[#f5f2ff] p-4"><p className="text-sm leading-relaxed">{recovery === 'saved' ? t('评价已保存，但最新数据未能加载。请重新加载，不要重复提交。', 'Your evaluation was saved, but the latest data could not load. Reload without submitting again.') : t('连接中断，暂时无法确认是否保存。请重新加载并检查记录，避免重复评分。', 'The connection was interrupted, so the result is not confirmed. Reload and check the history before scoring again.')}</p><Button busy={client.busy} onClick={async () => { if (await client.run(async () => {}, t('已加载最新评价记录。', 'The latest evaluation records are loaded.'))) onClose() }}><RefreshCw size={16} aria-hidden="true" />{t('重新加载', 'Reload')}</Button></div>}
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      <CustomEvaluationForm positive locale={locale} disabled={disabled} onSubmit={custom => submit({ custom })} />
      <CustomEvaluationForm positive={false} locale={locale} disabled={disabled} onSubmit={custom => submit({ custom })} />
    </div>
    <div className="section-tabs mb-4">{categories.map(item => <button key={item} className={cn('tab inline-flex items-center gap-2', item === category && 'tab-active')} onClick={() => setCategory(item)}>{item === 'study' ? <BookOpen size={15} /> : item === 'behavior' ? <HandHeart size={15} /> : item === 'health' ? <HeartPulse size={15} /> : <Shapes size={15} />}{categoryName(item, locale)}</button>)}</div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2">{[['all', t('全部', 'All')], ['positive', t('加分', 'Positive')], ['negative', t('扣分', 'Negative')]].map(([value, label]) => <Button key={value} className={cn('min-h-8 px-3 py-1 text-xs', sign === value && 'border-primary bg-[#f0ebff] text-primary')} onClick={() => setSign(value)}>{value === 'positive' ? <Plus size={14} /> : value === 'negative' ? <Minus size={14} /> : <ListFilter size={14} />}{label}</Button>)}</div><div className="relative w-full sm:w-52"><Search size={15} className="absolute left-3 top-3 text-muted" /><Input aria-label={t('搜索评价规则', 'Search evaluation rules')} placeholder={t('搜索规则', 'Search rules')} value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div></div>
    {ruleError && <p role="alert" className="mb-4 text-sm leading-relaxed text-danger">{ruleError}</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{rules.map(rule => <button key={rule.id} disabled={disabled} className={cn('flex min-h-24 flex-col items-start justify-between gap-3 rounded-xl border p-3.5 text-left transition-colors disabled:opacity-50', rule.points > 0 ? 'border-[#d0eadb] bg-[#f4fbf6] hover:bg-[#e5f5eb]' : 'border-[#f0d6dc] bg-[#fff7f8] hover:bg-[#fdebef]')} onClick={async () => { setRuleError(await submit({ ruleId: rule.id })) }}><span className={cn('flex items-center gap-1 text-lg font-bold tabular', rule.points > 0 ? 'text-success' : 'text-danger')}>{rule.points > 0 ? <Plus size={16} /> : <Minus size={16} />}{Math.abs(rule.points)}</span><span className="text-sm leading-relaxed">{rule.name[locale]}</span></button>)}</div>
    {!rules.length && <p className="py-8 text-center text-sm text-muted">{t('没有符合条件的规则。', 'No matching rules.')}</p>}
    </div>
  </Dialog>
}
export { PetPicker } from './pet-picker'
