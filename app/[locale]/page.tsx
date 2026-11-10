import { notFound } from 'next/navigation'
import { Workspace } from '@/components/workspace'
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ classId?: string | string[] }> }) {
  const { locale } = await params
  if (locale !== 'zh' && locale !== 'en') notFound()
  const { classId } = await searchParams
  return <Workspace locale={locale} initialClassId={typeof classId === 'string' ? classId : ''} />
}
