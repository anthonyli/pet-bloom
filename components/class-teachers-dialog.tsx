'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Check, Copy, KeyRound, LogOut, Pencil, RefreshCw, ShieldCheck, Trash2, UserPlus, Users, X } from 'lucide-react'
import { Button, Dialog, Field, Input } from '@/components/ui'
import { errorMessage, translator } from '@/lib/i18n'
import type { Classroom, ClassTeacher, ClassTeachers, InvitationPreview, Locale } from '@/lib/types'
import { api, ApiError, type GardenClient } from './use-garden'
import { TeacherProfileForm, teachingRoleName } from './teacher-profile'

const normalizeCode = (value: string) => value.replace(/[\s-]/g, '').toLowerCase()
const displayCode = (value: string) => normalizeCode(value).toUpperCase().match(/.{1,4}/g)?.join(' ') || value

export function JoinClassDialog({ client, locale, onClose }: { client: GardenClient; locale: Locale; onClose: () => void }) {
  const t = translator(locale), id = useId(), input = useRef<HTMLInputElement>(null), confirmButton = useRef<HTMLButtonElement>(null)
  const [code, setCode] = useState(''), [error, setError] = useState('')
  const [preview, setPreview] = useState<{ value: InvitationPreview; code: string } | null>(null)
  useEffect(() => { if (preview && !client.busy) confirmButton.current?.focus() }, [preview, client.busy])
  async function previewClass() {
    setError('')
    const submitted = normalizeCode(code)
    if (!/^[a-f0-9]{24}$/.test(submitted)) { setError(t('请输入完整的 6 组、每组 4 位邀请码（共 24 位数字或 A–F）。', 'Enter all six groups of four characters (24 digits or A–F in total).')); input.current?.focus(); return }
    await client.run(async () => {
      try { const value = await api<InvitationPreview>('invitations/preview', 'POST', { code: submitted }); setPreview({ value, code: submitted }) }
      catch (error) { setError(errorMessage(error instanceof ApiError ? error.code : 'serverError', locale)); throw error }
    })
  }
  async function joinClass() {
    if (!preview || normalizeCode(code) !== preview.code) return
    setError('')
    let joinedId = ''
    const ok = await client.run(async () => {
      try { joinedId = (await api<{ id: string }>('invitations/join', 'POST', { code: preview.code })).id }
      catch (error) { setError(errorMessage(error instanceof ApiError ? error.code : 'serverError', locale)); setPreview(null); input.current?.focus(); throw error }
    }, t('已进入班级。', 'Class opened.'), () => joinedId)
    if (ok) onClose()
  }
  return <Dialog open onClose={() => { if (!client.busy) onClose() }} icon={UserPlus} title={t('使用邀请码加入班级', 'Join a class with a code')} description={t('向班级教师索取邀请码。先确认班级，再以共同管理员身份加入。', 'Ask a class teacher for an invitation code. Review the class before joining as a co-admin.')} className="flex max-h-[90dvh] flex-col overflow-hidden">
    <form className="flex min-h-0 flex-1 flex-col gap-5" onSubmit={event => { event.preventDefault(); if (preview) void joinClass(); else void previewClass() }} aria-busy={client.busy}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-1 pb-2">
      <Field id={`${id}-code`} label={t('班级邀请码', 'Class invitation code')}><Input ref={input} id={`${id}-code`} autoFocus autoComplete="off" spellCheck={false} autoCapitalize="characters" maxLength={60} required disabled={client.busy} value={code} onChange={event => { setCode(event.target.value); setPreview(null); setError('') }} className="font-mono uppercase" placeholder="A1B2 C3D4 E5F6 A7B8 C9D0 E1F2" aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} /><p id={`${id}-hint`} className="mt-2 text-xs leading-relaxed text-muted">{t('邀请码为 6 组 4 位字符，空格或短横线均可。有效期 7 天，更新或停用后旧码立即失效。', 'Six groups of four characters; spaces or hyphens are accepted. Codes last seven days and stop working when replaced or disabled.')}</p></Field>
      {preview && <section className="rounded-2xl border border-[#ded4f6] bg-[#f8f5ff] p-5" aria-label={t('确认加入的班级', 'Review the class')}><h3 className="break-words text-lg font-bold">{preview.value.name}</h3><p className="mt-2 break-words text-sm text-muted">{t('班级负责人：', 'Class owner: ')}{preview.value.owner_name}</p><p className="mt-3 text-sm leading-relaxed">{preview.value.already_member ? t('你已在此班级中，确认后将切换到该班级，不会重复加入。', 'You already belong to this class. Confirm to switch to it; you will not be added twice.') : t('加入后可以管理学生、评分、兑换、规则和成长设置，也可以邀请其他教师。删除班级、移除成员及转让由负责人操作。', 'As a co-admin, you can manage students, evaluations, rewards, rules and growth settings, and invite teachers. Only the owner can delete the class, remove teachers or transfer ownership.')}</p></section>}
      {error && <p id={`${id}-error`} role="alert" className="text-sm leading-relaxed text-danger">{error}</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-line pt-4"><Button type="button" disabled={client.busy} onClick={onClose}>{t('取消', 'Cancel')}</Button><Button ref={confirmButton} type="submit" variant="primary" busy={client.busy} disabled={!code.trim()}>{preview ? <Check size={17} /> : <ArrowRight size={17} />}{preview ? preview.value.already_member ? t('进入这个班级', 'Open this class') : t('确认加入班级', 'Confirm and join') : t('查看并确认班级', 'Review class')}</Button></footer>
    </form>
  </Dialog>
}

type MemberConfirmation = { kind: 'remove' | 'transfer'; teacher: ClassTeacher } | { kind: 'leave' } | { kind: 'disable' } | null
export function ClassTeachersDialog({ client, locale, classroom, onClose }: { client: GardenClient; locale: Locale; classroom: Classroom; onClose: () => void }) {
  const t = translator(locale), id = useId(), codeInput = useRef<HTMLInputElement>(null), confirmationButton = useRef<HTMLButtonElement>(null)
  const [data, setData] = useState<ClassTeachers | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [rawCode, setRawCode] = useState(''), [copyMessage, setCopyMessage] = useState('')
  const [confirmation, setConfirmation] = useState<MemberConfirmation>(null), [editingProfile, setEditingProfile] = useState(false)
  const mounted = useRef(true), reloadNumber = useRef(0)
  const confirmationReturnFocus = useRef<HTMLElement | null>(null), reloadButton = useRef<HTMLButtonElement>(null), profileButton = useRef<HTMLButtonElement>(null)
  const owner = classroom.role === 'owner', user = client.state!.user
  const date = (value: number) => new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
  async function reload() {
    const number = ++reloadNumber.current
    const result = await api<ClassTeachers>(`classes/${classroom.id}/teachers`)
    if (mounted.current && number === reloadNumber.current) setData(result)
  }
  useEffect(() => {
    mounted.current = true
    reload().catch(error => { if (mounted.current) { setError(errorMessage(error instanceof ApiError ? error.code : 'serverError', locale)); client.report(error); if (error instanceof ApiError && [403, 404].includes(error.status)) void client.refresh().catch(client.report) } }).finally(() => { if (mounted.current) setLoading(false) })
    return () => { mounted.current = false; reloadNumber.current++ }
  }, [classroom.id])
  useEffect(() => { if (confirmation) confirmationButton.current?.focus() }, [confirmation])
  function ask(value: MemberConfirmation, trigger: HTMLElement) { confirmationReturnFocus.current = trigger; setConfirmation(value); setError('') }
  function cancelConfirmation() {
    setConfirmation(null)
    requestAnimationFrame(() => { if (confirmationReturnFocus.current?.isConnected) confirmationReturnFocus.current.focus(); else reloadButton.current?.focus() })
  }
  function closeProfile() { setEditingProfile(false); requestAnimationFrame(() => profileButton.current?.focus()) }
  async function execute(action: () => Promise<unknown>, message?: string, selected?: string) {
    setError(''); setCopyMessage('')
    return client.run(async () => {
      try { await action() }
      catch (error) { if (mounted.current) setError(errorMessage(error instanceof ApiError ? error.code : 'serverError', locale)); throw error }
    }, message, selected)
  }
  async function generate() {
    setRawCode('')
    await execute(async () => {
      const result = await api<{ code: string; expires_at: number }>(`classes/${classroom.id}/invitations`, 'POST', {})
      if (mounted.current) { setRawCode(result.code); setConfirmation(null); setData(previous => ({ teachers: previous?.teachers || [], invitation: { created_at: Date.now(), expires_at: result.expires_at } })) }
    })
  }
  async function confirmAction() {
    if (!confirmation) return
    const target = confirmation
    const ok = await execute(async () => {
      if (target.kind === 'leave') await api(`classes/${classroom.id}/leave`, 'POST', {})
      else if (target.kind === 'remove') await api(`classes/${classroom.id}/members/${target.teacher.user_id}`, 'DELETE')
      else if (target.kind === 'transfer') await api(`classes/${classroom.id}/transfer`, 'POST', { userId: target.teacher.user_id })
      else await api(`classes/${classroom.id}/invitations`, 'DELETE')
      if (mounted.current) { setRawCode(''); setData(previous => previous ? { ...previous, invitation: null } : null) }
      if (target.kind !== 'leave') await reload()
    }, target.kind === 'leave' ? t('已退出班级，历史记录保留。', 'You left the class. Historical records are kept.') : target.kind === 'transfer' ? t('负责人已转让，你仍是共同管理员。旧邀请码已失效。', 'Ownership transferred. You remain a co-admin. The old invitation code is invalid.') : target.kind === 'remove' ? t('教师已移除，旧邀请码已失效。', 'Teacher removed. The old invitation code is invalid.') : t('邀请码已停用。', 'Invitation code disabled.'), target.kind === 'leave' ? '' : undefined)
    if (ok && mounted.current) { if (target.kind === 'leave' || target.kind === 'transfer') onClose(); else cancelConfirmation() }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(displayCode(rawCode)); setCopyMessage(t('邀请码已复制。', 'Invitation code copied.')) }
    catch { codeInput.current?.focus(); codeInput.current?.select(); setCopyMessage(t('未能自动复制。邀请码已选中，请手动复制。', 'Automatic copy failed. The code is selected; copy it manually.')) }
  }
  const activeInvitation = data?.invitation && data.invitation.expires_at > Date.now() ? data.invitation : null
  const confirmationText = !confirmation ? '' : confirmation.kind === 'leave' ? t('确认退出这个班级？退出后将无法访问班级数据，但你此前的评价、兑换和署名会保留。之后需使用新的有效邀请再次加入。', 'Leave this class? You will lose access, but your evaluations, redemptions and historical name will remain. You will need a valid invitation to rejoin.') : confirmation.kind === 'disable' ? t('确认停用当前邀请码？尚未加入的教师将无法再使用它，已有成员不受影响。', 'Disable the current invitation code? It will stop accepting teachers. Existing members are unaffected.') : confirmation.kind === 'remove' ? t(`确认移除「${confirmation.teacher.display_name}」？对方将失去班级访问权限，历史署名保留。当前邀请码也会失效。`, `Remove ${confirmation.teacher.display_name}? They will lose class access; historical names are kept. The current invitation code will also stop working.`) : t(`将班级负责人转让给「${confirmation.teacher.display_name}」？你将保留共同管理员身份，但不能再删除班级、移除教师、转让或导出此班备份。当前邀请码会失效。`, `Transfer ownership to ${confirmation.teacher.display_name}? You will remain a co-admin, but lose permission to delete this class, remove teachers, transfer ownership or export its backup. The current invitation code will stop working.`)
  return <Dialog open wide onClose={() => { if (!client.busy) onClose() }} icon={Users} title={t('邀请教师 · 共同管理', 'Invite teachers · Manage together')} description={classroom.name} className="flex max-h-[90dvh] flex-col overflow-hidden">
    <div className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-1 pb-2" aria-busy={client.busy || loading}>
      {editingProfile ? <section><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t('编辑我的教师资料', 'Edit my teacher profile')}</h3><Button disabled={client.busy} variant="ghost" onClick={closeProfile}><X size={16} />{t('返回教师名单', 'Back to teachers')}</Button></div><TeacherProfileForm client={client} locale={locale} onSaved={() => { closeProfile(); void reload().catch(client.report) }} /></section> : <>
        <section><h3 className="mb-2 flex items-center gap-2 font-semibold"><KeyRound size={18} className="text-primary" />{t('班级邀请码', 'Class invitation code')}</h3><p className="mb-4 text-sm leading-relaxed text-muted">{t('7 天内可供多位教师加入为共同管理员。请只分享给可信任的教师；生成新码会立即停用旧码。', 'Valid for seven days and reusable by multiple teachers joining as co-admins. Share only with teachers you trust. Generating a new code invalidates the old one.')}</p>
          {loading ? <p role="status" className="py-3 text-sm text-muted">{t('正在读取邀请和教师名单…', 'Loading invitations and teachers…')}</p> : <>
            {rawCode && activeInvitation ? <div className="mb-4"><Field id={`${id}-invitation`} label={t('请复制或手动选取邀请码', 'Copy or select the invitation code')}><Input ref={codeInput} id={`${id}-invitation`} value={displayCode(rawCode)} readOnly autoComplete="off" spellCheck={false} className="font-mono text-sm tracking-wide sm:text-base" onFocus={event => event.target.select()} /></Field><Button className="mt-3" onClick={copy}><Copy size={16} />{t('复制邀请码', 'Copy invitation code')}</Button></div> : <p className="mb-4 text-sm leading-relaxed text-muted">{activeInvitation ? t('此班级已有有效邀请码。为保护安全，明文仅在生成时展示；如未保存，请生成新码并重新分享。', 'An invitation is already active. For security, its code is only shown when generated. If you no longer have it, generate and share a new one.') : t('目前没有有效邀请码。生成后即可分享给其他教师。', 'No active invitation. Generate a code to share with other teachers.')}</p>}
            {activeInvitation && <p className="mb-4 text-xs leading-relaxed text-muted">{t('有效至：', 'Expires: ')}<time dateTime={new Date(activeInvitation.expires_at).toISOString()}>{date(activeInvitation.expires_at)}</time></p>}
            <div className="flex flex-wrap gap-3"><Button variant="primary" busy={client.busy} onClick={generate}>{activeInvitation ? <RefreshCw size={16} /> : <UserPlus size={16} />}{activeInvitation ? t('生成新码（旧码失效）', 'Generate new code (replaces old)') : t('生成邀请码', 'Generate invitation code')}</Button>{activeInvitation && <Button disabled={client.busy} onClick={event => ask({ kind: 'disable' }, event.currentTarget)}>{t('停用邀请码', 'Disable invitation')}</Button>}</div>
            {copyMessage && <p role="status" className="mt-3 text-sm leading-relaxed text-primary">{copyMessage}</p>}
          </>}
        </section>
        <section className="border-t border-line pt-6"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t('一起管理的教师', 'Teachers managing this class')}</h3><Button ref={reloadButton} variant="ghost" disabled={client.busy || loading} onClick={() => execute(reload)}><RefreshCw size={15} />{t('刷新名单', 'Refresh teachers')}</Button></div><p className="mb-4 text-xs leading-relaxed text-muted">{t('负责人可撤回班内所有记录；共同管理员只能撤回自己提交的评价与兑换。修改称呼或退出不会改变历史署名。', 'Owners can undo all class records; co-admins can undo only their own evaluations and redemptions. Profile changes and departures never rewrite historical names.')}</p>
          {!loading && !data && <Button busy={client.busy} onClick={() => execute(async () => { await reload() })}><RefreshCw size={16} />{t('重新读取教师名单', 'Reload teachers')}</Button>}
          {!loading && data && !data.teachers.length && <p role="status" className="py-4 text-sm text-muted">{t('暂无可显示的教师，请刷新名单后重试。', 'No teachers to display. Refresh the list and try again.')}</p>}
          <ul className="divide-y divide-line">{data?.teachers.map(teacher => <li key={teacher.user_id} className="flex flex-col items-stretch justify-between gap-3 py-4 sm:flex-row sm:flex-wrap sm:items-center"><div className="min-w-0 flex-1 sm:basis-44"><div className="flex flex-wrap items-center gap-2"><span className="break-words font-semibold">{teacher.display_name}</span>{teacher.user_id === user.id && <span className="text-xs text-muted">{t('（我）', '(you)')}</span>}<span className="inline-flex items-center gap-1 rounded-full bg-[#f0ebff] px-2 py-1 text-xs text-primary">{teacher.role === 'owner' && <ShieldCheck size={12} />}{teacher.role === 'owner' ? t('负责人', 'Owner') : t('共同管理员', 'Co-admin')}</span></div><p className="mt-1.5 break-words text-sm leading-relaxed text-muted">{teacher.subject} · {teachingRoleName(teacher.teaching_role, locale)}</p></div><div className="flex flex-wrap gap-1">{teacher.user_id === user.id ? <Button ref={profileButton} variant="ghost" disabled={client.busy} onClick={() => { setEditingProfile(true); setConfirmation(null); setError('') }}><Pencil size={15} />{t('编辑我的资料', 'Edit my profile')}</Button> : owner && teacher.role !== 'owner' && <><Button variant="ghost" disabled={client.busy} onClick={event => ask({ kind: 'transfer', teacher }, event.currentTarget)}>{t('转让负责人', 'Transfer ownership')}</Button><Button variant="ghost" disabled={client.busy} onClick={event => ask({ kind: 'remove', teacher }, event.currentTarget)}><Trash2 size={15} />{t('移除', 'Remove')}</Button></>}</div></li>)}</ul>
        </section>
        <section className="border-t border-line pt-5">{owner ? <p className="text-xs leading-relaxed text-muted">{t('你是此班负责人。如需退出，请先将班级转让给已加入的教师。', 'You own this class. Transfer ownership to an existing teacher before leaving.')}</p> : <Button disabled={client.busy} onClick={event => ask({ kind: 'leave' }, event.currentTarget)}><LogOut size={16} />{t('退出这个班级', 'Leave this class')}</Button>}</section>
      </>}
    </div>
    {(confirmation || error) && <footer className="shrink-0 border-t border-line pt-4">{confirmation && <><p className="mb-3 max-h-32 overflow-y-auto break-words text-sm leading-relaxed">{confirmationText}</p><div className="flex flex-wrap gap-3"><Button ref={confirmationButton} variant="danger" busy={client.busy} onClick={confirmAction}>{confirmation.kind === 'transfer' ? t('确认转让负责人', 'Confirm ownership transfer') : confirmation.kind === 'remove' ? t('确认移除教师', 'Confirm teacher removal') : confirmation.kind === 'leave' ? t('确认退出班级', 'Confirm leave') : t('确认停用', 'Confirm disable')}</Button><Button disabled={client.busy} onClick={cancelConfirmation}>{t('取消', 'Cancel')}</Button></div></>}{error && <p role="alert" className="mt-3 text-sm leading-relaxed text-danger">{error}</p>}</footer>}
  </Dialog>
}
