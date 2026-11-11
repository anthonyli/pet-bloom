const path = require('node:path')
const { AppUpdater } = require('electron-updater/out/AppUpdater')
const installer = require('./mac-install.cjs')

class MacUpdater extends AppUpdater {
  async doDownloadUpdate(options) {
    const { info, provider } = options.updateInfoAndProvider
    const name = `PetBloom-${info.version}-mac-${process.arch}.zip`
    const file = provider.resolveFiles(info).find(file => file.info.url === name)
    if (!file || file.url.protocol !== 'https:' || file.url.hostname !== 'github.com' || !file.url.pathname.startsWith('/anthonyli/pet-bloom/releases/download/') || !/^[A-Za-z0-9+/]{86}==$/.test(file.info.sha512)) throw new Error('缺少可信的 Mac 更新包 / A trusted Mac update package is required')
    return this.executeDownload({
      fileExtension: 'zip', fileInfo: file, downloadUpdateOptions: { ...options, disableDifferentialDownload: true },
      task: (destination, downloadOptions) => this.httpExecutor.download(file.url, destination, downloadOptions),
      done: async event => {
        this.downloaded = { archive: event.downloadedFile, sha512: file.info.sha512, version: info.version }
        this.dispatchUpdateDownloaded(event)
      }
    })
  }

  async prepareInstall() {
    if (!this.downloaded) throw new Error('请先下载更新 / Download the update first')
    const { app } = require('electron')
    this.plan = await installer.prepare({
      ...this.downloaded,
      bundle: path.resolve(path.dirname(process.execPath), '../..'),
      dataDirectory: app.getPath('userData'), arch: process.arch, oldVersion: app.getVersion(),
      locale: app.getPreferredSystemLanguages()[0].startsWith('zh') ? 'zh' : 'en'
    })
  }

  async quitAndInstall() {
    if (!this.plan) throw new Error('更新尚未准备完成 / Update is not prepared')
    await installer.launch(this.plan, process.execPath)
    require('electron').app.quit()
  }
}

let current
function getUpdater() {
  if (!current) current = process.platform === 'darwin' ? new MacUpdater() : require('electron-updater').autoUpdater
  return current
}

module.exports = { MacUpdater, getUpdater }
