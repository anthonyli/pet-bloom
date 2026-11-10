'use client'
import { AdminLink } from '@/components/admin-classes'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PawPrint, Palette, ArrowDownAZ, Hash, Star, TrendingUp, MoreHorizontal, Settings2, Globe2, LogOut, Plus, Search, Trophy, ShoppingBag, History, ListChecks, SlidersHorizontal, BookOpen, Users, Pencil, RefreshCw, Award, Check, X, LoaderCircle, CircleCheck, CircleAlert, Undo2, Upload, Sparkles, School, UserPlus } from 'lucide-react'
import { Button, Select, Input, Checkbox, Tooltip, TooltipProvider, cn } from '@/components/ui'
import { translator, petById, growth } from '@/lib/i18n'
import type { Locale, Student } from '@/lib/types'
import { api, useGarden } from './use-garden'
import { AuthScreen } from './auth-screen'
import { GrowthBar, PetStateLabel, EvaluationDialog, PetPicker } from './pet-dialogs'
import { ClassDialog, StudentDialog, RulesDialog, SettingsDialog } from './manage-dialogs'
import { HistoryDialog, RankingDialog, ShopDialog } from './activity-dialogs'
import { LevelUpCelebration } from './level-up-celebration'
import { PetScene } from './pet-scene'
import { PetDressingDialog } from './pet-dressing-dialog'
import type { ShopTab } from './shop-dialog'
import { BadgeDialog } from './badge-dialog'
import { TeacherProfileScreen } from './teacher-profile'
import { ClassTeachersDialog, JoinClassDialog } from './class-teachers-dialog'

type Modal = 'newClass' | 'manageClass' | 'student' | 'import' | 'rules' | 'settings' | 'history' | 'ranking' | 'shop' | 'catalog' | 'teachers' | 'join' | null

export function Workspace({ locale }: { locale: Locale }) {
  const t = translator(locale), client = useGarden(locale)
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  const [modal, setModal] = useState<Modal>(null)
  const [editing, setEditing] = useState<Student | undefined>()
  const [adopting, setAdopting] = useState<{ student: Student; replacing: boolean } | null>(null)
  const [evaluating, setEvaluating] = useState<string[]>([])
  const [badgeStudentId, setBadgeStudentId] = useState<string | null>(null), [badgesOpen, setBadgesOpen] = useState(false)
  const badgeButtons = useRef(new Map<string, HTMLButtonElement>())
  const [dressingStudentId, setDressingStudentId] = useState<string | null>(null), [dressingOpen, setDressingOpen] = useState(false)
  const [dressingBackgroundId, setDressingBackgroundId] = useState<string | null | undefined>()
  const [shopContext, setShopContext] = useState<{ studentId?: string; tab: ShopTab } | null>(null), [shopOpen, setShopOpen] = useState(false)
  const backgroundTrigger = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!dressingStudentId && modal !== 'shop') return
    // 先卸载旧弹窗，避免把焦点入口记录为已消失的元素。
    const timer = setTimeout(() => {
      if (backgroundTrigger.current?.isConnected) backgroundTrigger.current.focus()
      if (dressingStudentId) setDressingOpen(true)
      else setShopOpen(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [dressingStudentId, modal])
  useEffect(() => {
    if (!badgeStudentId) return
    const timer = setTimeout(() => { badgeButtons.current.get(badgeStudentId)?.focus(); setBadgesOpen(true) }, 0)
    return () => clearTimeout(timer)
  }, [badgeStudentId])
  const [query, setQuery] = useState(''), [sort, setSort] = useState('name')
  const [batch, setBatch] = useState(false), [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => {
    const dismiss = () => document.querySelectorAll<HTMLElement>('[data-pet-actions]:popover-open').forEach(menu => menu.hidePopover())
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true) }
  }, [])
  const classroom = client.state?.classes.find(item => item.id === client.classId)
  const [interactionScope, setInteractionScope] = useState(client.scope)
  useEffect(() => {
    setInteractionScope(client.scope)
    setModal(value => value === 'settings' ? value : null); setEditing(undefined); setAdopting(null); setEvaluating([])
    setBadgeStudentId(null); setBadgesOpen(false); setBatch(false); setSelected(new Set()); setQuery('')
    setDressingStudentId(null); setDressingOpen(false); setDressingBackgroundId(undefined); setShopContext(null); setShopOpen(false); backgroundTrigger.current = null
    badgeButtons.current.clear()
  }, [client.scope, client.ready])
  const students = useMemo(() => {
    const list = [...(client.state?.students || [])].filter(student => `${student.name} ${student.student_no}`.toLowerCase().includes(query.toLowerCase()))
    return list.sort((a, b) => sort === 'points' ? b.points - a.points : sort === 'growth' ? b.pet_exp - a.pet_exp : sort === 'number' ? a.student_no.localeCompare(b.student_no, locale, { numeric: true }) : a.name.localeCompare(b.name, locale))
  }, [client.state?.students, query, sort, locale])
  function close() { setModal(null); setEditing(undefined); setShopContext(null); setShopOpen(false) }
  function showShop(studentId?: string, tab: ShopTab = 'shop', trigger?: HTMLElement) {
    if (trigger) backgroundTrigger.current = trigger
    client.setNotice(null); setDressingOpen(false); setDressingStudentId(null); setDressingBackgroundId(undefined); setShopOpen(false)
    setShopContext({ studentId, tab }); setModal('shop')
  }
  function showDressing(studentId: string, trigger?: HTMLElement, backgroundId?: string | null) {
    if (trigger) backgroundTrigger.current = trigger
    client.setNotice(null); setModal(null); setShopOpen(false); setShopContext(null)
    setDressingOpen(false); setDressingBackgroundId(backgroundId); setDressingStudentId(studentId)
  }
  function showBadges(student: Student) { client.setNotice(null); setEvaluating([]); setBadgesOpen(false); setBadgeStudentId(student.id) }
  const badgeStudent = client.state?.students.find(student => student.id === badgeStudentId)
  const badgesEarned = client.upgrades.reduce((total, event) => total + event.badgesEarned, 0)
  function toggle(id: string) { setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  const visibleSelected = [...selected].filter(id => client.state?.students.some(student => student.id === id))
  const date = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())
  const notice = client.notice && <div className="fixed bottom-5 left-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-start gap-3 rounded-2xl border border-line bg-white px-5 py-4 shadow-lg" role={client.notice.error ? 'alert' : 'status'}>{client.notice.error ? <CircleAlert className="mt-0.5 shrink-0 text-danger" size={19} /> : <CircleCheck className="mt-0.5 shrink-0 text-success" size={19} />}<span className="flex-1 text-sm leading-relaxed">{client.notice.text}</span><Button variant="ghost" className="size-6 min-h-6 shrink-0 p-0" aria-label={t('关闭提示', 'Dismiss notification')} onClick={() => client.setNotice(null)}><X size={15} /></Button></div>
  if (!client.ready) return <main className="flex min-h-screen items-center justify-center gap-3 text-muted"><LoaderCircle size={22} className="animate-spin text-primary" />{t('正在打开萌芽…', 'Opening PetBloom…')}</main>
  if (!client.state && client.refreshFailed) return <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"><CircleAlert size={30} className="text-danger" /><h1 className="text-xl font-bold">{t('暂时无法打开萌芽', 'PetBloom could not be opened')}</h1><p className="max-w-md text-sm leading-relaxed text-muted">{t('请检查网络后重试。未加载任何无权限的班级数据。', 'Check your connection and try again. No inaccessible class data is loaded.')}</p><Button busy={client.busy} onClick={() => client.run(async () => {})}><RefreshCw size={17} />{t('重新加载', 'Try again')}</Button>{notice}</main>
  if (!client.state) return <><AuthScreen locale={locale} client={client} />{notice}</>
  if (!client.state.user.profile_complete) return <><TeacherProfileScreen client={client} locale={locale} />{notice}</>
  const steps = client.state.settings.value.growth
  return <TooltipProvider delayDuration={300}><div className="min-h-screen pb-24">
    <header className="sticky top-0 z-30 border-b border-line bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 lg:px-9">
        <div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-white"><PawPrint size={23} /></span><div className="shrink-0"><span className="hidden text-base font-bold leading-tight sm:block">{t('萌芽', 'PetBloom')}</span><span className="block text-base font-bold sm:hidden">{t('萌芽', 'PetBloom')}</span><span className="mt-1 hidden text-[11px] text-muted sm:block">{t('让每一份成长，都悄悄发芽。', 'Let every bit of growth quietly bloom.')}</span></div><span className="mx-2 hidden h-7 w-px bg-line sm:block" /><Select aria-label={t('切换班级', 'Switch class')} value={client.classId} disabled={client.busy || !client.state.classes.length} placeholder={t('还没有班级', 'No classes yet')} icon={School} className="ml-2 hidden w-52 border-transparent bg-[#f5f3fa] font-medium sm:flex" onValueChange={value => { setSelected(new Set()); setBatch(false); client.selectClass(value) }} options={client.state.classes.map(item => ({ value: item.id, label: item.name }))} /><Button variant="ghost" aria-label={t('新建班级', 'New class')} className="hidden size-9 p-0 sm:inline-flex" onClick={() => setModal('newClass')}><Plus size={19} /></Button><Button variant="ghost" disabled={client.busy} className="hidden px-3 sm:inline-flex" onClick={() => setModal('join')}><UserPlus size={17} />{t('加入班级', 'Join class')}</Button></div>
        <div className="flex items-center gap-1"><AdminLink key={client.state.user.id} locale={locale} /><Button variant="ghost" className="size-9 p-0 xl:w-auto xl:px-4" onClick={() => setModal('settings')} aria-label={t('设置与数据', 'Settings & data')}><Settings2 size={17} /><span className="hidden xl:inline">{t('设置与数据', 'Settings & data')}</span></Button><Link href={locale === 'zh' ? '/en' : '/zh'} className="button button-ghost min-h-9 gap-1 px-2 sm:gap-2 sm:px-3" aria-label={t('切换为英文', 'Switch to Chinese')}><Globe2 size={17} className="hidden sm:block" /><span>{locale === 'zh' ? 'EN' : '中文'}</span></Link><span className="mx-1 hidden h-6 w-px bg-line sm:block" /><span className="hidden max-w-32 truncate px-2 text-sm text-muted md:block">{client.state.user.display_name}</span><Button variant="ghost" className="size-9 p-0" disabled={client.busy} aria-label={t('退出登录', 'Sign out')} onClick={async () => { if (await client.run(() => api('auth/logout', 'POST', {}))) { close(); setSelected(new Set()); setBatch(false) } }}><LogOut size={17} /></Button></div>
      </div>
      <div className="flex gap-2 px-5 pb-3 sm:hidden"><Select className="min-w-0 flex-1" aria-label={t('切换班级', 'Switch class')} disabled={client.busy || !client.state.classes.length} value={client.classId} placeholder={t('还没有班级', 'No classes yet')} icon={School} onValueChange={value => { setSelected(new Set()); setBatch(false); client.selectClass(value) }} options={client.state.classes.map(item => ({ value: item.id, label: item.name }))} /><Button aria-label={t('新建班级', 'New class')} onClick={() => setModal('newClass')} className="shrink-0 px-3"><Plus size={18} /></Button><Button disabled={client.busy} onClick={() => setModal('join')} className="shrink-0 px-3"><UserPlus size={16} /><span>{t('加入', 'Join')}</span></Button></div>
    </header>
    <main className="mx-auto max-w-[1600px] px-5 pt-7 lg:px-9 lg:pt-9">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><h1 className="min-w-0 break-words text-2xl font-bold tracking-tight lg:text-[28px]">{classroom?.name || t('欢迎来到萌芽', 'Welcome to PetBloom')}</h1>{classroom && <span className="inline-flex rounded-full bg-[#eee8ff] px-2.5 py-1 text-xs font-medium text-primary">{classroom.role === 'owner' ? t('负责人', 'Owner') : t('共同管理员', 'Co-admin')}</span>}{classroom && <Button variant="ghost" className="size-8 min-h-8 p-0" aria-label={t('管理班级', 'Manage class')} onClick={() => setModal('manageClass')}><Pencil size={15} /></Button>}</div><p className="hidden text-sm leading-relaxed text-muted sm:block">{classroom ? t('每一个小小的进步，都值得被看见。', 'Every little step forward deserves to be seen.') : t('创建班级，或输入其他教师的邀请码加入。', 'Create a class, or join with another teacher’s invitation code.')}</p></div><div className="hidden items-center gap-4 pt-1 text-sm text-muted sm:flex"><span className="hidden lg:block">{date}</span><span className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5"><Users size={15} />{client.state.students.length} {t('名学生', 'students')}</span></div></div>
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3"><div className="flex w-full flex-wrap items-center gap-2 lg:w-auto"><div className="relative min-w-40 flex-1 lg:w-64"><Search size={17} className="absolute left-3 top-3 text-muted" /><Input value={query} onChange={event => setQuery(event.target.value)} aria-label={t('搜索学生', 'Search students')} placeholder={t('搜索学生姓名或学号…', 'Search name or student number…')} className="bg-white pl-10" /></div><Select aria-label={t('学生排序', 'Sort students')} value={sort} onValueChange={setSort} className="w-40 sm:w-48" options={[
        { value: 'name', label: t('姓名排序', 'Name'), icon: ArrowDownAZ },
        { value: 'number', label: t('学号排序', 'Student number'), icon: Hash },
        { value: 'points', label: t('积分排序', 'Total points'), icon: Star },
        { value: 'growth', label: t('成长排序', 'Pet growth'), icon: TrendingUp }
      ]} /></div>
        <nav aria-label={t('班级工具', 'Class tools')} className="hidden w-full flex-wrap items-center gap-2 sm:flex lg:w-auto">{[
          { key: 'ranking', icon: Trophy, label: t('荣誉榜', 'Honor roll') },
          { key: 'shop', icon: ShoppingBag, label: t('小商店', 'Reward shop') },
          { key: 'history', icon: History, label: t('评价记录', 'History') },
          { key: 'rules', icon: SlidersHorizontal, label: t('规则', 'Rules') },
          { key: 'catalog', icon: BookOpen, label: t('图鉴', 'Collection') },
          { key: 'teachers', icon: UserPlus, label: t('邀请教师', 'Invite teachers') }
        ].map(({ key, icon: Icon, label }) => <Button key={key} className="px-3" disabled={client.busy || (!classroom && key !== 'catalog')} onClick={event => key === 'shop' ? showShop(undefined, 'shop', event.currentTarget) : setModal(key as Modal)}><Icon size={16} /><span>{label}</span></Button>)}<Button variant={batch ? 'primary' : 'secondary'} disabled={!client.state.students.length} onClick={() => { setBatch(!batch); setSelected(new Set()) }}><ListChecks size={16} />{t('批量评价', 'Batch')}</Button></nav>
        <div className="flex w-full justify-end gap-2 sm:hidden"><Button variant={batch ? 'primary' : 'secondary'} disabled={!client.state.students.length} onClick={() => { setBatch(!batch); setSelected(new Set()) }}><ListChecks size={16} />{t('批量评价', 'Batch')}</Button><details className="relative" onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.open = false }}><summary className="button button-secondary list-none"><MoreHorizontal size={18} />{t('班级工具', 'Class tools')}</summary><div className="absolute right-0 top-full z-40 mt-2 grid w-52 gap-1 rounded-2xl border border-line bg-white p-2 shadow-lg">{[
          { key: 'ranking', label: t('荣誉榜', 'Honor roll'), icon: Trophy },
          { key: 'shop', label: t('小商店', 'Reward shop'), icon: ShoppingBag },
          { key: 'history', label: t('评价记录', 'History'), icon: History },
          { key: 'rules', label: t('规则', 'Rules'), icon: SlidersHorizontal },
          { key: 'catalog', label: t('图鉴', 'Collection'), icon: BookOpen },
          { key: 'teachers', label: t('邀请教师', 'Invite teachers'), icon: UserPlus }
        ].map(({ key, label, icon: Icon }) => <Button key={key} variant="ghost" className="justify-start" disabled={client.busy || (!classroom && key !== 'catalog')} onClick={event => { const details = event.currentTarget.closest('details'); const trigger = details?.querySelector('summary'); details?.removeAttribute('open'); if (key === 'shop') showShop(undefined, 'shop', trigger || event.currentTarget); else setModal(key as Modal) }}><Icon size={16} />{label}</Button>)}</div></details></div>
      </div>
      {interactionScope === client.scope && !!client.upgrades.length && <div role="status" className="mb-5 flex items-start gap-3 rounded-2xl border border-[#d9cdfa] bg-[#f0eaff] px-5 py-4"><Sparkles size={21} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="font-semibold">{t('新的成长，值得庆祝！', 'A new level. A moment to celebrate!')}</p><p className="mt-1 text-sm leading-relaxed">{client.upgrades.slice(0, 3).map(item => `${item.name} · ${item.pet} → Lv.${item.level}`).join(' / ')}{client.upgrades.length > 3 && t(`，还有 ${client.upgrades.length - 3} 位伙伴升级`, `, plus ${client.upgrades.length - 3} more companions`)}</p><p className="mt-1 text-sm leading-relaxed">{badgesEarned > 0 ? t(`本次新增 ${badgesEarned} 枚等级徽章。`, `${badgesEarned} new level ${badgesEarned === 1 ? 'badge' : 'badges'} earned.`) : t('本次未新增徽章，同一轮每个等级只奖励一次。', 'No new badges this time. Each level awards once per pet cycle.')}{client.upgrades.some(item => item.level === 8) && t(' 毕业的伙伴可以重新领养。', ' Graduated pets can begin a new adoption cycle.')}</p></div><Button variant="ghost" className="size-7 min-h-7 shrink-0 p-0" aria-label={t('关闭升级提示', 'Dismiss level-up message')} onClick={() => client.setUpgrades([])}><X size={16} /></Button></div>}
      {classroom && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4"><span className="flex items-center gap-2 text-sm font-semibold"><PawPrint size={17} className="text-primary" />{t('我们的成长伙伴', 'Our growing companions')}<span className="ml-1 hidden text-xs font-normal text-muted sm:inline">{t('点击卡片领养或评价', 'Select a card to adopt or encourage')}</span></span><div className="flex gap-2"><Button variant="ghost" className="min-h-9 px-3 py-1 text-xs" onClick={() => setModal('import')}><Upload size={14} />{t('导入名单', 'Import')}</Button><Button variant="primary" className="min-h-9 px-3 py-1 text-xs" onClick={() => { setEditing(undefined); setModal('student') }}><Plus size={15} />{t('添加学生', 'Add student')}</Button></div></div>}
      {!classroom ? <section className="empty min-h-[55dvh] rounded-3xl border border-dashed border-[#d8cfee] bg-white"><span className="mb-5 flex size-20 items-center justify-center rounded-3xl bg-[#eee8ff] text-primary"><School size={36} /></span><h2 className="mb-3 text-xl font-bold">{t('让一个班级的故事，从这里开始', 'Every class has a story. Start yours here.')}</h2><p className="mb-7 max-w-md text-sm leading-relaxed text-muted">{t('创建班级、添加学生，为每个人选择一只宠物。你带来的每一次鼓励，都会让它们慢慢长大。', 'Create a class, add your students, and choose their companions. Every bit of encouragement helps them grow.')}</p><div className="flex flex-wrap justify-center gap-3"><Button variant="primary" onClick={() => setModal('newClass')}><Plus size={17} />{t('创建第一个班级', 'Create your first class')}</Button><Button onClick={() => setModal('join')} disabled={client.busy}><UserPlus size={17} />{t('输入邀请码加入', 'Join with a code')}</Button><Button busy={client.busy} onClick={async () => { let id = ''; if (await client.run(async () => { id = (await api('demo', 'POST', { locale })).id || '' }, undefined, () => id)) close() }}><Sparkles size={17} />{t('体验演示班级', 'Try a demo class')}</Button></div></section> : !client.state.students.length ? <section className="empty min-h-[45dvh] rounded-3xl border border-dashed border-[#d8cfee] bg-white"><Users size={42} className="mb-4 text-primary" /><h2 className="mb-3 text-xl font-bold">{t('等待第一位小伙伴', 'Ready for your first student')}</h2><p className="mb-6 text-sm text-muted">{t('可以逐个添加，也可以一次导入全班名单。', 'Add students one at a time, or import your whole class.')}</p><Button variant="primary" onClick={() => setModal('student')}><Plus size={16} />{t('添加学生', 'Add a student')}</Button></section> : !students.length ? <section className="empty"><Search size={36} className="mb-4 text-muted" /><p className="text-muted">{t('没有找到匹配的学生。', 'No matching students.')}</p><Button variant="ghost" onClick={() => setQuery('')}><X size={16} />{t('清空搜索', 'Clear search')}</Button></section> : <div className="pet-grid">{students.map(student => {
        const pet = petById(student.pet_id), p = growth(student.pet_exp, steps)
        const effect = client.scoreEffects.find(item => item.id === student.id)
        const actionsId = `pet-actions-${student.id}`, actionsTriggerId = `${actionsId}-trigger`
        return <article key={student.id} className={cn('pet-card group relative overflow-hidden rounded-2xl border bg-white shadow-card', selected.has(student.id) && batch ? 'border-primary ring-2 ring-[#dfd6ff]' : 'border-line')}>
          <button className="block w-full text-left" aria-label={`${student.name} · ${student.pet_id ? t('评价', 'Evaluate') : t('领养宠物', 'Adopt a pet')}`} disabled={client.busy} onClick={() => { if (batch) toggle(student.id); else if (!student.pet_id) setAdopting({ student, replacing: false }); else setEvaluating([student.id]) }}>
            <div className="relative aspect-[1.12]"><PetScene student={student} locale={locale} steps={steps} effect={effect} className="h-full w-full" /><span className="absolute bottom-3 right-3 inline-flex h-7 items-center rounded-full border border-[#e5ddf5] bg-white px-2.5 text-[11px] font-bold leading-none text-[#655183]">Lv.{p.level}</span></div>
            <div className="p-4"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="truncate text-base font-bold">{student.name}</h3><span className="tabular whitespace-nowrap text-base font-bold text-primary">{student.points}<span className="ml-1 text-[10px] font-medium text-muted">{t('分', 'pts')}</span></span></div><p className={cn('mb-2 truncate text-xs text-muted', !batch && 'pr-14')}>{pet?.name[locale] || t('等待领养', 'Waiting to adopt')}{student.student_no ? ` · ${student.student_no}` : ''}</p><div className="mb-3"><PetStateLabel student={student} locale={locale} /></div><GrowthBar exp={student.pet_exp} locale={locale} steps={steps} /></div>
          </button>
          <div className="pointer-events-none absolute inset-x-0 top-0 aspect-[1.12]">
            <Button ref={element => { if (element) badgeButtons.current.set(student.id, element); else badgeButtons.current.delete(student.id) }} className="group/badge pointer-events-auto absolute bottom-1 left-1 min-h-11 min-w-11 rounded-full border-0 bg-transparent p-2 hover:bg-transparent" disabled={client.busy} aria-haspopup="dialog" aria-label={t(`查看 ${student.name} 的徽章收藏，累计 ${student.badge_count} 枚`, `View ${student.name}’s badge collection, ${student.badge_count} earned`)} title={t('查看徽章收藏', 'View badge collection')} onClick={() => showBadges(student)}><span className="inline-flex h-7 items-center gap-1 rounded-full border border-[#ead89d] bg-[#fff0c4] px-2.5 text-[11px] font-bold leading-none text-[#795c1c] transition-colors group-hover/badge:border-[#c4a75c] group-hover/badge:bg-[#ffe6a4]"><Award size={13} aria-hidden="true" /><span className="tabular">{student.badge_count}</span></span></Button>
            {!batch && <Fragment>
              <div className="pointer-events-auto absolute right-2 top-full mt-12 flex opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 [@media(hover:none)]:opacity-100">
                <Tooltip content={t('宠物装扮', 'Dress companion')}><Button variant="ghost" className="size-8 min-h-8 rounded-lg p-0 focus-visible:outline-offset-[-2px] text-primary" disabled={client.busy} aria-haspopup="dialog" aria-label={t(`装扮 ${student.name} 的宠物`, `Dress ${student.name}’s companion`)} onClick={event => showDressing(student.id, event.currentTarget)}><Palette size={16} aria-hidden="true" /></Button></Tooltip>
                <Tooltip content={t('更多操作', 'More actions')}><Button id={actionsTriggerId} variant="ghost" className="size-8 min-h-8 rounded-lg p-0 focus-visible:outline-offset-[-2px]" disabled={client.busy} popoverTarget={actionsId} aria-label={t(`${student.name} 的更多操作`, `More actions for ${student.name}`)} onClick={event => {
                  const trigger = event.currentTarget, menu = document.getElementById(actionsId)!, bounds = trigger.getBoundingClientRect()
                  const height = (pet && client.state!.settings.value.allowChangePet ? 2 : 1) * 44 + 10
                  menu.style.left = `${Math.max(8, Math.min(bounds.right - 176, window.innerWidth - 184))}px`
                  menu.style.top = `${bounds.bottom + height + 4 <= window.innerHeight ? bounds.bottom + 4 : Math.max(8, bounds.top - height - 4)}px`
                }}><MoreHorizontal size={16} aria-hidden="true" /></Button></Tooltip>
              </div>
              <div id={actionsId} popover="auto" data-pet-actions role="group" aria-label={t(`${student.name} 的操作`, `Actions for ${student.name}`)} className="pointer-events-auto fixed inset-auto m-0 w-44 rounded-xl border border-line bg-white p-1 text-ink shadow-lg" onClickCapture={event => { event.currentTarget.hidePopover(); document.getElementById(actionsTriggerId)?.focus() }}>
                {pet && client.state!.settings.value.allowChangePet && <Button variant="ghost" className="min-h-11 w-full justify-start rounded-lg px-3 text-xs" disabled={client.busy} onClick={() => setAdopting({ student, replacing: true })}><RefreshCw size={15} aria-hidden="true" />{t('更换宠物', 'Change companion')}</Button>}
                <Button variant="ghost" className="min-h-11 w-full justify-start rounded-lg px-3 text-xs" disabled={client.busy} onClick={() => { setEditing(student); setModal('student') }}><Pencil size={15} aria-hidden="true" />{t('编辑学生', 'Edit student')}</Button>
              </div>
            </Fragment>}
          </div>
          {batch && <div className="absolute left-3 top-3 flex size-7 items-center justify-center rounded-lg bg-white"><Checkbox aria-label={`${t('选择', 'Select')} ${student.name}`} checked={selected.has(student.id)} onCheckedChange={() => toggle(student.id)} /></div>}
        </article>
      })}</div>}
      {classroom && <p className="mt-8 flex items-center justify-center gap-2 text-center text-xs leading-relaxed text-muted"><Check size={13} />{process.env.NEXT_PUBLIC_DESKTOP === 'true' ? t('每一次评价实时保存到这台电脑，请定期导出备份。', 'Every evaluation is saved on this computer. Export backups regularly.') : t('每一次评价实时保存到服务器，班级负责人可定期导出备份。', 'Every evaluation is saved to the server. Class owners can export regular backups.')}</p>}
      {interactionScope === client.scope && batch && <div className="sticky bottom-4 z-20 mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d8caff] bg-white px-5 py-4 shadow-lg"><span className="text-sm font-semibold">{t(`已选 ${visibleSelected.length} 名学生`, `${visibleSelected.length} students selected`)}</span><div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setSelected(new Set(students.map(student => student.id)))}><Check size={16} />{t('选择当前全部', 'Select visible')}</Button><Button variant="primary" disabled={!visibleSelected.length || client.busy} onClick={() => setEvaluating(visibleSelected)}><Star size={16} />{t('开始评价', 'Evaluate')}</Button><Button variant="ghost" aria-label={t('退出批量模式', 'Exit batch mode')} onClick={() => { setBatch(false); setSelected(new Set()) }}><X size={17} /></Button></div></div>}
    </main>
    {interactionScope === client.scope && <Fragment key={client.scope}>
    {modal === 'join' && <JoinClassDialog client={client} locale={locale} onClose={close} />}
    {modal === 'teachers' && classroom && <ClassTeachersDialog client={client} locale={locale} classroom={classroom} onClose={close} />}
    {modal === 'newClass' && <ClassDialog client={client} locale={locale} onClose={close} />}
    {modal === 'manageClass' && classroom && <ClassDialog client={client} locale={locale} classroom={classroom} onClose={close} />}
    {(modal === 'student' || modal === 'import') && <StudentDialog client={client} locale={locale} student={editing} importing={modal === 'import'} onClose={close} />}
    {modal === 'rules' && <RulesDialog client={client} locale={locale} onClose={close} />}
    {modal === 'history' && <HistoryDialog client={client} locale={locale} onClose={close} />}
    {modal === 'ranking' && <RankingDialog client={client} locale={locale} onClose={close} />}
    {modal === 'shop' && <ShopDialog client={client} locale={locale} open={shopOpen} initialStudentId={shopContext?.studentId} initialTab={shopContext?.tab} onClose={close} onDress={(studentId, backgroundId) => showDressing(studentId, undefined, backgroundId)} />}
    {dressingStudentId && <PetDressingDialog key={dressingStudentId} open={dressingOpen} client={client} locale={locale} studentId={dressingStudentId} initialBackgroundId={dressingBackgroundId} onClose={() => { setDressingOpen(false); setDressingStudentId(null); setDressingBackgroundId(undefined) }} onShop={studentId => showShop(studentId, 'backgrounds')} />}
    {(modal === 'catalog' || adopting) && <PetPicker client={client} locale={locale} student={adopting?.student || null} replacing={adopting?.replacing} onClose={() => { setAdopting(null); close() }} />}
    {!!evaluating.length && <EvaluationDialog client={client} locale={locale} studentIds={evaluating} onClose={() => setEvaluating([])} onAdopt={student => { setEvaluating([]); setAdopting({ student, replacing: false }) }} onBadges={showBadges} />}
    {badgeStudent && <BadgeDialog open={badgesOpen} student={badgeStudent} badges={client.state.badges} locale={locale} onClose={() => { setBadgesOpen(false); setBadgeStudentId(null) }} />}
    {!!client.celebrations.length && <LevelUpCelebration events={client.celebrations} locale={locale} onClose={() => client.setCelebrations([])} />}
    </Fragment>}
    {/* Account settings must keep the import receipt when the first class is loaded. */}
    {modal === 'settings' && <SettingsDialog key={client.state.user.id} client={client} locale={locale} onClose={close} />}
    {notice}
  </div></TooltipProvider>
}
