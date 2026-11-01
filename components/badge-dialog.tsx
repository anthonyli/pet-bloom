'use client'
import { Award } from 'lucide-react'
import { Button, Dialog, cn } from '@/components/ui'
import { badgeLevels } from '@/lib/data/badges'
import { petById, translator } from '@/lib/i18n'
import type { Badge, Locale, Student } from '@/lib/types'

export function BadgeDialog({ open, student, badges, locale, onClose }: { open: boolean; student: Student; badges: Badge[]; locale: Locale; onClose: () => void }) {
  const t = translator(locale)
  const collected = badges.filter(badge => badge.student_id === student.id && badge.active === 1).sort((a, b) => b.earned_at - a.earned_at)
  const earnedLevels = new Set(collected.map(badge => badge.level))
  const date = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })

  return <Dialog open={open} onClose={onClose} icon={Award} title={t('徽章收藏', 'Badge collection')} description={t(`${student.name} 的宠物成长荣誉`, `${student.name}’s pet growth honors`)} closeLabel={t('关闭徽章收藏', 'Close badge collection')} className="flex h-[min(90dvh,52rem)] max-w-2xl flex-col overflow-hidden [&>div:first-child]:[overflow-wrap:anywhere]">
    <dl className="mb-5 flex shrink-0 flex-wrap gap-x-6 gap-y-2 border-b border-line pb-4 text-sm">
      <div className="flex items-baseline gap-2"><dt className="text-muted">{t('累计获得', 'Earned')}</dt><dd className="tabular font-semibold">{student.badge_count}</dd></div>
      <div className="flex items-baseline gap-2"><dt className="text-muted">{t('已消费', 'Spent')}</dt><dd className="tabular font-semibold">{student.spent_badges}</dd></div>
      <div className="flex items-baseline gap-2"><dt className="text-muted">{t('可用', 'Available')}</dt><dd className="tabular font-semibold text-primary">{Math.max(0, student.badge_count - student.spent_badges)}</dd></div>
    </dl>
    <div role="region" aria-label={t('宠物等级徽章与获得记录', 'Pet level badges and award history')} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
      <p className="mb-5 text-sm leading-relaxed text-muted">{t('每轮首次达到 Lv.2–Lv.8 时，按当时成长设置发放徽章，奖励可以为 0 枚。Lv.1 不奖励；修改设置不会重新发放已达成等级的奖励。', 'Reaching Lv.2–Lv.8 for the first time each cycle awards the configured badge amount, which may be zero. Lv.1 has no reward. Changing settings does not reward completed levels again.')}</p>
      {!collected.length && <div className="pb-7 pt-2 text-center">
        <Award size={36} className="mx-auto mb-3 text-[#795c1c]" aria-hidden="true" />
        <h3 className="mb-2 font-semibold">{t('成长的纪念，从 Lv.2 开始', 'Your collection starts at Lv.2')}</h3>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted">{t('还没有等级徽章记录。领养宠物后，通过评价陪伴它成长，获得的徽章会收藏在这里。', 'No level badges recorded yet. Adopt a pet and help it grow through evaluations. Its earned badges will be collected here.')}</p>
      </div>}
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{t('宠物等级徽章', 'Pet level badges')}</h3>
        <span className="text-xs text-muted">{t(`已获 ${earnedLevels.size} / ${badgeLevels.length} 种`, `${earnedLevels.size} / ${badgeLevels.length} levels collected`)}</span>
      </div>
      <ul className="space-y-4">
        {badgeLevels.map(definition => {
          const records = collected.filter(badge => badge.level === definition.level)
          const earned = records.length > 0
          return <li key={definition.level} className="border-b border-line pb-4 last:border-0">
            <div className="flex items-center gap-3">
              <div className={cn('flex size-12 shrink-0 items-center justify-center', earned ? 'text-[#795c1c]' : 'text-muted')}>
                <img src={definition.image} alt={t(`Lv.${definition.level} ${definition.name.zh}徽章`, `Lv.${definition.level} ${definition.name.en} badge`)} className={cn('size-12 object-contain', !earned && 'opacity-40 grayscale')} width={512} height={512} loading="lazy" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold"><span className="text-primary">Lv.{definition.level}</span><span>{definition.name[locale]}</span></h4>
                <p className={cn('mt-1 text-xs', earned ? 'text-[#795c1c]' : 'text-muted')}>{earned ? t(`已获得 ${records.length} 次`, `Earned ${records.length} ${records.length === 1 ? 'time' : 'times'}`) : t('尚未获得', 'Not earned yet')}</p>
              </div>
            </div>
            {earned && <ul className="ml-2 mt-3 space-y-3 border-l border-line pl-4 text-xs">
              {records.map(badge => <li key={badge.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="min-w-0 break-words text-muted">{t(`第 ${badge.generation} 轮养成`, `Pet cycle ${badge.generation}`)} · {petById(badge.pet_id)?.name[locale] || t('未收录宠物', 'Unlisted companion')}</span>
                <span className="tabular font-semibold text-[#795c1c]">{t(`${badge.amount} 枚`, `${badge.amount} badges`)}</span><time dateTime={new Date(badge.earned_at).toISOString()} className="text-muted">{date.format(badge.earned_at)}</time>
              </li>)}
            </ul>}
          </li>
        })}
      </ul>
    </div>
    <footer className="mt-5 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <p className="min-w-0 flex-1 basis-52 text-xs leading-relaxed text-muted">{t('兑换只扣减可用徽章，不移除收藏荣誉。换宠保留本轮记录；重新领养开启新一轮，旧徽章仍在。', 'Spending reduces your available balance, not your collection. Changing companions keeps the current cycle. Adopting again starts a new cycle and preserves past badges.')}</p>
      <Button onClick={onClose}>{t('关闭', 'Close')}</Button>
    </footer>
  </Dialog>
}
