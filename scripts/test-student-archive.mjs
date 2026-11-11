import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { chromium } from 'playwright-core'

// All accounts and data belong to this disposable local server. No external services.
const directory = path.resolve(process.env.ARCHIVE_EVIDENCE_DIR || 'data/archive-evidence')
await mkdir(directory, { recursive: true })
const fixture = await mkdtemp(path.join(directory, 'run-'))
const portProbe = createServer().listen(0, '127.0.0.1')
await new Promise(resolve => portProbe.once('listening', resolve))
const port = portProbe.address().port
await new Promise(resolve => portProbe.close(resolve))
const origin = `http://127.0.0.1:${port}`
const log = createWriteStream(path.join(fixture, 'server.log'))
const server = spawn(process.execPath, [path.resolve('.next-build/standalone/server.js')], {
  env: { ...process.env, DATABASE_PATH: path.join(fixture, 'test.db'), TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', VERCEL: '', COOKIE_SECURE: 'false', APP_ORIGIN: origin, HOSTNAME: '127.0.0.1', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
})
server.stdout.pipe(log); server.stderr.pipe(log)
let browser
const results = []
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break } catch { /* startup */ }
    if (attempt > 100 || server.exitCode !== null) throw new Error('Local test server failed to start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const locale of ['zh', 'en']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    const t = (zh, en) => locale === 'zh' ? zh : en
    const request = async (route, method = 'GET', data) => {
      const response = await context.request.fetch(`${origin}/api/${route}`, { method, data })
      assert.equal(response.status(), 200, `${route}: ${await response.text()}`)
      return response.json()
    }
    await request('auth/register', 'POST', { username: `archive-${randomUUID().slice(0, 12)}`, password: randomUUID() })
    await request('auth/profile', 'PATCH', { displayName: t('测试教师', 'Test teacher'), subject: t('科学', 'Science'), teachingRole: 'homeroom' })
    const { id: classId } = await request('classes', 'POST', { name: t('归档验收班', 'Archive acceptance class') })
    const name = t('转学测试学生', 'Transfer student')
    const { ids: [studentId] } = await request('students', 'POST', { classId, students: [{ name, studentNo: '001' }] })
    await request(`students/${studentId}/pet`, 'POST', { petId: 'panda' })
    await request('evaluations', 'POST', { studentIds: [studentId], custom: { points: 100, reason: t('归档前的成长记录', 'Growth before archiving') } })
    const before = await request(`state?classId=${classId}`)
    const button = label => page.getByRole('button', { name: label, exact: true })
    const dialog = () => page.getByRole('dialog')
    const waitDialogClosed = () => dialog().waitFor({ state: 'hidden' })
    const screenshot = label => page.screenshot({ path: path.join(directory, `${locale}-${label}.png`), fullPage: false })
    async function openArchive() {
      if (page.viewportSize().width < 640) await page.locator('summary').filter({ hasText: t('班级工具', 'Class tools') }).click()
      await button(t('归档', 'Archive')).click()
    }
    await page.goto(`${origin}/${locale}`)
    await button(t(`${name} 的更多操作`, `More actions for ${name}`)).click()
    await button(t('编辑学生', 'Edit student')).click()
    await button(t('归档学生', 'Archive student')).click()
    await page.getByLabel(t('归档原因（选填）', 'Archive reason (optional)'), { exact: true }).click()
    await page.getByRole('option', { name: t('转学', 'Transfer'), exact: true }).click()
    const archiveNote = t('随家人搬迁，转入其他学校', 'Transferred to another school after moving')
    await page.getByLabel(t('归档说明（选填）', 'Archive note (optional)'), { exact: true }).fill(archiveNote)
    await screenshot('confirm-archive')
    // Commit succeeds but the browser loses its response. Retrying must preserve identity and time.
    let archivePosts = 0
    await page.route(`**/api/students/${studentId}/archive`, async route => {
      archivePosts++
      if (archivePosts === 1) { await route.fetch(); await route.abort('failed') }
      else await route.continue()
    })
    await button(t('确认归档', 'Confirm archive')).click()
    await page.getByRole('alert').waitFor()
    const archivedAt = (await request(`state?classId=${classId}`)).archived_students[0].archived_at
    await button(t('确认归档', 'Confirm archive')).click()
    await waitDialogClosed()
    assert.equal(archivePosts, 2)
    assert.equal((await request(`state?classId=${classId}`)).archived_students[0].archived_at, archivedAt)
    assert.equal(await button(`${name} · ${t('评价', 'Evaluate')}`).count(), 0)
    assert.equal(await button(t('批量评价', 'Batch')).first().isDisabled(), true)
    await page.reload()
    await openArchive()
    await screenshot('archive-list')
    let historyGets = 0
    await page.route(`**/api/students/${studentId}/history?*`, async route => {
      if (++historyGets === 1) await route.fulfill({ status: 503, json: { error: 'serverError' } })
      else await route.continue()
    })
    await button(t('查看档案', 'View profile')).click()
    await dialog().getByRole('alert').waitFor()
    await button(t('重试', 'Retry')).click()
    await page.getByText(t('归档前的成长记录', 'Growth before archiving'), { exact: true }).waitFor()
    await page.getByText(archiveNote, { exact: true }).waitFor()
    await page.getByText(t('转学', 'Transfer'), { exact: true }).waitFor()
    await screenshot('archive-profile')
    await page.setViewportSize({ width: 390, height: 844 })
    await screenshot('archive-mobile')
    assert.equal(await dialog().evaluate(element => element.scrollWidth > element.clientWidth), false)
    await page.keyboard.press('Escape')
    await waitDialogClosed()
    await openArchive()
    await button(t('查看档案', 'View profile')).click()
    await page.getByText(t('归档前的成长记录', 'Growth before archiving'), { exact: true }).waitFor()
    // A failed restore is recoverable from the same confirmation.
    let restorePosts = 0
    await page.route(`**/api/students/${studentId}/restore`, async route => {
      if (++restorePosts === 1) await route.fulfill({ status: 503, json: { error: 'serverError' } })
      else await route.continue()
    })
    await button(t('恢复到当前班级', 'Restore to this class')).click()
    await button(t('确认恢复', 'Confirm restore')).click()
    await page.getByRole('alert').waitFor()
    await button(t('确认恢复', 'Confirm restore')).click()
    await page.getByText(t('当前班级还没有已归档学生。可从学生的编辑窗口归档。', 'No archived students in this class. Archive a student from their edit dialog.'), { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.reload()
    await button(`${name} · ${t('评价', 'Evaluate')}`).waitFor()
    const after = await request(`state?classId=${classId}`)
    assert.deepEqual(after.students, before.students)
    assert.deepEqual(after.records, before.records)
    assert.deepEqual(after.badges, before.badges)
    assert.deepEqual(after.archived_students, [])
    assert.deepEqual(errors, [])
    await screenshot('restored-mobile')
    results.push({ locale, archivePosts, restorePosts, historyGets, preservedIdentity: true, preservedHistory: true, mobileOverflow: false, pageErrors: errors })
    await context.close()
  }
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ passed: true, evidence: directory, results }, null, 2))
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve) })
  log.end()
}
