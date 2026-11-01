import { NextResponse, type NextRequest } from 'next/server'
export function middleware(request: NextRequest) {
  if (process.env.DESKTOP_TOKEN && request.headers.get('x-petbloom-desktop') !== process.env.DESKTOP_TOKEN) return new NextResponse(null, { status: 403 })
  if (/^\/(api(?:\/|$)|_next(?:\/|$)|pets(?:\/|$)|favicon)/.test(request.nextUrl.pathname)) return NextResponse.next()
  if (request.nextUrl.pathname === '/') return NextResponse.redirect(new URL('/zh', request.url))
  const headers = new Headers(request.headers)
  headers.set('x-garden-locale', request.nextUrl.pathname.startsWith('/en') ? 'en' : 'zh')
  return NextResponse.next({ request: { headers } })
}
export const config = { matcher: ['/:path*'] }
