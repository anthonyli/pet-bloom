import { notFound } from 'next/navigation'
import { AdminClasses } from '@/components/admin-classes'

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (locale !== 'zh' && locale !== 'en') notFound()
  return <AdminClasses locale={locale} />
}
