import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
export const metadata: Metadata = {
  title: 'PetBloom · 萌芽',
  description: '让每一份成长，都悄悄发芽。面向学校和班级的游戏化宠物养成与学生成长激励平台。 A gamified pet-raising and student growth motivation platform for schools and classrooms.',
  robots: { index: false, follow: false }
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = (await headers()).get('x-garden-locale') || 'zh'
  return <html lang={lang} suppressHydrationWarning><body>{children}</body></html>
}
