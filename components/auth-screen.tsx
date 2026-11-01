'use client'
import { useState } from 'react'
import Link from 'next/link'
import { PawPrint, Globe2, ArrowRight, ShieldCheck, UserPlus, LogIn } from 'lucide-react'
import { Button, Field, Input } from '@/components/ui'
import { translator, petImage } from '@/lib/i18n'
import type { Locale } from '@/lib/types'
import { api, type GardenClient } from './use-garden'

export function AuthScreen({ locale, client }: { locale: Locale; client: GardenClient }) {
  const t = translator(locale)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState(''), [password, setPassword] = useState('')
  return <div className="min-h-screen bg-white">
    <header className="flex items-center justify-between px-6 py-5 sm:px-10"><div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-white"><PawPrint size={23} /></span><span className="font-bold">{t('班级宠物园', 'Class Pet Garden')}</span></div><Link href={locale === 'zh' ? '/en' : '/zh'} className="button button-ghost"><Globe2 size={17} />{locale === 'zh' ? 'English' : '中文'}</Link></header>
    <main className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-16 pt-8 lg:grid-cols-2 lg:gap-24 lg:px-12 lg:pt-16">
      <section className="relative hidden min-h-[620px] overflow-hidden rounded-[40px] bg-[#eee9ff] p-10 lg:block">
        <h1 className="display-voice relative z-10 max-w-sm text-4xl leading-tight tracking-tight">{t('让每一次进步，', 'A little encouragement.')}<br />{t('都有可爱的回应。', 'A lot of growth.')}</h1>
        <p className="mt-5 max-w-xs text-base leading-relaxed text-[#5c5280]">{t('把课堂里的闪光时刻，变成一只宠物慢慢长大的故事。', 'Turn everyday classroom wins into a little pet’s growing story.')}</p>
        <div className="absolute bottom-10 left-10 h-64 w-52 -rotate-6 overflow-hidden rounded-[32px] bg-white p-4 shadow-lg"><img src={petImage('westie', 5)} alt={t('西高地犬', 'West Highland terrier')} className="h-full w-full object-contain" /></div>
        <div className="absolute bottom-16 right-6 h-72 w-52 rotate-6 overflow-hidden rounded-[32px] bg-white p-4 shadow-lg"><img src={petImage('capybara', 4)} alt={t('卡皮巴拉', 'Capybara')} className="h-full w-full object-contain" /></div>
      </section>
      <section className="mx-auto w-full max-w-sm">
        <span className="mb-7 inline-flex size-14 items-center justify-center rounded-2xl bg-[#f0ebff] text-primary"><PawPrint size={28} /></span>
        <h2 className="text-3xl font-bold tracking-tight">{mode === 'login' ? t('欢迎回到宠物园', 'Welcome back') : t('开启你的班级宠物园', 'Start your class garden')}</h2>
        <p className="mb-8 mt-3 text-sm leading-relaxed text-muted">{t('教师的管理好帮手，学生的成长小伙伴。', 'A helping hand for teachers. A growing friend for every student.')}</p>
        <form className="form-stack" onSubmit={event => { event.preventDefault(); client.run(async () => { await api(`auth/${mode}`, 'POST', { username, password }) }) }}>
          <Field label={t('用户名', 'Username')} id="username"><Input id="username" autoComplete="username" required minLength={3} maxLength={30} value={username} onChange={event => setUsername(event.target.value)} placeholder={t('输入教师用户名', 'Your teacher username')} /></Field>
          <Field label={t('密码', 'Password')} id="password"><Input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder={t('至少 8 个字符', 'At least 8 characters')} /></Field>
          <Button type="submit" variant="primary" busy={client.busy} className="w-full py-3">{mode === 'login' ? t('登录宠物园', 'Sign in') : t('创建教师账号', 'Create account')}<ArrowRight size={17} /></Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">{mode === 'login' ? t('第一次来？', 'New here?') : t('已有账号？', 'Already have an account?')}<Button variant="ghost" className="ml-1 px-1 text-primary" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); client.setNotice(null) }}>{mode === 'login' ? <UserPlus size={16} /> : <LogIn size={16} />}{mode === 'login' ? t('创建账号', 'Create an account') : t('前往登录', 'Sign in')}</Button></p>
        <p className="mt-8 flex items-start gap-2 border-t border-line pt-5 text-xs leading-relaxed text-muted"><ShieldCheck size={17} className="shrink-0" />{t('仅你和获邀教师可以管理共享班级。班级数据保存在服务器的 SQLite 数据库中。', 'Only you and invited teachers can manage shared classes. Class data is saved in the server’s SQLite database.')}</p>
      </section>
    </main>
  </div>
}
