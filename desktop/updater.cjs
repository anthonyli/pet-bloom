function createUpdater({ app, autoUpdater, dialog, getWindow, beforeInstall, writeLog, onStatus, t }) {
  let phase = 'idle'
  let downloaded
  let pending
  let startupTimer
  let started = false
  let disposed = false
  let recovering = false

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = {
    info: message => writeLog(String(message)),
    warn: message => writeLog(String(message)),
    error: message => writeLog(String(message))
  }

  function status(next, percent) {
    phase = next
    if (!disposed) onStatus(next, percent)
  }

  function message(options) {
    const settings = { title: `${app.getName()} · ${t('软件更新', 'Software update')}`, ...options }
    const window = getWindow()
    return window && !window.isDestroyed() ? dialog.showMessageBox(window, settings) : dialog.showMessageBox(settings)
  }

  async function failure(detail) {
    if (disposed) return
    await message({
      type: 'warning', message: t('更新未完成，现有数据会保留。', 'The update did not complete. Your data is preserved.'),
      detail, buttons: [t('知道了', 'OK')]
    })
  }

  async function recoverInstall(error) {
    if (recovering || disposed) return
    recovering = true
    writeLog(error.stack || String(error))
    // 安装器可能先触发退出，必须在等待提示前登记重启。
    app.relaunch()
    await failure(t(
      '将重新打开现有版本。请稍后重试，或通过“文件 → 下载最新安装包”手动覆盖安装；macOS 自动更新需要已签名的正式版本。',
      'The current version will reopen. Retry later or use File → Download latest installer to upgrade manually. macOS automatic updates require a signed release.'
    ))
    if (!disposed) app.quit()
  }

  function onError(error) {
    if (disposed) return
    writeLog(error.stack || String(error))
    if (phase === 'installing') void recoverInstall(error)
  }

  function onProgress(progress) {
    if (disposed || phase !== 'downloading') return
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)))
    getWindow()?.setProgressBar(percent / 100)
    onStatus('downloading', percent)
  }

  autoUpdater.on('error', onError)
  autoUpdater.on('download-progress', onProgress)

  async function install() {
    status('prompting')
    const result = await message({
      type: 'question', message: t(`版本 ${downloaded.version} 已下载，是否重启安装？`, `Version ${downloaded.version} is downloaded. Restart to install?`),
      detail: t(
        '安装会关闭并重新打开应用，账号、班级和记录会保留。建议先导出备份。选择稍后时，普通退出不会自动安装，可再次点击“检查更新”继续。',
        'Installation closes and reopens the app, preserving accounts, classes and records. Export a backup first. Choosing Later also prevents installation on normal quit; use Check for updates to continue.'
      ),
      buttons: [t('重启并安装', 'Restart and install'), t('稍后', 'Later')], defaultId: 1, cancelId: 1
    })
    if (disposed) return
    if (result.response !== 0) { status('ready'); return }
    status('installing')
    try {
      await beforeInstall()
      if (!disposed) autoUpdater.quitAndInstall(false, true)
    } catch (error) { await recoverInstall(error) }
  }

  async function runCheck(manual) {
    if (!app.isPackaged) {
      if (manual) await message({ type: 'info', message: t('请在已安装的桌面版中检查更新。', 'Check for updates from the installed desktop edition.'), buttons: [t('知道了', 'OK')] })
      return
    }
    if (downloaded) { if (manual) await install(); return }
    status('checking')
    let result
    try { result = await autoUpdater.checkForUpdates() }
    catch (error) {
      writeLog(error.stack || String(error))
      if (manual) await failure(t('暂时无法检查更新。请检查网络后重试；已有功能可以继续离线使用。', 'Updates could not be checked. Check your connection and retry; existing features remain available offline.'))
      if (!disposed) status('idle')
      return
    }
    if (disposed) return
    if (!result) {
      if (manual) await failure(t('此版本暂时无法自动更新，请通过“文件 → 下载最新安装包”手动升级。', 'Automatic updates are unavailable for this build. Use File → Download latest installer to upgrade manually.'))
      status('idle')
      return
    }
    if (!result.isUpdateAvailable) {
      if (manual) await message({ type: 'info', message: t(`当前已是最新版本（${app.getVersion()}）。`, `You are up to date (${app.getVersion()}).`), buttons: [t('知道了', 'OK')] })
      status('idle')
      return
    }
    status('prompting')
    const choice = await message({
      type: 'question', message: t(`发现新版本 ${result.updateInfo.version}，是否下载？`, `Version ${result.updateInfo.version} is available. Download it?`),
      detail: t('下载期间可以继续使用应用。下载完成后会再次询问是否重启安装，不会自动替换当前版本。', 'Keep using the app while downloading. You will be asked again before restarting to install; the current version is not replaced automatically.'),
      buttons: [t('下载更新', 'Download update'), t('稍后', 'Later')], defaultId: 1, cancelId: 1
    })
    if (disposed) return
    if (choice.response !== 0) { status('idle'); return }
    status('downloading', 0)
    getWindow()?.setProgressBar(0)
    try {
      await autoUpdater.downloadUpdate()
      if (disposed) return
      downloaded = result.updateInfo
    } catch (error) {
      writeLog(error.stack || String(error))
      await failure(t('下载失败，请检查网络并通过“检查更新”重试，或选择“文件 → 下载最新安装包”。', 'The download failed. Check your connection and retry with Check for updates, or use File → Download latest installer.'))
      if (!disposed) status('idle')
      return
    } finally { getWindow()?.setProgressBar(-1) }
    await install()
  }

  function check(manual = true) {
    if (disposed || pending) return pending
    pending = runCheck(manual).finally(() => { pending = undefined })
    return pending
  }

  function start() {
    if (started || disposed || !app.isPackaged) return
    started = true
    startupTimer = setTimeout(() => { startupTimer = undefined; void check(false) }, 10000)
  }

  function dispose() {
    disposed = true
    clearTimeout(startupTimer)
    // 尚未结束的请求仍可能发出 error，退出期间必须保留监听。
    autoUpdater.removeListener('download-progress', onProgress)
    autoUpdater.logger = null
  }

  return { check, start, dispose }
}

module.exports = { createUpdater }
