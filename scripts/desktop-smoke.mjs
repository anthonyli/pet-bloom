import { _electron as electron } from 'playwright-core'
import { strict as assert } from 'node:assert'
import { createRequire } from 'node:module'
import { cp, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises'
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
    const updater = process.mainModule.require('electron-updater').autoUpdater
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
    const updater = process.mainModule.require('electron-updater').autoUpdater
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
      assert.equal(config.repo, 'class-pet')
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

try {
  let page = await launch()
  const firstOrigin = new URL(page.url()).origin
  assert.equal((await fetch(`${firstOrigin}/api/health`)).status, 403)
  assert.equal((await fetch(`${firstOrigin}/_next/static/does-not-exist.js`)).status, 403)
  await page.getByRole('button', { name: '创建账号', exact: true }).click()
  await page.getByLabel('用户名', { exact: true }).fill(`desktop-${randomBytes(5).toString('hex')}`)
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
  const result = { status: 'ok', screenshots: directory, checks: ['系统语言应用名称', '原生更新菜单与取消下载', '真实窗口注册', '教师资料', '演示班级', '图片加载及原生转码', '令牌隔离', '渲染沙箱', '备份保存与取消', '错误文件', '副本导入', '中英文', '退出回收', '重启持久化', '端口冲突恢复'] }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  if (app) {
    const page = app.windows()[0]
    await page?.screenshot({ path: path.join(directory, 'failure.png'), timeout: 5000 }).catch(() => {})
    console.error(await app.evaluate(({ app, BrowserWindow }) => ({
      name: app.getName(), windows: BrowserWindow.getAllWindows().map(window => ({
        title: window.getTitle(), visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), url: window.webContents.getURL(), destroyed: window.webContents.isDestroyed()
      }))
    })).catch(() => '无法读取窗口状态 / Could not inspect window'))
  }
  console.error(directory, { processExit, runtimeOutput })
  console.error(await readFile(path.join(data, 'desktop.log'), 'utf8').catch(() => '尚无启动日志 / No startup log'))
  throw error
} finally {
  if (app) await app.close().catch(() => {})
  if (blocker) await new Promise(resolve => blocker.close(resolve))
  if (portableDirectory) await rm(portableDirectory, { recursive: true, force: true })
}
