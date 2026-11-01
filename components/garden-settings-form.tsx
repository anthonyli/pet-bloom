'use client'
import { useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Button, Checkbox, Field, Input, cn } from '@/components/ui'
import { gardenSettingsSchema, graduationExperience, type GardenSettings } from '@/lib/garden-settings'
import { translator, errorMessage } from '@/lib/i18n'
import type { Locale } from '@/lib/types'
import { api, ApiError, type GardenClient } from './use-garden'

export function GardenSettingsForm({ client, locale, page }: { client: GardenClient; locale: Locale; page: 'growth' | 'status' }) {
  const t = translator(locale)
  const [value, setValue] = useState(() => structuredClone(client.state!.settings.value))
  const [version, setVersion] = useState(client.state!.settings.version)
  const [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const days = Math.floor(value.hunger.minutes / 1440), hours = Math.floor(value.hunger.minutes % 1440 / 60), minutes = value.hunger.minutes % 60
  function update(patch: Partial<GardenSettings>) { setValue(current => ({ ...current, ...patch })); setSaved(false); setError('') }
  function hunger(patch: Partial<GardenSettings['hunger']>) { update({ hunger: { ...value.hunger, ...patch } }) }
  function toggle(id: string, label: string, checked: boolean, change: (checked: boolean) => void, description?: string) {
    return <div className="flex items-start justify-between gap-5 py-4"><div className="min-w-0"><label htmlFor={id} className="cursor-pointer text-sm font-semibold">{label}</label>{description && <p id={`${id}-help`} className="mt-1 text-sm leading-relaxed text-muted">{description}</p>}</div><Button id={id} type="button" role="switch" aria-checked={checked} aria-describedby={description ? `${id}-help` : undefined} aria-label={label} disabled={client.busy} onClick={() => change(!checked)} className={cn('min-h-11 w-14 shrink-0 border-transparent p-1 hover:border-transparent', checked ? 'bg-primary hover:bg-primary' : 'bg-[#e8e2f3] hover:bg-[#ddd5ed]')}><span className={cn('flex w-full', checked && 'justify-end')}><span className="block size-5 rounded-full bg-white shadow-sm" /></span></Button></div>
  }
  return <form className="flex h-full min-h-0 flex-col gap-5" onSubmit={async event => {
    event.preventDefault(); setError(''); setSaved(false)
    if (!gardenSettingsSchema.safeParse(value).success) { setError(t('请检查经验、徽章、提醒时长、时区和假期日期；结束日期不能早于开始日期。', 'Check experience, badges, reminder duration, time zone and holiday dates. End dates must not precede start dates.')); return }
    let nextVersion = version
    const ok = await client.run(async () => { try { nextVersion = (await api<{ version: number }>('settings', 'PATCH', { classId: client.classId, version, value })).version } catch (error) { const code = error instanceof ApiError ? error.code === 'invalidInput' ? 'invalidSettings' : error.code : 'serverError'; setError(errorMessage(code, locale)); throw new ApiError(code, error instanceof ApiError ? error.status : 500) } })
    if (ok) { setVersion(nextVersion); setSaved(true) }
  }}>
    <fieldset disabled={client.busy} className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-1 pb-2">
      {page === 'growth' ? <>
        <p className="text-sm leading-relaxed text-muted">{t('保存后立即生效，保留当前等级与本级进度比例。已获徽章不追扣，每轮每级只奖励一次。', 'Changes apply immediately, preserving each pet’s level and progress within it. Existing badges are kept; each level rewards once per cycle.')}</p>
        <div className="grid grid-cols-[minmax(4rem,1fr)_1fr_1fr] gap-x-3 gap-y-3 text-sm sm:gap-x-6">
          <span className="self-end pb-2 font-semibold">{t('升级阶段', 'Level')}</span><span className="self-end pb-2 font-semibold">{t('所需经验', 'Experience')}</span><span className="self-end pb-2 font-semibold">{t('奖励徽章', 'Badges')}</span>
          {value.growth.map((step, index) => <div key={index} className="contents"><span className="flex items-center text-sm font-medium">Lv.{index + 1} → {index + 2}</span>{(['experience', 'badges'] as const).map(key => <Input key={key} type="number" inputMode="numeric" required min={key === 'experience' ? 1 : 0} max={key === 'experience' ? 10000 : 100} step={1} aria-label={t(`Lv.${index + 1} 到 Lv.${index + 2} ${key === 'experience' ? '所需经验' : '奖励徽章'}`, `Lv.${index + 1} to Lv.${index + 2} ${key === 'experience' ? 'experience' : 'badges'}`)} value={Number.isNaN(step[key]) ? '' : step[key]} placeholder={key === 'experience' ? '40' : '1'} onChange={event => update({ growth: value.growth.map((row, i) => i === index ? { ...row, [key]: event.target.value === '' ? NaN : Number(event.target.value) } : row) })} />)}</div>)}
        </div>
        <p className="border-t border-line pt-4 text-sm">{t('毕业所需总经验', 'Total experience to graduate')}<strong className="ml-3 tabular text-primary">{Number.isFinite(graduationExperience(value.growth)) ? graduationExperience(value.growth) : '—'}</strong></p>
      </> : <div className="divide-y divide-line">
        <section>{toggle('allow-change', t('允许更换宠物', 'Allow changing companions'), value.allowChangePet, allowChangePet => update({ allowChangePet }), t('更换种类保留成长、积分和徽章，不影响首次领养或毕业后重新领养。', 'Changing species keeps growth, points and badges. First adoption and adoption after graduation remain available.'))}</section>
        <section className="pb-5">
          {toggle('hunger-enabled', t('饥饿提醒', 'Hunger reminders'), value.hunger.enabled, enabled => hunger({ enabled }), t('从领养或最后一次有效加分开始计时；扣分不会喂养。仅提醒，不自动扣分。', 'Time starts at adoption or the last active positive evaluation. Deductions do not feed pets. Reminders never deduct points.'))}
          {value.hunger.enabled && <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">{[[t('天', 'Days'), days, 1440], [t('小时', 'Hours'), hours, 60], [t('分钟', 'Minutes'), minutes, 1]].map(([label, number, unit], index) => <Field key={index} id={`hunger-time-${index}`} label={String(label)}><Input id={`hunger-time-${index}`} type="number" min={0} max={index === 0 ? 365 : index === 1 ? 23 : 59} step={1} required value={Number.isNaN(number) ? '' : number} placeholder={index === 0 ? '2' : '0'} onChange={event => hunger({ minutes: value.hunger.minutes - Number(number) * Number(unit) + Number(event.target.value) * Number(unit) })} /></Field>)}</div>
            <p className="text-xs text-muted">{t('总时长需大于 0，最多 365 天。', 'Duration must be greater than zero and no more than 365 days.')}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-3">{([['excludeWeekends', t('周末不计入', 'Exclude weekends')], ['excludeHolidays', t('节假日不计入', 'Exclude holidays')]] as const).map(([key, label]) => <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><Checkbox checked={value.hunger[key]} onCheckedChange={checked => hunger({ [key]: checked })} />{label}</label>)}</div>
            <Field id="school-time-zone" label={t('学校时区', 'School time zone')}><Input id="school-time-zone" required maxLength={100} placeholder="Asia/Shanghai" value={value.hunger.timeZone} onChange={event => hunger({ timeZone: event.target.value })} /><p className="mt-2 text-xs text-muted">{t('例如 Asia/Shanghai；所有教师端使用同一学校时间计算日期。', 'For example: Asia/Shanghai. All devices use this school time zone for date boundaries.')}</p></Field>
            {value.hunger.excludeHolidays && <div className="space-y-3"><h3 className="text-sm font-semibold">{t('学校节假日', 'School holidays')}</h3><p className="text-xs leading-relaxed text-muted">{t('请填写学校实际放假日期，起止日期均计入；不自动获取法定节假日。单日假期填写相同起止日期。', 'Enter your school’s actual holidays, including both boundary dates. Public holidays are not fetched automatically. Use the same date for a single day.')}</p>{!value.hunger.holidays.length && <p className="text-sm text-muted">{t('尚未添加假期。', 'No holidays added yet.')}</p>}{value.hunger.holidays.map((range, index) => <div key={index} className="flex items-end gap-2"><div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">{(['start', 'end'] as const).map(key => <Field key={key} id={`holiday-${index}-${key}`} label={t(key === 'start' ? '开始日期' : '结束日期', key === 'start' ? 'Start date' : 'End date')}><Input id={`holiday-${index}-${key}`} type="date" required value={range[key]} min={key === 'end' ? range.start : undefined} onChange={event => hunger({ holidays: value.hunger.holidays.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row) })} className="min-w-0" /></Field>)}</div><Button type="button" variant="ghost" aria-label={t(`移除第 ${index + 1} 个假期`, `Remove holiday ${index + 1}`)} onClick={() => hunger({ holidays: value.hunger.holidays.filter((_, i) => i !== index) })}><Trash2 size={16} /></Button></div>)}<Button type="button" disabled={value.hunger.holidays.length >= 100} onClick={() => hunger({ holidays: [...value.hunger.holidays, { start: '', end: '' }] })}><Plus size={16} />{t('添加假期', 'Add holiday')}</Button></div>}
          </div>}
        </section>
        <section>{toggle('sickness-enabled', t('允许生病形态', 'Enable sick state'), value.sickness, sickness => update({ sickness }), t('Lv.1 且卡片上的累计积分低于 0 时显示生病，保存后立即生效，不要求本轮成长值为负。积分恢复至 0 后解除；同时达到蛋形态条件时优先显示蛋。', 'Pets at Lv.1 appear sick when their total points on the card are below zero. Saving applies this immediately, even if cycle experience is not negative. Reach zero points to recover. The egg state takes priority when its condition is also met.'))}</section>
        <section className="pb-4">{toggle('egg-enabled', t('启用蛋形态', 'Enable egg state'), value.resetToEgg, resetToEgg => update({ resetToEgg }), t('卡片上的累计积分达到分数线或更低时显示为蛋，保存后立即生效。保留宠物、养成周期及徽章，积分高于分数线后恢复。', 'The pet appears as an egg when its total points on the card reach or fall below the threshold. Saving applies this immediately. Its companion, cycle and badges are kept. Raise total points above the threshold to recover.'))}{value.resetToEgg && <Field id="egg-threshold" label={t('触发积分分数线', 'Total points threshold')}><Input id="egg-threshold" type="number" inputMode="numeric" required min={-10000} max={-1} step={1} placeholder="-10" value={Number.isNaN(value.eggThreshold) ? '' : value.eggThreshold} onChange={event => update({ eggThreshold: event.target.value === '' ? NaN : Number(event.target.value) })} /></Field>}</section>
        <p className="py-4 text-xs leading-relaxed text-muted">{t('关闭形态只隐藏状态，不修改积分或成长值。', 'Disabling these appearances hides the state without changing total points or experience.')}</p>
      </div>}
    </fieldset>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-white pt-4">
      <div className="min-w-0 flex-1 text-sm" aria-live="polite">{error ? <p role="alert" className="text-danger">{error}</p> : saved ? <p className="text-success">{t('设置已保存。', 'Settings saved.')}</p> : <p className="text-muted">{t('仅应用于当前班级，所有共管教师使用同一设置。', 'Applies only to this class, with shared settings for all its teachers.')}</p>}</div>
      <Button type="submit" variant="primary" busy={client.busy}><Save size={16} />{t('保存设置', 'Save settings')}</Button>
    </footer>
  </form>
}
