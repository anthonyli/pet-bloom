import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
export const metadata: Metadata = {
  title: '班级宠物园 · Class Pet Garden',
  description: 'A little encouragement. A lot of growth. 班级积分与宠物养成。',
  robots: { index: false, follow: false }
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = (await headers()).get('x-garden-locale') || 'zh'
  return <html lang={lang} suppressHydrationWarning><body>{children}</body></html>
}
