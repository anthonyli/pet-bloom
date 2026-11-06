import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../app/api/[...path]/route'
import { database } from '../lib/server/db'

const state = globalThis as typeof globalThis & {
  petGardenDb?: ReturnType<typeof database>
  gardenLoginLimits?: Map<string, { count: number; expires: number }>
}
const username = 'Teacher+class@example.com'
let password: string, wrongPassword: string, userId: string

async function request(path: 'login' | 'register', name = username, secret = wrongPassword) {
  return POST(new NextRequest(`http://localhost:3100/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: secret })
  }), { params: Promise.resolve({ path: ['auth', path] }) })
}

async function expectFailure(response: Response, status: number, error: string) {
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ error })
  expect(response.headers.get('set-cookie')).toBeNull()
}

beforeEach(async () => {
  vi.stubEnv('DATABASE_PATH', ':memory:')
  vi.stubEnv('TURSO_DATABASE_URL', undefined)
  vi.stubEnv('VERCEL', undefined)
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 1, 4))
  state.gardenLoginLimits?.clear()
  password = randomBytes(24).toString('hex')
  wrongPassword = randomBytes(24).toString('hex')
  const registered = await request('register', username, password)
  expect(registered.status).toBe(200)
  userId = (await registered.json()).user.id
})

afterEach(() => {
  state.gardenLoginLimits?.clear()
  state.petGardenDb?.close()
  delete state.petGardenDb
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('真实认证路由的账号失败限流', () => {
  it('15 次失败后，首尾空白及 ASCII 大小写变体共享限流，正确口令也不能绕过', async () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      await expectFailure(await request('login'), 401, 'invalidCredentials')
    }
    await expectFailure(await request('login'), 429, 'rateLimited')

    // String.trim() 接受的空白；长前缀确保在原有 key 长度截断之前去除空白。
    const whitespace = [
      ' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u1680',
      ...Array.from({ length: 11 }, (_, index) => String.fromCharCode(0x2000 + index)),
      '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff', ' '.repeat(150)
    ]
    const variants = [username.toLowerCase(), username.toUpperCase(),
      ...whitespace.flatMap(space => [`${space}${username}`, `${username}${space}`, `${space}${username.toUpperCase()}${space}`])]
    for (const variant of variants) {
      await expectFailure(await request('login', variant), 429, 'rateLimited')
      await expectFailure(await request('login', variant, password), 429, 'rateLimited')
    }
  })

  it('轮换空白和大小写写法也只能累计 15 次失败', async () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      const variant = `${' '.repeat(attempt + 1)}${attempt % 2 ? username.toLowerCase() : username.toUpperCase()}\t`
      await expectFailure(await request('login', variant), 401, 'invalidCredentials')
    }
    await expectFailure(await request('login'), 429, 'rateLimited')
  })

  it('不同账号（含内部空格）与注册/登录接口的额度仍相互独立', async () => {
    const names = ['teacher one', 'teacher  one']
    for (const name of names) expect((await request('register', name, password)).status).toBe(200)
    for (let attempt = 0; attempt < 15; attempt++) {
      await expectFailure(await request('login', names[0]), 401, 'invalidCredentials')
    }
    await expectFailure(await request('login', ` ${names[0]} `), 429, 'rateLimited')
    await expectFailure(await request('login', names[1]), 401, 'invalidCredentials')
    expect((await request('login', names[1], password)).status).toBe(200)
    expect((await request('login', username, password)).status).toBe(200)
    await expectFailure(await request('register', names[0], password), 409, 'usernameTaken')
  })

  it('15 分钟窗口过期后，账号变体恢复尝试额度', async () => {
    const started = Date.now()
    for (let attempt = 0; attempt < 15; attempt++) {
      await expectFailure(await request('login'), 401, 'invalidCredentials')
    }
    vi.mocked(Date.now).mockReturnValue(started + 15 * 60000 - 1)
    await expectFailure(await request('login', `\t${username}\t`), 429, 'rateLimited')
    vi.mocked(Date.now).mockReturnValue(started + 15 * 60000 + 1)
    await expectFailure(await request('login', `\u3000${username}\u3000`), 401, 'invalidCredentials')
    const login = await request('login', username, password)
    expect(login.status).toBe(200)
    expect((await login.json()).user.id).toBe(userId)
  })

  it('使用账号变体成功登录会重置同一账号的失败额度', async () => {
    for (let attempt = 0; attempt < 14; attempt++) {
      await expectFailure(await request('login'), 401, 'invalidCredentials')
    }
    const login = await request('login', ` \t${username.toUpperCase()}\u3000`, password)
    expect(login.status).toBe(200)
    expect((await login.json()).user.id).toBe(userId)
    expect(login.headers.get('set-cookie')).toContain('HttpOnly')
    for (let attempt = 0; attempt < 15; attempt++) {
      await expectFailure(await request('login'), 401, 'invalidCredentials')
    }
    await expectFailure(await request('login', ` ${username} `), 429, 'rateLimited')
  })

  it('重复注册的账号变体共享注册额度，同时仍可正常登录', async () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      await expectFailure(await request('register', username, password), 409, 'usernameTaken')
    }
    await expectFailure(await request('register', `\t${username.toUpperCase()}\u00a0`, password), 429, 'rateLimited')
    expect((await request('login', username, password)).status).toBe(200)
  })
})
