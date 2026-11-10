// Build first: BUILD_DIR=.next-build pnpm build
// Run: pnpm test:restore (Chrome installed, or PLAYWRIGHT_EXECUTABLE_PATH set).
import { chromium } from 'playwright-core'
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const directory = await mkdtemp(path.join(tmpdir(), 'pet-bloom-restore-'))
const evidence = path.resolve(root, process.env.RESTORE_EVIDENCE_DIR || 'data/restore-regression')
await mkdir(evidence, { recursive: true })
const socket = createServer()
socket.listen(0, '127.0.0.1')
await once(socket, 'listening')
const port = socket.address().port
await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
// An isolated local SQLite database; never inherit cloud credentials or production data.
const server = spawn(process.execPath, [path.join(root, process.env.BUILD_DIR || '.next-build', 'standalone/server.js')], {
  cwd: root,
  env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', APP_ORIGIN: origin, DATABASE_PATH: path.join(directory, 'test.db') },
  stdio: ['ignore', 'pipe', 'pipe']
})
let serverOutput = '', browser
server.stdout.on('data', chunk => { serverOutput += chunk })
server.stderr.on('data', chunk => { serverOutput += chunk })
const report = []
const copy = {
  zh: { settings: '设置与数据', file: '选择备份文件', submit: '确认导入新副本', reload: '重新加载班级', saved: '导入已成功', unknown: '暂时无法确认导入结果', result: '已创建 2 个班级副本。', open: '进入新班级', select: '导入的新班级', switch: '切换班级' },
  en: { settings: 'Settings & data', file: 'Choose backup', submit: 'Import new copies', reload: 'Reload classes', saved: 'Import succeeded', unknown: 'The import result is unknown', result: '2 class copies created.', open: 'Open imported class', select: 'Imported class', switch: 'Switch class' }
}

try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(serverOutput)
    try { ready = (await fetch(`${origin}/api/health`)).ok } catch { /* Wait for this test server only. */ }
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(ready, `Test server failed to start: ${serverOutput}`)
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : { channel: 'chrome' }) })
  for (const locale of ['zh', 'en']) {
    for (const scenario of ['saved-500', 'saved-network', 'lost-response', 'server-500', 'malformed-success', 'rejected-400', 'success', 'first-classes']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
      const page = await context.newPage(), words = copy[locale]
      page.setDefaultTimeout(15000)
      const errors = [], requests = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('request', request => {
        const url = new URL(request.url())
        if (url.pathname === '/api/restore' || url.pathname === '/api/state') requests.push({ method: request.method(), path: url.pathname, classId: url.searchParams.get('classId') })
      })
      const api = async (route, method = 'GET', data) => {
        const response = await context.request.fetch(`${origin}/api/${route}`, { method, data, headers: { Origin: origin } })
        assert.equal(response.status(), 200, `${method} ${route}: ${await response.text()}`)
        return response.json()
      }
      await api('auth/register', 'POST', { username: `qa-${randomBytes(8).toString('hex')}`, password: randomBytes(24).toString('base64url') })
      await api('auth/profile', 'PATCH', { displayName: 'Restore QA', subject: 'Math', teachingRole: 'subject' })
      const originals = []
      for (const name of ['Restore QA A', 'Restore QA B']) originals.push((await api('classes', 'POST', { name })).id)
      const backup = await api('backup')
      if (scenario === 'first-classes') for (const id of originals) await api(`classes/${id}`, 'DELETE')
      const baseline = (await api('state')).classes.length
      await page.goto(`${origin}/${locale}`)
      await page.getByRole('button', { name: words.settings, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: words.settings, exact: true })
      const chooseFile = data => dialog.getByLabel(words.file, { exact: true }).setInputFiles({ name: 'restore-qa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })
      let posts = 0, receipt, blockState = false, stateFailures = 0
      const unknown = ['lost-response', 'server-500', 'malformed-success'].includes(scenario)
      const savedFailure = scenario.startsWith('saved-') || scenario === 'first-classes'
      await page.route('**/api/restore', async route => {
        posts++
        // The real route commits the transaction before we lose/replace the response.
        const response = await route.fetch()
        if (response.ok()) receipt = await response.json()
        if (scenario === 'lost-response') return route.abort('failed')
        if (scenario === 'server-500') return route.fulfill({ status: 500, json: { error: 'serverError' } })
        if (scenario === 'malformed-success') return route.fulfill({ status: 200, json: {} })
        if (savedFailure) blockState = true
        await route.fulfill({ response })
      })
      await page.route('**/api/state*', async route => {
        if (!blockState) return route.continue()
        stateFailures++
        if (scenario === 'saved-network') return route.abort('failed')
        return route.fulfill({ status: 500, json: { error: 'serverError' } })
      })
      await chooseFile(scenario === 'rejected-400' ? { version: 7 } : backup)
      await dialog.getByRole('button', { name: words.submit, exact: true }).click()

      if (scenario === 'rejected-400') {
        await dialog.getByRole('alert').waitFor()
        assert.equal(await dialog.getByRole('button', { name: words.submit }).isEnabled(), true)
        assert.equal((await api('state')).classes.length, baseline)
        await chooseFile(backup)
        await dialog.getByRole('button', { name: words.submit, exact: true }).click()
      }
      if (savedFailure || unknown) {
        await dialog.getByRole('alert').filter({ hasText: unknown ? words.unknown : words.saved }).waitFor()
        const reload = dialog.getByRole('button', { name: words.reload, exact: true })
        await reload.waitFor({ state: 'visible' })
        await page.waitForFunction(label => [...document.querySelectorAll('button')].some(button => button.textContent.includes(label) && !button.disabled), words.reload)
        assert.equal(await dialog.getByRole('button', { name: words.submit, exact: true }).count(), 0)
        assert.equal(await dialog.getByLabel(words.file, { exact: true }).isDisabled(), true)
        assert.equal((await api('state')).classes.length, baseline + 2)
        // Repeated failed reloads must remain read-only and retain the recovery UI.
        blockState = true
        await reload.click()
        await page.waitForFunction(label => [...document.querySelectorAll('button')].some(button => button.textContent.includes(label) && !button.disabled), words.reload)
        assert.equal(posts, 1)
        assert.ok(stateFailures >= (savedFailure ? 2 : 1))
        assert.equal((await api('state')).classes.length, baseline + 2)
        await reload.scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.join(evidence, `${locale}-${scenario}.png`) })
        // Mobile reflow uses the same recovery controls.
        if (scenario === 'saved-500') {
          await page.setViewportSize({ width: 390, height: 844 })
          await reload.scrollIntoViewIfNeeded()
          assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), true)
          await page.screenshot({ path: path.join(evidence, `${locale}-${scenario}-mobile.png`) })
          await page.setViewportSize({ width: 1280, height: 1000 })
        }
        blockState = false
        await reload.click()
      }
      if (unknown) {
        await dialog.waitFor({ state: 'hidden' })
        const switcher = page.getByRole('combobox', { name: words.switch, exact: true }).filter({ visible: true }).first()
        await switcher.click()
        assert.equal(await page.getByRole('option').count(), baseline + 2)
        await page.keyboard.press('Escape')
        // Reopening settings cannot resurrect the old confirmation.
        await page.getByRole('button', { name: words.settings, exact: true }).click()
        assert.equal(await dialog.getByRole('button', { name: words.submit, exact: true }).count(), 0)
      } else {
        await dialog.getByRole('status').filter({ hasText: words.result }).waitFor()
        const select = dialog.getByRole('combobox', { name: words.select, exact: true })
        await select.click()
        assert.equal(await page.getByRole('option').count(), 2)
        const classes = (await api('state')).classes
        const targetId = receipt.classIds[1], target = classes.find(item => item.id === targetId)
        await page.getByRole('option', { name: target.name, exact: true }).click()
        // A failed class switch must keep the receipt and permit another GET.
        if (scenario === 'success') {
          blockState = true
          await dialog.getByRole('button', { name: words.open, exact: true }).click()
          await page.waitForFunction(label => [...document.querySelectorAll('button')].some(button => button.textContent.includes(label) && !button.disabled), words.open)
          assert.equal(await dialog.isVisible(), true)
          blockState = false
        }
        const loaded = page.waitForResponse(response => new URL(response.url()).searchParams.get('classId') === targetId && response.status() === 200)
        await dialog.getByRole('button', { name: words.open, exact: true }).click()
        await loaded
        await dialog.waitFor({ state: 'hidden' })
        assert.equal(await page.getByRole('combobox', { name: words.switch, exact: true }).first().textContent(), target.name)
      }
      assert.equal(posts, scenario === 'rejected-400' ? 2 : 1)
      assert.equal((await api('state')).classes.length, baseline + 2)
      assert.deepEqual(errors, [])
      report.push({ locale, scenario, result: 'passed', restorePosts: posts, baselineClasses: baseline, finalClasses: baseline + 2, stateFailures, requests })
      await writeFile(path.join(evidence, 'network-evidence.json'), JSON.stringify(report, null, 2))
      console.log(`PASS ${locale} ${scenario}: POST=${posts}, classes=${baseline}->${baseline + 2}`)
      await context.close()
    }
  }
  console.log(`All ${report.length} browser scenarios passed. Evidence: ${evidence}`)
} finally {
  await browser?.close()
  if (server.exitCode === null) {
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await exited
  }
  await rm(directory, { recursive: true, force: true })
}
