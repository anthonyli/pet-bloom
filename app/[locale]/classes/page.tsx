import { notFound } from 'next/navigation'
import { ClassDirectory } from '@/components/admin-classes'

export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale } = await params
  if (locale !== 'zh' && locale !== 'en') notFound()
  const graduatedOnly = (await searchParams).status === 'graduated'
  return <ClassDirectory key={graduatedOnly ? 'graduated' : 'all'} locale={locale} graduatedOnly={graduatedOnly} />
}
