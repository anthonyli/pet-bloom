'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { Check, Image, Palette, RefreshCw, Search, ShoppingBag, X } from 'lucide-react'
import { Button, Dialog, Input, cn } from '@/components/ui'
import { errorMessage, translator } from '@/lib/i18n'
import { backgroundCategories, equippedBackgroundId, filterPetBackgrounds, petBackgroundById, petBackgrounds, type BackgroundFilter } from '@/lib/pet-backgrounds'
import type { Locale } from '@/lib/types'
import { api, ApiError, type GardenClient } from './use-garden'
import { PetScene } from './pet-scene'

export function PetDressingDialog({ client, locale, studentId, initialBackgroundId, open, onClose, onShop }: { client: GardenClient; locale: Locale; studentId: string; initialBackgroundId?: string | null; open: boolean; onClose: () => void; onShop: (studentId: string) => void }) {
  const t = translator(locale), id = useId()
  const student = client.state!.students.find(value => value.id === studentId)
  const [draft, setDraft] = useState<string | null>(() => initialBackgroundId !== undefined ? initialBackgroundId : student ? equippedBackgroundId(student) : null)
  const [backgroundCategory, setBackgroundCategory] = useState<BackgroundFilter>('all'), [backgroundQuery, setBackgroundQuery] = useState('')
  const backgroundSearch = useRef<HTMLInputElement>(null), recoveryButton = useRef<HTMLButtonElement>(null)
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [needsReload, setNeedsReload] = useState(false)
  const [recovery, setRecovery] = useState<'saved' | 'unknown' | null>(null)
  const submitting = useRef(false), recoveryLock = useRef(false)
  useEffect(() => { if (recovery) recoveryButton.current?.focus() }, [recovery])
  if (!student) return null
  const availability = client.state!.festival_backgrounds
  const free = new Map(availability.backgrounds.map(offer => [offer.background_id, offer.expires_at]))
  const owned = new Set(student.owned_background_ids)
  const equipped = equippedBackgroundId(student)
  const available = petBackgrounds.filter(background => owned.has(background.id) || free.has(background.id) || student.festival_background_id === background.id)
  const filteredAvailable = filterPetBackgrounds(available, backgroundCategory, backgroundQuery)
  const choices = [null, ...filteredAvailable]
  const hasBackgroundFilters = backgroundCategory !== 'all' || backgroundQuery.trim() !== ''
  const allowed = draft === null || owned.has(draft) || free.has(draft)
  const inUse = equipped === draft
  const makePermanent = draft !== null && student.festival_background_id === draft && owned.has(draft)
  const current = inUse && !makePermanent
  const draftExpiry = draft === student.festival_background_id ? student.festival_background_expires_at : draft !== null ? free.get(draft) : undefined
  const previewName = petBackgroundById(draft)?.name[locale] || t('默认背景', 'Default background')
  const disabled = client.busy || saving || recovery !== null
  const steps = client.state!.settings.value.growth
  const expiryFormat = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: availability.time_zone })

  function freeUntil(expiresAt: number) {
    return t(`节日免费至 ${expiryFormat.format(expiresAt)}（学校时区 ${availability.time_zone}）`, `Festival access until ${expiryFormat.format(expiresAt)} (school time: ${availability.time_zone})`)
  }

  async function reload() {
    if (await client.run(async () => {}, t('已加载最新装扮。', 'Latest outfit loaded.'))) { recoveryLock.current = false; setRecovery(null); setError(''); setNeedsReload(false) }
  }

  function clearBackgroundFilters() {
    setBackgroundCategory('all'); setBackgroundQuery('')
    backgroundSearch.current?.focus()
  }

  async function save() {
    if (!student || submitting.current || recoveryLock.current || disabled || !allowed || current) return
    submitting.current = true; setSaving(true); setError('')
    let saved = false, unknown = false
    try {
      const ok = await client.run(async () => {
        try { await api(`students/${student.id}/background`, 'PATCH', { backgroundId: draft }); saved = true }
        catch (failure) {
          unknown = failure instanceof ApiError && failure.status === 0
          if (failure instanceof ApiError && failure.code === 'backgroundNotOwned') setNeedsReload(true)
          setError(failure instanceof ApiError && failure.code === 'backgroundNotOwned' ? t('这个背景未拥有，或节日免费已结束。请重新加载后选择可用背景，不会扣除徽章。', 'This background is not owned, or festival access has ended. Reload and choose an available background. No badges were spent.') : failure instanceof ApiError && failure.code === 'invalidBackground' ? t('这个背景暂不可用。请选择其他背景。', 'This background is unavailable. Choose another background.') : errorMessage(failure instanceof ApiError ? failure.code : 'serverError', locale))
          throw failure
        }
      }, draft !== null && !owned.has(draft) ? t('已免费使用节日背景，未扣除徽章。', 'Festival background applied for free. No badges spent.') : t('背景已使用。', 'Background applied.'))
      if (!ok && (saved || unknown)) { recoveryLock.current = true; setError(''); setRecovery(saved ? 'saved' : 'unknown') }
    } finally { submitting.current = false; setSaving(false) }
  }

  return <Dialog open={open} onClose={() => { if (!submitting.current && !recoveryLock.current) onClose() }} wide icon={Palette} title={t('宠物装扮', 'Dress your companion')} description={t(`${student.name} 的可用背景。节日当天可免费临时使用对应背景；已兑换背景可全年使用。`, `${student.name}’s available backgrounds. Use matching festival backgrounds for free during the festival; redeemed backgrounds are available year-round.`)} className={cn('flex max-h-[90dvh] flex-col overflow-hidden', recovery && '[&>div:first-child>button]:hidden')}>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
      {recovery && <div role="alert" className="mb-5 space-y-3 rounded-xl border border-line bg-[#f5f2ff] p-4">
        <p className="text-sm leading-relaxed">{recovery === 'saved' ? t('背景已保存，但最新数据未能加载。预览已保留，请重新加载核对，不要重复保存。', 'Your background was saved, but the latest data could not load. Your preview is kept. Reload to check without saving again.') : t('连接中断，暂时无法确认背景是否保存。预览已保留，请重新加载核对当前背景，不会再次发送保存请求。', 'The connection was interrupted, so the save result is unknown. Your preview is kept. Reload to check the current background; the save request will not be sent again.')}</p>
        <Button ref={recoveryButton} className="text-xs" busy={client.busy} onClick={reload}><RefreshCw size={15} aria-hidden="true" />{t('重新加载', 'Reload')}</Button>
      </div>}
      <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <PetScene student={student} locale={locale} steps={steps} backgroundId={draft} className="rounded-2xl border border-line" />
          <p role="status" aria-live="polite" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"><strong className="font-semibold">{previewName}</strong><span className={cn('inline-flex items-center gap-1 text-xs', inUse ? 'text-primary' : 'text-muted')}>{inUse ? <><Check size={14} aria-hidden="true" />{t('使用中', 'In use')}</> : t('仅预览，尚未使用', 'Preview only · not applied')}</span></p>
          {draft !== null && owned.has(draft) ? <p className="mt-2 text-xs leading-relaxed text-muted">{makePermanent ? t('已永久拥有；目前仍为节日临时使用，可在下方改为永久使用。', 'Permanently owned, but currently applied as a festival outfit. Switch to permanent use below.') : t('永久拥有，全年可用。', 'Permanently owned · available year-round.')}</p> : draftExpiry && <p className="mt-2 break-words text-xs leading-relaxed text-primary">{freeUntil(draftExpiry)}</p>}
          {draft !== null && draftExpiry && !owned.has(draft) && <p className="mt-2 text-xs leading-relaxed text-muted">{t(`免费结束后恢复「${petBackgroundById(student.background_id)?.name[locale] || '默认背景'}」，不会扣除徽章。`, `When access ends, ${petBackgroundById(student.background_id)?.name[locale] || 'the default background'} will return. No badges will be spent.`)}</p>}
        </div>
        <div className="min-w-0">
          <h3 id={`${id}-choices`} className="mb-3 text-sm font-semibold">{t('可用背景', 'Available backgrounds')}</h3>
          <div className="mb-4 space-y-3">
            <div role="group" aria-label={t('背景分类', 'Background categories')} className="flex flex-wrap gap-2">
              <Button type="button" className={cn('min-h-11 px-3 text-xs', backgroundCategory === 'all' && 'border-primary bg-[#f5f2ff] text-primary')} aria-pressed={backgroundCategory === 'all'} onClick={() => setBackgroundCategory('all')}>{t('全部', 'All')}</Button>
              {backgroundCategories.map(category => <Button key={category.id} type="button" className={cn('min-h-11 px-3 text-xs', backgroundCategory === category.id && 'border-primary bg-[#f5f2ff] text-primary')} aria-pressed={backgroundCategory === category.id} onClick={() => setBackgroundCategory(category.id)}>{category.name[locale]}</Button>)}
            </div>
            <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-muted" aria-hidden="true" /><Input ref={backgroundSearch} id={`${id}-background-search`} type="search" value={backgroundQuery} onChange={event => setBackgroundQuery(event.target.value)} aria-label={t('搜索可用背景的名称或描述，支持中文和英文', 'Search available background names or descriptions in Chinese or English')} aria-describedby={`${id}-background-results`} placeholder={t('搜索可用背景，支持中英文', 'Search available backgrounds in Chinese or English')} className="min-h-11 pl-9" /></div>
            <div className="flex flex-wrap items-center justify-between gap-2"><p id={`${id}-background-results`} role="status" aria-live="polite" className="text-xs leading-relaxed text-muted">{t(`显示 ${filteredAvailable.length} / ${available.length} 个可用背景；默认背景始终可选。`, `Showing ${filteredAvailable.length} of ${available.length} available backgrounds. The default is always available.`)}</p>{hasBackgroundFilters && <Button type="button" variant="ghost" className="min-h-11 px-2 text-xs" onClick={clearBackgroundFilters}><X size={14} aria-hidden="true" />{t('清空筛选', 'Clear filters')}</Button>}</div>
          </div>
          <div role="group" aria-labelledby={`${id}-choices`} className="grid grid-cols-2 gap-3">
            {choices.map(background => {
              const backgroundId = background?.id || null, name = background?.name[locale] || t('默认背景', 'Default background')
              const selected = draft === backgroundId, inUse = equipped === backgroundId
              const expiresAt = backgroundId === student.festival_background_id ? student.festival_background_expires_at : backgroundId !== null ? free.get(backgroundId) : undefined
              const access = backgroundId === null ? t('始终免费', 'Always free') : owned.has(backgroundId) ? t('永久拥有', 'Permanently owned') : t('节日免费', 'Festival access')
              return <button key={backgroundId || 'default'} type="button" disabled={disabled} aria-pressed={selected} aria-label={`${name} · ${inUse ? t('使用中', 'In use') : t('预览此背景', 'Preview this background')}`} className={cn('min-w-0 overflow-hidden rounded-xl border text-left transition-colors hover:border-primary disabled:opacity-50', selected ? 'border-primary bg-[#f5f2ff]' : 'border-line bg-white')} onClick={() => { setDraft(backgroundId); setError('') }}>
                <PetScene student={student} locale={locale} steps={steps} backgroundId={backgroundId} className="aspect-[4/3]" />
                <span className="flex flex-wrap items-center justify-between gap-1 p-2.5 text-xs leading-relaxed"><span className="break-words font-medium">{name}</span>{selected && <Check size={14} className="shrink-0 text-primary" aria-hidden="true" />}<span className={cn('w-full', inUse ? 'font-medium text-primary' : 'text-muted')}>{inUse ? `${t('使用中', 'In use')} · ${access}` : access}</span>{backgroundId !== null && !owned.has(backgroundId) && expiresAt && <span className="w-full break-words text-muted">{freeUntil(expiresAt)}</span>}</span>
              </button>
            })}
          </div>
          {!filteredAvailable.length && (available.length > 0 || hasBackgroundFilters) && <div className="mt-4 text-sm leading-relaxed text-muted"><p>{t('没有匹配的可用背景。默认背景仍可选，也可以清空筛选。', 'No available backgrounds match. The default is still available, or clear the filters.')}</p><Button type="button" variant="ghost" className="mt-2 min-h-11 px-2 text-xs" onClick={clearBackgroundFilters}><X size={14} aria-hidden="true" />{t('清空筛选', 'Clear filters')}</Button></div>}
          {draft !== null && allowed && !filteredAvailable.some(background => background.id === draft) && <p className="mt-3 text-xs leading-relaxed text-muted">{t('当前预览已保留，不受筛选影响，仍可使用。', 'Your current preview is kept and can still be applied, even when hidden by these filters.')}</p>}
          {!available.length && <div className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-muted"><Image size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><p>{t('暂无已兑换或今日免费的背景。可先用默认背景，或去商店用徽章长期解锁。', 'No redeemed backgrounds or festival offers today. Use the default, or unlock a background permanently with badges in the shop.')}</p></div>}
          {!!availability.unsupported_background_ids.length && <p className="mt-4 text-xs leading-relaxed text-muted">{t(`部分节日尚无当前年份的可靠日期，暂不提供免费使用：${availability.unsupported_background_ids.map(value => petBackgroundById(value)?.name.zh || value).join('、')}。默认背景和已拥有背景不受影响。`, `Verified dates are not available for some festivals this year, so free access is unavailable for: ${availability.unsupported_background_ids.map(value => petBackgroundById(value)?.name.en || value).join(', ')}. The default and owned backgrounds are unaffected.`)}</p>}
          <p className="mt-4 text-xs leading-relaxed text-muted">{t('节日免费仅临时使用，不会永久解锁；到期恢复原长期背景。兑换的背景由这位学生单独持有，换宠和毕业后保留；退款会撤销长期使用权。', 'Festival access is temporary, not permanent ownership. Your previous permanent background returns when it ends. Redeemed backgrounds belong to this student and stay through companion changes and graduation; refunds revoke permanent access.')}</p>
        </div>
      </div>
      {((!allowed && !inUse) || error) && <div className="mt-4 space-y-2"><p role="alert" className="text-sm leading-relaxed text-danger">{error || t('节日免费已结束，且尚未永久拥有此背景。预览已保留，请选择可用背景，不会自动扣除徽章。', 'Festival access has ended and this background is not permanently owned. Your preview is kept. Choose an available background; no badges will be spent automatically.')}</p>{(needsReload || !allowed) && <Button className="min-h-11 text-xs" disabled={disabled} onClick={reload}><RefreshCw size={15} aria-hidden="true" />{t('重新加载', 'Reload')}</Button>}</div>}
    </div>
    <footer className="mt-5 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <Button variant="ghost" className="min-h-11 px-3 text-xs" disabled={disabled} onClick={() => onShop(student.id)}><ShoppingBag size={15} aria-hidden="true" />{t('去兑换背景', 'Shop backgrounds')}</Button>
      <Button variant="primary" className="min-h-11 px-4 text-xs" disabled={disabled || !allowed || current} busy={saving} onClick={save}><Check size={15} aria-hidden="true" />{current ? t('正在使用', 'Currently in use') : makePermanent ? t('改为永久使用', 'Use permanently') : draft === null ? t('恢复默认背景', 'Restore default background') : owned.has(draft) ? t('使用这个背景', 'Use this background') : t('免费使用此背景', 'Use for free')}</Button>
    </footer>
  </Dialog>
}
