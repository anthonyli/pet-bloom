import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api as clientApi } from '../components/use-garden'
import { NextRequest } from 'next/server'
import { GET, POST, PATCH, DELETE } from '../app/api/[...path]/route'
import { database } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { errorMessage } from '../lib/i18n'
import sharp from 'sharp'
import { MAX_ITEM_IMAGE_BYTES } from '../lib/shop'
import type { Snapshot } from '../lib/types'
import { petBackgrounds, holidayBackgroundIds, versionSevenBackgroundIds } from '../lib/pet-backgrounds'

let cookie: string, otherCookie: string, classId: string
const handlers = { GET, POST, PATCH, DELETE }
async function request(path: string, method: keyof typeof handlers = 'GET', data?: unknown, session = cookie, origin = 'http://localhost:3100') {
  const request = new NextRequest(`http://localhost:3100/api/${path}`, {
    method,
    headers: { ...(session ? { Cookie: session } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data)
  })
  return handlers[method](request, { params: Promise.resolve({ path: path.split('?')[0].split('/') }) })
}
const scoringHistory = () => Object.fromEntries(['students', 'evaluations', 'growth_events', 'badges', 'rules', 'settings_versions'].map(table => [table, database().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
async function scoringSnapshot(session = cookie, id = classId): Promise<Snapshot> {
  const response = await request(`state?classId=${id}`, 'GET', undefined, session)
  expect(response.status).toBe(200)
  return response.json()
}
async function scoringStudent(name = '自定义API学生', id = classId, session = cookie) {
  const response = await request('students', 'POST', { classId: id, students: [{ name }] }, session)
  expect(response.status).toBe(200)
  const studentId = (await response.json()).ids[0] as string
  expect((await request(`students/${studentId}/pet`, 'POST', { petId: 'panda' }, session)).status).toBe(200)
  return studentId
}
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 1, 4))
  process.env.DATABASE_PATH = ':memory:'
  const a = await request('auth/register', 'POST', { username: `teacher-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, password: 'Good-password-123' }, '')
  cookie = a.headers.get('set-cookie')!.split(';')[0]
  const b = await request('auth/register', 'POST', { username: `teacher-b-${Math.random().toString(36).slice(2)}`, password: 'Good-password-456' }, '')
  otherCookie = b.headers.get('set-cookie')!.split(';')[0]
  expect((await request('auth/profile', 'PATCH', { displayName: 'API甲老师', subject: '语文', teachingRole: 'homeroom' })).status).toBe(200)
  expect((await request('auth/profile', 'PATCH', { displayName: 'API乙老师', subject: '数学', teachingRole: 'subject' }, otherCookie)).status).toBe(200)
  const response = await request('classes', 'POST', { name: 'API 测试班级' })
  classId = (await response.json()).id
})
afterEach(() => {
  vi.restoreAllMocks()
  database().close()
  delete (globalThis as typeof globalThis & { petGardenDb?: unknown }).petGardenDb
  delete process.env.DATABASE_PATH
})
describe('真实 Route Handler 请求契约', () => {
  it('超限备份返回 413 和可翻译的错误，客户端不会进入下载成功分支', async () => {
    const snapshot = await scoringSnapshot()
    const garden = new Garden(database())
    const rule = { classId, name: { zh: '边界规则', en: 'Boundary rule' }, points: 1, category: 'other' }
    for (let count = snapshot.rules.length; count < 2000; count++) await garden.addRule(snapshot.user.id, rule)
    expect((await request('backup')).status).toBe(200)
    expect((await request('rules', 'POST', rule)).status).toBe(200)
    const response = await request('backup')
    expect(response.status).toBe(413)
    expect(await response.clone().json()).toEqual({ error: 'backupTooLarge' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const download = vi.fn()
    await expect(clientApi('backup').then(download)).rejects.toMatchObject({ code: 'backupTooLarge', status: 413 })
    expect(download).not.toHaveBeenCalled()
    expect(errorMessage('backupTooLarge', 'zh')).toContain('记录数量超过可恢复上限')
    expect(errorMessage('backupTooLarge', 'en')).toContain('record limits for restoring')
    fetchMock.mockRestore()
    expect((await request('backup', 'GET', undefined, otherCookie)).status).toBe(200)
  })
  it.each(['teacher@example.com', 'teacher+class@example.com'])('邮箱用户名 %s 可以注册、登录，不能重复注册', async username => {
    const password = 'Email-password-123'
    const registered = await request('auth/register', 'POST', { username: `  ${username}  `, password }, '')
    expect(registered.status).toBe(200)
    const { user } = await registered.json()
    expect(user.username).toBe(username)
    const session = registered.headers.get('set-cookie')!.split(';')[0]
    expect((await (await request('state', 'GET', undefined, session)).json()).user.id).toBe(user.id)

    const login = await request('auth/login', 'POST', { username: username.toUpperCase(), password }, '')
    expect(login.status).toBe(200)
    expect((await login.json()).user.id).toBe(user.id)
    const wrongPassword = await request('auth/login', 'POST', { username, password: 'Wrong-password-123' }, '')
    expect(wrongPassword.status).toBe(401)
    expect(await wrongPassword.json()).toEqual({ error: 'invalidCredentials' })

    const duplicate = await request('auth/register', 'POST', { username: username.toUpperCase(), password }, '')
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({ error: 'usernameTaken' })
  })
  it.each([
    [{ username: 'ab', password: 'Valid-password-123' }, 'invalidUsername'],
    [{ username: 'a'.repeat(31), password: 'Valid-password-123' }, 'invalidUsername'],
    [{ username: 'teacher/name', password: 'Valid-password-123' }, 'invalidUsername'],
    [{ username: 'teacher\nname', password: 'Valid-password-123' }, 'invalidUsername'],
    [{ username: '   ', password: 'Valid-password-123' }, 'invalidUsername'],
    [{ username: 123, password: 'Valid-password-123' }, 'invalidUsername'],
    [{ password: 'Valid-password-123' }, 'invalidUsername'],
    [{ username: 'invalid-password-test', password: '1234567' }, 'invalidPassword'],
    [{ username: 'invalid-password-test', password: 'a'.repeat(129) }, 'invalidPassword'],
    [{ username: 'invalid-password-test', password: 12345678 }, 'invalidPassword'],
    [{ username: 'invalid-password-test' }, 'invalidPassword']
  ])('注册及登录为无效输入 %j 返回具体字段错误 %s', async (input, error) => {
    const usersBefore = database().prepare('SELECT COUNT(*) AS count FROM users').get()
    for (const path of ['auth/register', 'auth/login']) {
      const response = await request(path, 'POST', input, '')
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error })
      expect(response.headers.get('set-cookie')).toBeNull()
    }
    expect(database().prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual(usersBefore)
  })
  it('会话使用 HttpOnly、SameSite=Lax Cookie', async () => {
    const response = await request('auth/register', 'POST', { username: 'cookie-test', password: 'Good-password-123' }, '')
    const setCookie = response.headers.get('set-cookie')!
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=lax')
    expect((await response.json()).token).toBeUndefined()
  })
  it('未登录返回 401，健康检查公开可访问', async () => {
    expect((await request('state', 'GET', undefined, '')).status).toBe(401)
    expect((await request('health', 'GET', undefined, '')).status).toBe(200)
  })
  it('拒绝跨站写请求', async () => {
    expect((await request('classes', 'POST', { name: 'CSRF' }, cookie, 'https://foreign.example')).status).toBe(403)
  })
  it('数据接口不缓存，另一个账号不能查询、删除班级', async () => {
    const state = await request('state')
    expect(state.headers.get('cache-control')).toBe('no-store')
    expect((await request(`classes/${classId}`, 'DELETE', undefined, otherCookie)).status).toBe(404)
    expect((await request('state', 'GET', undefined, otherCookie)).status).toBe(200)
  })
  it('创建学生、评价、导出与恢复的 HTTP 数据契约一致', async () => {
    const added = await request('students', 'POST', { classId, students: [{ name: 'API 学生', studentNo: '01' }] })
    expect(added.status).toBe(200)
    const studentId = (await added.json()).ids[0]
    expect((await request(`students/${studentId}/pet`, 'POST', { petId: 'panda' })).status).toBe(200)
    const snapshot = await (await request('state')).json()
    expect((await request('evaluations', 'POST', { studentIds: [studentId], ruleId: snapshot.rules[0].id })).status).toBe(200)
    const backup = await (await request('backup')).json()
    expect(backup.students).toHaveLength(1)
    const response = await request('restore', 'POST', backup)
    expect(response.status).toBe(200)
    const imported = await response.json()
    expect(imported.imported).toBe(1)
    expect(imported.classIds).toHaveLength(1)
    const restored = await (await request(`state?classId=${imported.classIds[0]}`)).json()
    expect(restored.classes).toHaveLength(2)
    const original = await (await request(`state?classId=${classId}`)).json()
    expect(original.students[0].id).toBe(studentId)
    expect(restored.students[0].points).toBe(1)
    expect(restored.students[0].id).not.toBe(studentId)
  })
  it.each([
    [Number.MAX_SAFE_INTEGER, undefined, { zh: '自定义加分', en: 'Custom bonus' }],
    [-Number.MAX_SAFE_INTEGER, undefined, { zh: '自定义扣分', en: 'Custom deduction' }],
    [1_000_000, undefined, { zh: '自定义加分', en: 'Custom bonus' }],
    [-1_000_000, undefined, { zh: '自定义扣分', en: 'Custom deduction' }],
    [1000, undefined, { zh: '自定义加分', en: 'Custom bonus' }],
    [-1000, undefined, { zh: '自定义扣分', en: 'Custom deduction' }],
    [101, undefined, { zh: '自定义加分', en: 'Custom bonus' }],
    [-101, undefined, { zh: '自定义扣分', en: 'Custom deduction' }],
    [100, undefined, { zh: '自定义加分', en: 'Custom bonus' }],
    [-100, undefined, { zh: '自定义扣分', en: 'Custom deduction' }],
    [1, undefined, { zh: '自定义加分', en: 'Custom bonus' }],
    [-1, undefined, { zh: '自定义扣分', en: 'Custom deduction' }],
    [3, ' \t\n ', { zh: '自定义加分', en: 'Custom bonus' }],
    [-3, '', { zh: '自定义扣分', en: 'Custom deduction' }],
    [3, '  主动协助课堂  ', { zh: '主动协助课堂', en: '主动协助课堂' }],
    [-3, '  Stay focused  ', { zh: 'Stay focused', en: 'Stay focused' }],
    [1, `  ${'中'.repeat(80)}  `, { zh: '中'.repeat(80), en: '中'.repeat(80) }],
    [-1, `  ${'a'.repeat(80)}  `, { zh: 'a'.repeat(80), en: 'a'.repeat(80) }]
  ])('POST自定义%s分与原因%j保存稳定双语契约而不新建规则', async (points, reason, expected) => {
    const studentId = await scoringStudent(), before = await scoringSnapshot(), rules = database().prepare('SELECT * FROM rules ORDER BY id').all(), version = database().pragma('user_version', { simple: true })
    const response = await request('evaluations', 'POST', { studentIds: [studentId], custom: { points, ...(reason === undefined ? {} : { reason }) } })
    expect(response.status).toBe(200)
    const batch = await response.json()
    expect(batch.batchId).toBeTypeOf('string')
    const after = await scoringSnapshot()
    expect(after.records.find(row => row.batch_id === batch.batchId)).toMatchObject({ points, reason: expected, category: 'other', actor_user_id: before.user.id, actor_name: 'API甲老师', actor_subject: '语文' })
    expect(after.students[0]).toMatchObject({ points, pet_exp: Math.max(0, points as number) })
    expect(after.rules).toEqual(before.rules)
    expect(database().prepare('SELECT * FROM rules ORDER BY id').all()).toEqual(rules)
    expect((await request(`evaluations/${batch.batchId}/undo`, 'POST', {})).status).toBe(200)
    const undone = await scoringSnapshot()
    expect(undone.students[0]).toMatchObject({ points: 0, pet_exp: 0, badge_count: 0 })
    expect(undone.records.find(row => row.batch_id === batch.batchId)).toMatchObject({ points, reason: expected, undone: 1 })
    expect(database().prepare('SELECT * FROM rules ORDER BY id').all()).toEqual(rules)
    expect(database().pragma('user_version', { simple: true })).toBe(version)
  })
  it.each([
    ['零分', { custom: { points: 0 } }],
    ['正小数', { custom: { points: 1.5 } }],
    ['负小数', { custom: { points: -1.5 } }],
    ['正不安全整数', { custom: { points: Number.MAX_SAFE_INTEGER + 1 } }],
    ['负不安全整数', { custom: { points: Number.MIN_SAFE_INTEGER - 1 } }],
    ['缺少分数', { custom: {} }],
    ['字符串分数', { custom: { points: '3' } }],
    ['空分数', { custom: { points: null } }],
    ['中文81字', { custom: { points: 3, reason: '中'.repeat(81) } }],
    ['英文81字', { custom: { points: -3, reason: 'a'.repeat(81) } }],
    ['空自定义', { custom: null }],
    ['空学生列表', { studentIds: [], custom: { points: 3 } }],
    ['两种评分均未传', {}],
    ['同时传规则和自定义', { custom: { points: 3 }, ruleId: 'existing-rule' }]
  ])('POST非法自定义评分%s返回400/invalidEvaluation且不写入', async (_, input) => {
    const studentId = await scoringStudent(), state = await scoringSnapshot(), before = scoringHistory()
    const response = await request('evaluations', 'POST', { studentIds: [studentId], ...input, ...('ruleId' in input ? { ruleId: state.rules[0].id } : {}) })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalidEvaluation' })
    expect(scoringHistory()).toEqual(before)
  })
  it.each([-1, 1])('POST累计积分抵达%s方向安全边界后额外一分返回409/scoreLimitExceeded且无写入', async direction => {
    const studentId = await scoringStudent(), points = direction * Number.MAX_SAFE_INTEGER
    expect((await request('evaluations', 'POST', { studentIds: [studentId], custom: { points } })).status).toBe(200)
    expect((await scoringSnapshot()).students[0]).toMatchObject({ points, pet_exp: Math.max(0, points) })
    const before = scoringHistory(), response = await request('evaluations', 'POST', { studentIds: [studentId], custom: { points: direction } })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'scoreLimitExceeded' })
    expect(scoringHistory()).toEqual(before)
  })
  it('POST批量后一位积分溢出时返回409，前一位已评分、升级和全部历史一起回滚', async () => {
    const first = await scoringStudent('先评分学生'), second = await scoringStudent('积分边界学生')
    expect((await request('evaluations', 'POST', { studentIds: [first], custom: { points: 39 } })).status).toBe(200)
    expect((await request('evaluations', 'POST', { studentIds: [second], custom: { points: Number.MAX_SAFE_INTEGER } })).status).toBe(200)
    const before = scoringHistory(), response = await request('evaluations', 'POST', { studentIds: [first, second], custom: { points: 1 } })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'scoreLimitExceeded' })
    expect(scoringHistory()).toEqual(before)
  })
  it('POST累计积分仍安全但截零成长达到安全边界后额外一分返回409，全部状态不变', async () => {
    const studentId = await scoringStudent()
    expect((await scoringSnapshot()).settings.value.signedGrowth).toBe(false)
    for (const points of [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) expect((await request('evaluations', 'POST', { studentIds: [studentId], custom: { points } })).status).toBe(200)
    expect((await scoringSnapshot()).students[0]).toMatchObject({ points: 0, pet_exp: Number.MAX_SAFE_INTEGER })
    const before = scoringHistory(), response = await request('evaluations', 'POST', { studentIds: [studentId], custom: { points: 1 } })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'scoreLimitExceeded' })
    expect(scoringHistory()).toEqual(before)
  })
  it('大额自定义API批量去重、同班与成员鉴权保留整批事务及撤回', async () => {
    const first = await scoringStudent('第一位'), second = await scoringStudent('第二位')
    const ownClass = (await (await request('classes', 'POST', { name: '同教师另一班' })).json()).id
    const ownStudent = await scoringStudent('另一班学生', ownClass)
    const foreignClass = (await (await request('classes', 'POST', { name: '其他教师班级' }, otherCookie)).json()).id
    const foreignStudent = await scoringStudent('无权学生', foreignClass, otherCookie), before = scoringHistory()
    for (const [ids, expectedStatus] of [[[first, ownStudent], 400], [[first, foreignStudent], 404]] as const) {
      const rejected = await request('evaluations', 'POST', { studentIds: ids, custom: { points: 1_000_000 } })
      expect(rejected.status).toBe(expectedStatus)
      expect(scoringHistory()).toEqual(before)
    }
    expect((await request('evaluations', 'POST', { studentIds: [first], custom: { points: 1_000_000 } }, otherCookie)).status).toBe(404)
    expect(scoringHistory()).toEqual(before)
    const response = await request('evaluations', 'POST', { studentIds: [first, first, second], custom: { points: 1_000_000, reason: '同批进步' } })
    expect(response.status).toBe(200)
    const { batchId } = await response.json(), scored = await scoringSnapshot()
    expect(scored.records.filter(row => row.batch_id === batchId)).toHaveLength(2)
    expect(database().prepare("SELECT COUNT(*) AS n FROM growth_events WHERE kind = 'evaluation'").get()).toEqual({ n: 2 })
    expect(scored.students.every(row => row.points === 1_000_000 && row.pet_exp === 1_000_000 && row.badge_count === 7)).toBe(true)
    expect((await request(`evaluations/${batchId}/undo`, 'POST', {})).status).toBe(200)
    const undone = await scoringSnapshot()
    expect(undone.students.every(row => row.points === 0 && row.pet_exp === 0 && row.badge_count === 0)).toBe(true)
    expect(undone.records.filter(row => row.batch_id === batchId).every(row => row.undone === 1 && row.undone_by_user_id === undone.user.id && row.undone_by_name === 'API甲老师')).toBe(true)
  })
  it.each([-Number.MAX_SAFE_INTEGER, -1_000_000, 1_000_000, Number.MAX_SAFE_INTEGER])('HTTP v6备份往返保留%s分与原因署名，副本新ID撤回不影响原班', async points => {
    const studentId = await scoringStudent(), reason = points > 0 ? '大额课堂奖励' : '大额课堂扣分'
    const response = await request('evaluations', 'POST', { studentIds: [studentId], custom: { points, reason } })
    expect(response.status).toBe(200)
    const { batchId } = await response.json(), original = await scoringSnapshot()
    const backupResponse = await request('backup')
    expect(backupResponse.status).toBe(200)
    const backup = await backupResponse.json()
    expect(backup.version).toBe(8)
    expect(backup.evaluations).toMatchObject([{ points, actor_name: 'API甲老师', actor_subject: '语文' }])
    const restoreResponse = await request('restore', 'POST', backup)
    expect(restoreResponse.status).toBe(200)
    const restored = await restoreResponse.json()
    expect(restored.classIds).toHaveLength(1)
    const copyId = restored.classIds[0], copy = await scoringSnapshot(cookie, copyId)
    expect(copyId).not.toBe(classId)
    expect(copy.students).toHaveLength(1)
    expect(copy.students[0].id).not.toBe(studentId)
    expect(copy.students[0]).toMatchObject({ points, pet_exp: Math.max(0, points) })
    expect(copy.records).toHaveLength(1)
    expect(copy.records[0]).toMatchObject({ student_id: copy.students[0].id, points, reason: { zh: reason, en: reason }, actor_user_id: null, actor_name: 'API甲老师', actor_subject: '语文', undone: 0 })
    expect(copy.records[0].id).not.toBe(original.records[0].id)
    expect(copy.records[0].batch_id).not.toBe(batchId)
    expect((await request(`evaluations/${copy.records[0].batch_id}/undo`, 'POST', {})).status).toBe(200)
    expect((await scoringSnapshot(cookie, copyId)).students[0]).toMatchObject({ points: 0, pet_exp: 0, badge_count: 0 })
    expect(await scoringSnapshot()).toMatchObject({ students: original.students, records: original.records, badges: original.badges, rules: original.rules })
  })
  it('更换宠物保留成长数据，拒绝越权和无效宠物', async () => {
    const added = await request('students', 'POST', { classId, students: [{ name: '换宠学生' }] })
    const studentId = (await added.json()).ids[0]
    const path = `students/${studentId}/pet`
    expect((await request(path, 'POST', { petId: 'panda' })).status).toBe(200)
    const initial = await (await request('state')).json()
    await request('evaluations', 'POST', { studentIds: [studentId], ruleId: initial.rules[0].id })
    const before = (await (await request('state')).json()).students[0]
    expect((await request(path, 'PATCH', { petId: 'westie' }, otherCookie)).status).toBe(404)
    expect((await request(path, 'PATCH', { petId: 'invalid' })).status).toBe(400)
    expect((await request(path, 'PATCH', { petId: 'westie' }, '')).status).toBe(401)
    expect((await request(path, 'PATCH', { petId: 'westie' }, cookie, 'https://foreign.example')).status).toBe(403)
    expect((await request(path, 'PATCH', { petId: 'westie' })).status).toBe(200)
    const after = (await (await request('state')).json()).students[0]
    expect(after).toEqual({ ...before, pet_id: 'westie' })
  })
  it.each(['zodiac-rat', 'zodiac-ox', 'zodiac-snake'])('新生肖 %s 可以通过正式 API 领养', async (petId) => {
    const added = await request('students', 'POST', { classId, students: [{ name: '生肖验收学生' }] })
    expect(added.status).toBe(200)
    const studentId = (await added.json()).ids[0]
    expect((await request(`students/${studentId}/pet`, 'POST', { petId })).status).toBe(200)
    const snapshot = await (await request('state')).json()
    expect(snapshot.students.find((student: { id: string }) => student.id === studentId).pet_id).toBe(petId)
  })
  it('商品创建、编辑和软删除的HTTP契约保留双语内容与库存', async () => {
    const input = { name: { zh: '画册', en: 'Sketchbook' }, description: { zh: '用于课堂绘画', en: 'For classroom drawing' }, category: 'stationery', icon: 'book', stock: 3, cost: 2 }
    const created = await request('items', 'POST', { classId, ...input })
    expect(created.status).toBe(200)
    const itemId = (await created.json()).id
    let state = await (await request('state')).json()
    expect(state.items.find((item: { id: string }) => item.id === itemId)).toMatchObject({ ...input, image: null })
    expect((await request(`items/${itemId}`, 'PATCH', { ...input, stock: 5, cost: 3 })).status).toBe(200)
    state = await (await request('state')).json()
    expect(state.items.find((item: { id: string }) => item.id === itemId)).toMatchObject({ stock: 5, cost: 3 })
    expect((await request(`items/${itemId}`, 'DELETE')).status).toBe(200)
    state = await (await request('state')).json()
    expect(state.items.some((item: { id: string }) => item.id === itemId)).toBe(false)
    expect((await request(`items/${itemId}`, 'PATCH', input)).status).toBe(404)
    const backup = await (await request('backup')).json()
    expect(backup.items.find((item: { id: string }) => item.id === itemId).active).toBe(0)
  })
  it('商品图片只通过私有认证接口返回，不混入每次状态刷新', async () => {
    const png = await sharp({ create: { width: 600, height: 400, channels: 4, background: '#6d4aff' } }).png().toBuffer()
    const created = await request('items', 'POST', { classId, name: { zh: '图片商品', en: 'Image reward' }, cost: 1, image: `data:image/png;base64,${png.toString('base64')}` })
    expect(created.status).toBe(200)
    const itemId = (await created.json()).id
    const state = await (await request('state')).json()
    expect(state.items.find((item: { id: string }) => item.id === itemId).image).toMatch(new RegExp(`^/api/items/${itemId}/image\\?v=[a-f0-9]{64}$`))
    expect(JSON.stringify(state)).not.toContain('data:image/')
    const image = await request(`items/${itemId}/image`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/webp')
    expect(image.headers.get('cache-control')).toBe('private, no-store')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata()
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(512)
    expect((await request(`items/${itemId}/image`, 'GET', undefined, otherCookie)).status).toBe(404)
    expect((await request(`items/${itemId}/image`, 'GET', undefined, '')).status).toBe(401)
    expect((await request(`items/${itemId}`, 'PATCH', { name: { zh: '图片商品', en: 'Image reward' }, cost: 1, image: null })).status).toBe(200)
    expect((await request(`items/${itemId}/image`)).status).toBe(404)
  })
  it('商品接口拒绝越权、未登录与跨站写请求', async () => {
    const input = { name: { zh: '权限商品', en: 'Private reward' }, cost: 1 }
    const created = await request('items', 'POST', { classId, ...input })
    const itemId = (await created.json()).id
    expect((await request(`items/${itemId}`, 'PATCH', input, otherCookie)).status).toBe(404)
    expect((await request(`items/${itemId}`, 'DELETE', undefined, otherCookie)).status).toBe(404)
    expect((await request('items', 'POST', { classId, ...input }, '')).status).toBe(401)
    expect((await request(`items/${itemId}`, 'PATCH', input, '')).status).toBe(401)
    expect((await request('items', 'POST', { classId, ...input }, cookie, 'https://foreign.example')).status).toBe(403)
    expect((await request(`items/${itemId}`, 'PATCH', input, cookie, 'https://foreign.example')).status).toBe(403)
    const foreign = await (await request('state', 'GET', undefined, otherCookie)).json()
    expect(foreign.items.some((item: { id: string }) => item.id === itemId)).toBe(false)
  })
  it('无效商品字段、损坏图片和超大图片返回稳定错误码', async () => {
    const input = { name: { zh: '校验商品', en: 'Validated reward' }, cost: 1 }
    for (const extra of [{ cost: 0 }, { stock: -2 }, { icon: 'invalid' }, { category: 'invalid' }]) {
      const invalid = await request('items', 'POST', { classId, ...input, ...extra })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({ error: 'invalidInput' })
    }
    for (const image of ['data:image/png;base64,YQ==', 'data:image/svg+xml;base64,PHN2Zy8+', 'https://foreign.example/image.png']) {
      const invalid = await request('items', 'POST', { classId, ...input, image })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({ error: 'invalidImage' })
    }
    const oversized = await request('items', 'POST', { classId, ...input, image: `data:image/png;base64,${Buffer.alloc(MAX_ITEM_IMAGE_BYTES + 1).toString('base64')}` })
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toEqual({ error: 'imageTooLarge' })
  })
  it('正式兑换接口原子扣库存，退款恢复库存和学生徽章', async () => {
    const added = await request('students', 'POST', { classId, students: [{ name: '兑换学生' }] })
    const studentId = (await added.json()).ids[0]
    await request(`students/${studentId}/pet`, 'POST', { petId: 'panda' })
    expect((await request('rules', 'POST', { classId, name: { zh: '升级奖励', en: 'Level reward' }, points: 40, category: 'other' })).status).toBe(200)
    const initial = await (await request('state')).json()
    const ruleId = initial.rules.at(-1).id
    await request('evaluations', 'POST', { studentIds: [studentId], ruleId })
    const created = await request('items', 'POST', { classId, name: { zh: '最后一件', en: 'Last reward' }, cost: 1, stock: 1 })
    const itemId = (await created.json()).id
    expect((await request('redemptions', 'POST', { studentId, itemId })).status).toBe(200)
    const sold = await (await request('state')).json()
    expect(sold.items.find((item: { id: string }) => item.id === itemId).stock).toBe(0)
    expect(sold.students.find((student: { id: string }) => student.id === studentId).spent_badges).toBe(1)
    const repeated = await request('redemptions', 'POST', { studentId, itemId })
    expect(repeated.status).toBe(409)
    expect(await repeated.json()).toEqual({ error: 'outOfStock' })
    const redemptionId = sold.redemptions[0].id
    expect((await request(`redemptions/${redemptionId}/undo`, 'POST', {}, otherCookie)).status).toBe(404)
    expect((await request(`redemptions/${redemptionId}/undo`, 'POST', {})).status).toBe(200)
    expect((await request(`redemptions/${redemptionId}/undo`, 'POST', {})).status).toBe(404)
    const restored = await (await request('state')).json()
    expect(restored.items.find((item: { id: string }) => item.id === itemId).stock).toBe(1)
    expect(restored.students.find((student: { id: string }) => student.id === studentId).spent_badges).toBe(0)
  })
  it('节日背景PATCH零徽章免费，状态返回学校日期权限和临时截止，不写永久兑换', async () => {
    vi.mocked(Date.now).mockReturnValue(Date.UTC(2026, 9, 1, 4))
    const studentId = await scoringStudent(), before = await scoringSnapshot(), path = `students/${studentId}/background`
    expect(before.festival_backgrounds).toMatchObject({ server_now: Date.UTC(2026, 9, 1, 4), valid_until: Date.UTC(2026, 9, 1, 16), time_zone: 'Asia/Shanghai' })
    const records = database().prepare('SELECT * FROM redemptions ORDER BY rowid').all()
    expect((await request(path, 'PATCH', { backgroundId: 'national-day', cost: 0 })).status).toBe(200)
    expect((await scoringSnapshot()).students[0]).toMatchObject({ background_id: null, festival_background_id: 'national-day', festival_background_expires_at: Date.UTC(2026, 9, 1, 16), owned_background_ids: [], badge_count: 0, spent_badges: 0 })
    expect(database().prepare('SELECT * FROM redemptions ORDER BY rowid').all()).toEqual(records)
    const item = before.items.find(row => row.background_id === 'national-day')!
    const purchase = await request('redemptions', 'POST', { studentId, itemId: item.id })
    expect(purchase.status).toBe(409)
    expect(await purchase.json()).toEqual({ error: 'insufficientBadges' })
    expect((await scoringSnapshot()).items).toEqual(before.items)
  })
  it('节日背景API仍检查认证、CSRF和归属，不信任客户端伪造日期与免费权限', async () => {
    const studentId = await scoringStudent(), path = `students/${studentId}/background`, input = { backgroundId: 'national-day', free: true, date: '2026-10-01', timeZone: 'Asia/Shanghai', festival_background_expires_at: Number.MAX_SAFE_INTEGER }
    const ordinary = await request(path, 'PATCH', input)
    expect(ordinary.status).toBe(409)
    expect(await ordinary.json()).toEqual({ error: 'backgroundNotOwned' })
    vi.mocked(Date.now).mockReturnValue(Date.UTC(2026, 9, 1, 4))
    expect((await request(path, 'PATCH', input, '')).status).toBe(401)
    expect((await request(path, 'PATCH', input, cookie, 'https://foreign.example')).status).toBe(403)
    expect((await request(path, 'PATCH', { ...input, classId }, otherCookie)).status).toBe(404)
    expect((await scoringSnapshot()).students[0]).toMatchObject({ festival_background_id: null, owned_background_ids: [], spent_badges: 0 })
  })
  it('跨学校午夜免费背景快照失效，迟到PATCH返回409且不会自动扣章', async () => {
    vi.mocked(Date.now).mockReturnValue(Date.UTC(2026, 9, 1, 15, 59))
    const studentId = await scoringStudent(), path = `students/${studentId}/background`
    expect((await request(path, 'PATCH', { backgroundId: 'national-day' })).status).toBe(200)
    vi.mocked(Date.now).mockReturnValue(Date.UTC(2026, 9, 1, 16))
    const late = await request(path, 'PATCH', { backgroundId: 'national-day', server_now: Date.UTC(2026, 9, 1, 15, 59), free: true })
    expect(late.status).toBe(409)
    expect(await late.json()).toEqual({ error: 'backgroundNotOwned' })
    const snapshot = await scoringSnapshot()
    expect(snapshot.students[0]).toMatchObject({ background_id: null, festival_background_id: null, festival_background_expires_at: null, owned_background_ids: [], spent_badges: 0 })
    expect(snapshot.redemptions).toHaveLength(0)
    expect(snapshot.festival_backgrounds.backgrounds.some(row => row.background_id === 'national-day')).toBe(false)
  })
  it('背景正式API兑换解锁→装扮→恢复默认→退款→重兑，状态和错误码保持一致', async () => {
    const studentId = await scoringStudent()
    expect((await request('evaluations', 'POST', { studentIds: [studentId], custom: { points: 700 } })).status).toBe(200)
    const initial = await scoringSnapshot(), item = initial.items.find(row => row.background_id === 'garden')!, path = `students/${studentId}/background`
    expect(initial.students[0]).toMatchObject({ background_id: null, owned_background_ids: [] })
    expect((await request('redemptions', 'POST', { studentId, itemId: item.id, actor_user_id: 'forged', background_id: 'beach' })).status).toBe(200)
    const unlocked = await scoringSnapshot()
    expect(unlocked.students[0]).toMatchObject({ background_id: null, owned_background_ids: ['garden'], spent_badges: 1 })
    expect(unlocked.redemptions[0]).toMatchObject({ background_id: 'garden', actor_user_id: initial.user.id, actor_name: 'API甲老师' })
    const repeated = await request('redemptions', 'POST', { studentId, itemId: item.id })
    expect(repeated.status).toBe(409)
    expect(await repeated.json()).toEqual({ error: 'backgroundAlreadyOwned' })
    expect((await request(path, 'PATCH', { backgroundId: 'garden' })).status).toBe(200)
    expect((await scoringSnapshot()).students[0]).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 1 })
    expect((await request(path, 'PATCH', { backgroundId: null })).status).toBe(200)
    expect((await scoringSnapshot()).students[0]).toMatchObject({ background_id: null, owned_background_ids: ['garden'], spent_badges: 1 })
    expect((await request(path, 'PATCH', { backgroundId: 'garden' })).status).toBe(200)
    const redemptionId = unlocked.redemptions[0].id
    expect((await request(`redemptions/${redemptionId}/undo`, 'POST', {})).status).toBe(200)
    expect((await scoringSnapshot()).students[0]).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    const notOwned = await request(path, 'PATCH', { backgroundId: 'garden' })
    expect(notOwned.status).toBe(409)
    expect(await notOwned.json()).toEqual({ error: 'backgroundNotOwned' })
    expect((await request(`redemptions/${redemptionId}/undo`, 'POST', {})).status).toBe(404)
    expect((await request('redemptions', 'POST', { studentId, itemId: item.id })).status).toBe(200)
    expect((await request(path, 'PATCH', { backgroundId: 'garden' })).status).toBe(200)
    expect((await scoringSnapshot()).students[0].owned_background_ids).toEqual(['garden'])
  })
  it.each([{ backgroundId: 'unknown' }, { backgroundId: '../../secret' }, { backgroundId: '' }, { backgroundId: 1 }, { backgroundId: false }, {}, null])('背景PATCH非法输入%j返回400/invalidBackground且状态不变', async input => {
    const studentId = await scoringStudent(), before = await scoringSnapshot()
    const response = await request(`students/${studentId}/background`, 'PATCH', input)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalidBackground' })
    expect(await scoringSnapshot()).toEqual(before)
  })
  it('背景PATCH保留认证/同源/学生归属检查，徽章不足兑换不解锁且null可免费恢复', async () => {
    const studentId = await scoringStudent(), initial = await scoringSnapshot(), item = initial.items.find(row => row.background_id === 'garden')!, path = `students/${studentId}/background`
    const insufficient = await request('redemptions', 'POST', { studentId, itemId: item.id })
    expect(insufficient.status).toBe(409)
    expect(await insufficient.json()).toEqual({ error: 'insufficientBadges' })
    expect((await request(path, 'PATCH', { backgroundId: 'garden' }, '')).status).toBe(401)
    expect((await request(path, 'PATCH', { backgroundId: null }, cookie, 'https://foreign.example')).status).toBe(403)
    expect((await request(path, 'PATCH', { backgroundId: null, actor_user_id: initial.user.id, classId }, otherCookie)).status).toBe(404)
    expect((await request('students/missing/background', 'PATCH', { backgroundId: null })).status).toBe(404)
    const notOwned = await request(path, 'PATCH', { backgroundId: 'garden', owned_background_ids: ['garden'] })
    expect(notOwned.status).toBe(409)
    expect(await notOwned.json()).toEqual({ error: 'backgroundNotOwned' })
    expect(await scoringSnapshot()).toEqual(initial)
    expect((await request(path, 'PATCH', { backgroundId: null })).status).toBe(200)
    expect(await scoringSnapshot()).toEqual(initial)
  })
  it('协作背景API不能伪造退款权限，移除成员后不能装扮、兑换或退本人历史', async () => {
    const code = (await (await request(`classes/${classId}/invitations`, 'POST', {})).json()).code
    expect((await request('invitations/join', 'POST', { code }, otherCookie)).status).toBe(200)
    const studentId = await scoringStudent()
    expect((await request('evaluations', 'POST', { studentIds: [studentId], custom: { points: 700 } })).status).toBe(200)
    const initial = await scoringSnapshot(), gardenItem = initial.items.find(row => row.background_id === 'garden')!, beach = initial.items.find(row => row.background_id === 'beach')!
    expect((await request('redemptions', 'POST', { studentId, itemId: gardenItem.id })).status).toBe(200)
    const ownedByOwner = (await scoringSnapshot()).redemptions[0]
    const forbidden = await request(`redemptions/${ownedByOwner.id}/undo`, 'POST', { actor_user_id: initial.user.id, role: 'owner' }, otherCookie)
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ error: 'operationNotOwned' })
    expect((await request('redemptions', 'POST', { studentId, itemId: beach.id, actor_user_id: initial.user.id, actor_name: '伪造教师' }, otherCookie)).status).toBe(200)
    const state = await scoringSnapshot(), ownRedemption = state.redemptions.find(row => row.background_id === 'beach')!
    expect(ownRedemption).toMatchObject({ actor_name: 'API乙老师', actor_subject: '数学' })
    expect(ownRedemption.actor_user_id).not.toBe(initial.user.id)
    expect((await request(`students/${studentId}/background`, 'PATCH', { backgroundId: 'beach' }, otherCookie)).status).toBe(200)
    const before = await scoringSnapshot()
    expect((await request(`classes/${classId}/members/${ownRedemption.actor_user_id}`, 'DELETE')).status).toBe(200)
    expect((await request(`students/${studentId}/background`, 'PATCH', { backgroundId: null }, otherCookie)).status).toBe(404)
    expect((await request('redemptions', 'POST', { studentId, itemId: gardenItem.id }, otherCookie)).status).toBe(404)
    expect((await request(`redemptions/${ownRedemption.id}/undo`, 'POST', {}, otherCookie)).status).toBe(404)
    expect(await scoringSnapshot()).toEqual(before)
    expect((await request(`redemptions/${ownRedemption.id}/undo`, 'POST', {})).status).toBe(200)
    expect((await scoringSnapshot()).students[0]).toMatchObject({ background_id: null, owned_background_ids: ['garden'], spent_badges: 1 })
  })
  it('背景API同一负责人的跨班商品也返回404，不能借用另一学生持有装扮', async () => {
    const studentId = await scoringStudent()
    const ownClass = (await (await request('classes', 'POST', { name: '背景独立班' })).json()).id
    const otherStudent = await scoringStudent('另班背景学生', ownClass)
    expect((await request('evaluations', 'POST', { studentIds: [otherStudent], custom: { points: 700 } })).status).toBe(200)
    const otherState = await scoringSnapshot(cookie, ownClass), item = otherState.items.find(row => row.background_id === 'garden')!
    expect((await request('redemptions', 'POST', { studentId: otherStudent, itemId: item.id })).status).toBe(200)
    const initial = await scoringSnapshot(), response = await request('redemptions', 'POST', { studentId, itemId: item.id })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'notFound' })
    const notOwned = await request(`students/${studentId}/background`, 'PATCH', { backgroundId: 'garden', studentId: otherStudent, classId: ownClass })
    expect(notOwned.status).toBe(409)
    expect(await notOwned.json()).toEqual({ error: 'backgroundNotOwned' })
    expect(await scoringSnapshot()).toEqual(initial)
  })
  it.each([
    ...(['chinese', 'global'] as const).map(category => ({ category, backgroundId: petBackgrounds.find(background => background.category === category)!.id })),
    ...versionSevenBackgroundIds.map(backgroundId => ({ category: 'chinese' as const, backgroundId }))
  ])('$backgroundId节日背景正式HTTP兑换、装扮、v7备份新副本及退款，目录分组不污染商品分类', async ({ category, backgroundId }) => {
    const studentId = await scoringStudent(), catalog = petBackgrounds.find(background => background.id === backgroundId)!
    expect(new Set<string>([...holidayBackgroundIds, ...versionSevenBackgroundIds]).has(catalog.id)).toBe(true)
    expect(catalog.category).toBe(category)
    expect((await request('evaluations', 'POST', { studentIds: [studentId], custom: { points: 700 } })).status).toBe(200)
    const initial = await scoringSnapshot(), item = initial.items.find(row => row.background_id === catalog.id)!
    expect(item).toMatchObject({ background_id: catalog.id, category: 'other', cost: 1, stock: -1, image: null })
    expect((await request(`items/${item.id}`, 'PATCH', { cost: 2, category, stock: 0, background_id: 'garden' })).status).toBe(200)
    expect((await scoringSnapshot()).items.find(row => row.id === item.id)).toMatchObject({ background_id: catalog.id, category: 'other', cost: 2, stock: -1, image: null })
    expect((await request('redemptions', 'POST', { studentId, itemId: item.id })).status).toBe(200)
    expect((await request(`students/${studentId}/background`, 'PATCH', { backgroundId: catalog.id })).status).toBe(200)
    const original = await scoringSnapshot()
    expect(original.students[0]).toMatchObject({ background_id: catalog.id, owned_background_ids: [catalog.id], spent_badges: 2 })
    const backup = await (await request('backup')).json()
    expect(backup.version).toBe(8)
    expect(backup.redemptions[0]).toMatchObject({ background_id: catalog.id, cost: 2 })
    expect(JSON.stringify(backup)).not.toContain('owned_background_ids')
    const restoreResponse = await request('restore', 'POST', backup)
    expect(restoreResponse.status).toBe(200)
    const restored = await restoreResponse.json(), copy = await scoringSnapshot(cookie, restored.classIds[0])
    expect(copy.students[0]).toMatchObject({ background_id: catalog.id, owned_background_ids: [catalog.id], spent_badges: 2 })
    expect(copy.students[0].id).not.toBe(studentId)
    expect((await request(`redemptions/${copy.redemptions[0].id}/undo`, 'POST', {})).status).toBe(200)
    expect((await scoringSnapshot(cookie, restored.classIds[0])).students[0]).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    expect(await scoringSnapshot()).toEqual({ ...original, classes: (await scoringSnapshot()).classes })
  })
  it('设置接口认证、隔离、版本冲突和换宠限制实际生效', async () => {
    expect((await request(`settings?classId=${classId}`, 'GET', undefined, '')).status).toBe(401)
    const response = await request(`settings?classId=${classId}`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const settings = await response.json()
    settings.value.allowChangePet = false
    settings.value.growth[0] = { experience: 10, badges: 5 }
    expect((await request('settings', 'PATCH', { classId, ...settings }, cookie, 'https://foreign.example')).status).toBe(403)
    expect((await request('settings', 'PATCH', { classId, ...settings })).status).toBe(200)
    expect((await request('settings', 'PATCH', { classId, ...settings })).status).toBe(409)
    expect((await request(`settings?classId=${classId}`, 'GET', undefined, otherCookie)).status).toBe(404)
    const otherClass = (await (await request('classes', 'POST', { name: '独立API配置班' }, otherCookie)).json()).id
    expect((await (await request(`settings?classId=${otherClass}`, 'GET', undefined, otherCookie)).json()).value.allowChangePet).toBe(true)
    const studentId = (await (await request('students', 'POST', { classId, students: [{ name: '设置学生' }] })).json()).ids[0]
    expect((await request(`students/${studentId}/pet`, 'POST', { petId: 'panda' })).status).toBe(200)
    const changed = await request(`students/${studentId}/pet`, 'PATCH', { petId: 'westie' })
    expect(changed.status).toBe(409)
    expect(await changed.json()).toEqual({ error: 'petChangeDisabled' })
    const state = await (await request('state')).json()
    expect(state.settings.value.growth[0]).toEqual({ experience: 10, badges: 5 })
    expect(state.students[0].status.form).toBe('normal')
  })
  it('规则、商品及设置必须显式提供班级，不能回退到账号模板', async () => {
    const current = await (await request(`settings?classId=${classId}`)).json()
    for (const [path, method, body] of [
      ['settings', 'GET', undefined],
      ['settings', 'PATCH', { version: current.version, value: current.value }],
      ['rules', 'POST', { name: { zh: '无班级', en: 'Missing class' }, points: 1, category: 'other' }],
      ['items', 'POST', { name: { zh: '无班级', en: 'Missing class' }, cost: 1 }]
    ] as const) {
      const response = await request(path, method, body)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalidInput' })
    }
    expect((await (await request('state')).json()).rules).toHaveLength(83)
    const state = await scoringSnapshot()
    expect(state.items.filter(item => item.background_id === null)).toHaveLength(3)
    expect(state.items.filter(item => item.background_id !== null)).toHaveLength(41)
  })
  it('资料未完善只开放state/profile/logout，保存真实资料后才能创建和加入班级', async () => {
    const registered = await request('auth/register', 'POST', { username: 'profile-gate-test', password: 'Profile-password-123' }, '')
    const session = registered.headers.get('set-cookie')!.split(';')[0]
    const initial = await registered.json()
    expect(initial.user.profile_complete).toBe(false)
    const state = await request('state', 'GET', undefined, session)
    expect(state.status).toBe(200)
    expect((await state.json()).classes).toEqual([])
    expect((await request('auth/profile', 'GET', undefined, session)).status).toBe(200)
    const invite = await (await request(`classes/${classId}/invitations`, 'POST', {})).json()
    for (const [path, method, body] of [
      ['classes', 'POST', { name: '未完善班级' }],
      [`classes/${classId}/teachers`, 'GET', undefined],
      ['invitations/preview', 'POST', { code: invite.code }],
      ['invitations/join', 'POST', { code: invite.code }],
      ['backup', 'GET', undefined]
    ] as const) {
      const response = await request(path, method, body, session)
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'profileRequired' })
    }
    expect((await request('auth/profile', 'PATCH', { displayName: '新教师', subject: '', teachingRole: 'subject' }, session)).status).toBe(400)
    expect((await request('auth/profile', 'PATCH', { displayName: '新教师', subject: '科学', teachingRole: 'owner' }, session)).status).toBe(400)
    expect((await request('auth/profile', 'PATCH', { displayName: '新教师', subject: '科学', teachingRole: 'homeroom', role: 'owner', owner_id: initial.user.id }, session)).status).toBe(200)
    expect((await request('invitations/join', 'POST', { code: invite.code }, session)).status).toBe(200)
    const joined = await (await request(`state?classId=${classId}`, 'GET', undefined, session)).json()
    expect(joined.user).toMatchObject({ id: initial.user.id, display_name: '新教师', profile_complete: true })
    expect(joined.classes).toEqual([expect.objectContaining({ id: classId, role: 'admin' })])
    expect((await request(`classes/${classId}`, 'DELETE', undefined, session)).status).toBe(403)
  })
  it('全部协作写接口保留认证和CSRF校验，教师名单与资料需要登录', async () => {
    const writes = [
      ['auth/profile', 'PATCH', { displayName: '教师', subject: '科学', teachingRole: 'subject' }],
      [`classes/${classId}/invitations`, 'POST', {}],
      [`classes/${classId}/invitations`, 'DELETE', undefined],
      ['invitations/preview', 'POST', { code: 'f'.repeat(48) }],
      ['invitations/join', 'POST', { code: 'f'.repeat(48) }],
      [`classes/${classId}/members/member-id`, 'DELETE', undefined],
      [`classes/${classId}/leave`, 'POST', {}],
      [`classes/${classId}/transfer`, 'POST', { userId: 'member-id' }]
    ] as const
    for (const [path, method, body] of writes) {
      expect((await request(path, method, body, '')).status).toBe(401)
      expect((await request(path, method, body, cookie, 'https://foreign.example')).status).toBe(403)
    }
    expect((await request('auth/profile', 'GET', undefined, '')).status).toBe(401)
    expect((await request(`classes/${classId}/teachers`, 'GET', undefined, '')).status).toBe(401)
    expect((await request(`classes/${classId}/teachers`, 'GET', undefined, otherCookie)).status).toBe(404)
  })
  it('邀请/预览/幂等加入/退出/转让/移除通过正式API执行当前成员权限', async () => {
    const secondClass = (await (await request('classes', 'POST', { name: '不共享的第二班' })).json()).id
    const superseded = await (await request(`classes/${classId}/invitations`, 'POST', {})).json()
    expect((await request(`classes/${classId}/invitations`, 'DELETE')).status).toBe(200)
    expect((await request('invitations/join', 'POST', { code: superseded.code }, otherCookie)).status).toBe(404)
    const invitation = await (await request(`classes/${classId}/invitations`, 'POST', {})).json()
    expect(invitation.code).toBeTypeOf('string')
    const previewResponse = await request('invitations/preview', 'POST', { code: invitation.code }, otherCookie)
    expect(previewResponse.headers.get('cache-control')).toBe('no-store')
    const preview = await previewResponse.json()
    expect(preview).toEqual({ id: classId, name: 'API 测试班级', owner_name: 'API甲老师', already_member: false, expires_at: invitation.expires_at })
    for (let i = 0; i < 2; i++) {
      const response = await request('invitations/join', 'POST', { code: invitation.code, userId: 'forged-owner', role: 'owner' }, otherCookie)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: classId })
    }
    expect((await request(`classes/${classId}/leave`, 'POST', {}, otherCookie)).status).toBe(200)
    expect((await request(`classes/${classId}/teachers`, 'GET', undefined, otherCookie)).status).toBe(404)
    expect((await request('invitations/join', 'POST', { code: invitation.code }, otherCookie)).status).toBe(200)
    const teachers = await (await request(`classes/${classId}/teachers`, 'GET', undefined, otherCookie)).json()
    expect(teachers.teachers).toHaveLength(2)
    const ownerId = teachers.teachers.find((teacher: { role: string }) => teacher.role === 'owner').user_id
    const adminId = teachers.teachers.find((teacher: { role: string }) => teacher.role === 'admin').user_id
    expect((await request(`state?classId=${secondClass}`, 'GET', undefined, otherCookie)).status).toBe(404)
    expect((await request(`settings?classId=${secondClass}`, 'GET', undefined, otherCookie)).status).toBe(404)
    expect((await request('rules', 'POST', { classId: secondClass, name: { zh: '越权', en: 'Foreign' }, points: 1, category: 'other' }, otherCookie)).status).toBe(404)
    expect((await request(`classes/${classId}`, 'DELETE', undefined, otherCookie)).status).toBe(403)
    expect((await request(`classes/${classId}/members/${ownerId}`, 'DELETE', undefined, otherCookie)).status).toBe(403)
    expect((await request(`classes/${classId}/leave`, 'POST', {})).status).toBe(409)
    expect((await request(`classes/${classId}/transfer`, 'POST', { userId: ownerId })).status).toBe(409)
    expect((await request(`classes/${classId}/transfer`, 'POST', { userId: adminId }, otherCookie)).status).toBe(403)
    expect((await request(`classes/${classId}/transfer`, 'POST', { userId: adminId })).status).toBe(200)
    const oldCode = await request('invitations/join', 'POST', { code: invitation.code })
    expect(oldCode.status).toBe(404)
    expect(await oldCode.json()).toEqual({ error: 'invalidInvitation' })
    expect((await request(`classes/${classId}`, 'DELETE')).status).toBe(403)
    const oldOwnerState = await (await request(`state?classId=${classId}`)).json()
    expect(oldOwnerState.classes.find((row: { id: string }) => row.id === classId)).toMatchObject({ owner_id: adminId, role: 'admin' })
    const renewed = await (await request(`classes/${classId}/invitations`, 'POST', {}, otherCookie)).json()
    expect((await request(`classes/${classId}/members/${ownerId}`, 'DELETE', undefined, otherCookie)).status).toBe(200)
    expect((await request(`state?classId=${classId}`)).status).toBe(404)
    expect((await request('invitations/join', 'POST', { code: renewed.code })).status).toBe(404)
    expect((await request(`state?classId=${secondClass}`)).status).toBe(200)
    expect((await request(`classes/${classId}`, 'DELETE', undefined, otherCookie)).status).toBe(200)
  })
  it('协作评分记录显示真实署名，管理员不能以请求字段伪造作者或撤回他人操作', async () => {
    const code = (await (await request(`classes/${classId}/invitations`, 'POST', {})).json()).code
    await request('invitations/join', 'POST', { code }, otherCookie)
    const studentId = (await (await request('students', 'POST', { classId, students: [{ name: '共同评分学生' }] }, otherCookie)).json()).ids[0]
    await request(`students/${studentId}/pet`, 'POST', { petId: 'panda' }, otherCookie)
    const state = await (await request('state')).json()
    const ownerBatch = await (await request('evaluations', 'POST', { studentIds: [studentId], ruleId: state.rules[0].id })).json()
    const adminBatch = await (await request('evaluations', 'POST', { studentIds: [studentId], ruleId: state.rules[0].id, actor_user_id: state.user.id, actor_name: '伪造教师' }, otherCookie)).json()
    const adminState = await (await request(`state?classId=${classId}`, 'GET', undefined, otherCookie)).json()
    expect(adminState.records.find((row: { batch_id: string }) => row.batch_id === ownerBatch.batchId)).toMatchObject({ actor_name: 'API甲老师', can_undo: false })
    expect(adminState.records.find((row: { batch_id: string }) => row.batch_id === adminBatch.batchId)).toMatchObject({ actor_name: 'API乙老师', actor_subject: '数学', can_undo: true })
    const forbidden = await request(`evaluations/${ownerBatch.batchId}/undo`, 'POST', {}, otherCookie)
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ error: 'operationNotOwned' })
    expect((await request(`evaluations/${adminBatch.batchId}/undo`, 'POST', {}, otherCookie)).status).toBe(200)
    const next = (await (await request('state')).json()).records.find((row: { batch_id: string }) => row.batch_id === adminBatch.batchId)
    expect(next).toMatchObject({ actor_name: 'API乙老师', undone_by_name: 'API乙老师', undone: 1, can_undo: false })
  })
  it('自定义评分API不能伪造actor，管理员只能撤本人且撤回按当时真实教师署名', async () => {
    const code = (await (await request(`classes/${classId}/invitations`, 'POST', {})).json()).code
    expect((await request('invitations/join', 'POST', { code }, otherCookie)).status).toBe(200)
    const studentId = await scoringStudent(), state = await scoringSnapshot()
    const ownerResponse = await request('evaluations', 'POST', { studentIds: [studentId], custom: { points: 3 } })
    expect(ownerResponse.status).toBe(200)
    const ownerBatch = await ownerResponse.json(), before = scoringHistory()
    let adminResponse = await request('evaluations', 'POST', { studentIds: [studentId], custom: { points: -2 }, actor_user_id: state.user.id, actor_name: '伪造教师', actor_subject: '伪造学科', userId: state.user.id, role: 'owner' }, otherCookie)
    if (adminResponse.status === 400) {
      expect(scoringHistory()).toEqual(before)
      adminResponse = await request('evaluations', 'POST', { studentIds: [studentId], custom: { points: -2 } }, otherCookie)
    }
    expect(adminResponse.status).toBe(200)
    const adminBatch = await adminResponse.json(), adminState = await scoringSnapshot(otherCookie)
    expect(adminState.records.find(row => row.batch_id === ownerBatch.batchId)).toMatchObject({ actor_user_id: state.user.id, actor_name: 'API甲老师', can_undo: false })
    expect(adminState.records.find(row => row.batch_id === adminBatch.batchId)).toMatchObject({ actor_user_id: adminState.user.id, actor_name: 'API乙老师', actor_subject: '数学', can_undo: true })
    const beforeUndo = scoringHistory(), forbidden = await request(`evaluations/${ownerBatch.batchId}/undo`, 'POST', { actor_user_id: state.user.id, actor_name: 'API甲老师' }, otherCookie)
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ error: 'operationNotOwned' })
    expect(scoringHistory()).toEqual(beforeUndo)
    expect((await request('auth/profile', 'PATCH', { displayName: 'API乙新名', subject: '科学', teachingRole: 'subject' }, otherCookie)).status).toBe(200)
    expect((await request(`evaluations/${adminBatch.batchId}/undo`, 'POST', { actor_user_id: state.user.id, actor_name: '伪造撤回教师' }, otherCookie)).status).toBe(200)
    const undone = await scoringSnapshot()
    expect(undone.records.find(row => row.batch_id === adminBatch.batchId)).toMatchObject({ actor_user_id: adminState.user.id, actor_name: 'API乙老师', actor_subject: '数学', undone: 1, undone_by_user_id: adminState.user.id, undone_by_name: 'API乙新名', undone_by_subject: '科学', can_undo: false })
    expect(undone.students[0]).toMatchObject({ points: 3, pet_exp: 3 })
  })
  it('自定义评分API仍校验登录与同源，拒绝请求没有写入', async () => {
    const studentId = await scoringStudent(), before = scoringHistory(), input = { studentIds: [studentId], custom: { points: 3 } }
    expect((await request('evaluations', 'POST', input, '')).status).toBe(401)
    expect((await request('evaluations', 'POST', input, cookie, 'https://foreign.example')).status).toBe(403)
    expect(scoringHistory()).toEqual(before)
  })
  it('邀请码错误尝试按真实账号限流，不因更换错误码绕过且不创建成员', async () => {
    const invitation = await (await request(`classes/${classId}/invitations`, 'POST', {})).json()
    let limited = false
    for (let index = 0; index < 101; index++) {
      const normalized = invitation.code.replace(/-/g, '').toUpperCase()
      const code = `${index.toString(16).toUpperCase().padStart(8, '0')}${normalized.slice(8)}`
      const response = await request(index % 2 ? 'invitations/join' : 'invitations/preview', 'POST', { code }, otherCookie)
      if (response.status === 429) {
        expect(await response.json()).toEqual({ error: 'rateLimited' })
        limited = true
        break
      }
      expect([400, 404]).toContain(response.status)
    }
    expect(limited).toBe(true)
    expect((await (await request('state', 'GET', undefined, otherCookie)).json()).classes).toEqual([])
  })
  it('退出后旧 Cookie 无法再使用', async () => {
    expect((await request('auth/logout', 'POST', {})).status).toBe(200)
    expect((await request('state')).status).toBe(401)
  })
  it('无效字段以稳定错误码返回，不泄露数据库错误', async () => {
    const response = await request('students', 'POST', { classId, students: [{ name: '' }] })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalidInput' })
  })
})

describe('客户端 API 响应完整性', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['截断 JSON', () => new Response('{"batchId":', { status: 200 })],
    ['响应体读取中断', () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('响应体中断')) } }), { status: 200 })]
  ] as const)('成功状态的%s归为结果不明，不重发请求', async (_, response) => {
    const fetch = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetch)
    await expect(clientApi('evaluations', 'POST', { studentIds: ['student'], custom: { points: 1 } })).rejects.toMatchObject({ code: 'networkError', status: 0 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('未收到响应时保留网络错误分类且不自动重试', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('连接中断') })
    vi.stubGlobal('fetch', fetch)
    await expect(clientApi('evaluations', 'POST', {})).rejects.toMatchObject({ code: 'networkError', status: 0 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403, 404, 500, 503])('错误响应无法解析时仍保留 HTTP %s，供失权处理使用', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status })))
    await expect(clientApi('state')).rejects.toMatchObject({ code: 'serverError', status })
  })

  it('完整错误响应保留原错误码及状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'notFound' }, { status: 404 })))
    await expect(clientApi('state')).rejects.toMatchObject({ code: 'notFound', status: 404 })
  })

  it('完整成功响应仍返回原批次', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ batchId: 'saved-batch' })))
    await expect(clientApi('evaluations', 'POST', {})).resolves.toEqual({ batchId: 'saved-batch' })
  })
})


describe('学生归档 HTTP 契约', () => {
  it('归档与恢复幂等，名单排除但历史可读，跨教师和匿名访问被拒绝', async () => {
    const id = await scoringStudent()
    expect((await request('evaluations', 'POST', { studentIds: [id], custom: { points: 5 } })).status).toBe(200)
    for (const path of [`students/${id}/archive`, `students/${id}/restore`]) {
      expect((await request(path, 'POST', {}, otherCookie)).status).toBe(404)
      expect((await request(path, 'POST', {}, '')).status).toBe(401)
    }
    expect((await request(`students/${id}/history`, 'GET', undefined, otherCookie)).status).toBe(404)
    expect((await request(`state?classId=${classId}`, 'GET', undefined, otherCookie)).status).toBe(404)
    expect((await request(`students/${id}/archive`, 'POST', {}, cookie, 'https://other.example')).status).toBe(403)
    for (let i = 0; i < 2; i++) expect((await request(`students/${id}/archive`, 'POST', {})).status).toBe(200)
    const archived = await scoringSnapshot()
    expect(archived.students).toEqual([])
    expect(archived.archived_students[0]).toMatchObject({ id, points: 5, archived_at: expect.any(Number) })
    const denied = await request('evaluations', 'POST', { studentIds: [id], custom: { points: 1 } })
    expect(denied.status).toBe(409); expect(await denied.json()).toEqual({ error: 'studentArchived' })
    expect((await (await request(`students/${id}/history`)).json()).entries).toHaveLength(1)
    expect((await request(`students/${id}/history?offset=bad`)).status).toBe(400)
    for (let i = 0; i < 2; i++) expect((await request(`students/${id}/restore`, 'POST', {})).status).toBe(200)
    expect((await scoringSnapshot()).students[0]).toMatchObject({ id, points: 5, archived_at: null })
  })
})
