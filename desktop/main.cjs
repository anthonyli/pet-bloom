const { app, BrowserWindow, Menu, dialog, session, shell, utilityProcess } = require('electron')
const { randomBytes } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } = require('node:fs')
const path = require('node:path')
const { createUpdater } = require('./updater.cjs')

app.setName('PetBloom')
const dataOverride = app.commandLine.getSwitchValue('user-data-dir') || (!app.isPackaged && process.env.PETBLOOM_DESKTOP_DATA)
const dataDirectory = dataOverride ? path.resolve(dataOverride)
  : path.join(app.getPath('appData'), app.isPackaged ? 'PetBloom' : 'PetBloom Development')
mkdirSync(dataDirectory, { recursive: true })
app.setPath('userData', dataDirectory)

let window
let server
let origin
let quitting = false
let log
let updates
const token = randomBytes(32).toString('hex')
const settingsFile = path.join(dataDirectory, 'desktop.json')
const t = (zh, en) => app.getPreferredSystemLanguages()[0].startsWith('zh') ? zh : en

function writeLog(message) {
  if (log && !log.writableEnded) log.write(`${new Date().toISOString()} ${message}\n`)
}

function showFailure(error) {
  writeLog(error.stack || error)
  dialog.showErrorBox(t('萌芽启动失败', 'PetBloom could not start'), t(
    `请重新打开应用。若仍失败，请保留数据目录并检查 desktop.log，不要删除数据库。\n\n${error.message}\n\n数据目录：${dataDirectory}`,
    `Please reopen the app. If the problem persists, keep the data directory and check desktop.log. Do not delete the database.\n\n${error.message}\n\nData directory: ${dataDirectory}`
  ))
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'server.cjs'), [], {
      serviceName: 'PetBloom Local Server',
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_PATH: path.join(dataDirectory, 'pet-garden.db'),
        DESKTOP_TOKEN: token,
        DESKTOP_PORT: String(port),
        COOKIE_SECURE: 'false',
        NEXT_TELEMETRY_DISABLED: '1'
      }
    })
    server = child
    child.stdout.on('data', chunk => writeLog(chunk))
    child.stderr.on('data', chunk => writeLog(chunk))
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(t('本地服务启动超时。', 'The local server timed out.')))
    }, 60000)
    let ready = false
    child.on('message', message => {
      if (message.type !== 'ready' || ready) return
      ready = true
      clearTimeout(timeout)
      resolve(message.port)
    })
    child.once('exit', code => {
      clearTimeout(timeout)
      if (server === child) server = undefined
      if (!ready) reject(new Error(t(`本地服务退出（${code}）。`, `The local server exited (${code}).`)))
      else if (!quitting) {
        showFailure(new Error(t('本地服务意外停止，请重启应用。', 'The local server stopped unexpectedly. Please restart the app.')))
        app.quit()
      }
    })
  })
}

async function stopServer() {
  const child = server
  if (!child) return
  await new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill(); resolve() }, 5000)
    child.once('exit', () => { clearTimeout(timeout); resolve() })
    child.postMessage({ type: 'shutdown' })
  })
}

function createWindow() {
  window = new BrowserWindow({
    title: app.getName(),
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#ffffff',
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      partition: 'persist:petbloom',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged
    }
  })
  window.on('page-title-updated', event => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  for (const event of ['will-navigate', 'will-redirect']) window.webContents.on(event, (navigation, url) => {
    if (new URL(url).origin !== origin) navigation.preventDefault()
  })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.once('ready-to-show', () => { window?.show(); updates.start() })
  window.on('closed', () => { window = undefined })
  window.loadURL(`${origin}/${t('zh', 'en')}`).catch(error => {
    if (!quitting && error.code !== 'ERR_ABORTED') { showFailure(error); app.quit() }
  })
}

function configureSession() {
  const browserSession = session.fromPartition('persist:petbloom')
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(
    permission === 'clipboard-sanitized-write' && contents === window?.webContents && new URL(details.requestingUrl).origin === origin
  ))
  browserSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    permission === 'clipboard-sanitized-write' && contents === window?.webContents && requestingOrigin === origin
  )
  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    // 仅应用窗口可访问本地服务，不把桌面令牌交给其他来源。
    if (new URL(details.url).origin === origin && details.webContentsId === window?.webContents.id) headers['x-petbloom-desktop'] = token
    callback({ requestHeaders: headers })
  })
  browserSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({
      title: t('保存备份', 'Save backup'),
      defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())),
      filters: [{ name: t('JSON 备份', 'JSON backup'), extensions: ['json'] }]
    })
    item.once('done', (_downloadEvent, state) => {
      if (state === 'interrupted') dialog.showErrorBox(t('备份保存失败', 'Could not save backup'), t('请重新导出并选择可写入的文件夹。', 'Please export again and choose a writable folder.'))
    })
  })
}

function configureMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu', label: app.getName() }] : []),
    { label: t('文件', 'File'), submenu: [
      { id: 'check-for-updates', label: t('检查更新…', 'Check for updates…'), click: () => { void updates.check() } },
      { label: t('下载最新安装包', 'Download latest installer'), click: async () => {
        try { await shell.openExternal('https://github.com/anthonyli/class-pet/releases/latest') }
        catch (error) { dialog.showErrorBox(t('无法打开下载页面', 'Could not open download page'), error.message) }
      } },
      { type: 'separator' },
      { label: t('打开数据文件夹', 'Open data folder'), click: async () => {
        const error = await shell.openPath(dataDirectory)
        if (error) dialog.showErrorBox(t('无法打开文件夹', 'Could not open folder'), error)
      } },
      { type: 'separator' },
      { role: 'close' },
      ...(process.platform === 'darwin' ? [] : [{ role: 'quit' }])
    ] },
    { role: 'editMenu', label: t('编辑', 'Edit') },
    { label: t('视图', 'View'), submenu: [
      { role: 'reload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' }
    ] },
    { role: 'windowMenu', label: t('窗口', 'Window') }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
    credits: t('离线桌面版 · 数据保存在此电脑，不会自动同步。', 'Offline desktop edition · Data stays on this computer and does not sync automatically.')
  })
}

function updateMenu(phase, percent) {
  const item = Menu.getApplicationMenu()?.getMenuItemById('check-for-updates')
  if (!item) return
  item.enabled = phase === 'idle' || phase === 'ready'
  item.label = phase === 'checking' ? t('正在检查更新…', 'Checking for updates…')
    : phase === 'downloading' ? t(`正在下载更新 ${percent}%`, `Downloading update ${percent}%`)
    : phase === 'installing' ? t('正在安装更新…', 'Installing update…')
    : phase === 'ready' ? t('重启并安装更新…', 'Restart and install update…')
    : t('检查更新…', 'Check for updates…')
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (!origin || quitting) return
    if (!window) createWindow()
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  app.on('activate', () => { if (!window && origin && !quitting) createWindow() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', event => {
    updates?.dispose()
    if (quitting) { log?.end(); return }
    event.preventDefault()
    quitting = true
    stopServer().finally(() => { log?.end(); app.quit() })
  })
  app.whenReady().then(async () => {
    app.setName(t('萌芽', 'PetBloom'))
    log = createWriteStream(path.join(dataDirectory, 'desktop.log'), { flags: 'w' })
    updates = createUpdater({
      app, autoUpdater: require('electron-updater').autoUpdater, dialog,
      getWindow: () => window,
      beforeInstall: async () => { quitting = true; await stopServer() },
      writeLog, onStatus: updateMenu, t
    })
    let preferredPort = 0
    if (existsSync(settingsFile)) {
      try {
        const settings = JSON.parse(readFileSync(settingsFile, 'utf8'))
        if (Number.isInteger(settings.port) && settings.port > 1023 && settings.port < 65536) preferredPort = settings.port
      } catch {}
    }
    let port
    try { port = await startServer(preferredPort) }
    catch (error) {
      if (!preferredPort) throw error
      port = await startServer(0)
    }
    origin = `http://127.0.0.1:${port}`
    writeFileSync(settingsFile, JSON.stringify({ port }))
    configureSession()
    configureMenu()
    createWindow()
  }).catch(error => { showFailure(error); app.quit() })
}
