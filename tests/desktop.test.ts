import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'

const require = createRequire(import.meta.url)

afterEach(() => vi.unstubAllEnvs())

describe('Windows 数据库预构建', () => {
  it('包含 x64 PE 模块及不依赖 Electron ABI 的 Node-API 导出', () => {
    const directory = path.dirname(require.resolve('better-sqlite3/package.json'))
    const binding = readFileSync(path.join(directory, 'prebuilds/win32-x64.node'))
    const pe = binding.readUInt32LE(0x3c)
    expect(binding.readUInt16LE(0)).toBe(0x5a4d)
    expect(binding.readUInt32LE(pe)).toBe(0x4550)
    expect(binding.readUInt16LE(pe + 4)).toBe(0x8664)
    expect(binding.readUInt16LE(pe + 24)).toBe(0x20b)
    expect(binding.includes(Buffer.from('napi_register_module_v1\0'))).toBe(true)
    expect(binding.includes(Buffer.from('node_api_module_get_api_version_v1\0'))).toBe(true)
  })
})

describe('桌面本地服务访问隔离', () => {
  it.each(['/zh', '/en', '/api/health', '/api/auth/register', '/_next/static/app.js', '/pets/egg.webp', '/fonts/font.woff2', '/'])('拒绝没有桌面令牌的请求：%s', path => {
    vi.stubEnv('DESKTOP_TOKEN', 'desktop-secret')
    expect(middleware(new NextRequest(`http://127.0.0.1:43123${path}`)).status).toBe(403)
  })

  it('拒绝错误令牌', () => {
    vi.stubEnv('DESKTOP_TOKEN', 'desktop-secret')
    expect(middleware(new NextRequest('http://127.0.0.1:43123/api/health', { headers: { 'x-petbloom-desktop': 'wrong' } })).status).toBe(403)
  })

  it.each(['/zh', '/en', '/api/health', '/_next/static/app.js', '/pets/egg.webp'])('允许桌面窗口访问：%s', path => {
    vi.stubEnv('DESKTOP_TOKEN', 'desktop-secret')
    expect(middleware(new NextRequest(`http://127.0.0.1:43123${path}`, { headers: { 'x-petbloom-desktop': 'desktop-secret' } })).status).toBe(200)
  })

  it('保留网页部署的语言重定向和语言请求头', () => {
    vi.stubEnv('DESKTOP_TOKEN', '')
    expect(middleware(new NextRequest('http://localhost:3100/')).headers.get('location')).toBe('http://localhost:3100/zh')
    expect(middleware(new NextRequest('http://localhost:3100/en')).headers.get('x-middleware-request-x-garden-locale')).toBe('en')
    expect(middleware(new NextRequest('http://localhost:3100/zh')).headers.get('x-middleware-request-x-garden-locale')).toBe('zh')
  })

  it('网页 API 和静态资源仍无需桌面令牌', () => {
    vi.stubEnv('DESKTOP_TOKEN', '')
    expect(middleware(new NextRequest('http://localhost:3100/api/health')).status).toBe(200)
    expect(middleware(new NextRequest('http://localhost:3100/pets/egg.webp')).headers.get('x-middleware-request-x-garden-locale')).toBeNull()
  })
})
