import { EventEmitter } from 'node:events'
import { createRequire, Module } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

type UpdateInfo = { version: string }
type CheckResult = { isUpdateAvailable: boolean; updateInfo: UpdateInfo }
type MessageOptions = {
  title: string
  type: string
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
}
type WindowPort = { isDestroyed(): boolean; setProgressBar(progress: number): void }
type UpdaterPort = EventEmitter & {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  autoRunAppAfterInstall: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableWebInstaller: boolean
  logger: { info(message: string): void; warn(message: string): void; error(message: string): void } | null
  checkForUpdates(): Promise<CheckResult | null>
  downloadUpdate(): Promise<string[]>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
}
type Controller = { check(manual?: boolean): Promise<void> | undefined; start(): void; dispose(): void }
type UpdaterOptions = {
  app: { isPackaged: boolean; getName(): string; getVersion(): string; relaunch(): void; quit(): void }
  autoUpdater: UpdaterPort
  dialog: { showMessageBox(...args: unknown[]): Promise<{ response: number }> }
  getWindow(): WindowPort | undefined
  beforeInstall(): Promise<void>
  writeLog(message: string): void
  onStatus(phase: string, percent?: number): void
  t(zh: string, en: string): string
}
const require = createRequire(import.meta.url)
const { createUpdater } = require('../desktop/updater.cjs') as { createUpdater(options: UpdaterOptions): Controller }

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function setup(options: { packaged?: boolean; locale?: 'zh' | 'en'; responses?: number[] } = {}) {
  const responses = [...(options.responses ?? [])]
  const messages: MessageOptions[] = []
  const app = {
    isPackaged: options.packaged ?? true,
    getName: vi.fn(() => options.locale === 'en' ? 'PetBloom' : '萌芽'),
    getVersion: vi.fn(() => '1.0.0'),
    relaunch: vi.fn(),
    quit: vi.fn()
  }
  const autoUpdater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: false,
    allowPrerelease: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    logger: null as UpdaterPort['logger'],
    checkForUpdates: vi.fn<() => Promise<CheckResult | null>>().mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '1.0.0' } }),
    downloadUpdate: vi.fn<() => Promise<string[]>>().mockResolvedValue(['/updates/app.zip']),
    quitAndInstall: vi.fn<(isSilent: boolean, isForceRunAfter: boolean) => void>()
  })
  const window = { isDestroyed: vi.fn(() => false), setProgressBar: vi.fn<(progress: number) => void>() }
  const dialog = {
    showMessageBox: vi.fn(async (...args: unknown[]) => {
      messages.push(args[args.length - 1] as MessageOptions)
      return { response: responses.shift() ?? 1 }
    })
  }
  const getWindow = vi.fn<() => WindowPort | undefined>().mockReturnValue(window)
  const beforeInstall = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const writeLog = vi.fn<(message: string) => void>()
  const onStatus = vi.fn<(phase: string, percent?: number) => void>()
  const controller = createUpdater({
    app, autoUpdater, dialog, getWindow, beforeInstall, writeLog, onStatus,
    t: (zh, en) => options.locale === 'en' ? en : zh
  })
  return { controller, app, autoUpdater, window, dialog, messages, responses, getWindow, beforeInstall, writeLog, onStatus }
}

function available(context: ReturnType<typeof setup>) {
  context.autoUpdater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '1.1.0' } })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('桌面更新控制器', () => {
  it('关闭自动下载、退出自动安装、预发布、降级和 web installer', () => {
    const { autoUpdater } = setup()
    expect(autoUpdater).toMatchObject({
      autoDownload: false, autoInstallOnAppQuit: false, autoRunAppAfterInstall: true,
      allowPrerelease: false, allowDowngrade: false, disableWebInstaller: true
    })
  })

  it('转发更新日志', () => {
    const { autoUpdater, writeLog } = setup()
    autoUpdater.logger!.info('checking')
    autoUpdater.logger!.warn('offline')
    autoUpdater.logger!.error('failed')
    expect(writeLog.mock.calls).toEqual([['checking'], ['offline'], ['failed']])
  })

  it('开发版手动检查只提示，不访问网络', async () => {
    const { controller, autoUpdater, messages } = setup({ packaged: false })
    await controller.check()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(messages).toHaveLength(1)
    expect(messages[0].message).toBe('请在已安装的桌面版中检查更新。')
  })

  it('开发版不安排后台检查，静默检查也不弹窗', async () => {
    vi.useFakeTimers()
    const { controller, autoUpdater, dialog } = setup({ packaged: false })
    controller.start()
    await vi.advanceTimersByTimeAsync(60_000)
    await controller.check(false)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('正式版启动十秒后仅检查一次，重复 start 不增加定时器', async () => {
    vi.useFakeTimers()
    const { controller, autoUpdater, dialog, onStatus } = setup()
    controller.start()
    controller.start()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(onStatus.mock.calls).toEqual([['checking', undefined], ['idle', undefined]])
    controller.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('后台离线失败静默记录，保持原有离线功能', async () => {
    const { controller, autoUpdater, dialog, writeLog, onStatus, app } = setup()
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('offline'))
    await controller.check(false)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(writeLog).toHaveBeenCalledWith(expect.stringContaining('offline'))
    expect(onStatus).toHaveBeenLastCalledWith('idle', undefined)
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('手动离线检查显示可重试提示，不退出或安装', async () => {
    const { controller, autoUpdater, messages, app } = setup()
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('offline'))
    await controller.check()
    expect(messages[0]).toMatchObject({ type: 'warning', title: '萌芽 · 软件更新' })
    expect(messages[0].detail).toContain('已有功能可以继续离线使用')
    expect(app.quit).not.toHaveBeenCalled()
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('手动无更新显示当前版本', async () => {
    const { controller, messages, autoUpdater } = setup()
    await controller.check()
    expect(messages[0].message).toBe('当前已是最新版本（1.0.0）。')
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('英文系统使用完整英文更新提示', async () => {
    const { controller, messages } = setup({ locale: 'en' })
    await controller.check()
    expect(messages[0]).toMatchObject({
      title: 'PetBloom · Software update', message: 'You are up to date (1.0.0).', buttons: ['OK']
    })
  })

  it.each([true, false])('更新器不可用时仅手动检查显示安装包退路：manual=%s', async manual => {
    const { controller, autoUpdater, messages, onStatus } = setup()
    autoUpdater.checkForUpdates.mockResolvedValue(null)
    await controller.check(manual)
    expect(messages).toHaveLength(manual ? 1 : 0)
    if (manual) expect(messages[0].detail).toContain('下载最新安装包')
    expect(onStatus).toHaveBeenLastCalledWith('idle', undefined)
  })

  it('拒绝下载或关闭确认框不下载，且默认选择稍后', async () => {
    const context = setup({ responses: [1] })
    available(context)
    await context.controller.check()
    expect(context.messages[0]).toMatchObject({ type: 'question', defaultId: 1, cancelId: 1, buttons: ['下载更新', '稍后'] })
    expect(context.messages[0].message).toContain('1.1.0')
    expect(context.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(context.onStatus).toHaveBeenLastCalledWith('idle', undefined)
  })

  it('确认前不下载，下载完成后再次确认，稍后不关闭服务或安装', async () => {
    const context = setup({ responses: [0, 1] })
    available(context)
    const choice = deferred<{ response: number }>()
    context.dialog.showMessageBox.mockReturnValueOnce(choice.promise)
    const checking = context.controller.check()
    await vi.waitFor(() => expect(context.dialog.showMessageBox).toHaveBeenCalledTimes(1))
    expect(context.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    choice.resolve({ response: 0 })
    context.responses.splice(0, 1)
    await checking
    expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(context.messages).toHaveLength(1)
    expect(context.messages[0]).toMatchObject({
      defaultId: 1, cancelId: 1, buttons: ['重启并安装', '稍后']
    })
    expect(context.messages[0].detail).toContain('普通退出不会自动安装')
    expect(context.beforeInstall).not.toHaveBeenCalled()
    expect(context.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(context.autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(context.onStatus).toHaveBeenLastCalledWith('ready', undefined)
  })

  it('下载进度取整限制范围，完成后清理 Dock 或任务栏进度', async () => {
    const context = setup({ responses: [0, 1] })
    available(context)
    const download = deferred<string[]>()
    context.autoUpdater.downloadUpdate.mockReturnValue(download.promise)
    const checking = context.controller.check()
    await vi.waitFor(() => expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1))
    expect(context.window.setProgressBar).toHaveBeenCalledWith(0)
    context.autoUpdater.emit('download-progress', { percent: 42.6 })
    context.autoUpdater.emit('download-progress', { percent: -5 })
    context.autoUpdater.emit('download-progress', { percent: 110 })
    expect(context.window.setProgressBar.mock.calls).toEqual([[0], [0.43], [0], [1]])
    expect(context.onStatus).toHaveBeenCalledWith('downloading', 43)
    download.resolve(['/updates/app.zip'])
    await checking
    expect(context.window.setProgressBar).toHaveBeenLastCalledWith(-1)
  })

  it('未下载时忽略无关进度事件', () => {
    const { autoUpdater, window, onStatus } = setup()
    autoUpdater.emit('download-progress', { percent: 50 })
    expect(window.setProgressBar).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalled()
  })

  it('下载失败清理进度、提示重试，并允许下次重新下载', async () => {
    const context = setup({ responses: [0, 0, 0, 1] })
    available(context)
    context.autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('download offline'))
    await context.controller.check()
    expect(context.messages[1].detail).toContain('下载失败')
    expect(context.window.setProgressBar).toHaveBeenLastCalledWith(-1)
    expect(context.onStatus).toHaveBeenLastCalledWith('idle', undefined)
    expect(context.beforeInstall).not.toHaveBeenCalled()
    await context.controller.check()
    expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(context.onStatus).toHaveBeenLastCalledWith('ready', undefined)
  })

  it('下载后稍后安装，再次手动检查只询问安装，不重复查询或下载', async () => {
    const context = setup({ responses: [0, 1, 0] })
    available(context)
    await context.controller.check()
    expect(context.beforeInstall).not.toHaveBeenCalled()
    await context.controller.check()
    expect(context.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(context.messages.map(message => message.buttons[0])).toEqual(['下载更新', '重启并安装', '重启并安装'])
    expect(context.beforeInstall).toHaveBeenCalledTimes(1)
    expect(context.autoUpdater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
  })

  it('选择稍后安装后，启动定时检查和后台检查都不再提示，手动检查仍可继续安装', async () => {
    vi.useFakeTimers()
    const context = setup({ responses: [0, 1, 0] })
    available(context)
    context.controller.start()
    await context.controller.check()
    expect(context.messages).toHaveLength(2)
    expect(context.onStatus).toHaveBeenLastCalledWith('ready', undefined)
    await vi.advanceTimersByTimeAsync(10_000)
    await context.controller.check(false)
    expect(context.messages).toHaveLength(2)
    expect(context.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(context.beforeInstall).not.toHaveBeenCalled()
    expect(context.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(context.onStatus).toHaveBeenLastCalledWith('ready', undefined)
    await context.controller.check()
    expect(context.messages).toHaveLength(3)
    expect(context.beforeInstall).toHaveBeenCalledTimes(1)
    expect(context.autoUpdater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
  })

  it('重复检查共享同一任务，不会并行请求或弹出多个确认框', async () => {
    const context = setup({ responses: [1] })
    const result = deferred<CheckResult>()
    context.autoUpdater.checkForUpdates.mockReturnValue(result.promise)
    const first = context.controller.check()
    const second = context.controller.check()
    expect(first).toBe(second)
    expect(context.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    result.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.1.0' } })
    await first
    expect(context.messages).toHaveLength(1)
    await context.controller.check()
    expect(context.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('下载期间重复检查不再弹窗或重复下载', async () => {
    const context = setup({ responses: [0, 1] })
    available(context)
    const download = deferred<string[]>()
    context.autoUpdater.downloadUpdate.mockReturnValue(download.promise)
    const first = context.controller.check()
    await vi.waitFor(() => expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1))
    expect(context.controller.check()).toBe(first)
    expect(context.messages).toHaveLength(1)
    expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    download.resolve([])
    await first
  })

  it('确认安装后等待本地服务完全停止，再调用安装器', async () => {
    const context = setup({ responses: [0, 0] })
    available(context)
    const stopped = deferred<void>()
    context.beforeInstall.mockReturnValue(stopped.promise)
    const checking = context.controller.check()
    await vi.waitFor(() => expect(context.beforeInstall).toHaveBeenCalledTimes(1))
    expect(context.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(context.onStatus).toHaveBeenLastCalledWith('installing', undefined)
    stopped.resolve()
    await checking
    expect(context.autoUpdater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
  })

  it.each(['beforeInstall', 'quitAndInstall'] as const)('%s 同步或 Promise 安装失败后提示并重新打开现有版本', async stage => {
    const context = setup({ responses: [0, 0, 0] })
    available(context)
    const error = new Error('install failed')
    if (stage === 'beforeInstall') context.beforeInstall.mockRejectedValue(error)
    else context.autoUpdater.quitAndInstall.mockImplementation(() => { throw error })
    await context.controller.check()
    expect(context.messages[2].detail).toContain('将重新打开现有版本')
    expect(context.messages[2].detail).toContain('macOS 自动更新需要已签名的正式版本')
    expect(context.app.relaunch).toHaveBeenCalledTimes(1)
    expect(context.app.quit).toHaveBeenCalledTimes(1)
    if (stage === 'beforeInstall') expect(context.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('安装器异步发出多次错误时先登记一次重启，再等待提示结束退出', async () => {
    const context = setup({ responses: [0, 0] })
    available(context)
    await context.controller.check()
    const warning = deferred<{ response: number }>()
    context.dialog.showMessageBox.mockReturnValueOnce(warning.promise)
    context.autoUpdater.emit('error', new Error('native signature failure'))
    context.autoUpdater.emit('error', new Error('second failure'))
    expect(context.dialog.showMessageBox).toHaveBeenCalledTimes(3)
    expect(context.app.relaunch).toHaveBeenCalledTimes(1)
    expect(context.app.quit).not.toHaveBeenCalled()
    expect(context.app.relaunch.mock.invocationCallOrder[0]).toBeLessThan(context.dialog.showMessageBox.mock.invocationCallOrder[2])
    warning.resolve({ response: 0 })
    await vi.waitFor(() => expect(context.app.quit).toHaveBeenCalledTimes(1))
    expect(context.app.relaunch).toHaveBeenCalledTimes(1)
    context.autoUpdater.emit('error', new Error('late failure'))
    expect(context.dialog.showMessageBox).toHaveBeenCalledTimes(3)
    expect(context.app.relaunch).toHaveBeenCalledTimes(1)
  })

  it('真实 NsisUpdater 启动安装器异步失败，SDK 在警告关闭前退出也保留一次重启登记', async () => {
    const { NsisUpdater } = require('electron-updater/out/NsisUpdater') as typeof import('electron-updater/out/NsisUpdater')
    const sdkRequire = createRequire(require.resolve('electron-updater/out/BaseUpdater'))
    const electronPath = sdkRequire.resolve('electron')
    const originalElectron = require.cache[electronPath]
    const mockElectron = new Module(electronPath)
    mockElectron.exports = { autoUpdater: new EventEmitter() }
    require.cache[electronPath] = mockElectron
    const warning = deferred<{ response: number }>()
    const order: string[] = []
    let controller!: Controller
    const app = {
      isPackaged: true, getName: () => '萌芽', getVersion: () => '1.0.0',
      relaunch: vi.fn(() => { order.push('relaunch') }),
      quit: vi.fn(() => { order.push('quit'); controller.dispose() })
    }
    const autoUpdater = new NsisUpdater(undefined, {
      version: '1.0.0', name: 'PetBloom', isPackaged: true,
      appUpdateConfigPath: '/unused/app-update.yml', userDataPath: '/unused/user-data', baseCachePath: '/unused/cache',
      whenReady: async () => {}, onQuit: () => {}, relaunch: app.relaunch, quit: app.quit
    })
    const info = { version: '1.1.0', files: [], path: 'PetBloom-1.1.0-win-x64.exe', sha512: 'unused', releaseDate: '2026-11-01T00:00:00.000Z' }
    vi.spyOn(autoUpdater, 'checkForUpdates').mockResolvedValue({ isUpdateAvailable: true, updateInfo: info, versionInfo: info })
    vi.spyOn(autoUpdater, 'downloadUpdate').mockResolvedValue(['/updates/PetBloom-1.1.0-win-x64.exe'])
    const spawnLog = vi.fn(() => {
      order.push('spawn')
      return Promise.reject(Object.assign(new Error('installer could not start'), { code: 'EPERM' }))
    })
    Object.defineProperty(autoUpdater, 'spawnLog', { value: spawnLog })
    Object.defineProperty(autoUpdater, 'downloadedUpdateHelper', { value: {
      file: '/updates/PetBloom-1.1.0-win-x64.exe', packageFile: null, downloadedFileInfo: { isAdminRightsRequired: false }
    } })
    const dialog = { showMessageBox: vi.fn(async (...args: unknown[]) => {
      if ((args[args.length - 1] as MessageOptions).type === 'warning') {
        order.push('warning')
        return warning.promise
      }
      return { response: 0 }
    }) }
    try {
      controller = createUpdater({
        app, autoUpdater, dialog, getWindow: () => undefined,
        beforeInstall: async () => { order.push('stop') },
        writeLog: vi.fn(), onStatus: vi.fn(), t: zh => zh
      })
      await controller.check()
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(spawnLog).toHaveBeenCalledExactlyOnceWith('/updates/PetBloom-1.1.0-win-x64.exe', ['--updated', '--force-run'])
      expect(order).toEqual(['stop', 'spawn', 'relaunch', 'warning', 'quit'])
      expect(app.relaunch).toHaveBeenCalledTimes(1)
      expect(app.quit).toHaveBeenCalledTimes(1)
      expect(dialog.showMessageBox).toHaveBeenCalledTimes(3)
      warning.resolve({ response: 0 })
      await new Promise<void>(resolve => setImmediate(resolve))
      autoUpdater.emit('error', new Error('late installer failure after exit'))
      expect(app.relaunch).toHaveBeenCalledTimes(1)
      expect(app.quit).toHaveBeenCalledTimes(1)
      expect(dialog.showMessageBox).toHaveBeenCalledTimes(3)
    } finally {
      warning.resolve({ response: 0 })
      controller?.dispose()
      await new Promise<void>(resolve => setImmediate(resolve))
      if (originalElectron) require.cache[electronPath] = originalElectron
      else delete require.cache[electronPath]
    }
  })

  it('非安装阶段错误仅写日志，不触发重新启动', () => {
    const { autoUpdater, writeLog, app, dialog } = setup()
    expect(() => autoUpdater.emit('error', new Error('network failure'))).not.toThrow()
    expect(writeLog).toHaveBeenCalledWith(expect.stringContaining('network failure'))
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it.each(['missing', 'destroyed'] as const)('窗口 %s 时使用无父窗口的原生提示', async state => {
    const context = setup()
    if (state === 'missing') context.getWindow.mockReturnValue(undefined)
    else context.window.isDestroyed.mockReturnValue(true)
    await context.controller.check()
    expect(context.dialog.showMessageBox.mock.calls[0]).toHaveLength(1)
    expect(context.messages[0].title).toBe('萌芽 · 软件更新')
  })

  it('现有窗口作为原生提示的父窗口', async () => {
    const { controller, dialog, window } = setup()
    await controller.check()
    expect(dialog.showMessageBox.mock.calls[0][0]).toBe(window)
  })

  it('dispose 取消启动定时器，之后 start 和 check 都不联网', async () => {
    vi.useFakeTimers()
    const { controller, autoUpdater, dialog } = setup()
    controller.start()
    controller.dispose()
    expect(vi.getTimerCount()).toBe(0)
    controller.start()
    expect(controller.check()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('dispose 后保留错误监听吸收异步错误，但不再更新 UI 或日志', () => {
    const { controller, autoUpdater, window, dialog, writeLog, onStatus, app } = setup()
    controller.dispose()
    expect(autoUpdater.listenerCount('error')).toBeGreaterThan(0)
    expect(autoUpdater.listenerCount('download-progress')).toBe(0)
    expect(autoUpdater.logger).toBeNull()
    expect(() => autoUpdater.emit('error', new Error('request finished during quit'))).not.toThrow()
    autoUpdater.emit('download-progress', { percent: 50 })
    expect(window.setProgressBar).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalled()
    expect(writeLog).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(app.relaunch).not.toHaveBeenCalled()
  })

  it.each(['available', 'offline'] as const)('检查进行中退出，随后 %s 结果都不会弹窗', async result => {
    const context = setup()
    const request = deferred<CheckResult>()
    context.autoUpdater.checkForUpdates.mockReturnValue(request.promise)
    const checking = context.controller.check()
    context.controller.dispose()
    if (result === 'available') request.resolve({ isUpdateAvailable: true, updateInfo: { version: '1.1.0' } })
    else request.reject(new Error('offline during quit'))
    await checking
    expect(context.dialog.showMessageBox).not.toHaveBeenCalled()
    expect(context.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(context.onStatus).toHaveBeenCalledTimes(1)
  })

  it('下载确认框打开时退出，随后确认也不会开始下载', async () => {
    const context = setup()
    available(context)
    const choice = deferred<{ response: number }>()
    context.dialog.showMessageBox.mockReturnValue(choice.promise)
    const checking = context.controller.check()
    await vi.waitFor(() => expect(context.dialog.showMessageBox).toHaveBeenCalledTimes(1))
    context.controller.dispose()
    choice.resolve({ response: 0 })
    await checking
    expect(context.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'] as const)('下载途中退出后 %s，不再询问安装或触发恢复', async result => {
    const context = setup({ responses: [0] })
    available(context)
    const download = deferred<string[]>()
    context.autoUpdater.downloadUpdate.mockReturnValue(download.promise)
    const checking = context.controller.check()
    await vi.waitFor(() => expect(context.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1))
    context.controller.dispose()
    if (result === 'success') download.resolve([])
    else download.reject(new Error('download failed during quit'))
    await checking
    expect(context.dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(context.beforeInstall).not.toHaveBeenCalled()
    expect(context.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    expect(context.app.relaunch).not.toHaveBeenCalled()
  })
})
