import { NextResponse, type NextRequest } from 'next/server'
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/') return NextResponse.redirect(new URL('/zh', request.url))
  const headers = new Headers(request.headers)
  headers.set('x-garden-locale', request.nextUrl.pathname.startsWith('/en') ? 'en' : 'zh')
  return NextResponse.next({ request: { headers } })
}
export const config = { matcher: ['/((?!api|_next|pets|favicon).*)'] }
