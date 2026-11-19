'use client'
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { GraduationCap, LogOut } from 'lucide-react'
import { Button } from '@/components/ui'
import { translator } from '@/lib/i18n'
import type { Locale } from '@/lib/types'

export function AccountMenu({ locale, name, busy, onSignOut }: {
  locale: Locale
  name: string
  busy: boolean
  onSignOut: () => void
}) {
  const t = translator(locale)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const initial = Array.from(name.trim())[0] || '?'
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey) }
  }, [open])
  function onMenuKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus() }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus() }
    else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus() }
    else if (event.key === 'Tab') setOpen(false)
  }
  return <div ref={root} className="relative">
    <Button ref={button} variant="ghost" className="size-9 rounded-full p-0" disabled={busy} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={t(`账号菜单，${name}`, `Account menu, ${name}`)} onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{initial}</span>
    </Button>
    {open && <div id={menuId} role="menu" aria-label={t('账号菜单', 'Account menu')} className="absolute right-0 top-full z-40 mt-2 w-56 rounded-2xl border border-line bg-white p-2 shadow-lg" onKeyDown={onMenuKey}>
      <p className="truncate px-3 py-2 text-sm font-semibold">{name}</p>
      <Link role="menuitem" href={`/${locale}/classes?status=graduated`} className="button button-ghost w-full justify-start" onClick={() => setOpen(false)}><GraduationCap size={16} aria-hidden="true" />{t('毕业班级', 'Graduated classes')}</Link>
      <Button role="menuitem" variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => { setOpen(false); onSignOut() }}><LogOut size={16} aria-hidden="true" />{t('退出登录', 'Sign out')}</Button>
    </div>}
  </div>
}
