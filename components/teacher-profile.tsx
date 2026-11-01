'use client'
import { useId, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Globe2, LogOut, PawPrint, Save, UserRound } from 'lucide-react'
import { Button, Field, Input, Select } from '@/components/ui'
import { teacherProfileSchema, teachingRoles } from '@/lib/teacher'
import { errorMessage, translator } from '@/lib/i18n'
import type { Locale, TeachingRole, User } from '@/lib/types'
import { api, ApiError, type GardenClient } from './use-garden'

export const teachingRoleName = (role: TeachingRole | null, locale: Locale) => {
  const t = translator(locale)
  return role === 'homeroom' ? t('班主任', 'Homeroom teacher') : role === 'subject' ? t('任课教师', 'Subject teacher') : role === 'other' ? t('其他教学身份', 'Other teaching role') : t('未填写', 'Not specified')
}
const commonSubjects = [['语文', 'Language arts'], ['数学', 'Mathematics'], ['英语', 'English'], ['科学', 'Science'], ['体育', 'Physical education'], ['音乐', 'Music'], ['美术', 'Art'], ['综合', 'General studies']] as const

export function TeacherProfileForm({ client, locale, onSaved, onboarding = false }: { client: GardenClient; locale: Locale; onSaved?: () => void; onboarding?: boolean }) {
  const t = translator(locale), id = useId(), user = client.state!.user
  const [displayName, setDisplayName] = useState(user.display_name || '')
  const [subject, setSubject] = useState(user.subject || '')
  const [subjectOption, setSubjectOption] = useState(() => { const index = commonSubjects.findIndex(pair => pair.some(value => value === user.subject)); return index < 0 ? 'custom' : String(index) })
  const [teachingRole, setTeachingRole] = useState<TeachingRole | ''>(user.teaching_role || '')
  const [error, setError] = useState(''), [saved, setSaved] = useState(false)
  return <form className="form-stack" aria-busy={client.busy} onSubmit={async event => {
    event.preventDefault(); setError(''); setSaved(false)
    const parsed = teacherProfileSchema.safeParse({ displayName, subject, teachingRole })
    if (!parsed.success) { setError(t('请填写教师称呼、任教学科，并选择教学身份。', 'Enter your teacher name and subject, then choose a teaching role.')); return }
    const ok = await client.run(async () => {
      try { await api<User>('auth/profile', 'PATCH', parsed.data) }
      catch (error) { setError(errorMessage(error instanceof ApiError ? error.code : 'serverError', locale)); throw error }
    }, onboarding ? undefined : t('教师资料已保存。', 'Teacher profile saved.'))
    if (ok) { setSaved(true); onSaved?.() }
  }}>
    <fieldset className="min-w-0 space-y-5" disabled={client.busy}>
      <Field id={`${id}-name`} label={t('教师称呼', 'Teacher name')}><Input id={`${id}-name`} autoFocus autoComplete="name" required maxLength={40} value={displayName} onChange={event => { setDisplayName(event.target.value); setSaved(false) }} placeholder={t('例如：李老师', 'For example: Ms. Lee')} /><p className="mt-2 text-xs leading-relaxed text-muted">{t('用于教师名单及今后的评价、兑换署名，不修改用户名。', 'Shown in teacher lists and on future evaluations and redemptions. Your username stays the same.')}</p></Field>
      <Field id={`${id}-subject-option`} label={t('任教学科', 'Teaching subject')}><Select id={`${id}-subject-option`} value={subjectOption} onValueChange={value => { setSubjectOption(value); setSubject(value === 'custom' ? '' : commonSubjects[Number(value)][locale === 'zh' ? 0 : 1]); setSaved(false) }} options={[...commonSubjects.map((pair, index) => ({ value: String(index), label: pair[locale === 'zh' ? 0 : 1] })), { value: 'custom', label: t('自行填写', 'Enter another subject') }]} /></Field>
      {subjectOption === 'custom' && <Field id={`${id}-subject`} label={t('填写学科或教学方向', 'Your subject or teaching area')}><Input id={`${id}-subject`} required maxLength={60} value={subject} onChange={event => { setSubject(event.target.value); setSaved(false) }} placeholder={t('例如：信息科技', 'For example: Computer science')} /></Field>}
      <Field id={`${id}-role`} label={t('教学身份', 'Teaching role')}><Select id={`${id}-role`} value={teachingRole} placeholder={t('请选择教学身份', 'Choose your teaching role')} onValueChange={value => { setTeachingRole(value as TeachingRole); setSaved(false) }} options={teachingRoles.map(value => ({ value, label: teachingRoleName(value, locale) }))} /><p className="mt-2 text-xs leading-relaxed text-muted">{t('教学身份仅用于介绍。班级负责人和共同管理员权限由班级成员关系决定。', 'Your teaching role is descriptive. Class ownership and co-admin access are set separately.')}</p></Field>
    </fieldset>
    {error && <p role="alert" className="text-sm leading-relaxed text-danger">{error}</p>}
    {saved && <p role="status" className="text-sm text-success">{t('教师资料已保存。', 'Teacher profile saved.')}</p>}
    <Button type="submit" variant="primary" busy={client.busy} className="w-full">{onboarding ? <ArrowRight size={17} /> : <Save size={17} />}{onboarding ? t('保存并继续', 'Save and continue') : t('保存教师资料', 'Save teacher profile')}</Button>
  </form>
}

export function TeacherProfileScreen({ client, locale }: { client: GardenClient; locale: Locale }) {
  const t = translator(locale)
  return <div className="min-h-screen bg-white">
    <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-10"><span className="flex items-center gap-3 font-bold"><span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-white"><PawPrint size={23} /></span>{t('萌芽', 'PetBloom')}</span><div className="flex items-center gap-1"><Link href={locale === 'zh' ? '/en' : '/zh'} className="button button-ghost"><Globe2 size={17} />{locale === 'zh' ? 'English' : '中文'}</Link><Button variant="ghost" disabled={client.busy} onClick={() => client.run(() => api('auth/logout', 'POST', {}))}><LogOut size={17} />{t('退出', 'Sign out')}</Button></div></header>
    <main className="mx-auto w-full max-w-lg px-6 pb-14 pt-7 sm:pt-12"><span className="mb-5 inline-flex size-14 items-center justify-center rounded-2xl bg-[#f0ebff] text-primary"><UserRound size={27} /></span><h1 className="text-3xl font-bold tracking-tight">{t('先认识一下你', 'Let’s get to know you')}</h1><p className="mb-8 mt-3 text-sm leading-relaxed text-muted">{t('完善教师资料后，就可以创建班级或使用邀请码加入。只需填写一次，之后随时可以修改。', 'Complete your teacher profile, then create a class or join with an invitation code. You can update these details later.')}</p><TeacherProfileForm client={client} locale={locale} onboarding /></main>
  </div>
}
