import { _electron as electron, chromium } from 'playwright-core'
import { strict as assert } from 'node:assert'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const directory = await mkdtemp(path.join(root, '.desktop/smoke-'))
const data = path.join(directory, 'profile')
let executablePath = process.argv[2] ? path.resolve(process.argv[2]) : require('electron')
const appDirectory = path.join(root, '.desktop', `${process.platform}-${process.arch}`, 'app')
const packaged = Boolean(process.argv[2])
const macUpdate = process.argv.includes('--mac-update')
const quitUpdate = path.join(directory, 'quit-update')
let updateBrowser
let portableDirectory
if (packaged) {
  const bundle = process.platform === 'darwin' ? path.resolve(path.dirname(executablePath), '../..') : path.dirname(executablePath)
  async function validateLinks(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const link = await readlink(filename)
        const destination = path.resolve(directory, link)
        assert.ok(!path.isAbsolute(link) && !path.relative(bundle, destination).startsWith('..'), `安装包包含外部依赖链接 / External dependency link: ${filename}`)
      } else if (entry.isDirectory()) await validateLinks(filename)
    }
  }
  await validateLinks(bundle)
  portableDirectory = await mkdtemp(path.join(tmpdir(), 'petbloom-portable-'))
  const copy = path.join(portableDirectory, path.basename(bundle))
  await cp(bundle, copy, { recursive: true, verbatimSymlinks: true })
  executablePath = path.join(copy, path.relative(bundle, executablePath))
}
let app
let processExit
let runtimeOutput = ''
let blocker
const errors = []

async function launch() {
  processExit = undefined
  runtimeOutput = ''
  // 自动化使用模拟钥匙串，避免重启时系统授权弹窗阻塞测试窗口。
  app = await electron.launch({ executablePath, args: [...(packaged ? [] : [appDirectory]), ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []), `--user-data-dir=${data}`], timeout: 90000 })
  app.process().once('exit', (code, signal) => { processExit = { code, signal } })
  app.process().stderr.on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-32768) })
  await app.evaluate(async ({ app }) => {
    await app.whenReady()
    const updater = process.mainModule.require('./update-client.cjs').getUpdater()
    // 回归不依赖公开仓库当前是否已有新版本。
    updater.checkForUpdates = async () => ({ isUpdateAvailable: false, updateInfo: { version: app.getVersion() } })
  })
  const page = await app.firstWindow({ timeout: 90000 })
  await app.evaluate(({ app, BrowserWindow }) => {
    if (process.platform === 'darwin') app.focus({ steal: true })
    const window = BrowserWindow.getAllWindows()[0]
    window.show()
    window.focus()
  })
  await page.bringToFront()
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(60000)
  await page.waitForURL(/http:\/\/127\.0\.0\.1:\d+\/(zh|en)/)
  await page.locator('header').waitFor()
  await page.waitForLoadState('load')
  if (new URL(page.url()).pathname !== '/zh') await page.goto(`${new URL(page.url()).origin}/zh`)
  return page
}

async function checkUpdateMenu(page) {
  const safety = await app.evaluate(({ app, Menu, dialog }) => {
    const updater = process.mainModule.require('./update-client.cjs').getUpdater()
    const originalCheck = updater.checkForUpdates
    const originalDownload = updater.downloadUpdate
    const originalDialog = dialog.showMessageBox
    const state = globalThis.smokeUpdates = { downloads: 0, close: new AbortController() }
    updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: '999.0.0' } })
    updater.downloadUpdate = async () => { state.downloads++; throw new Error('Unexpected update download during smoke test') }
    state.shown = new Promise(resolve => {
      dialog.showMessageBox = (parent, options) => {
        state.finished = originalDialog.call(dialog, parent, { ...options, signal: state.close.signal })
        resolve(options)
        return state.finished
      }
    })
    state.restore = () => {
      updater.checkForUpdates = originalCheck
      updater.downloadUpdate = originalDownload
      dialog.showMessageBox = originalDialog
    }
    const item = Menu.getApplicationMenu().getMenuItemById('check-for-updates')
    if (!item?.enabled) throw new Error('更新菜单不可用 / Update menu is unavailable')
    item.click()
    return { packaged: app.isPackaged, resources: process.resourcesPath, autoDownload: updater.autoDownload, autoInstallOnAppQuit: updater.autoInstallOnAppQuit }
  })
  assert.equal(safety.autoDownload, false)
  assert.equal(safety.autoInstallOnAppQuit, false)
  try {
    if (safety.packaged) {
      const config = parse(await readFile(path.join(safety.resources, 'app-update.yml'), 'utf8'))
      assert.equal(config.provider, 'github')
      assert.equal(config.owner, 'anthonyli')
      assert.equal(config.repo, 'pet-bloom')
      assert.equal(config.private, false)
      assert.equal(config.token, undefined)
    }
    const prompt = await app.evaluate(() => globalThis.smokeUpdates.shown)
    assert.ok(prompt.message)
    if (safety.packaged) {
      assert.ok(prompt.message.includes('999.0.0'))
      assert.equal(prompt.cancelId, 1)
      assert.equal(prompt.defaultId, 1)
    }
    await page.screenshot({ path: path.join(directory, 'update-prompt.png') })
  } finally {
    await app.evaluate(async () => {
      const state = globalThis.smokeUpdates
      state.close.abort()
      await state.finished
      state.restore()
    })
  }
  const result = await app.evaluate(({ Menu }) => ({
    downloads: globalThis.smokeUpdates.downloads,
    enabled: Menu.getApplicationMenu().getMenuItemById('check-for-updates').enabled
  }))
  assert.equal(result.downloads, 0)
  assert.equal(result.enabled, true)
}

async function download(page, mode) {
  const filename = path.join(directory, 'backup.json')
  await app.evaluate(({ session }, { filename, mode }) => {
    globalThis.smokeDownload = new Promise(resolve => {
      const timeout = setTimeout(() => resolve('timeout'), 15000)
      session.fromPartition('persist:petbloom').once('will-download', (_event, item) => {
        item.once('done', (_doneEvent, state) => { clearTimeout(timeout); resolve(state) })
        if (mode === 'cancelled') item.cancel()
        else item.setSavePath(filename)
      })
    })
  }, { filename, mode })
  await page.getByRole('button', { name: '导出负责班级', exact: true }).click()
  return await app.evaluate(() => globalThis.smokeDownload)
}

async function checkMacInstall() {
  assert.ok(packaged && process.platform === 'darwin' && portableDirectory, '--mac-update 仅支持隔离的 Mac 安装包 / --mac-update requires a Mac package')
  const bundle = path.resolve(path.dirname(executablePath), '../..')
  const observer = path.join(directory, 'update-process.json')
  const listener = createServer()
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  const main = path.join(bundle, 'Contents/Resources/app/desktop/main.cjs')
  // 调试入口仅写入隔离副本，发布源码不提供该入口。
  const instrumentation = `;(() => {
    const {app} = require('electron'), fs = require('node:fs');
    app.commandLine.appendSwitch('remote-debugging-port', '${port}');
    app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
    app.commandLine.appendSwitch('use-mock-keychain');
    app.whenReady().then(() => fs.writeFileSync(${JSON.stringify(observer)}, JSON.stringify({pid: process.pid, version: app.getVersion()})));
    setInterval(() => { if (fs.existsSync(${JSON.stringify(quitUpdate)})) app.quit(); }, 250).unref();
  })();\n`
  await writeFile(main, instrumentation + await readFile(main, 'utf8'))
  const sign = app => {
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--preserve-metadata=identifier,entitlements,flags', app])
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  }
  sign(bundle)
  const fixture = path.join(directory, 'update-fixture/PetBloom.app')
  await mkdir(path.dirname(fixture))
  await cp(bundle, fixture, { recursive: true, verbatimSymlinks: true })
  const metadataFile = path.join(fixture, 'Contents/Resources/app/package.json')
  const metadata = JSON.parse(await readFile(metadataFile, 'utf8'))
  const parts = metadata.version.split('.').map(Number)
  parts[2]++
  const version = parts.join('.')
  await writeFile(metadataFile, JSON.stringify({ ...metadata, version }))
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${version}`, path.join(fixture, 'Contents/Info.plist')])
  sign(fixture)
  const archive = path.join(directory, 'update-fixture.zip')
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', fixture, archive])
  const sha512 = await require('../desktop/mac-install.cjs').digest(archive)
  const closed = app.waitForEvent('close', { timeout: 90000 })
  await app.evaluate(({ Menu, dialog }, downloaded) => {
    const updater = process.mainModule.require('./update-client.cjs').getUpdater()
    updater.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { version: downloaded.version } })
    updater.downloadUpdate = async () => { updater.downloaded = downloaded }
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    Menu.getApplicationMenu().getMenuItemById('check-for-updates').click()
  }, { archive, sha512, version })
  await closed
  app = undefined
  const deadline = Date.now() + 240000
  let lastError
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await readFile(observer, 'utf8'))
      if (!updateBrowser) updateBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 })
      const page = updateBrowser.contexts()[0]?.pages()[0]
      if (!page) throw new Error('新版窗口尚未创建 / New window is not created yet')
      await page.locator('.pet-card').first().waitFor({ timeout: 2000 })
      await page.screenshot({ path: path.join(directory, 'after-update.png'), fullPage: true })
      const restored = await page.evaluate(async () => (await fetch('/api/state')).json())
      assert.equal(restored.classes.length, 2)
      assert.equal(restored.user.display_name, '桌面验证老师')
      assert.equal(state.version, version, '系统未启动新版，已恢复旧版及班级数据；请检查 macOS 安全确认 / macOS did not start the update; previous version and class data restored. Check macOS security approval')
      const installing = path.join(data, 'updates/installing.json')
      if (await readFile(installing).then(() => true, () => false)) throw new Error('安装事务尚未提交 / Installation has not committed yet')
      console.log(`本地更新副本已通过覆盖安装、重启与数据保留验证：${version}`)
      return
    } catch (error) {
      lastError = error
      if (error.code === 'ERR_ASSERTION') throw error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  console.error(await readFile(path.join(data, 'update.log'), 'utf8').catch(() => '尚无更新日志 / No update log'))
  throw lastError || new Error('更新窗口启动超时 / Update window timed out')
}

try {
  let page = await launch()
  const firstOrigin = new URL(page.url()).origin
  assert.equal((await fetch(`${firstOrigin}/api/health`)).status, 403)
  assert.equal((await fetch(`${firstOrigin}/_next/static/does-not-exist.js`)).status, 403)
  await page.getByRole('button', { name: '创建账号', exact: true }).click()
  await page.getByLabel('用户名或邮箱', { exact: true }).fill(`desktop-${randomBytes(5).toString('hex')}`)
  await page.getByLabel('密码', { exact: true }).fill(randomBytes(20).toString('hex'))
  await page.getByRole('button', { name: '创建教师账号', exact: true }).click()
  await page.getByLabel('教师称呼', { exact: true }).fill('桌面验证老师')
  await page.getByLabel('填写学科或教学方向', { exact: true }).fill('科学')
  await page.getByRole('combobox', { name: '教学身份', exact: true }).click()
  await page.getByRole('option', { name: '班主任', exact: true }).click()
  await page.getByRole('button', { name: '保存并继续', exact: true }).click()
  await page.getByRole('button', { name: '体验演示班级', exact: true }).click()
  await page.locator('.pet-card').first().waitFor()
  assert.equal(await page.locator('.pet-card').count(), 6)
  await page.waitForFunction(() => [...document.querySelectorAll('.pet-card img')].every(image => image.complete && image.naturalWidth > 0))
  assert.deepEqual(await page.evaluate(() => ({ node: typeof window.require, process: typeof window.process })), { node: 'undefined', process: 'undefined' })
  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.sandbox, true)
  const naming = await app.evaluate(({ app, BrowserWindow }) => ({
    expected: app.getPreferredSystemLanguages()[0].startsWith('zh') ? '萌芽' : 'PetBloom',
    name: app.getName(), title: BrowserWindow.getAllWindows()[0].getTitle()
  }))
  assert.equal(naming.name, naming.expected)
  assert.equal(naming.title, naming.expected)
  if (packaged && process.platform === 'darwin') {
    const bundle = path.resolve(path.dirname(executablePath), '../..')
    for (const [language, expected] of [['zh-Hans', '萌芽'], ['zh-Hant', '萌芽'], ['en', 'PetBloom']]) {
      const name = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
        'function run(args) { ObjC.import("Foundation"); return ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(args[0])); }',
        bundle, '-AppleLanguages', `(${language})`
      ], { encoding: 'utf8', timeout: 15000 }).trim()
      assert.equal(name, expected)
    }
  }
  await page.screenshot({ path: path.join(directory, 'desktop-zh.png'), fullPage: true })
  await checkUpdateMenu(page)
  const imageResult = await page.evaluate(async () => {
    const state = await (await fetch('/api/state')).json()
    const canvas = document.createElement('canvas')
    canvas.width = 16; canvas.height = 16
    const context = canvas.getContext('2d')
    context.fillStyle = '#7856d8'; context.fillRect(0, 0, 16, 16)
    const response = await fetch('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      classId: state.classes[0].id, name: { zh: '桌面图片验证', en: 'Desktop image check' }, cost: 1, image: canvas.toDataURL('image/png')
    }) })
    const result = await response.json()
    if (!response.ok) return { status: response.status, error: result.error }
    const image = await fetch(`/api/items/${result.id}/image`)
    return { status: image.status, type: image.headers.get('content-type'), bytes: (await image.arrayBuffer()).byteLength }
  })
  assert.equal(imageResult.status, 200)
  assert.equal(imageResult.type, 'image/webp')
  assert.ok(imageResult.bytes > 0)

  await page.getByRole('button', { name: '设置与数据', exact: true }).click()
  assert.equal(await download(page, 'completed'), 'completed')
  const backupPath = path.join(directory, 'backup.json')
  const backup = JSON.parse(await readFile(backupPath, 'utf8'))
  assert.equal(backup.classes.length, 1)
  assert.equal(await download(page, 'cancelled'), 'cancelled')

  // Native download completion can precede React clearing the busy state.
  // setInputFiles does not wait for the input to become enabled.
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="file"]')
    return input && !input.disabled
  })
  await page.locator('input[type="file"]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('not-json') })
  await page.getByRole('alert').first().waitFor()
  await page.locator('input[type="file"]').setInputFiles(backupPath)
  await page.getByRole('button', { name: '确认导入新副本', exact: true }).click()
  await page.getByRole('button', { name: '进入新班级', exact: true }).click()
  await page.locator('.pet-card').first().waitFor()
  assert.equal(await page.locator('.pet-card').count(), 6)
  await page.getByRole('link', { name: '切换为英文', exact: true }).click()
  await page.getByRole('button', { name: 'Settings & data', exact: true }).waitFor()
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), naming.expected)
  await page.screenshot({ path: path.join(directory, 'desktop-en.png'), fullPage: true })
  const state = await page.evaluate(async () => (await fetch('/api/state')).json())
  assert.equal(state.classes.length, 2)
  await app.close()
  app = undefined
  assert.equal(await fetch(`${firstOrigin}/api/health`).then(() => true, () => false), false)

  page = await launch()
  await page.locator('.pet-card').first().waitFor()
  assert.equal(new URL(page.url()).origin, firstOrigin)
  const restored = await page.evaluate(async () => (await fetch('/api/state')).json())
  assert.equal(restored.classes.length, 2)
  assert.equal(restored.user.display_name, '桌面验证老师')
  await app.close()
  app = undefined

  blocker = createServer(socket => socket.destroy())
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(Number(new URL(firstOrigin).port), '127.0.0.1', resolve) })
  page = await launch()
  await page.locator('.pet-card').first().waitFor()
  assert.notEqual(new URL(page.url()).origin, firstOrigin)
  assert.equal((await page.evaluate(async () => (await fetch('/api/state')).json())).classes.length, 2)
  assert.deepEqual(errors, [])
  if (macUpdate) await checkMacInstall()
  const result = { status: 'ok', screenshots: directory, checks: ['系统语言应用名称', '原生更新菜单与取消下载', '真实窗口注册', '教师资料', '演示班级', '图片加载及原生转码', '令牌隔离', '渲染沙箱', '备份保存与取消', '错误文件', '副本导入', '中英文', '退出回收', '重启持久化', '端口冲突恢复', ...(macUpdate ? ['Mac 本地 ZIP 覆盖更新、重启与数据保留（不含 GitHub 网络下载和管理员授权）'] : [])] }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  if (app) {
    const page = app.windows()[0]
    await page?.screenshot({ path: path.join(directory, 'failure.png'), timeout: 5000 }).catch(() => {})
    console.error('Smoke page state:', await page?.locator('body').innerText({ timeout: 5000 }).catch(() => 'unavailable'))
    console.error('Renderer errors:', errors)
    console.error(await app.evaluate(({ app, BrowserWindow }) => ({
      name: app.getName(), windows: BrowserWindow.getAllWindows().map(window => ({
        title: window.getTitle(), visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), url: window.webContents.getURL(), destroyed: window.webContents.isDestroyed()
      }))
    })).catch(() => '无法读取窗口状态 / Could not inspect window'))
  }
  console.error(directory, { processExit, runtimeOutput })
  console.error(await readFile(path.join(data, 'desktop.log'), 'utf8').catch(() => '尚无启动日志 / No startup log'))
  if (macUpdate) console.error(await readFile(path.join(data, 'update.log'), 'utf8').catch(() => '尚无更新日志 / No update log'))
  throw error
} finally {
  if (app) await app.close().catch(() => {})
  if (macUpdate) {
    await writeFile(quitUpdate, '')
    await updateBrowser?.close().catch(() => {})
    const state = await readFile(path.join(directory, 'update-process.json'), 'utf8').then(JSON.parse, () => null)
    const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
    const deadline = Date.now() + 15000
    while (state?.pid && alive(state.pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250))
    const active = await readFile(path.join(data, 'updates/installing.json'), 'utf8').then(JSON.parse, () => null)
    if ((state?.pid && alive(state.pid)) || (active?.pid && alive(active.pid))) {
      console.error(`测试进程仍在退出，保留隔离副本：${portableDirectory}`)
      portableDirectory = undefined
    }
  }
  if (blocker) await new Promise(resolve => blocker.close(resolve))
  if (portableDirectory) await rm(portableDirectory, { recursive: true, force: true })
}
