import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { applicationDatabase } from '@/lib/server/db'
import { Garden } from '@/lib/server/garden'
import { DomainError } from '@/lib/server/errors'
import { MAX_BACKUP_BYTES } from '@/lib/shop'
import { exportBackup, restoreBackup } from '@/lib/server/backup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const cookieName = 'pet-garden-session'
const globalLimits = globalThis as typeof globalThis & { gardenLoginLimits?: Map<string, { count: number; expires: number }>; gardenInviteLimits?: Map<string, { count: number; expires: number }> }
const limits = globalLimits.gardenLoginLimits ||= new Map()
const inviteLimits = globalLimits.gardenInviteLimits ||= new Map()

async function body(request: NextRequest, limit = 5 * 1024 * 1024) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('invalidInput', 415)
  const reader = request.body?.getReader()
  if (!reader) throw new DomainError('invalidInput')
  const chunks: Uint8Array[] = []; let length = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    length += result.value.byteLength
    if (length > limit) { await reader.cancel(); throw new DomainError(limit === MAX_BACKUP_BYTES ? 'backupTooLarge' : 'fileTooLarge', 413) }
    chunks.push(result.value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new DomainError('invalidInput') }
}

async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const parts = (await context.params).path
    const path = parts.join('/'), method = request.method
    if (!['GET', 'HEAD'].includes(method)) {
      const origin = request.headers.get('origin')
      const expected = process.env.APP_ORIGIN || new URL(request.url).origin
      if ((origin && origin !== expected) || request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('forbidden', 403)
    }
    const garden = new Garden(await applicationDatabase())
    const token = request.cookies.get(cookieName)?.value
    if (method === 'POST' && ['auth/login', 'auth/register'].includes(path)) {
      // 同一账号的登录/注册失败限制；不信任任意代理头作为客户端身份
      const input = await body(request)
      // 与 credentials 的 trim 保持一致，避免同一账号通过首尾空白获取新额度。
      const username = typeof input?.username === 'string' ? input.username.trim().toLowerCase().slice(0, 100) : 'invalid'
      const key = `${path}:${username}`
      for (const [entry, value] of limits) if (value.expires < Date.now()) limits.delete(entry)
      if (limits.size > 10000) throw new DomainError('rateLimited', 429)
      const limit = limits.get(key) || { count: 0, expires: Date.now() + 15 * 60000 }
      if (limit.count >= 15) throw new DomainError('rateLimited', 429)
      limit.count++; limits.set(key, limit)
      const result = path === 'auth/register' ? (await garden.register(input)) : (await garden.login(input))
      limits.delete(key)
      const response = NextResponse.json({ user: result.user })
      response.cookies.set(cookieName, result.token, { httpOnly: true, sameSite: 'lax', secure: Boolean(process.env.VERCEL) || process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 30 * 86400 })
      response.headers.set('Cache-Control', 'no-store')
      return response
    }
    if (method === 'GET' && path === 'health') {
      await garden.db.prepare('SELECT 1').get()
      return NextResponse.json({ status: 'ok', database: garden.db.kind }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const actor = await garden.authenticate(token)
    if (!['state', 'auth/profile', 'auth/logout'].includes(path)) await garden.requireProfile(actor)
    if (method === 'POST' && ['invitations/preview', 'invitations/join'].includes(path)) {
      for (const [key, value] of inviteLimits) if (value.expires < Date.now()) inviteLimits.delete(key)
      if (inviteLimits.size > 10000) throw new DomainError('rateLimited', 429)
      const limit = inviteLimits.get(actor) || { count: 0, expires: Date.now() + 15 * 60000 }
      if (limit.count >= 30) throw new DomainError('rateLimited', 429)
      limit.count++; inviteLimits.set(actor, limit)
    }
    let result: unknown = { success: true }
    if (method === 'POST' && path === 'auth/logout') {
      await garden.logout(token!)
      const response = NextResponse.json(result)
      response.cookies.set(cookieName, '', { httpOnly: true, sameSite: 'lax', secure: Boolean(process.env.VERCEL) || process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 0 })
      return response
    } else if (method === 'GET' && path === 'auth/profile') {
      result = (await garden.user(actor))
    } else if (method === 'PATCH' && path === 'auth/profile') {
      result = (await garden.saveProfile(actor, await body(request)))
    } else if (method === 'GET' && path === 'state') {
      result = (await garden.snapshot(actor, request.nextUrl.searchParams.get('classId') || undefined))
    } else if (method === 'POST' && path === 'invitations/preview') {
      result = (await garden.previewInvitation(actor, await body(request)))
    } else if (method === 'POST' && path === 'invitations/join') {
      result = (await garden.joinClass(actor, await body(request)))
    } else if (method === 'GET' && parts[0] === 'classes' && parts[2] === 'teachers' && parts.length === 3) {
      result = (await garden.classTeachers(actor, parts[1]))
    } else if (method === 'POST' && parts[0] === 'classes' && parts[2] === 'invitations' && parts.length === 3) {
      result = (await garden.createInvitation(actor, parts[1]))
    } else if (method === 'DELETE' && parts[0] === 'classes' && parts[2] === 'invitations' && parts.length === 3) {
      await garden.revokeInvitation(actor, parts[1])
    } else if (method === 'DELETE' && parts[0] === 'classes' && parts[2] === 'members' && parts.length === 4) {
      await garden.removeTeacher(actor, parts[1], parts[3])
    } else if (method === 'POST' && parts[0] === 'classes' && parts[2] === 'leave' && parts.length === 3) {
      await garden.leaveClass(actor, parts[1])
    } else if (method === 'POST' && parts[0] === 'classes' && parts[2] === 'transfer' && parts.length === 3) {
      await garden.transferClass(actor, parts[1], await body(request))
    } else if (method === 'GET' && path === 'settings') {
      const classId = request.nextUrl.searchParams.get('classId')
      if (!classId) throw new DomainError('invalidInput')
      result = (await garden.settings(actor, classId))
    } else if (method === 'PATCH' && path === 'settings') {
      result = (await garden.saveSettings(actor, await body(request)))
    } else if (method === 'POST' && path === 'classes') {
      result = (await garden.createClass(actor, await body(request)))
    } else if (method === 'PATCH' && parts[0] === 'classes' && parts.length === 2) {
      await garden.renameClass(actor, parts[1], await body(request))
    } else if (method === 'DELETE' && parts[0] === 'classes' && parts.length === 2) {
      await garden.deleteClass(actor, parts[1])
    } else if (method === 'POST' && parts[0] === 'students' && ['archive', 'restore'].includes(parts[2]) && parts.length === 3) {
      await garden.setStudentArchived(actor, parts[1], parts[2] === 'archive', parts[2] === 'archive' ? await body(request) : {})
    } else if (method === 'GET' && parts[0] === 'students' && parts[2] === 'history' && parts.length === 3) {
      result = await garden.studentHistory(actor, parts[1], Number(request.nextUrl.searchParams.get('offset') || 0))
    } else if (method === 'POST' && path === 'students') {
      result = { ids: await garden.addStudents(actor, await body(request)) }
    } else if (method === 'PATCH' && parts[0] === 'students' && parts.length === 2) {
      await garden.updateStudent(actor, parts[1], await body(request))
    } else if (method === 'DELETE' && parts[0] === 'students' && parts.length === 2) {
      await garden.deleteStudent(actor, parts[1])
    } else if (method === 'POST' && parts[0] === 'students' && parts[2] === 'pet' && parts.length === 3) {
      await garden.adopt(actor, parts[1], await body(request))
    } else if (method === 'PATCH' && parts[0] === 'students' && parts[2] === 'pet' && parts.length === 3) {
      await garden.changePet(actor, parts[1], await body(request))
    } else if (method === 'PATCH' && parts[0] === 'students' && parts[2] === 'background' && parts.length === 3) {
      await garden.setBackground(actor, parts[1], await body(request))
    } else if (method === 'POST' && path === 'evaluations') {
      result = (await garden.evaluate(actor, await body(request)))
    } else if (method === 'POST' && parts[0] === 'evaluations' && parts[2] === 'undo' && parts.length === 3) {
      await garden.undo(actor, parts[1])
    } else if (method === 'POST' && path === 'rules') {
      await garden.addRule(actor, await body(request))
    } else if (method === 'DELETE' && parts[0] === 'rules' && parts.length === 2) {
      await garden.deleteRule(actor, parts[1])
    } else if (method === 'GET' && parts[0] === 'items' && parts[2] === 'image' && parts.length === 3) {
      const image = await garden.itemImage(actor, parts[1])
      return new NextResponse(new Uint8Array(image.data), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
    } else if (method === 'POST' && path === 'items') {
      result = await garden.addItem(actor, await body(request))
    } else if (method === 'PATCH' && parts[0] === 'items' && parts.length === 2) {
      await garden.updateItem(actor, parts[1], await body(request))
    } else if (method === 'DELETE' && parts[0] === 'items' && parts.length === 2) {
      await garden.deleteItem(actor, parts[1])
    } else if (method === 'POST' && path === 'redemptions') {
      await garden.redeem(actor, await body(request))
    } else if (method === 'POST' && parts[0] === 'redemptions' && parts[2] === 'undo' && parts.length === 3) {
      await garden.undoRedemption(actor, parts[1])
    } else if (method === 'GET' && path === 'backup') {
      return NextResponse.json(await exportBackup(garden, actor), { headers: { 'Content-Disposition': `attachment; filename="pet-garden-${Date.now()}.json"`, 'Cache-Control': 'no-store' } })
    } else if (method === 'POST' && path === 'restore') {
      result = await restoreBackup(garden, actor, await body(request, MAX_BACKUP_BYTES))
    } else if (method === 'POST' && path === 'demo') {
      const input = await body(request)
      result = (await garden.demo(actor, input?.locale === 'en' ? 'en' : 'zh'))
    } else throw new DomainError('notFound', 404)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: 'invalidInput' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    if (error instanceof DomainError) return NextResponse.json({ error: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
    console.error('API 操作失败：', error)
    return NextResponse.json({ error: 'serverError' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE }
