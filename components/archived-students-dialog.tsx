'use client'
import { useEffect, useRef, useState } from 'react'
import { Archive, ArrowLeft, RotateCcw, Search } from 'lucide-react'
import { Button, Dialog, Input } from '@/components/ui'
import { errorMessage, growth, petById, petImage, translator } from '@/lib/i18n'
import type { Locale, StudentHistory, StudentHistoryEntry } from '@/lib/types'
import { api, ApiError, type GardenClient } from './use-garden'

export function ArchivedStudentsDialog({ client, locale, onClose }: { client: GardenClient; locale: Locale; onClose: () => void }) {
  const t = translator(locale)
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string | null>(null)
  const [offset, setOffset] = useState(0), [retry, setRetry] = useState(0)
  const [entries, setEntries] = useState<StudentHistoryEntry[]>([]), [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const students = client.state!.archived_students
  const student = students.find(row => row.id === selected)
  const visible = students.filter(row => `${row.name} ${row.student_no}`.toLowerCase().includes(query.toLowerCase()))
  const formatDate = (time: number) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(time)
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setLoading(true); setError('')
    api<StudentHistory>(`students/${selected}/history?offset=${offset}`).then(result => {
      if (cancelled) return
      setEntries(previous => offset === 0 ? result.entries : [...previous, ...result.entries])
      setNextOffset(result.nextOffset)
    }).catch(failure => {
      if (!cancelled) setError(errorMessage(failure instanceof ApiError ? failure.code : 'serverError', locale))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selected, offset, retry, locale])
  useEffect(() => { heading.current?.focus() }, [selected, student?.id])
  function back() { setSelected(null); setEntries([]); setOffset(0); setConfirm(false); setError('') }
  return <Dialog open wide icon={Archive} onClose={() => { if (!client.busy) onClose() }} title={t('已归档学生', 'Archived students')} description={t('转学或离班的学生保留在这里，不计入在班人数，也不参与日常评价和兑换。恢复后继续使用原有档案。', 'Students who transfer or leave are kept here, excluded from active counts, evaluations and redemptions. Restoring keeps their existing profile.')}>
    {selected && !student ? <div className="space-y-4"><p role="status">{t('该学生已恢复，或已不在当前班级的归档名单中。', 'This student has been restored or is no longer in this class’s archive.')}</p><Button onClick={back}>{t('返回归档名单', 'Back to archive')}</Button></div> : student ? <div className="space-y-5">
      <Button variant="ghost" onClick={back} disabled={client.busy}><ArrowLeft size={16} />{t('返回归档名单', 'Back to archive')}</Button>
      <div className="flex items-center gap-4">
        {student.pet_id && <img src={petImage(student.pet_id, growth(student.pet_exp, client.state!.settings.value.growth).level)} alt={petById(student.pet_id)?.name[locale] || ''} className="size-20 shrink-0 object-contain" />}
        <div className="min-w-0"><h3 ref={heading} tabIndex={-1} className="break-words text-lg font-semibold">{student.name}</h3><p className="mt-1 break-words text-sm text-muted">{t('学号', 'Student number')}: {student.student_no || '—'}</p><p className="mt-1 text-sm text-muted">{t('归档于', 'Archived on')} {formatDate(student.archived_at!)}</p></div>
      </div>
      <p className="text-sm leading-relaxed">{t(`累计积分 ${student.points} · 宠物成长 ${student.pet_exp} · 累计徽章 ${student.badge_count} · 可用徽章 ${student.badge_count - student.spent_badges}`, `Total points ${student.points} · Pet growth ${student.pet_exp} · Earned badges ${student.badge_count} · Available badges ${student.badge_count - student.spent_badges}`)}</p>
      <div className="space-y-3 border-y border-line py-4">
        {confirm && client.notice?.error && <p role="alert" className="text-sm text-danger">{client.notice.text}</p>}
        {confirm && <p role="status" className="text-sm">{t(`将 ${student.name} 恢复到当前班级？积分、宠物和历史保持不变。`, `Restore ${student.name} to this class? Points, pets and history are kept.`)}</p>}
        <div className="flex flex-wrap gap-2"><Button variant="primary" busy={client.busy} onClick={async () => { client.setNotice(null); if (!confirm) return setConfirm(true); if (await client.run(() => api(`students/${student.id}/restore`, 'POST', {}), t('学生已恢复到在班名单。', 'Student restored to the active roster.'))) back() }}><RotateCcw size={16} />{confirm ? t('确认恢复', 'Confirm restore') : t('恢复到当前班级', 'Restore to this class')}</Button>{confirm && <Button variant="ghost" disabled={client.busy} onClick={() => setConfirm(false)}>{t('取消', 'Cancel')}</Button>}</div>
      </div>
      <h4 className="font-semibold">{t('评价与兑换历史', 'Evaluation and redemption history')}</h4>
      <div className="max-h-[35dvh] space-y-3 overflow-y-auto" aria-busy={loading}>
        {entries.map(entry => <div key={`${entry.kind}-${entry.id}`} className="border-b border-line pb-3 text-sm leading-relaxed">
          <p className="flex flex-wrap justify-between gap-2"><span className="min-w-0 break-words">{entry.description[locale] || t('自定义评价', 'Custom evaluation')}</span><span className="tabular">{entry.kind === 'evaluation' ? `${entry.amount > 0 ? '+' : ''}${entry.amount} ${t('积分', 'points')}` : `${entry.amount} ${t('枚徽章', 'badges')}`}{entry.undone ? ` · ${t('已撤回', 'Undone')}` : ''}</span></p>
          <p className="mt-1 break-words text-xs text-muted"><time>{formatDate(entry.created_at)}</time> · {entry.actor_name ? `${entry.actor_name} · ${entry.actor_subject}` : t('历史记录', 'Historical record')}</p>
        </div>)}
        {!loading && !error && !entries.length && <p className="text-sm text-muted">{t('该学生还没有评价或兑换记录。', 'This student has no evaluations or redemptions yet.')}</p>}
      </div>
      {loading && <p role="status" className="text-sm text-muted">{t('正在加载历史…', 'Loading history…')}</p>}
      {error && <div><p role="alert" className="mb-2 text-sm text-danger">{error}</p><Button onClick={() => setRetry(value => value + 1)}>{t('重试', 'Retry')}</Button></div>}
      {!loading && !error && nextOffset !== null && <Button onClick={() => setOffset(nextOffset)}>{t('加载更早记录', 'Load earlier records')}</Button>}
    </div> : <div>
      <div className="relative mb-5"><Search size={17} className="absolute left-3 top-3 text-muted" /><Input autoFocus className="pl-10" value={query} onChange={event => setQuery(event.target.value)} aria-label={t('搜索已归档学生', 'Search archived students')} placeholder={t('搜索姓名或学号', 'Search name or student number')} /></div>
      {!visible.length ? <p className="empty text-muted">{students.length ? t('没有匹配的已归档学生。', 'No archived students match your search.') : t('当前班级还没有已归档学生。可从学生的编辑窗口归档。', 'No archived students in this class. Archive a student from their edit dialog.')}</p> : <div className="max-h-[55dvh] divide-y divide-line overflow-y-auto">{visible.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0 flex-1"><p className="break-words font-semibold">{row.name}</p><p className="mt-1 break-words text-sm text-muted">{row.student_no && `${row.student_no} · `}{formatDate(row.archived_at!)}</p></div><Button onClick={() => { setSelected(row.id); setOffset(0); setEntries([]); setNextOffset(null); setConfirm(false) }}>{t('查看档案', 'View profile')}</Button></div>)}</div>}
    </div>}
  </Dialog>
}
