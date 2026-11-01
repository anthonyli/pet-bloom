'use client'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Award, Check, Gift, History, LockKeyhole, Palette, Pencil, Plus, RefreshCw, Search, ShoppingBag, Trash2, Undo2, UserRound, X } from 'lucide-react'
import { Button, Dialog, Field, Input, Select, cn } from '@/components/ui'
import { operationActorName, translator } from '@/lib/i18n'
import { backgroundCategories, equippedBackgroundId, filterPetBackgrounds, petBackgroundById, petBackgrounds, type BackgroundFilter } from '@/lib/pet-backgrounds'
import type { Locale, ShopItem } from '@/lib/types'
import { ShopIcon } from './shop-icon'
import { ShopItemDialog } from './shop-item-dialog'
import { PetScene } from './pet-scene'
import { api, ApiError, type GardenClient } from './use-garden'

export type ShopTab = 'shop' | 'backgrounds' | 'history'
type BackgroundRecovery = { result: 'saved' | 'unknown'; studentName: string; backgroundName: string }

function ShopArtwork({ item, locale }: { item: ShopItem; locale: Locale }) {
  const [failed, setFailed] = useState(false)
  const t = translator(locale)
  return item.image && !failed ? <img src={item.image} alt={item.name[locale]} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(true)} /> : <div className="flex flex-col items-center gap-3"><ShopIcon icon={item.icon} locale={locale} size={48} className="text-primary" />{failed && <span className="text-xs text-muted">{t('图片暂时无法加载', 'Image unavailable')}</span>}</div>
}

function BackgroundPriceDialog({ client, locale, item, onClose }: { client: GardenClient; locale: Locale; item: ShopItem; onClose: () => void }) {
  const t = translator(locale), id = useId(), submitting = useRef(false)
  const [cost, setCost] = useState(String(item.cost)), [failed, setFailed] = useState(false)
  const valid = cost.trim() !== '' && Number.isInteger(Number(cost)) && Number(cost) >= 1 && Number(cost) <= 100
  return <Dialog open onClose={() => { if (!submitting.current) onClose() }} icon={Pencil} title={t('修改背景价格', 'Edit background price')} description={t(`「${item.name.zh}」的新价格仅影响当前班级之后的兑换，已拥有的背景不受影响。`, `The new price for ${item.name.en} applies only to future redemptions in this class. Owned backgrounds are unchanged.`)}>
    <form onSubmit={async event => {
      event.preventDefault()
      if (!valid || client.busy || submitting.current) return
      const current = client.state!.items.find(value => value.id === item.id)
      if (!current) { onClose(); return }
      submitting.current = true; setFailed(false)
      try {
        if (await client.run(() => api(`items/${current.id}`, 'PATCH', { cost: Number(cost) }), t('背景价格已保存。', 'Background price saved.'))) onClose()
        else setFailed(true)
      } finally { submitting.current = false }
    }}>
      <Field id={`${id}-cost`} label={t('所需徽章', 'Badge cost')}><Input id={`${id}-cost`} type="number" min={1} max={100} step={1} required value={cost} disabled={client.busy} onChange={event => { setCost(event.target.value); setFailed(false) }} aria-describedby={`${id}-hint`} /></Field>
      <p id={`${id}-hint`} className="mt-2 text-xs leading-relaxed text-muted">{t('输入 1–100 的整数。背景不限库存，每位学生只需兑换一次。', 'Enter a whole number from 1 to 100. Background stock is unlimited; each student redeems once.')}</p>
      {failed && <p role="alert" className="mt-4 text-sm text-danger">{t('价格暂未确认更新，输入已保留。请核对提示后重试。', 'The price update could not be confirmed. Your input is kept. Check the notice, then try again.')}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button type="button" variant="ghost" className="text-xs" disabled={client.busy} onClick={onClose}>{t('取消', 'Cancel')}</Button><Button type="submit" variant="primary" className="text-xs" disabled={!valid} busy={client.busy}>{t('保存价格', 'Save price')}</Button></div>
    </form>
  </Dialog>
}

export function ShopDialog({ client, locale, onClose, open = true, initialStudentId, initialTab = 'shop', onDress }: { client: GardenClient; locale: Locale; onClose: () => void; open?: boolean; initialStudentId?: string; initialTab?: ShopTab; onDress?: (studentId: string, backgroundId?: string) => void }) {
  const t = translator(locale)
  useEffect(() => { client.setNotice(null) }, [client.setNotice])
  const id = useId()
  const addButton = useRef<HTMLButtonElement>(null), backgroundSearch = useRef<HTMLInputElement>(null), recoveryButton = useRef<HTMLButtonElement>(null)
  const backgroundSubmitting = useRef(false), recoveryLock = useRef<BackgroundRecovery | null>(null)
  const [selected, setSelected] = useState(initialStudentId || client.state!.students[0]?.id || '')
  const [tab, setTab] = useState<ShopTab>(initialTab)
  const [backgroundCategory, setBackgroundCategory] = useState<BackgroundFilter>('all'), [backgroundQuery, setBackgroundQuery] = useState('')
  const [editor, setEditor] = useState<{ item?: ShopItem; trigger: HTMLButtonElement } | null>(null)
  const [priceEditor, setPriceEditor] = useState<ShopItem | null>(null)
  const [recovery, setRecovery] = useState<BackgroundRecovery | null>(null), [backgroundWorking, setBackgroundWorking] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [redeeming, setRedeeming] = useState<string | null>(null)
  const [refunding, setRefunding] = useState<string | null>(null)
  const { students, items, redemptions, festival_backgrounds: festival } = client.state!
  const freeBackgrounds = petBackgrounds.filter(background => festival.backgrounds.some(offer => offer.background_id === background.id))
  const festivalDateFormat = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: festival.time_zone })
  const rewards = items.filter(item => !item.background_id)
  const backgrounds = items.filter(item => item.background_id && petBackgroundById(item.background_id))
  const matchingBackgrounds = new Set(filterPetBackgrounds(petBackgrounds.filter(background => backgrounds.some(item => item.background_id === background.id)), backgroundCategory, backgroundQuery).map(background => background.id))
  const visibleBackgrounds = backgrounds.filter(item => matchingBackgrounds.has(item.background_id!))
  const hasBackgroundFilters = backgroundCategory !== 'all' || backgroundQuery.trim() !== ''
  const student = students.find(value => value.id === selected) || students[0]
  const available = student ? student.badge_count - student.spent_badges : 0
  const writesDisabled = client.busy || backgroundWorking || recovery !== null
  const dateFormat = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })
  useEffect(() => { if (recovery) recoveryButton.current?.focus() }, [recovery])

  function clearBackgroundFilters() {
    setBackgroundCategory('all'); setBackgroundQuery(''); setRemoving(null)
    backgroundSearch.current?.focus()
  }

  function switchTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tabs: ShopTab[] = ['shop', 'backgrounds', 'history']
    const index = tabs.indexOf(tab)
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
    setTab(next)
    document.getElementById(`${id}-tab-${next}`)?.focus()
  }

  function cancelRemoval(itemId: string) {
    setRemoving(null)
    document.getElementById(`${id}-remove-${itemId}`)?.focus()
  }

  async function redeem(item: ShopItem) {
    if (!student || writesDisabled || backgroundSubmitting.current || recoveryLock.current || item.stock === 0 || available < item.cost) return
    if (item.background_id && student.owned_background_ids.includes(item.background_id)) return
    setRedeeming(item.id)
    if (!item.background_id) {
      try { await client.run(() => api('redemptions', 'POST', { studentId: student.id, itemId: item.id }), t(`已为${student.name}兑换「${item.name.zh}」。`, `${item.name.en} redeemed for ${student.name}.`)) }
      finally { setRedeeming(null) }
      return
    }
    backgroundSubmitting.current = true; setBackgroundWorking(true)
    let saved = false, unknown = false
    try {
      const ok = await client.run(async () => {
        try { await api('redemptions', 'POST', { studentId: student.id, itemId: item.id }); saved = true }
        catch (error) { unknown = error instanceof ApiError && error.status === 0; throw error }
      }, t(`已为${student.name}解锁「${item.name.zh}」，可去装扮中选用。`, `${item.name.en} unlocked for ${student.name}. Apply it in Dress up.`))
      if (!ok && (saved || unknown)) {
        const next: BackgroundRecovery = { result: saved ? 'saved' : 'unknown', studentName: student.name, backgroundName: item.name[locale] }
        recoveryLock.current = next; setRecovery(next); setRemoving(null)
      }
    } finally { backgroundSubmitting.current = false; setBackgroundWorking(false); setRedeeming(null) }
  }

  async function removeItem(item: ShopItem) {
    if (writesDisabled || backgroundSubmitting.current || recoveryLock.current) return
    if (await client.run(() => api(`items/${item.id}`, 'DELETE'), item.background_id ? t('背景已下架，已拥有的学生仍可使用。', 'Background removed from the shop. Students who own it can still use it.') : t('商品已移除。', 'Reward removed.'))) {
      setRemoving(null)
      requestAnimationFrame(() => item.background_id ? document.getElementById(`${id}-tab-backgrounds`)?.focus() : addButton.current?.focus())
    }
  }

  return <Dialog open={open} wide onClose={() => { if (!editor && !priceEditor && !backgroundSubmitting.current && !recoveryLock.current) onClose() }} icon={ShoppingBag} title={t('班级小商店', 'Class reward shop')} description={t('用成长获得的徽章兑换奖励，或为宠物解锁新的背景。', 'Exchange growth badges for classroom rewards or unlock new pet backgrounds.')} className={cn(recovery && '[&>div:first-child>button]:hidden')}>
    <div role="tablist" aria-label={t('商店内容', 'Shop views')} className="section-tabs mb-5">
      <button type="button" role="tab" id={`${id}-tab-shop`} aria-selected={tab === 'shop'} aria-controls={`${id}-panel-shop`} tabIndex={tab === 'shop' ? 0 : -1} onKeyDown={switchTab} onClick={() => setTab('shop')} className={cn('tab inline-flex min-h-11 items-center gap-2 text-sm', tab === 'shop' && 'tab-active')}><ShoppingBag size={16} aria-hidden="true" />{t('奖励商店', 'Rewards')}</button>
      <button type="button" role="tab" id={`${id}-tab-backgrounds`} aria-selected={tab === 'backgrounds'} aria-controls={`${id}-panel-backgrounds`} tabIndex={tab === 'backgrounds' ? 0 : -1} onKeyDown={switchTab} onClick={() => setTab('backgrounds')} className={cn('tab inline-flex min-h-11 items-center gap-2 text-sm', tab === 'backgrounds' && 'tab-active')}><Palette size={16} aria-hidden="true" />{t('宠物背景', 'Backgrounds')}</button>
      <button type="button" role="tab" id={`${id}-tab-history`} aria-selected={tab === 'history'} aria-controls={`${id}-panel-history`} tabIndex={tab === 'history' ? 0 : -1} onKeyDown={switchTab} onClick={() => setTab('history')} className={cn('tab inline-flex min-h-11 items-center gap-2 text-sm', tab === 'history' && 'tab-active')}><History size={16} aria-hidden="true" />{t('兑换记录', 'Redemptions')}</button>
    </div>
    {recovery && <div role="alert" className="mb-5 space-y-3 rounded-xl border border-line bg-[#f5f2ff] p-4">
      <p className="text-sm leading-relaxed">{recovery.result === 'saved' ? t(`${recovery.studentName} 的「${recovery.backgroundName}」兑换已保存，但最新数据未能加载。请重新加载核对记录，不要再次兑换或退款。`, `The redemption of ${recovery.backgroundName} for ${recovery.studentName} was saved, but the latest data could not load. Reload and check the records. Do not redeem or refund again.`) : t(`连接中断，暂时无法确认${recovery.studentName}是否已兑换「${recovery.backgroundName}」。已暂停兑换、退款及商品修改；请重新加载并核对记录，避免重复扣除徽章。`, `The connection was interrupted. The redemption of ${recovery.backgroundName} for ${recovery.studentName} is not confirmed. Redemptions, refunds and reward changes are paused. Reload and check the records to avoid spending badges twice.`)}</p>
      <div className="flex flex-wrap gap-2"><Button ref={recoveryButton} className="min-h-11 text-xs" busy={client.busy} onClick={async () => { if (await client.run(async () => {}, t('最新兑换记录已加载，请核对后继续。', 'Latest redemptions loaded. Check the records before continuing.'))) { recoveryLock.current = null; setRecovery(null); setTab('history'); requestAnimationFrame(() => document.getElementById(`${id}-tab-history`)?.focus()) } }}><RefreshCw size={15} aria-hidden="true" />{t('重新加载并核对记录', 'Reload and check records')}</Button><Button variant="ghost" className="min-h-11 text-xs" onClick={() => { setTab('history'); document.getElementById(`${id}-tab-history`)?.focus() }}><History size={15} aria-hidden="true" />{t('查看已有记录', 'View loaded records')}</Button></div>
    </div>}
    {tab !== 'history' && <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1 basis-60"><Field id={`${id}-student`} label={t('为谁兑换？', 'Who is redeeming?')}><Select id={`${id}-student`} value={student?.id || ''} disabled={writesDisabled} onValueChange={value => { setSelected(value); setRemoving(null) }} icon={UserRound} placeholder={t('请先添加学生', 'Add a student first')} options={students.map(value => ({ value: value.id, label: value.name }))} aria-describedby={`${id}-balance`} /></Field></div>
        {tab === 'shop' && <Button ref={addButton} className="min-h-11 text-xs" disabled={writesDisabled} onClick={event => setEditor({ trigger: event.currentTarget })}><Plus size={16} aria-hidden="true" />{t('添加商品', 'Add reward')}</Button>}
        {tab === 'backgrounds' && onDress && <Button className="min-h-11 text-xs" disabled={writesDisabled || !student} onClick={() => student && onDress(student.id)}><Palette size={15} aria-hidden="true" />{t('去装扮', 'Dress up')}</Button>}
      </div>
      <p id={`${id}-balance`} role="status" className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-[#fff4d6] px-4 py-3 text-sm leading-relaxed text-[#76591b]">
        <Award size={19} className="shrink-0" aria-hidden="true" />{student ? <><span className="min-w-0 break-words">{student.name}</span><span>{t('可用徽章', 'has')}</span><strong className="tabular">{available}</strong><span>{t('枚', available === 1 ? 'badge available' : 'badges available')}</span><span className="text-xs">{t(`（已使用 ${student.spent_badges} 枚）`, `(${student.spent_badges} spent)`)}</span></> : <span>{t('请先在班级中添加学生，再兑换奖励。', 'Add a student to this class before redeeming rewards.')}</span>}
      </p>
    </>}
    <section role="tabpanel" id={`${id}-panel-shop`} aria-labelledby={`${id}-tab-shop`} hidden={tab !== 'shop'}>
      {!rewards.length ? <div className="empty rounded-2xl border border-dashed border-line"><ShoppingBag size={36} className="mb-4 text-primary" aria-hidden="true" /><h3 className="font-semibold">{t('商店还没有商品', 'No rewards in the shop yet')}</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{t('添加一份奖励，设置所需徽章和库存，就可以开始兑换了。', 'Add a reward, set its badge cost and stock, then start redeeming.')}</p></div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rewards.map(item => {
          const soldOut = item.stock === 0
          const insufficient = !!student && available < item.cost
          return <article key={item.id} className="group/reward flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby={`${id}-name-${item.id}`}>
            <div className="flex aspect-[4/3] items-center justify-center border-b border-line bg-[#fbfaff] p-5">
              <ShopArtwork key={item.image || item.icon} item={item} locale={locale} />
            </div>
            <div className="flex flex-1 flex-col p-4">
              <h3 id={`${id}-name-${item.id}`} className="break-words font-semibold leading-relaxed">{item.name[locale]}</h3>
              {item.description[locale] && <p className="mt-1.5 whitespace-pre-line break-words text-sm leading-relaxed text-muted">{item.description[locale]}</p>}
              <div id={`${id}-details-${item.id}`} className="mb-4 mt-auto flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-primary"><Award size={17} aria-hidden="true" /><span className="tabular">{item.cost}</span>{t('枚徽章', item.cost === 1 ? 'badge' : 'badges')}</span>
                <span className={cn('text-xs', soldOut ? 'font-semibold text-danger' : 'text-muted')}>{soldOut ? t('已售罄', 'Sold out') : item.stock === -1 ? t('库存不限', 'Unlimited stock') : t(`库存 ${item.stock} 件`, `${item.stock} in stock`)}</span>
              </div>
              <Button variant="primary" className="min-h-11 w-full text-xs" aria-describedby={`${id}-details-${item.id}`} aria-label={`${soldOut ? t('已售罄', 'Sold out') : insufficient ? t('徽章不足', 'Not enough badges') : t('兑换', 'Redeem')} · ${item.name[locale]}`} disabled={writesDisabled || !student || soldOut || insufficient} busy={redeeming === item.id && client.busy} onClick={() => redeem(item)}><Gift size={16} aria-hidden="true" />{soldOut ? t('已售罄', 'Sold out') : !student ? t('请先添加学生', 'Add a student first') : insufficient ? t('徽章不足', 'Not enough badges') : t('兑换商品', 'Redeem reward')}</Button>
            </div>
            <div className={cn('flex flex-wrap items-center justify-end gap-1 border-t border-line px-3 py-1 transition-opacity group-hover/reward:opacity-100 group-focus-within/reward:opacity-100 [@media(hover:none)]:opacity-100', removing !== item.id && 'opacity-0')}>
              <Button variant="ghost" className="min-h-11 px-3 text-xs" aria-label={`${t('编辑商品', 'Edit reward')} · ${item.name[locale]}`} disabled={writesDisabled} onClick={event => setEditor({ item, trigger: event.currentTarget })}><Pencil size={15} aria-hidden="true" />{t('编辑', 'Edit')}</Button>
              <Button id={`${id}-remove-${item.id}`} variant="ghost" className="min-h-11 px-3 text-xs" aria-label={`${t('移除商品', 'Remove reward')} · ${item.name[locale]}`} aria-expanded={removing === item.id} aria-controls={removing === item.id ? `${id}-confirm-${item.id}` : undefined} disabled={writesDisabled} onClick={() => setRemoving(value => value === item.id ? null : item.id)}><Trash2 size={15} aria-hidden="true" />{t('移除', 'Remove')}</Button>
            </div>
            {removing === item.id && <div id={`${id}-confirm-${item.id}`} className="border-t border-line bg-[#fff0f2] p-4">
              <p className="mb-3 text-sm leading-relaxed text-danger">{t('确认从商店移除此商品？已有兑换记录会保留。', 'Remove this reward from the shop? Existing redemptions will be kept.')}</p>
              <div className="flex flex-wrap gap-2"><Button variant="danger" className="min-h-11 text-xs" autoFocus disabled={writesDisabled} busy={client.busy} onClick={() => removeItem(item)}><Trash2 size={15} aria-hidden="true" />{t('确认移除', 'Remove reward')}</Button><Button variant="ghost" className="min-h-11 text-xs" disabled={writesDisabled} onClick={() => cancelRemoval(item.id)}><X size={15} aria-hidden="true" />{t('取消', 'Cancel')}</Button></div>
            </div>}
          </article>
        })}
      </div>}
    </section>
    <section role="tabpanel" id={`${id}-panel-backgrounds`} aria-labelledby={`${id}-tab-backgrounds`} hidden={tab !== 'backgrounds'}>
      <p className="mb-5 text-sm leading-relaxed text-muted">{t('默认背景免费。节日当天可免费临时使用对应背景，不扣徽章、不产生兑换记录；到期恢复原长期背景。想全年使用，可按原价为每位学生分别兑换，长期解锁后去「装扮」选用，不会自动更换。', 'The default is free. Matching festival backgrounds are temporarily free during the festival, with no badges spent or redemption record; your previous permanent background returns afterward. To use one year-round, redeem it at its regular price for each student, then apply it in Dress up. Redemption does not change the outfit automatically.')}</p>
      {!!freeBackgrounds.length && <section aria-labelledby={`${id}-festival-title`} className="mb-6">
        <h3 id={`${id}-festival-title`} className="mb-2 text-sm font-semibold text-primary">{t('今日免费装扮', 'Free festival outfits today')}</h3>
        <p className="mb-3 text-xs leading-relaxed text-muted">{t(`按学校时区 ${festival.time_zone} 开放，零徽章也能使用，不受商品库存或下架影响。`, `Available in school time (${festival.time_zone}), even with zero badges and regardless of shop stock or sale status.`)}</p>
        <div className="grid gap-3 sm:grid-cols-2">{freeBackgrounds.map(background => {
          const offer = festival.backgrounds.find(value => value.background_id === background.id)!
          return <article key={background.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-line p-3">
            <div className="w-20 shrink-0 overflow-hidden rounded-lg">{student ? <PetScene student={student} locale={locale} steps={client.state!.settings.value.growth} backgroundId={background.id} className="aspect-square" /> : <img src={background.image} alt="" className="aspect-square w-full object-cover" loading="lazy" />}</div>
            <div className="min-w-0 flex-1"><h4 className="break-words text-sm font-semibold">{background.name[locale]}</h4><p className="mt-1 break-words text-xs leading-relaxed text-muted">{t(`免费至 ${festivalDateFormat.format(offer.expires_at)}（${festival.time_zone}）`, `Free until ${festivalDateFormat.format(offer.expires_at)} (${festival.time_zone})`)}</p><Button variant="primary" className="mt-2 min-h-11 w-full px-2 text-xs" disabled={writesDisabled || !student || !onDress} onClick={() => student && onDress?.(student.id, background.id)} aria-label={`${t('今日免费装扮', 'Free festival outfit')} · ${background.name[locale]}`}><Palette size={15} aria-hidden="true" />{t('今日免费装扮', 'Dress for free')}</Button></div>
          </article>
        })}</div>
      </section>}
      {!!festival.unsupported_background_ids.length && <p className="mb-4 text-xs leading-relaxed text-muted">{t(`当前年份尚未核实以下节日日期，暂不开放免费：${festival.unsupported_background_ids.map(value => petBackgroundById(value)?.name.zh || value).join('、')}；永久兑换和已拥有背景不受影响。`, `Verified dates are not available this year for: ${festival.unsupported_background_ids.map(value => petBackgroundById(value)?.name.en || value).join(', ')}. Free access is unavailable, but permanent redemption and owned backgrounds are unaffected.`)}</p>}
      <h3 className="mb-3 text-sm font-semibold">{t('长期解锁', 'Permanent unlocks')}</h3>
      <div className="mb-5 space-y-3">
        <div role="group" aria-label={t('背景分类', 'Background categories')} className="flex flex-wrap gap-2">
          <Button type="button" className={cn('min-h-11 px-3 text-xs', backgroundCategory === 'all' && 'border-primary bg-[#f5f2ff] text-primary')} aria-pressed={backgroundCategory === 'all'} onClick={() => { setBackgroundCategory('all'); setRemoving(null) }}>{t('全部', 'All')}</Button>
          {backgroundCategories.map(category => <Button key={category.id} type="button" className={cn('min-h-11 px-3 text-xs', backgroundCategory === category.id && 'border-primary bg-[#f5f2ff] text-primary')} aria-pressed={backgroundCategory === category.id} onClick={() => { setBackgroundCategory(category.id); setRemoving(null) }}>{category.name[locale]}</Button>)}
        </div>
        <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-3.5 text-muted" aria-hidden="true" /><Input ref={backgroundSearch} id={`${id}-background-search`} type="search" value={backgroundQuery} onChange={event => { setBackgroundQuery(event.target.value); setRemoving(null) }} aria-label={t('搜索背景名称或描述，支持中文和英文', 'Search background names or descriptions in Chinese or English')} aria-describedby={`${id}-background-results`} placeholder={t('搜索背景或节日，支持中英文', 'Search backgrounds or holidays in Chinese or English')} className="min-h-11 pl-9" /></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><p id={`${id}-background-results`} role="status" aria-live="polite" className="text-xs leading-relaxed text-muted">{t(`显示 ${visibleBackgrounds.length} / ${backgrounds.length} 个在售背景`, `Showing ${visibleBackgrounds.length} of ${backgrounds.length} backgrounds on sale`)}</p>{hasBackgroundFilters && <Button type="button" variant="ghost" className="min-h-11 px-2 text-xs" onClick={clearBackgroundFilters}><X size={14} aria-hidden="true" />{t('清空筛选', 'Clear filters')}</Button>}</div>
      </div>
      {!backgrounds.length ? <div className="empty rounded-2xl border border-dashed border-line"><Palette size={36} className="mb-4 text-primary" aria-hidden="true" /><h3 className="font-semibold">{t('暂无在售背景', 'No backgrounds on sale')}</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{t('已拥有的背景仍保留在装扮中，可以继续选用。', 'Owned backgrounds remain available in Dress up.')}</p>{student && onDress && <Button className="mt-4 min-h-11 text-xs" disabled={writesDisabled} onClick={() => onDress(student.id)}><Palette size={15} aria-hidden="true" />{t('去装扮', 'Dress up')}</Button>}</div> : !visibleBackgrounds.length ? <div className="empty rounded-2xl border border-dashed border-line"><Search size={30} className="mb-3 text-muted" aria-hidden="true" /><h3 className="font-semibold">{t('没有匹配的背景', 'No matching backgrounds')}</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{t('换个中文或英文关键词，或清空分类与搜索后查看全部在售背景。', 'Try another Chinese or English keyword, or clear the category and search to see all backgrounds on sale.')}</p><Button type="button" className="mt-4 min-h-11 text-xs" onClick={clearBackgroundFilters}><X size={14} aria-hidden="true" />{t('清空筛选', 'Clear filters')}</Button></div> : <div className="grid gap-4 sm:grid-cols-2">
        {visibleBackgrounds.map(item => {
          const background = petBackgroundById(item.background_id)!
          const owned = !!student?.owned_background_ids.includes(background.id)
          const inUse = !!student && equippedBackgroundId(student) === background.id
          const insufficient = !!student && !owned && available < item.cost
          const soldOut = item.stock === 0
          const status = inUse ? t('使用中', 'In use') : owned ? t('已拥有', 'Owned') : insufficient ? t('徽章不足', 'Not enough badges') : t('未拥有', 'Not owned')
          return <article key={item.id} className="group/background min-w-0 overflow-hidden rounded-2xl border border-line bg-white" aria-labelledby={`${id}-name-${item.id}`}>
            <div className="relative border-b border-line">
              {student ? <PetScene student={student} locale={locale} steps={client.state!.settings.value.growth} backgroundId={background.id} className="aspect-[4/3]" /> : <img src={background.image} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />}
              <span className={cn('absolute bottom-3 left-3 inline-flex min-h-7 items-center gap-1 rounded-full border border-line bg-white px-2.5 text-xs font-medium', owned ? 'text-primary' : 'text-muted')}>{owned ? <Check size={13} aria-hidden="true" /> : <LockKeyhole size={13} aria-hidden="true" />}{status}</span>
              {student && <span className="absolute bottom-3 right-3 rounded-full bg-white px-2 py-1 text-xs text-muted">{t('效果预览', 'Preview')}</span>}
            </div>
            <div className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 id={`${id}-name-${item.id}`} className="break-words font-semibold">{background.name[locale]}</h3><span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">{t('永久兑换 · ', 'Permanent unlock · ')}<Award size={16} aria-hidden="true" /><span className="tabular">{item.cost}</span>{t('枚徽章', item.cost === 1 ? 'badge' : 'badges')}</span></div>
              <p className="mb-4 mt-2 text-sm leading-relaxed text-muted">{background.description[locale]}</p>
              {owned ? <Button className="min-h-11 w-full text-xs" disabled={writesDisabled || !onDress} onClick={() => student && onDress?.(student.id, background.id)}><Palette size={15} aria-hidden="true" />{t('去装扮', 'Dress up')}</Button> : <Button variant="primary" className="min-h-11 w-full text-xs" disabled={writesDisabled || !student || insufficient || soldOut} busy={redeeming === item.id && backgroundWorking} aria-label={`${t('兑换背景', 'Redeem background')} · ${background.name[locale]} · ${item.cost} ${t('枚徽章', item.cost === 1 ? 'badge' : 'badges')}`} onClick={() => redeem(item)}><Gift size={15} aria-hidden="true" />{!student ? t('请先添加学生', 'Add a student first') : soldOut ? t('暂不可兑换', 'Unavailable') : insufficient ? t('徽章不足', 'Not enough badges') : t('兑换并长期解锁', 'Redeem permanently')}</Button>}
            </div>
            <div className={cn('flex flex-wrap justify-end gap-1 border-t border-line px-2 py-1 transition-opacity group-hover/background:opacity-100 group-focus-within/background:opacity-100 [@media(hover:none)]:opacity-100', removing !== item.id && 'opacity-0')}>
              <Button variant="ghost" className="min-h-11 px-3 text-xs" disabled={writesDisabled} aria-label={t(`修改「${background.name.zh}」价格`, `Edit the price of ${background.name.en}`)} onClick={() => setPriceEditor(item)}><Pencil size={14} aria-hidden="true" />{t('改价格', 'Edit price')}</Button>
              <Button id={`${id}-remove-${item.id}`} variant="ghost" className="min-h-11 px-3 text-xs" disabled={writesDisabled} aria-label={t(`下架「${background.name.zh}」`, `Remove ${background.name.en} from sale`)} aria-expanded={removing === item.id} aria-controls={removing === item.id ? `${id}-confirm-${item.id}` : undefined} onClick={() => setRemoving(value => value === item.id ? null : item.id)}><Trash2 size={14} aria-hidden="true" />{t('下架', 'Remove')}</Button>
            </div>
            {removing === item.id && <div id={`${id}-confirm-${item.id}`} className="border-t border-line bg-[#fff0f2] p-4"><p className="mb-3 text-sm leading-relaxed text-danger">{t('确认下架这个背景？之后不能再兑换，但已拥有的学生仍保留并可使用；已有兑换记录也会保留。', 'Remove this background from sale? New redemptions will stop. Students who own it keep access, and existing redemption records are preserved.')}</p><div className="flex flex-wrap gap-2"><Button variant="danger" className="min-h-11 text-xs" autoFocus disabled={writesDisabled} busy={client.busy} onClick={() => removeItem(item)}><Trash2 size={14} aria-hidden="true" />{t('确认下架', 'Remove from sale')}</Button><Button variant="ghost" className="min-h-11 text-xs" disabled={writesDisabled} onClick={() => cancelRemoval(item.id)}>{t('取消', 'Cancel')}</Button></div></div>}
          </article>
        })}
      </div>}
    </section>
    <section role="tabpanel" id={`${id}-panel-history`} aria-labelledby={`${id}-tab-history`} hidden={tab !== 'history'}>
      {!redemptions.length ? <div className="empty"><History size={36} className="mb-4 text-primary" aria-hidden="true" /><h3 className="font-semibold">{t('暂无兑换记录', 'No redemptions yet')}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{t('兑换商品后，可在这里查看当时操作教师的署名。负责人可退款全班，共同管理员仅可退款自己的兑换。', 'View each redemption with the teacher’s name at the time. Owners may refund any class redemption; co-admins may refund only their own.')}</p></div> : <div className="table-wrap"><table className="data-table"><caption className="sr-only">{t('本班学生的商品兑换与退款记录', 'Reward redemptions and refunds for this class')}</caption><thead><tr><th scope="col">{t('学生 / 时间', 'Student / time')}</th><th scope="col">{t('商品', 'Reward')}</th><th scope="col">{t('操作教师', 'Teacher')}</th><th scope="col">{t('徽章', 'Badges')}</th><th scope="col">{t('操作', 'Action')}</th></tr></thead><tbody>{redemptions.map(redemption => <tr key={redemption.id} className={redemption.undone ? 'text-muted' : ''}>
        <td><span className="block whitespace-nowrap font-medium">{redemption.student_name}</span><time dateTime={new Date(redemption.created_at).toISOString()} className="mt-1 block whitespace-nowrap text-xs text-muted">{dateFormat.format(redemption.created_at)}</time></td>
        <td className="min-w-32 break-words">{redemption.item_name[locale]}{redemption.background_id && <span className="mt-1 block text-xs leading-relaxed text-muted">{t('宠物背景 · 退款后撤销解锁', 'Pet background · refund revokes access')}</span>}</td>
        <td className="min-w-32 break-words text-xs leading-relaxed">{operationActorName(redemption, locale)}</td>
        <td className="tabular">{redemption.cost}</td>
        <td className="whitespace-nowrap">{redemption.undone ? <span className="block max-w-48 whitespace-normal text-xs leading-relaxed">{t('已退款', 'Refunded')}{redemption.undone_by_name && <span className="mt-1 block">{t('退款者：', 'Refunded by: ')}{operationActorName(redemption, locale, true)}</span>}</span> : redemption.can_undo ? <Button variant="ghost" className="min-h-11 text-xs" disabled={writesDisabled} busy={refunding === redemption.id && client.busy} aria-label={t(`为${redemption.student_name}退回「${redemption.item_name.zh}」的 ${redemption.cost} 枚徽章`, `Refund ${redemption.cost} ${redemption.cost === 1 ? 'badge' : 'badges'} to ${redemption.student_name} for ${redemption.item_name.en}`)} onClick={async () => { if (backgroundSubmitting.current || recoveryLock.current || writesDisabled) return; setRefunding(redemption.id); try { if (await client.run(() => api(`redemptions/${redemption.id}/undo`, 'POST', {}), t('兑换已退款，徽章已退回。', 'Redemption refunded. Badges returned.'))) document.getElementById(`${id}-tab-history`)?.focus() } finally { setRefunding(null) } }}><Undo2 size={15} aria-hidden="true" />{t('退款', 'Refund')}</Button> : <span className="text-xs text-muted">{t('仅本人或负责人可退款', 'Author or owner only')}</span>}</td>
      </tr>)}</tbody></table></div>}
    </section>
    {priceEditor && <BackgroundPriceDialog key={priceEditor.id} client={client} locale={locale} item={priceEditor} onClose={() => setPriceEditor(null)} />}
    {editor && <ShopItemDialog key={editor.item?.id || 'new'} client={client} locale={locale} item={editor.item} returnFocusTo={editor.trigger} onClose={() => setEditor(null)} />}
  </Dialog>
}
