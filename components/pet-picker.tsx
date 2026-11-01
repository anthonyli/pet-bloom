'use client'
import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, Bird, BookOpen, Cat, Check, Dog, ExternalLink, Grid2X2, Leaf, Mountain, PawPrint, Rabbit, Search, Shapes, Sparkles, Sprout, Clapperboard } from 'lucide-react'
import { Button, Dialog, Input, Select, cn } from '@/components/ui'
import { pets, petById, petImage, translator, growth } from '@/lib/i18n'
import { filterPetCatalog, petCollections, petKinds, type CollectionFilter, type KindFilter } from '@/lib/pet-catalog'
import type { Locale, Student } from '@/lib/types'
import { api, type GardenClient } from './use-garden'

const collectionIcons = { all: Grid2X2, fairy: Sparkles, shanhai: BookOpen, anime: Clapperboard, cute: PawPrint, zodiac: Shapes }
const kindIcons = { all: Grid2X2, dog: Dog, cat: Cat, bird: Bird, small: Rabbit, farm: Sprout, wild: Leaf, mythical: Sparkles }

export function PetPicker({ client, locale, student, replacing = false, onClose }: { client: GardenClient; locale: Locale; student: Student | null; replacing?: boolean; onClose: () => void }) {
  const t = translator(locale)
  const [query, setQuery] = useState(''), [collection, setCollection] = useState<CollectionFilter>('all'), [kind, setKind] = useState<KindFilter>('all')
  const [preview, setPreview] = useState<string | null>(null), [stage, setStage] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null), listScroll = useRef(0)
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = preview ? 0 : listScroll.current }, [preview])
  const filtered = filterPetCatalog(pets, { query, collection, kind, locale })
  const selected = preview ? petById(preview) : undefined
  const currentLevel = student ? growth(student.pet_exp, client.state!.settings.value.growth).level : 1
  function openCollection(value: CollectionFilter) { setCollection(value); setKind('all') }
  return <Dialog open wide onClose={onClose} icon={PawPrint} className="flex h-[90dvh] flex-col overflow-hidden" title={student ? replacing ? t(`为 ${student.name} 更换宠物`, `Change ${student.name}’s companion`) : t(`为 ${student.name} 选择宠物`, `A companion for ${student.name}`) : t('宠物图鉴', 'Pet collection')} description={replacing ? t('更换宠物种类，保留当前成长值、积分和徽章。', 'Change the companion while keeping current growth, points and badges.') : student?.pet_id ? t('原宠物已毕业。重新领养将从零开始成长，累计积分和徽章保留。', 'Your companion has graduated. A new adoption starts growth from zero; total points and badges are kept.') : t(`${pets.length} 种伙伴，每种都有 8 张独立成长形态。分类沿用参考图鉴，并增加生肖专题。`, `${pets.length} companions, each with 8 distinct growth images. Original collections are preserved, with an added zodiac theme.`)}>
    <div ref={scrollRef} className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
      {selected ? <div>
        <Button variant="ghost" onClick={() => setPreview(null)}><ArrowLeft size={16} />{t('返回宠物列表', 'Back to companions')}</Button>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-muted">{selected.zodiac && <span className="rounded-full bg-[#fff3d8] px-3 py-1 text-[#795719]">{selected.zodiac.name[locale]}</span>}{selected.chapter && <span className="inline-flex items-center gap-1 rounded-full bg-[#f0ebff] px-3 py-1 text-primary"><BookOpen size={13} />{locale === 'zh' ? `《${selected.chapter.zh}》` : selected.chapter.en}</span>}</div>
        <img src={petImage(selected.id, replacing ? currentLevel : stage)} alt={selected.name[locale]} className="mx-auto mt-3 h-56 max-w-full rounded-xl object-contain" />
        <h3 className="mb-2 mt-4 text-center text-xl font-bold">{selected.name[locale]}</h3>
        <p className="mx-auto mb-5 max-w-lg text-center text-sm leading-relaxed text-muted">{selected.description[locale]}</p>
        {replacing ? <p className="text-center text-sm font-semibold text-primary">{t(`沿用当前等级 Lv.${currentLevel}`, `Keeping current level Lv.${currentLevel}`)}</p> : <div className="flex flex-wrap justify-center gap-2">{Array.from({ length: 8 }, (_, index) => index + 1).map(value => <Button key={value} variant={stage === value ? 'primary' : 'secondary'} onClick={() => setStage(value)}>Lv.{value}</Button>)}</div>}
        {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center justify-center gap-1 text-xs text-muted underline underline-offset-4"><ExternalLink size={12} />{t('查看图像来源', 'View artwork source')}</a>}
      </div> : <>
        <div className="bg-white pb-4 [@media(min-height:600px)]:sticky [@media(min-height:600px)]:top-0 [@media(min-height:600px)]:z-10">
          <div className="section-tabs mb-4" role="group" aria-label={t('宠物主题分类', 'Pet collections')}>{petCollections.map(item => {
            const Icon = collectionIcons[item.id]
            const count = item.id === 'all' ? pets.length : pets.filter(pet => pet.collections?.includes(item.id as Exclude<CollectionFilter, 'all'>)).length
            return <button key={item.id} className={cn('tab inline-flex items-center gap-2', collection === item.id && 'tab-active')} aria-pressed={collection === item.id} onClick={() => openCollection(item.id)}><Icon size={15} /><span>{item.name[locale]}</span><span className="text-[11px] tabular">{count}</span></button>
          })}</div>
          <div className="flex flex-wrap items-center gap-3"><div className="relative min-w-44 flex-1"><Search size={16} className="absolute left-3 top-3 text-muted" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('搜索名字、生肖或英文名…', 'Search a name, zodiac sign or English name…')} aria-label={t('搜索宠物', 'Search pets')} className="pl-10" /></div><Select aria-label={t('动物类型', 'Animal type')} value={kind} onValueChange={value => setKind(value as KindFilter)} className="w-48" options={petKinds.map(item => ({ value: item.id, label: item.name[locale], icon: kindIcons[item.id] }))} /></div>
        </div>
        {collection === 'zodiac' && <p className="mb-4 flex items-center gap-2 text-xs leading-relaxed text-muted"><Shapes size={15} className="shrink-0" />{t('十二生肖已全部开放，按子鼠至亥猪的传统顺序排列；每位伙伴均有 8 张独立成长形态。', 'All twelve zodiac signs are available, ordered from Rat to Pig, with eight distinct growth images for each companion.')}</p>}
        {collection === 'shanhai' && <p className="mb-4 flex items-center gap-2 text-xs leading-relaxed text-muted"><Mountain size={15} className="shrink-0" />{t('沿用参考图鉴的山海主题：九尾狐、貔貅、狻猊、青龙、白虎、朱雀；这是神话主题分类，不是古籍出处索引。', 'The original Shanhai theme includes the nine-tailed fox, Pixiu, Suanni, Azure Dragon, White Tiger and Vermilion Bird. This is a mythical theme, not a textual source index.')}</p>}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">{filtered.map(pet => <button key={pet.id} aria-label={pet.name[locale]} onClick={() => { listScroll.current = scrollRef.current?.scrollTop || 0; setPreview(pet.id); setStage(1) }} className="flex scroll-mt-44 flex-col rounded-xl border border-line bg-white p-2 text-center transition-colors hover:border-primary hover:bg-[#f7f4ff] sm:scroll-mt-32">
          <img src={petImage(pet.id, replacing ? currentLevel : 1)} alt="" loading="lazy" className="mb-2 aspect-square w-full rounded-lg object-contain" />
          <span className="block text-xs font-semibold leading-relaxed">{pet.name[locale]}</span>
          {pet.zodiac && collection === 'zodiac' && <span className="mt-1 block text-[11px] text-muted">{pet.zodiac.name[locale]}</span>}
          {pet.chapter && collection === 'shanhai' && <span className="mt-1 block text-[11px] text-muted">{pet.chapter[locale]}</span>}
        </button>)}</div>
        {!filtered.length && <div className="empty min-h-32"><Search size={28} className="mb-3" /><p className="mb-3 text-sm">{t('没有找到符合条件的伙伴。', 'No companions match these filters.')}</p><Button variant="ghost" onClick={() => { setQuery(''); setKind('all'); setCollection('all') }}><ArrowLeft size={15} />{t('查看全部伙伴', 'Show all companions')}</Button></div>}
      </>}
    </div>
    <div className="mt-4 shrink-0">
      {selected ? student && <Button variant="primary" busy={client.busy} disabled={replacing && (selected.id === student.pet_id || !client.state!.settings.value.allowChangePet)} className="w-full" onClick={async () => { if (await client.run(() => api(`students/${student.id}/pet`, replacing ? 'PATCH' : 'POST', { petId: selected.id }), replacing ? t('宠物已更换，成长值和积分保持不变。', 'Companion changed. Growth and points are unchanged.') : t('领养成功，一起成长吧！', 'Adopted. Let’s grow together!'))) onClose() }}><Check size={16} />{replacing ? selected.id === student.pet_id ? t('当前宠物', 'Current companion') : t('更换为这只宠物', 'Switch to this companion') : t('领养这只宠物', 'Adopt this companion')}</Button> : <div className="flex items-center justify-between gap-3 text-xs text-muted"><span className="shrink-0" role="status">{t(`找到 ${filtered.length} 位伙伴`, `${filtered.length} companions found`)}</span><span className="text-right">{t('分类与领养共享同一份图鉴', 'The same collection is available for adoption')}</span></div>}
    </div>
  </Dialog>
}
