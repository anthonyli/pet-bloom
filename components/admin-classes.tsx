'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronLeft, ChevronRight, Globe2, LoaderCircle, Search, ShieldCheck } from 'lucide-react'
import { Button, Dialog, Input, Label } from '@/components/ui'
import { api, ApiError } from '@/components/use-garden'
import { errorMessage, translator } from '@/lib/i18n'
import type { Locale } from '@/lib/types'
import type { AdminClassDetail, AdminClassPage } from '@/lib/admin-types'

type Remote<T> = { key: string; value?: T; error?: string }
function useAdminRead<T>(path: string | null, revision: number) {
  const key = `${path}:${revision}`
  const [state, setState] = useState<Remote<T>>({ key: '' })
  useEffect(() => {
    setState({ key })
    if (!path) return
    let current = true
    api<T>(path).then(value => { if (current) setState({ key, value }) }).catch(error => {
      if (current) setState({ key, error: error instanceof ApiError ? error.code : 'networkError' })
    })
    return () => { current = false }
  }, [path, key])
  return state.key === key ? state : { key }
}

export function AdminLink({ locale }: { locale: Locale }) {
  const access = useAdminRead<{ allowed: boolean }>('admin/access', 0)
  if (!access.value?.allowed) return null
  return <Link href={`/${locale}/admin`} className="button button-ghost gap-2 px-2 sm:px-3"><ShieldCheck size={17} aria-hidden="true" /><span className="hidden sm:inline">{translator(locale)('全部班级', 'All classes')}</span><span className="sr-only sm:hidden">{translator(locale)('全部班级', 'All classes')}</span></Link>
}

export function AdminClasses({ locale }: { locale: Locale }) {
  const t = translator(locale)
  const [draft, setDraft] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0), [selected, setSelected] = useState<string | null>(null)
  const [detailRevision, setDetailRevision] = useState(0)
  const list = useAdminRead<AdminClassPage>(`admin/classes?${new URLSearchParams({ page: String(page), search })}`, revision)
  const detail = useAdminRead<AdminClassDetail>(selected ? `admin/classes/${encodeURIComponent(selected)}` : null, detailRevision)
  const accessError = [list.error, selected ? detail.error : undefined].find(code => code === 'unauthorized' || code === 'forbidden')
  const formatDate = (time: number) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium' }).format(time)
  const loading = <p role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" />{t('正在加载班级…', 'Loading classes…')}</p>
  function failure(code: string, retry: () => void) {
    return <div className="space-y-4 py-10 text-center"><p role="alert" className="text-sm text-danger">{errorMessage(code, locale)}</p><Button onClick={retry}>{t('重试', 'Try again')}</Button></div>
  }
  return <div className="min-h-screen bg-canvas text-ink">
    <header className="border-b border-line bg-white"><nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4" aria-label={t('页面导航', 'Page navigation')}>
      <Link className="button button-ghost gap-2" href={`/${locale}`}><ArrowLeft size={17} aria-hidden="true" />{t('返回工作台', 'Back to workspace')}</Link>
      <Link className="button button-ghost gap-2" href={`/${locale === 'zh' ? 'en' : 'zh'}/admin`} aria-label={t('切换为英文', 'Switch to Chinese')}><Globe2 size={17} aria-hidden="true" />{locale === 'zh' ? 'EN' : '中文'}</Link>
    </nav></header>
    <main className="mx-auto max-w-6xl px-5 py-8 sm:py-12">
      <div className="mb-8"><div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('全部班级', 'All classes')}</h1><span className="rounded-full bg-white px-3 py-1 text-xs text-muted">{t('管理员 · 只读', 'Admin · Read only')}</span></div><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{t('查看当前应用内各教师的班级与人数，选择班级查看概要。', 'Browse classes and student counts across teachers in this app. Select a class to view its summary.')}</p></div>
      {accessError ? <section className="rounded-2xl border border-line bg-white p-6"><h2 className="text-lg font-semibold">{accessError === 'unauthorized' ? t('请先登录', 'Sign in required') : t('此页面仅供全局管理员访问', 'Global admin access required')}</h2><p className="mt-3 text-sm text-muted">{accessError === 'unauthorized' ? t('登录后重新打开此页面。', 'Sign in, then reopen this page.') : t('当前账号没有查看全部班级的权限。如需访问，请联系应用负责人。', 'Your account cannot view all classes. Contact the app owner if you need access.')}</p><Link href={`/${locale}`} className="button button-primary mt-5">{t('返回工作台', 'Back to workspace')}</Link></section> : <>
        <form className="mb-6 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setSelected(null); setPage(1); setSearch(draft.trim()); setRevision(value => value + 1) }}>
          <div className="min-w-0 flex-1 sm:max-w-md"><Label htmlFor="admin-search">{t('搜索班级名称', 'Search class names')}</Label><Input id="admin-search" maxLength={80} value={draft} onChange={event => setDraft(event.target.value)} placeholder={t('输入班级名称', 'Enter a class name')} className="bg-white" /></div>
          <Button type="submit" variant="primary"><Search size={17} aria-hidden="true" />{t('搜索', 'Search')}</Button>
          {search && <Button type="button" onClick={() => { setDraft(''); setSearch(''); setPage(1); setSelected(null) }}>{t('清除搜索', 'Clear search')}</Button>}
        </form>
        <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-label={t('班级列表', 'Class list')} aria-busy={!list.value && !list.error}>
          {list.error ? failure(list.error, () => setRevision(value => value + 1)) : !list.value ? loading : <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><p role="status" className="text-sm font-medium">{t(`共 ${list.value.total} 个班级`, `${list.value.total} classes`)}</p><Button variant="ghost" onClick={() => setRevision(value => value + 1)}>{t('刷新', 'Refresh')}</Button></div>
            {!list.value.classes.length ? <div className="px-5 py-16 text-center"><h2 className="font-semibold">{search ? t('没有找到匹配的班级', 'No matching classes') : t('暂无班级', 'No classes yet')}</h2><p className="mt-2 text-sm text-muted">{search ? t('试试其他名称，或清除搜索查看全部班级。', 'Try another name, or clear the search to see all classes.') : t('教师创建班级后，将显示在这里。', 'Classes will appear here when teachers create them.')}</p></div> : <ul className="divide-y divide-line">{list.value.classes.map(classroom => <li key={classroom.id}>
              <Button variant="ghost" className="w-full items-start justify-between gap-4 rounded-none px-5 py-5 text-left" onClick={() => setSelected(classroom.id)} aria-haspopup="dialog">
                <span className="min-w-0 flex-1"><span className="block break-words text-base font-semibold">{classroom.name}</span><span className="mt-2 block break-words text-sm font-normal text-muted">{t('负责人：', 'Owner: ')}{classroom.owner_name || t('未完善资料', 'Profile incomplete')}{classroom.owner_subject ? ` · ${classroom.owner_subject}` : ''}</span><span className="mt-2 block text-xs font-normal text-muted">{t('创建于 ', 'Created ')}{formatDate(classroom.created_at)}</span></span>
                <span className="flex shrink-0 items-center gap-3"><span className="space-y-2 text-right text-sm font-normal tabular-nums"><span className="block">{t(`在班 ${classroom.active_students} 人`, `${classroom.active_students} active`)}</span><span className="block text-muted">{t(`归档 ${classroom.archived_students} 人`, `${classroom.archived_students} archived`)}</span></span><ChevronRight size={16} className="hidden text-muted sm:block" aria-hidden="true" /></span>
              </Button>
            </li>)}</ul>}
            <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4" aria-label={t('班级分页', 'Class pagination')}><p className="text-xs text-muted">{t(`第 ${page} 页 · 每页 ${list.value.pageSize} 个`, `Page ${page} · ${list.value.pageSize} per page`)}</p><div className="flex gap-2"><Button disabled={page === 1} onClick={() => { setSelected(null); setPage(value => value - 1) }}><ChevronLeft size={16} aria-hidden="true" />{t('上一页', 'Previous')}</Button><Button disabled={page * list.value.pageSize >= list.value.total} onClick={() => { setSelected(null); setPage(value => value + 1) }}>{t('下一页', 'Next')}<ChevronRight size={16} aria-hidden="true" /></Button></div></nav>
          </>}
        </section>
        {list.value && !list.value.archiveSupported && <p className="mt-4 text-xs leading-relaxed text-muted">{t('当前尚未启用学生归档，所有学生均计入在班人数。', 'Student archiving is not enabled yet. All students count as active.')}</p>}
        {selected && <Dialog open onClose={() => setSelected(null)} title={t('班级概要', 'Class summary')} description={t('仅查看班级信息和汇总人数。', 'View class information and aggregate counts.')}>
          {detail.error ? failure(detail.error, () => setDetailRevision(value => value + 1)) : !detail.value ? loading : <dl className="space-y-5 text-sm">{[
            [t('班级名称', 'Class name'), detail.value.classroom.name],
            [t('负责人', 'Owner'), detail.value.classroom.owner_name || t('未完善资料', 'Profile incomplete')],
            [t('任教学科', 'Subject'), detail.value.classroom.owner_subject || t('未填写', 'Not provided')],
            [t('创建日期', 'Created'), formatDate(detail.value.classroom.created_at)],
            [t('在班学生', 'Active students'), detail.value.classroom.active_students],
            [t('已归档学生', 'Archived students'), detail.value.classroom.archived_students],
            [t('班级教师（含负责人）', 'Class teachers (including owner)'), detail.value.classroom.teacher_count],
            [t('班级编号', 'Class ID'), detail.value.classroom.id]
          ].map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4"><dt className="text-muted">{label}</dt><dd className="break-words font-medium tabular-nums">{value}</dd></div>)}</dl>}
        </Dialog>}
      </>}
    </main>
  </div>
}
