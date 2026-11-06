'use client'
import { useRef, useState } from 'react'
import { Trash2, Plus, Download, Database, ShieldCheck, Settings2, School, UserRound, Upload, Save, Check, X, Sparkles, BookOpen, HandHeart, HeartPulse, Shapes, RefreshCw } from 'lucide-react'
import { Button, Checkbox, Dialog, Field, FileInput, Input, Select, Textarea } from '@/components/ui'
import { parseStudentList } from '@/lib/student-import'
import { MAX_BACKUP_MB, MAX_BACKUP_BYTES } from '@/lib/shop'
import { translator, categories, categoryName, localizedUserText, errorMessage } from '@/lib/i18n'
import type { Locale, Student, Classroom } from '@/lib/types'
import { api, ApiError, type GardenClient } from './use-garden'
import { GardenSettingsForm } from './garden-settings-form'
import { TeacherProfileForm, teachingRoleName } from './teacher-profile'

export function ClassDialog({ client, locale, classroom, onClose }: { client: GardenClient; locale: Locale; classroom?: Classroom; onClose: () => void }) {
  const t = translator(locale), [name, setName] = useState(classroom?.name || ''), [confirmDelete, setConfirmDelete] = useState(false)
  return <Dialog open onClose={onClose} icon={School} title={classroom ? t('管理班级', 'Manage class') : t('创建班级', 'Create a class')}>
    <form className="form-stack" onSubmit={async event => { event.preventDefault(); let created = ''; const ok = await client.run(async () => { const result = await api(classroom ? `classes/${classroom.id}` : 'classes', classroom ? 'PATCH' : 'POST', { name }); created = result.id || '' }, t('班级已保存。', 'Class saved.'), () => created || classroom?.id || client.classId); if (ok) onClose() }}>
      <Field label={t('班级名称', 'Class name')} id="class-name"><Input id="class-name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} autoFocus placeholder={t('例如：三年级一班', 'For example: Class 3A')} /></Field>
      <Button type="submit" variant="primary" busy={client.busy} className="w-full"><Save size={16} />{t('保存班级', 'Save class')}</Button>
    </form>
    {classroom?.role === 'owner' && <div className="mt-7 border-t border-line pt-5">{confirmDelete && <p className="mb-3 text-sm leading-relaxed text-danger">{t('将永久删除此班级的学生、评价、徽章和兑换记录。此操作无法撤销。', 'This permanently deletes the class, students, evaluations, badges and redemptions. This cannot be undone.')}</p>}<Button variant="danger" busy={client.busy} onClick={async () => { if (!confirmDelete) return setConfirmDelete(true); if (await client.run(() => api(`classes/${classroom.id}`, 'DELETE'), t('班级已删除。', 'Class deleted.'), '')) onClose() }}><Trash2 size={16} />{confirmDelete ? t('确认永久删除', 'Confirm permanent deletion') : t('删除这个班级', 'Delete this class')}</Button></div>}
  </Dialog>
}
export function StudentDialog({ client, locale, student, importing, onClose }: { client: GardenClient; locale: Locale; student?: Student; importing?: boolean; onClose: () => void }) {
  const t = translator(locale), [name, setName] = useState(student?.name || ''), [number, setNumber] = useState(student?.student_no || ''), [lines, setLines] = useState(''), [confirmDelete, setConfirmDelete] = useState(false)
  const [acceptNames, setAcceptNames] = useState(false)
  const parsed = parseStudentList(lines)
  const ambiguous = parsed.some(row => row.ambiguous), invalid = parsed.some(row => row.invalid)
  return <Dialog open onClose={onClose} icon={importing ? Upload : UserRound} title={importing ? t('批量导入学生', 'Import students') : student ? t('编辑学生', 'Edit student') : t('添加学生', 'Add a student')} description={importing ? t('每行一名学生，姓名和学号用空格、逗号或分号分隔。每次最多 500 名。', 'One student per line. Separate the name and student number with a comma, semicolon or space. Up to 500 students.') : undefined}>
    <form className="form-stack" onSubmit={async event => { event.preventDefault(); const ok = await client.run(() => student ? api(`students/${student.id}`, 'PATCH', { name, studentNo: number }) : api('students', 'POST', { classId: client.classId, students: importing ? parsed : [{ name, studentNo: number }] }), t('学生信息已保存。', 'Students saved.')); if (ok) onClose() }}>
      {importing ? <Field label={t('学生名单', 'Student list')} id="student-list"><Textarea id="student-list" value={lines} onChange={event => { setLines(event.target.value); setAcceptNames(false) }} required placeholder={locale === 'zh' ? '林小橙 01\n陈子禾 02' : 'Olivia, 01\nNoah, 02'} /><p className="mt-2 text-xs text-muted">{parsed.length} {t('名学生待导入', 'students to import')}</p></Field> : <><Field label={t('学生姓名', 'Student name')} id="student-name"><Input id="student-name" required maxLength={80} autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={t('例如：林小橙', 'For example: Olivia')} /></Field><Field label={t('学号（选填）', 'Student number (optional)')} id="student-number"><Input id="student-number" maxLength={30} value={number} onChange={event => setNumber(event.target.value)} placeholder={t('例如：01，可留空', 'For example: 01, or leave blank')} /></Field></>}
      {importing && parsed.length > 0 && <div className="space-y-3"><div className="table-wrap max-h-40 overflow-y-auto rounded-xl border border-line"><table className="data-table"><thead><tr><th>{t('姓名预览', 'Name preview')}</th><th>{t('学号', 'Student number')}</th></tr></thead><tbody>{parsed.slice(0, 20).map((row, index) => <tr key={index}><td>{row.name}</td><td>{row.studentNo || '—'}</td></tr>)}</tbody></table></div>{invalid && <p role="alert" className="text-sm text-danger">{t('有无效行，请检查姓名、学号长度、引号以及列数（每行最多两列）。', 'Some rows are invalid. Check names, number lengths, quotes, and the two-column limit.')}</p>}{ambiguous && <label className="flex items-start gap-3 text-sm leading-relaxed"><Checkbox checked={acceptNames} onCheckedChange={setAcceptNames} /><span>{t('部分行只有空格且没有明确学号。我确认将整行作为完整姓名保留。', 'Some space-separated rows have no clear student number. Keep each entire row as the full name.')}</span></label>}</div>}
      <Button type="submit" variant="primary" busy={client.busy} disabled={importing && (parsed.length > 500 || !lines.trim() || invalid || (ambiguous && !acceptNames))} className="w-full">{importing ? <Upload size={16} /> : <Save size={16} />}{importing ? t('导入学生', 'Import students') : t('保存学生', 'Save student')}</Button>
    </form>
    {student && <div className="mt-6 border-t border-line pt-5">{confirmDelete && <p className="mb-3 text-sm text-danger">{t('将永久删除此学生及其全部记录。', 'This permanently deletes this student and all their records.')}</p>}<Button variant="danger" busy={client.busy} onClick={async () => { if (!confirmDelete) return setConfirmDelete(true); if (await client.run(() => api(`students/${student.id}`, 'DELETE'), t('学生已删除。', 'Student deleted.'))) onClose() }}><Trash2 size={16} />{confirmDelete ? t('确认删除学生', 'Confirm deletion') : t('删除学生', 'Delete student')}</Button></div>}
  </Dialog>
}
export function RulesDialog({ client, locale, onClose }: { client: GardenClient; locale: Locale; onClose: () => void }) {
  const t = translator(locale), [category, setCategory] = useState('study'), [name, setName] = useState(''), [points, setPoints] = useState(1), [adding, setAdding] = useState(false)
  const [page, setPage] = useState<'rules' | 'growth' | 'status'>('rules')
  const rules = client.state!.rules.filter(rule => rule.category === category)
  const pages = [['rules', t('加减分规则', 'Evaluations')], ['growth', t('成长设置', 'Growth')], ['status', t('宠物状态', 'Pet status')]] as const
  return <Dialog open wide className="flex h-[90dvh] flex-col overflow-hidden" onClose={onClose} icon={BookOpen} title={t('规则设置', 'Garden rules')} description={t('管理当前班级的评价、成长和宠物状态，不影响其他班级。', 'Manage evaluations, growth and pet states for this class only. Other classes are unchanged.')}>
    <div className="section-tabs mb-6 shrink-0" role="tablist" aria-label={t('规则设置分类', 'Garden settings sections')}>{pages.map(([key, label], index) => <button key={key} id={`settings-tab-${key}`} type="button" role="tab" aria-selected={page === key} aria-controls={`settings-panel-${key}`} tabIndex={page === key ? 0 : -1} className={`tab whitespace-nowrap ${page === key ? 'tab-active' : ''}`} onClick={() => setPage(key)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3; setPage(pages[next][0]); document.getElementById(`settings-tab-${pages[next][0]}`)?.focus() } }}>{label}</button>)}</div>
    <div id="settings-panel-rules" className="min-h-0 flex-1 overflow-y-auto" role="tabpanel" aria-labelledby="settings-tab-rules" hidden={page !== 'rules'}>
    <p className="mb-4 text-sm text-muted">{t('每个新班级从你的初始模板复制规则。这里的修改由本班教师共享，只影响当前班级。', 'New classes copy rules from your initial template. Changes here are shared by this class’s teachers and affect only this class.')}</p>
    <div className="mb-5 flex flex-wrap justify-between gap-3"><Select aria-label={t('规则分类', 'Rule category')} className="w-44" value={category} onValueChange={setCategory} options={categories.map(value => ({ value, label: categoryName(value, locale), icon: { study: BookOpen, behavior: HandHeart, health: HeartPulse, other: Shapes }[value] }))} /><Button onClick={() => setAdding(!adding)}><Plus size={16} />{t('自定义规则', 'Custom rule')}</Button></div>
    {adding && <form className="mb-6 space-y-4 rounded-2xl bg-[#f7f5fb] p-4" onSubmit={async event => { event.preventDefault(); if (await client.run(() => api('rules', 'POST', { classId: client.classId, name: localizedUserText(name, locale), category, points }), t('规则已添加。', 'Rule added.'))) { setName(''); setAdding(false) } }}>
      <Field id="rule-name" label={t('规则名称', 'Rule name')}><Input id="rule-name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} placeholder={t('例如：主动帮助同学', 'For example: Helping classmates')} /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field id="rule-points" label={t('分值（负数为扣分）', 'Points (negative to deduct)')}><Input id="rule-points" type="number" min={-100} max={100} value={points} onChange={event => setPoints(Number(event.target.value))} required /></Field><Button type="submit" variant="primary" busy={client.busy} disabled={points === 0 || !name.trim()} className="self-end"><Plus size={16} />{t('添加规则', 'Add rule')}</Button></div>
    </form>}
    <div className="table-wrap max-h-[50dvh] overflow-y-auto"><table className="data-table"><thead><tr><th>{t('评价内容', 'Evaluation')}</th><th>{t('分值', 'Points')}</th><th>{t('类型', 'Type')}</th><th><span className="sr-only">{t('操作', 'Actions')}</span></th></tr></thead><tbody>{rules.map(rule => <tr key={rule.id}><td>{rule.name[locale]}</td><td className="tabular font-semibold">{rule.points > 0 ? '+' : ''}{rule.points}</td><td className="whitespace-nowrap text-xs text-muted">{rule.custom ? t('自定义', 'Custom') : t('预置', 'Default')}</td><td>{!!rule.custom && <Button variant="ghost" aria-label={`${t('删除规则', 'Delete rule')} ${rule.name[locale]}`} disabled={client.busy} onClick={() => client.run(() => api(`rules/${rule.id}`, 'DELETE'))}><Trash2 size={15} /></Button>}</td></tr>)}</tbody></table></div>
    </div>
    <div className="min-h-0 flex-1" id={`settings-panel-${page === 'rules' ? 'growth' : page}`} role="tabpanel" aria-labelledby={`settings-tab-${page === 'rules' ? 'growth' : page}`} hidden={page === 'rules'}><GardenSettingsForm client={client} locale={locale} page={page === 'rules' ? 'growth' : page} /></div>
  </Dialog>
}
export function SettingsDialog({ client, locale, onClose }: { client: GardenClient; locale: Locale; onClose: () => void }) {
  const t = translator(locale), [restore, setRestore] = useState<unknown>(null), [filename, setFilename] = useState('')
  const profileButton = useRef<HTMLButtonElement>(null)
  const [editingProfile, setEditingProfile] = useState(false), [restoreError, setRestoreError] = useState('')
  const [importResult, setImportResult] = useState<{ imported: number; classIds: string[] } | null>(null), [importSelected, setImportSelected] = useState('')
  const [recovery, setRecovery] = useState<'saved' | 'unknown' | null>(null)
  const restoreLock = useRef(false)
  const { user, classes } = client.state!
  const ownedClasses = classes.filter(classroom => classroom.role === 'owner')
  async function importBackup() {
    if (client.busy || restoreLock.current || restore === null) return
    setRestoreError('')
    let imported = 0, saved = false
    const ok = await client.run(async () => {
      restoreLock.current = true
      try {
        const result = await api<{ imported: number; classIds: string[] }>('restore', 'POST', restore)
        if (!result || !Number.isSafeInteger(result.imported) || result.imported < 0 || !Array.isArray(result.classIds) || result.classIds.length !== result.imported || result.classIds.some(id => typeof id !== 'string' || !id)) throw new ApiError('networkError', 0)
        // The write is committed. Preserve its receipt before run() attempts the GET.
        saved = true; imported = result.imported
        setRestore(null); setImportResult(result); setImportSelected(result.classIds[0] || ''); setRecovery('saved')
      } catch (error) {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          restoreLock.current = false
          setRestoreError(errorMessage(error.code, locale))
        } else {
          // A lost response or server failure cannot prove that no copies were created.
          setRestore(null); setRecovery('unknown')
        }
        throw error
      }
    })
    if (ok && saved) {
      setRecovery(null)
      client.setNotice({ text: t(`已导入 ${imported} 个新班级副本，现有数据未被覆盖。`, `${imported} new class ${imported === 1 ? 'copy' : 'copies'} imported. Existing data is unchanged.`), error: false })
    }
  }
  async function reloadImport() {
    if (!await client.run(async () => {})) return
    if (recovery === 'unknown') {
      client.setNotice({ text: t('已加载最新班级。请通过班级切换列表核对是否已创建副本，确认未导入后再选择文件。', 'The latest classes are loaded. Check the class switcher for imported copies. Choose the file again only after confirming it was not imported.'), error: false })
      onClose()
    } else setRecovery(null)
  }
  return <Dialog open onClose={() => { if (!client.busy) onClose() }} icon={Settings2} title={t('设置与数据', 'Settings & data')} className="flex max-h-[90dvh] flex-col overflow-hidden">
    <div className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-1 pb-2"><section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><UserRound size={18} />{t('我的教师资料', 'My teacher profile')}</h3><Button ref={profileButton} variant="ghost" disabled={client.busy} onClick={() => setEditingProfile(value => !value)}>{editingProfile ? t('收起编辑', 'Close editor') : t('编辑资料', 'Edit profile')}</Button></div>{editingProfile ? <TeacherProfileForm client={client} locale={locale} onSaved={() => { setEditingProfile(false); requestAnimationFrame(() => profileButton.current?.focus()) }} /> : <><p className="break-words font-medium">{user.display_name}</p><p className="mt-2 break-words text-sm leading-relaxed text-muted">{user.subject} · {teachingRoleName(user.teaching_role, locale)}</p><p className="mt-2 break-words text-xs text-muted">{t('用户名：', 'Username: ')}{user.username}</p></>}<p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted"><ShieldCheck size={16} className="shrink-0" />{t('只有班级成员可以访问共享数据。每班的规则、成长和商店独立，修改资料不改变历史署名。', 'Only class members can access shared data. Rules, growth settings and rewards are separate for each class. Profile edits do not change historical names.')}</p></section>
      <section className="border-t border-line pt-6"><h3 className="mb-3 flex items-center gap-2 font-semibold"><Database size={18} />{t('备份与导入', 'Backup & import')}</h3><p className="mb-4 text-sm leading-relaxed text-muted">{process.env.NEXT_PUBLIC_DESKTOP === 'true' ? t('数据保存在这台电脑的 SQLite 数据库中，不会自动同步。请定期导出备份。备份包含本人负责的班级及个人初始模板，不包含仅共管班级、账号密码、成员权限或邀请码。', 'Data is stored in SQLite on this computer and does not sync automatically. Export backups regularly. Backups include your owned classes and initial template, but exclude co-admin-only classes, account credentials, membership permissions and invitation codes.') : t('数据保存在服务器 SQLite 中。备份只包含你当前负责的班级及各班的学生、独立规则、成长设置、历史、徽章、商品和兑换，并可含个人初始模板；不包含仅共管班级、账号密码、成员权限或邀请码。', 'Data is stored in server-side SQLite. Backups include only classes you own, with their students, class-specific rules, growth settings, history, badges, rewards and redemptions, and may include your initial template. Co-admin-only classes, account credentials, membership permissions and invitation codes are excluded.')}</p><div className="flex flex-wrap gap-3"><Button busy={client.busy} disabled={!ownedClasses.length} onClick={() => client.run(async () => {
        const data = await api('backup'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `pet-garden-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, process.env.NEXT_PUBLIC_DESKTOP === 'true' ? undefined : t('本人负责班级的备份已导出。', 'Backup of your owned classes exported.'))}><Download size={16} />{t('导出负责班级', 'Export owned classes')}</Button><FileInput label={t('选择备份文件', 'Choose backup')} accept="application/json,.json" disabled={client.busy || recovery !== null} onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file || client.busy || recovery) return; restoreLock.current = false; setRestoreError(''); setImportResult(null); setRestore(null); try { if (file.size > MAX_BACKUP_BYTES) throw new ApiError('backupTooLarge'); const parsed: unknown = JSON.parse(await file.text()); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError('invalidBackup'); setRestore(parsed); setFilename(file.name) } catch (error) { const failure = error instanceof ApiError ? error : new ApiError('invalidBackup'); setRestoreError(errorMessage(failure.code, locale)); client.report(failure) } }} /></div>
      {!ownedClasses.length && <p className="mt-3 text-xs leading-relaxed text-muted">{t('你目前没有负责的班级，无法导出共管班级。可向该班负责人索取备份。', 'You do not own any classes, so co-managed classes cannot be exported. Ask the class owner for a backup.')}</p>}
      <p className="mt-3 text-xs leading-relaxed text-muted">{t(`导入文件最大 ${MAX_BACKUP_MB} MB。导入将创建新班级副本，不会覆盖现有班级、共管数据或你的个人初始模板，也不会恢复其他教师权限。`, `Import files can be up to ${MAX_BACKUP_MB} MB. Import creates new class copies without replacing existing classes, co-managed data or your initial template. Other teachers’ access is not restored.`)}</p>
      {restore !== null && <div className="mt-4 rounded-xl border border-[#ded4f6] bg-[#f8f5ff] p-4"><p className="mb-3 break-words text-sm leading-relaxed">{filename}<br />{t('确认导入为新的班级副本？你将成为副本负责人，原有班级保持不变；如需共同管理，请重新邀请教师。', 'Import as new class copies? You will own the copies. Existing classes stay unchanged; invite teachers again if you want to share the copies.')}</p><div className="flex flex-wrap gap-2"><Button variant="primary" busy={client.busy} onClick={importBackup}><Check size={16} />{t('确认导入新副本', 'Import new copies')}</Button><Button variant="ghost" disabled={client.busy} onClick={() => setRestore(null)}><X size={16} />{t('取消', 'Cancel')}</Button></div></div>}
      {restoreError && <p role="alert" className="mt-3 text-sm leading-relaxed text-danger">{restoreError}</p>}
      {recovery && <div role="alert" className="mt-4 space-y-3 rounded-xl border border-line bg-[#f5f2ff] p-4"><p className="text-sm leading-relaxed">{recovery === 'saved' ? t('导入已成功，副本编号已保留。最新班级数据尚未加载，请重新加载，不要重复导入。', 'Import succeeded and the copy IDs are kept. The latest class data has not loaded. Reload without importing again.') : t('暂时无法确认导入结果，班级副本可能已创建。已暂停导入，请重新加载并核对班级列表，避免重复创建副本。', 'The import result is unknown; class copies may already exist. Import is paused. Reload and check the class list to avoid creating duplicates.')}</p><Button busy={client.busy} onClick={reloadImport}><RefreshCw size={16} aria-hidden="true" />{t('重新加载班级', 'Reload classes')}</Button></div>}
      {importResult && <div className="mt-4 space-y-3 rounded-xl bg-[#f4f0ff] p-4"><p role="status" className="text-sm leading-relaxed">{t(`已创建 ${importResult.imported} 个班级副本。`, `${importResult.imported} class ${importResult.imported === 1 ? 'copy' : 'copies'} created.`)}</p>{!recovery && importResult.classIds.length > 0 && <><Select aria-label={t('导入的新班级', 'Imported class')} value={importSelected} disabled={client.busy} onValueChange={setImportSelected} options={classes.filter(classroom => importResult.classIds.includes(classroom.id)).map(classroom => ({ value: classroom.id, label: classroom.name }))} /><Button variant="primary" disabled={client.busy || !importSelected} onClick={async () => { if (await client.run(async () => {}, undefined, importSelected)) onClose() }}>{t('进入新班级', 'Open imported class')}</Button></>}</div>}
      </section>
      <section className="border-t border-line pt-6"><h3 className="mb-2 font-semibold">{t('想先体验一下？', 'Want to explore first?')}</h3><p className="mb-4 text-sm leading-relaxed text-muted">{t('创建一个标记为演示的班级，包含 6 名学生和成长记录，不修改其他班级。', 'Create a clearly labeled demo class with six students and sample growth records. Your other classes stay unchanged.')}</p><Button busy={client.busy} onClick={async () => { let id = ''; const ok = await client.run(async () => { id = (await api('demo', 'POST', { locale })).id || '' }, t('演示班级已准备好。', 'Your demo class is ready.'), () => id); if (ok) onClose() }}><Sparkles size={16} />{t('创建演示班级', 'Create demo class')}</Button></section>
      <p className="border-t border-line pt-4 text-xs leading-relaxed text-muted">{t('公开部署或再分发前请确认宠物图像的资源授权。', 'Confirm pet artwork licensing before public deployment or redistribution.')}</p>
    </div>
  </Dialog>
}
