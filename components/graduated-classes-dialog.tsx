'use client'
import { GraduationCap } from 'lucide-react'
import { Button, Dialog } from '@/components/ui'
import { translator } from '@/lib/i18n'
import type { Classroom, Locale } from '@/lib/types'
import type { GardenClient } from './use-garden'

export function GraduatedClassesDialog({ client, locale, onClose, onOpen }: {
  client: GardenClient
  locale: Locale
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const t = translator(locale)
  const classes = (client.state?.classes || []).filter(item => item.graduated_at != null)
  const format = (time: number) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium' }).format(time)
  const roleName = (classroom: Classroom) => classroom.role === 'global_admin' ? t('全局管理员', 'Global admin') : classroom.role === 'owner' ? t('负责人', 'Owner') : t('共同管理员', 'Co-admin')
  return <Dialog open onClose={onClose} icon={GraduationCap} title={t('毕业班级', 'Graduated classes')} description={t('这些班级已从左上角切换列表移出。学生、评价、徽章和兑换记录仍保留，可以打开查看。', 'These classes are hidden from the class switcher. Students, evaluations, badges and redemptions are kept and can be opened.')}>
    {!classes.length ? <div className="rounded-2xl border border-dashed border-[#d8cfee] px-5 py-10 text-center">
      <p role="status" className="font-semibold">{t('还没有毕业班级', 'No graduated classes yet')}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{t('在「管理班级」中可以把班级设为毕业。设为毕业不会删除班级数据。', 'Mark a class as graduated from Manage class. Graduation does not delete class data.')}</p>
    </div> : <ul className="space-y-2" aria-label={t('毕业班级列表', 'Graduated class list')}>{classes.map(classroom => <li key={classroom.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
      <div className="min-w-0"><p className="break-words font-semibold">{classroom.name}</p><p className="mt-1 text-xs text-muted">{roleName(classroom)} · {t('毕业于 ', 'Graduated ')}{format(classroom.graduated_at!)}</p></div>
      <Button variant="primary" disabled={client.busy} aria-label={t(`查看${classroom.name}`, `View ${classroom.name}`)} onClick={() => onOpen(classroom.id)}>{t('查看', 'View')}</Button>
    </li>)}</ul>}
  </Dialog>
}
