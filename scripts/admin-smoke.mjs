// Real HTTP + Chrome against an isolated SQLite database. No production configuration.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
import { chromium } from 'playwright-core'

const root = process.cwd(), dist = process.env.BUILD_DIR || '.next-build'
await mkdir(path.join(root, 'data'), { recursive: true })
const output = await mkdtemp(path.join(root, 'data/admin-evidence-'))
const databasePath = path.join(output, 'test.db')
const socket = createServer().listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const base = `http://127.0.0.1:${port}`
let server, browser
const log = createWriteStream(path.join(output, 'server.log'))
const checks = [], errors = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function start(admin = '') {
  server = spawn(process.execPath, [path.join(root, dist, 'standalone/server.js')], {
    cwd: root, env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', DATABASE_PATH: databasePath,
      TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', VERCEL: '', DESKTOP_TOKEN: '', COOKIE_SECURE: 'false', APP_ORIGIN: base, PET_GARDEN_ADMIN_USER_IDS: admin }, stdio: ['ignore', 'pipe', 'pipe']
  })
  server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false })
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Test service exited')
    try { if ((await fetch(`${base}/api/health`)).ok) return } catch { /* starting */ }
    await sleep(100)
  }
  throw new Error('Test service did not become ready')
}
async function stop() {
  if (server && server.exitCode === null) { const ended = once(server, 'exit'); server.kill('SIGTERM'); await ended }
  server = undefined
}
async function request(endpoint, cookie = '', method = 'GET', body) {
  return fetch(`${base}/api/${endpoint}`, { method, headers: { Cookie: cookie, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
}
async function createUser(username, displayName) {
  const response = await request('auth/register', '', 'POST', { username, password: randomUUID() })
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie').split(';')[0], { user } = await response.json()
  assert.equal((await request('auth/profile', cookie, 'PATCH', { displayName, subject: '科学 / Science', teachingRole: 'homeroom' })).status, 200)
  return { cookie, id: user.id }
}
try {
  await start()
  const admin = await createUser('overview-reviewer', '总览测试管理员')
  const alice = await createUser('teacher-a', '测试教师 A'), bob = await createUser('admin', '测试教师 B')
  const classes = []
  for (let i = 0; i < 23; i++) {
    const owner = i % 2 ? bob : alice
    const response = await request('classes', owner.cookie, 'POST', { name: `测试班级 ${String(i + 1).padStart(2, '0')} · Garden` })
    assert.equal(response.status, 200)
    classes.push({ id: (await response.json()).id, owner })
  }
  const target = classes[22]
  const students = await request('students', target.owner.cookie, 'POST', { classId: target.id, students: [{ name: 'Synthetic A' }, { name: 'Synthetic B' }] })
  const ids = (await students.json()).ids
  assert.equal((await request('admin/classes', admin.cookie)).status, 403)
  await stop()
  const fixture = new Database(databasePath)
  // Match ABCD-14's schema contract without claiming its archive UI was exercised here.
  fixture.exec('ALTER TABLE students ADD COLUMN archived_at INTEGER')
  fixture.prepare('UPDATE students SET archived_at = ? WHERE id = ?').run(Date.now(), ids[1])
  fixture.prepare('INSERT INTO class_members (class_id, user_id, joined_at) VALUES (?, ?, ?)').run(target.id, bob.id, Date.now())
  fixture.close()
  await start(admin.id)
  const first = await (await request('admin/classes', admin.cookie)).json()
  const second = await (await request('admin/classes?page=2', admin.cookie)).json()
  assert.equal(first.total, 23); assert.equal(first.classes.length, 20); assert.equal(second.classes.length, 3)
  assert.equal(new Set([...first.classes, ...second.classes].map(c => c.id)).size, 23)
  assert.equal(new Set([...first.classes, ...second.classes].map(c => c.owner_id)).size, 2)
  const summary = await (await request(`admin/classes/${target.id}`, admin.cookie)).json()
  assert.equal(summary.classroom.active_students, 1); assert.equal(summary.classroom.archived_students, 1)
  assert.equal(summary.classroom.teacher_count, 2)
  for (const cookie of [alice.cookie, bob.cookie, '']) for (const endpoint of ['admin/classes', `admin/classes/${target.id}`, `admin/classes?role=admin&userId=${admin.id}`]) {
    assert.equal((await request(endpoint, cookie)).status, cookie ? 403 : 401)
  }
  assert.equal((await request(`classes/${target.id}`, admin.cookie, 'PATCH', { name: 'Unauthorized' })).status, 404)
  assert.equal((await request('admin/classes', admin.cookie, 'POST', { name: 'Unauthorized' })).status, 405)
  checks.push('real HTTP: 23 classes / two owners / pagination / archive counts / default deny / unauthenticated / teacher / co-admin named admin / forged parameters / write denial')
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.addCookies([{ name: 'pet-garden-session', value: admin.cookie.split('=')[1], url: base }])
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}/zh`)
  await page.getByRole('link', { name: '全部班级', exact: true }).click()
  await page.getByText('共 23 个班级', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'zh-all-classes.png') })
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByText('第 2 页 · 每页 20 个', { exact: true }).waitFor()
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await page.getByText('第 1 页 · 每页 20 个', { exact: true }).waitFor()
  await page.getByLabel('搜索班级名称').fill('测试班级 23')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByText('共 1 个班级', { exact: true }).waitFor()
  const row = page.getByRole('button', { name: /测试班级 23/ })
  await row.click()
  await page.getByRole('dialog').getByText(target.id, { exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'zh-class-summary.png'), fullPage: true, animations: 'disabled' })
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('测试班级 23'))
  assert.equal(await row.evaluate(el => el === document.activeElement), true)
  await page.getByLabel('搜索班级名称').fill('no-such-class')
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.getByText('没有找到匹配的班级', { exact: true }).waitFor()
  checks.push('Chrome zh: navigation, pagination, search, empty state, summary, Escape and focus return')
  // Controlled transport fault and delay; successful data comes from the live service.
  await page.route('**/api/admin/classes?**', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"serverError"}' }), { times: 1 })
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await page.getByRole('alert').waitFor()
  await page.screenshot({ path: path.join(output, 'zh-error.png'), fullPage: true })
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByText('共 23 个班级', { exact: true }).waitFor()
  let release
  const delayed = new Promise(resolve => { release = resolve })
  await page.route('**/api/admin/classes?**', async route => { await delayed; await route.continue() }, { times: 1 })
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText('正在加载班级…', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(output, 'zh-loading.png'), fullPage: true })
  release()
  await page.getByText('共 23 个班级', { exact: true }).waitFor()
  await page.getByRole('button', { name: /测试班级 23/ }).click()
  await page.getByRole('dialog').getByText(target.id, { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.route(`**/api/admin/classes/${target.id}`, route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"serverError"}' }), { times: 1 })
  await page.getByRole('button', { name: /测试班级 23/ }).click()
  await page.getByRole('dialog').getByRole('alert').waitFor()
  await page.getByRole('dialog').getByRole('button', { name: '重试', exact: true }).click()
  await page.getByRole('dialog').getByText(target.id, { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  checks.push('Chrome controlled transport injection: list failure/retry, loading, detail failure/retry')
  await page.goto(`${base}/en/admin`)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('23 classes', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: path.join(output, 'en-mobile.png') })
  await page.getByRole('button', { name: /测试班级 23/ }).click()
  await page.getByRole('dialog').getByText(target.id, { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: path.join(output, 'en-mobile-summary.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  const db = new Database(databasePath)
  db.prepare('UPDATE sessions SET expires_at = 0 WHERE user_id = ?').run(admin.id); db.close()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('heading', { name: 'Sign in required' }).waitFor()
  assert.equal(await page.getByRole('button', { name: /测试班级/ }).count(), 0)
  await context.clearCookies()
  await context.addCookies([{ name: 'pet-garden-session', value: bob.cookie.split('=')[1], url: base }])
  await page.reload()
  await page.getByRole('heading', { name: 'Global admin access required' }).waitFor()
  await page.goto(`${base}/en`)
  await page.getByRole('heading', { name: /测试班级/ }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'All classes', exact: true }).count(), 0)
  checks.push('Chrome en 390px: no overflow, detail, expired-session data clearing, teacher denial and hidden entry')
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, pageErrors: errors, scope: 'Local production Next.js service + SQLite + real Chrome. Local archive fixture; no remote Turso or production data.' }, null, 2))
  console.log(`Admin verification passed. Evidence: ${output}`)
} finally {
  await browser?.close()
  await stop()
  log.end()
}
