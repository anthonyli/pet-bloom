import { notFound } from 'next/navigation'
import { Workspace } from '@/components/workspace'
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (locale !== 'zh' && locale !== 'en') notFound()
  return <Workspace locale={locale} />
}
