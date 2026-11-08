import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { applicationDatabase } from '@/lib/server/db'
import { Garden } from '@/lib/server/garden'
import { DomainError } from '@/lib/server/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store', Vary: 'Cookie' }

// This namespace exports only GET. Never pass global access to ordinary writes.
export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const garden = new Garden(await applicationDatabase())
    const actor = await garden.authenticate(request.cookies.get('pet-garden-session')?.value)
    const { path } = await context.params
    let result: unknown
    if (path.length === 1 && path[0] === 'access') result = await garden.adminAccess(actor)
    else if (path.length === 1 && path[0] === 'classes') {
      const query = request.nextUrl.searchParams
      result = await garden.adminClasses(actor, {
        page: query.get('page') ?? undefined, pageSize: query.get('pageSize') ?? undefined,
        search: query.get('search') ?? undefined
      })
    } else if (path.length === 2 && path[0] === 'classes') result = await garden.adminClass(actor, path[1])
    else throw new DomainError('notFound', 404)
    return NextResponse.json(result, { headers })
  } catch (error) {
    if (error instanceof DomainError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
    if (error instanceof ZodError) return NextResponse.json({ error: 'invalidInput' }, { status: 400, headers })
    console.error('Admin class overview failed', error)
    return NextResponse.json({ error: 'serverError' }, { status: 500, headers })
  }
}
