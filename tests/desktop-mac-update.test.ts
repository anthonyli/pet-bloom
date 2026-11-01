import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { extract, digest, verifyBundle, prepare, loadPlan, install, receipt, quote, privilegedScript } = require('../desktop/mac-install.cjs')
const { MacUpdater } = require('../desktop/update-client.cjs')
const temporary: string[] = []

async function directory() {
  const value = await realpath(await mkdtemp(path.join(tmpdir(), 'petbloom-mac-update-')))
  temporary.push(value)
  return value
}

type Entry = { name: string; data?: string | Buffer; mode?: number }
async function zip(root: string, entries: Entry[]) {
  const parts: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data ?? '')
    const header = Buffer.alloc(30), index = Buffer.alloc(46)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26)
    index.writeUInt32LE(0x02014b50); index.writeUInt16LE(0x314, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8)
    index.writeUInt32LE(crc32(data), 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(name.length, 28)
    index.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38); index.writeUInt32LE(offset, 42)
    parts.push(header, name, data); central.push(index, name); offset += header.length + name.length + data.length
  }
  const end = Buffer.alloc(22), table = Buffer.concat(central)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16)
  const archive = path.join(root, `update-${randomBytes(4).toString('hex')}.zip`)
  await writeFile(archive, Buffer.concat([...parts, table, end]))
  return archive
}

async function bundle(root: string, version = '0.0.1', id = 'app.petbloom.desktop', arch = process.arch) {
  const app = path.join(root, 'PetBloom.app')
  await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true })
  await writeFile(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key><string>PetBloom</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`)
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf); header.writeUInt32LE(arch === 'arm64' ? 0x100000c : 0x1000007, 4)
  await writeFile(path.join(app, 'Contents/MacOS/PetBloom'), header, { mode: 0o755 })
  return app
}

async function transaction() {
  const root = await directory(), dataDirectory = path.join(root, 'data')
  await mkdir(path.join(dataDirectory, 'updates'), { recursive: true })
  const workspace = await mkdtemp(path.join(dataDirectory, 'updates/install-'))
  const current = await bundle(path.join(root, 'installed'))
  const candidate = await bundle(workspace, '0.0.2')
  await writeFile(path.join(dataDirectory, 'pet-garden.db'), 'user data stays')
  const archive = await zip(root, [
    { name: 'PetBloom.app/Contents/Info.plist', data: await readFile(path.join(candidate, 'Contents/Info.plist')) },
    { name: 'PetBloom.app/Contents/MacOS/PetBloom', data: await readFile(path.join(candidate, 'Contents/MacOS/PetBloom')), mode: 0o100755 }
  ])
  const cached = path.join(workspace, 'update.zip')
  await writeFile(cached, await readFile(archive))
  return { bundle: current, candidate, workspace, dataDirectory, archive: cached, sha512: await digest(cached), quarantine: '0083;1234;PetBloom;1111-2222', version: '0.0.2', oldVersion: '0.0.1', arch: process.arch, locale: 'en', parentPid: process.pid, nonce: randomBytes(32).toString('hex') }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporary.splice(0).map(file => rm(file, { recursive: true, force: true })))
})

describe('Mac 更新包解压安全边界', () => {
  it('解压普通文件并规范化权限，保留可执行位', async () => {
    const root = await directory()
    const archive = await zip(root, [{ name: 'PetBloom.app/Contents/file', data: 'contents' }, { name: 'PetBloom.app/Contents/MacOS/PetBloom', data: 'executable', mode: 0o100755 }])
    const app = await extract(archive, path.join(root, 'out'))
    expect(await readFile(path.join(app, 'Contents/file'), 'utf8')).toBe('contents')
    if (process.platform !== 'win32') expect((await stat(path.join(app, 'Contents/MacOS/PetBloom'))).mode & 0o777).toBe(0o755)
  })

  it.each(['../outside', '/absolute', 'Other.app/file', 'PetBloom.app/../../outside', 'PetBloom.app/./file', 'PetBloom.app/Contents\\outside'])('拒绝非应用路径和穿越：%s', async name => {
    const root = await directory()
    const archive = await zip(root, [{ name, data: 'invalid' }])
    await expect(extract(archive, path.join(root, 'out'))).rejects.toThrow()
  })

  it.each([0o104755, 0o102755, 0o100666, 0o020666, 0o060666])('拒绝危险权限或特殊文件：%s', async mode => {
    const root = await directory()
    const archive = await zip(root, [{ name: 'PetBloom.app/Contents/file', mode }])
    await expect(extract(archive, path.join(root, 'out'))).rejects.toThrow(/Unsafe/)
  })

  it.skipIf(process.platform === 'win32')('允许真实框架使用的内部相对符号链接', async () => {
    const root = await directory()
    const archive = await zip(root, [{ name: 'PetBloom.app/Contents/Versions/A/file', data: 'framework' }, { name: 'PetBloom.app/Contents/Current', data: 'Versions/A', mode: 0o120777 }])
    const app = await extract(archive, path.join(root, 'out'))
    expect(await readFile(path.join(app, 'Contents/Current/file'), 'utf8')).toBe('framework')
  })

  it.each(['/etc', '../../../outside', '../..'])('拒绝外逸符号链接：%s', async target => {
    const root = await directory()
    const archive = await zip(root, [{ name: 'PetBloom.app/Contents/link', data: target, mode: 0o120777 }])
    await expect(extract(archive, path.join(root, 'out'))).rejects.toThrow(/link escapes/)
  })

  it.skipIf(process.platform === 'win32')('链接与后续文件路径冲突时拒绝，不能沿链接写文件', async () => {
    const root = await directory()
    const archive = await zip(root, [{ name: 'PetBloom.app/Contents/alias', data: '.', mode: 0o120777 }, { name: 'PetBloom.app/Contents/alias/file', data: 'bad' }])
    await expect(extract(archive, path.join(root, 'out'))).rejects.toThrow()
  })

  it('允许 ditto 的可组写元数据目录，但拒绝其中的链接及特权文件', async () => {
    const root = await directory()
    const archive = await zip(root, [{ name: '__MACOSX/', mode: 0o040775 }, { name: 'PetBloom.app/file', data: 'safe' }])
    expect(await readFile(path.join(await extract(archive, path.join(root, 'valid')), 'file'), 'utf8')).toBe('safe')
    for (const mode of [0o120777, 0o104755]) {
      const invalid = await zip(root, [{ name: '__MACOSX/unsafe', data: '../outside', mode }])
      await expect(extract(invalid, path.join(root, `invalid-${mode}`))).rejects.toThrow()
    }
  })

  it('重复文件名拒绝覆盖', async () => {
    const root = await directory()
    const archive = await zip(root, [{ name: 'PetBloom.app/file', data: 'first' }, { name: 'PetBloom.app/file', data: 'second' }])
    await expect(extract(archive, path.join(root, 'out'))).rejects.toThrow()
  })

  it('对真实文件计算完整 SHA-512', async () => {
    const root = await directory(), file = path.join(root, 'file')
    await writeFile(file, 'hash me')
    expect(await digest(file)).toBe(createHash('sha512').update('hash me').digest('base64'))
  })

  it('Shell 引号不能插入额外命令', () => {
    expect(quote("/Applications/PetBloom's app; $(bad).app")).toBe("'/Applications/PetBloom'\\''s app; $(bad).app'")
  })
})

describe.skipIf(process.platform !== 'darwin')('Mac 应用验证和替换事务', () => {
  it('不要求 Apple 证书，仍验证应用标识、版本与芯片', async () => {
    const root = await directory(), app = await bundle(root)
    await verifyBundle(app, '0.0.1', process.arch)
    await expect(verifyBundle(app, '0.0.2', process.arch)).rejects.toThrow(/identity or version/)
    await expect(verifyBundle(app, '0.0.1', process.arch === 'arm64' ? 'x64' : 'arm64')).rejects.toThrow(/architecture/)
  })

  it('拒绝其他应用、外部链接和 setuid 文件', async () => {
    const root = await directory(), app = await bundle(root, '0.0.1', 'other.app')
    await expect(verifyBundle(app, '0.0.1', process.arch)).rejects.toThrow(/identity or version/)
    const valid = await bundle(path.join(root, 'valid'))
    await symlink('/etc/passwd', path.join(valid, 'Contents/external'))
    await expect(verifyBundle(valid, '0.0.1', process.arch)).rejects.toThrow(/link escapes/)
    await rm(path.join(valid, 'Contents/external'))
    await chmod(path.join(valid, 'Contents/MacOS/PetBloom'), 0o4755)
    await expect(verifyBundle(valid, '0.0.1', process.arch)).rejects.toThrow(/Unsafe bundle/)
  })

  it('校验失败不修改现有应用，且不留下待安装计划', async () => {
    const root = await directory(), current = await bundle(root), archive = await zip(root, [])
    await expect(prepare({ archive, sha512: 'incorrect', version: '0.0.2', bundle: current, dataDirectory: path.join(root, 'data'), arch: process.arch, oldVersion: '0.0.1', locale: 'zh' })).rejects.toThrow(/checksum/)
    await verifyBundle(current, '0.0.1', process.arch)
  })

  it('成功替换必须等待新版本 ready，且不动用户数据库', async () => {
    const plan = await transaction()
    let beforeReady = false
    await install(plan, { open: async () => {
      await verifyBundle(plan.bundle, '0.0.2', process.arch)
      beforeReady = true
      await writeFile(path.join(plan.workspace, 'ready.json'), JSON.stringify({ nonce: plan.nonce, version: '0.0.2' }))
      await writeFile(path.join(plan.workspace, 'ack'), plan.nonce)
    } })
    expect(beforeReady).toBe(true)
    expect(await readFile(path.join(plan.dataDirectory, 'pet-garden.db'), 'utf8')).toBe('user data stays')
    await expect(stat(plan.workspace)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('启动失败或 ready 超时恢复旧版，不把 open 成功当作启动成功', async () => {
    const plan = await transaction(), opened: boolean[] = []
    await expect(install(plan, { timeout: 10, open: async (failed: boolean) => { opened.push(failed) } })).rejects.toThrow(/did not finish/)
    expect(opened).toEqual([false, true])
    await verifyBundle(plan.bundle, '0.0.1', process.arch)
    expect(await readFile(path.join(plan.dataDirectory, 'pet-garden.db'), 'utf8')).toBe('user data stays')
  })

  it('复制失败时旧版原地保留并重新打开', async () => {
    const plan = await transaction(), opened: boolean[] = []
    await expect(install(plan, { run: async () => { throw Object.assign(new Error('copy failed'), { code: 'EIO' }) }, open: async (failed: boolean) => { opened.push(failed) } })).rejects.toThrow('copy failed')
    expect(opened).toEqual([true])
    await verifyBundle(plan.bundle, '0.0.1', process.arch)
  })

  it('提升新目录失败会恢复旧目录，而不是删除旧应用', async () => {
    const plan = await transaction()
    const filesystem = require('node:fs/promises')
    const rename = filesystem.rename
    vi.spyOn(filesystem, 'rename').mockImplementation((...args: unknown[]) => {
      const [source, destination] = args as [string, string]
      if (source.endsWith('/unpacked/PetBloom.app')) return Promise.reject(new Error('promotion failed'))
      return rename(source, destination)
    })
    await expect(install(plan, { open: async () => {} })).rejects.toThrow('promotion failed')
    await verifyBundle(plan.bundle, '0.0.1', process.arch)
  })

  it('新版改写数据库后启动失败，会恢复数据库、WAL 并移除新产生的 SHM', async () => {
    const plan = await transaction()
    await writeFile(path.join(plan.dataDirectory, 'pet-garden.db-wal'), 'old WAL')
    await expect(install(plan, { timeout: 1, open: async (failed: boolean) => {
      if (failed) return
      for (const name of ['pet-garden.db', 'pet-garden.db-wal', 'pet-garden.db-shm']) await writeFile(path.join(plan.dataDirectory, name), 'new schema')
    } })).rejects.toThrow(/did not finish/)
    expect(await readFile(path.join(plan.dataDirectory, 'pet-garden.db'), 'utf8')).toBe('user data stays')
    expect(await readFile(path.join(plan.dataDirectory, 'pet-garden.db-wal'), 'utf8')).toBe('old WAL')
    await expect(stat(path.join(plan.dataDirectory, 'pet-garden.db-shm'))).rejects.toMatchObject({ code: 'ENOENT' })
    await verifyBundle(plan.bundle, '0.0.1', process.arch)
  })

  it('日志路径不可写也不能阻断旧版和数据恢复', async () => {
    const plan = await transaction()
    await mkdir(path.join(plan.dataDirectory, 'update.log'))
    await expect(install(plan, { timeout: 1, open: async (failed: boolean) => {
      if (!failed) await writeFile(path.join(plan.dataDirectory, 'pet-garden.db'), 'new schema')
    } })).rejects.toThrow(/did not finish/)
    expect(await readFile(path.join(plan.dataDirectory, 'pet-garden.db'), 'utf8')).toBe('user data stays')
    await verifyBundle(plan.bundle, '0.0.1', process.arch)
  })

  it('缓存 ZIP 在确认后被改动会再次校验并拒绝替换', async () => {
    const plan = await transaction()
    await writeFile(plan.archive, 'tampered')
    await expect(install(plan, { open: async () => {} })).rejects.toThrow(/checksum/)
    await verifyBundle(plan.bundle, '0.0.1', process.arch)
  })

  it('提权脚本语法有效，不向用户目录写 root 标记，也不执行下载代码', async () => {
    const plan = await transaction()
    const transactionDirectory = path.join(path.dirname(plan.bundle), `.petbloom-install-${plan.nonce.slice(0, 24)}`)
    for (const action of ['install', 'rollback', 'cleanup']) {
      const script = privilegedScript(plan, transactionDirectory, action)
      execFileSync('/bin/sh', ['-n'], { input: script })
      expect(script).not.toContain('/usr/bin/touch')
      expect(script).not.toContain('installer.cjs')
      expect(script).not.toContain('commit.json')
      expect(script).not.toContain('osascript')
    }
    expect(privilegedScript(plan, transactionDirectory)).toContain(Buffer.from(plan.sha512, 'base64').toString('hex'))
  })

  it.each([false, true])('模拟提权分支等待文件替换完成后才启动，失败恢复也不与新版并行：%s', async fail => {
    const plan = await transaction()
    const filesystem = require('node:fs/promises'), original = filesystem.mkdir
    const transactionDirectory = path.join(path.dirname(plan.bundle), `.petbloom-install-${plan.nonce.slice(0, 24)}`)
    let denied = false
    vi.spyOn(filesystem, 'mkdir').mockImplementation((...args: unknown[]) => {
      if (args[0] === transactionDirectory && !denied) { denied = true; return Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' })) }
      return original(...args)
    })
    const authorize = vi.fn(async (script: string) => { execFileSync('/bin/sh', ['-c', script]) })
    const work = install(plan, { authorize, timeout: 1, open: async (failed: boolean) => {
      if (failed) return
      await verifyBundle(plan.bundle, '0.0.2', process.arch)
      if (!fail) {
        await writeFile(path.join(plan.workspace, 'ready.json'), JSON.stringify({ nonce: plan.nonce, version: '0.0.2' }))
        await writeFile(path.join(plan.workspace, 'ack'), plan.nonce)
      } else await writeFile(path.join(plan.dataDirectory, 'pet-garden.db'), 'new schema')
    } })
    if (fail) await expect(work).rejects.toThrow(/did not finish/)
    else await work
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(authorize.mock.calls[1][0]).toBe(privilegedScript(plan, transactionDirectory, fail ? 'rollback' : 'cleanup'))
    await verifyBundle(plan.bundle, fail ? '0.0.1' : '0.0.2', process.arch)
    expect(await readFile(path.join(plan.dataDirectory, 'pet-garden.db'), 'utf8')).toBe('user data stays')
  })

  it('安装进行时拒绝普通重开，避免备份期间另一个实例写数据库', async () => {
    const plan = await transaction()
    const app = { commandLine: { getSwitchValue: () => '' }, getPath: () => plan.dataDirectory }
    expect(await receipt(app)).toBeUndefined()
    await writeFile(path.join(plan.dataDirectory, 'updates/installing.json'), JSON.stringify({ pid: process.pid, nonce: plan.nonce }))
    await expect(receipt(app)).rejects.toThrow(/being installed/)
  })

  it('携带更新参数但计划或身份错误时拒绝启动，不放行数据库访问', async () => {
    const plan = await transaction(), filename = path.join(plan.workspace, 'plan.json')
    const app = { commandLine: { getSwitchValue: () => filename, hasSwitch: () => false }, getPath: () => plan.dataDirectory, getVersion: () => '0.0.2' }
    await expect(receipt(app)).rejects.toThrow()
    await writeFile(filename, JSON.stringify(plan))
    await expect(receipt(app)).rejects.toThrow(/validation failed/)
  })

  it.each([false, true])('启动握手等待 commit，期间 abort 可安全退出：%s', async abort => {
    const plan = await transaction(), filename = path.join(plan.workspace, 'plan.json')
    await writeFile(filename, JSON.stringify(plan))
    const app = {
      commandLine: { getSwitchValue: (name: string) => name === 'petbloom-update' ? filename : plan.nonce, hasSwitch: () => false },
      getPath: () => plan.dataDirectory, getVersion: () => '0.0.2', quit: vi.fn()
    }
    const original = process.execPath
    let pending
    try {
      Object.defineProperty(process, 'execPath', { value: path.join(plan.bundle, 'Contents/MacOS/PetBloom'), writable: true, configurable: true })
      pending = await receipt(app)
    } finally { Object.defineProperty(process, 'execPath', { value: original, writable: true, configurable: true }) }
    let settled = false
    const ready = pending.ready().then((value: boolean) => { settled = true; return value })
    await vi.waitFor(async () => expect(await stat(path.join(plan.workspace, 'ready.json'))).toBeDefined())
    expect(settled).toBe(false)
    if (abort) await writeFile(path.join(plan.workspace, 'abort'), plan.nonce)
    else await writeFile(path.join(plan.workspace, 'commit.json'), JSON.stringify({ nonce: plan.nonce }))
    expect(await ready).toBe(!abort)
    expect(app.quit).toHaveBeenCalledTimes(abort ? 1 : 0)
  })

  it('安装计划目录必须私有、归当前用户且不能逃逸', async () => {
    const plan = await transaction(), filename = path.join(plan.workspace, 'plan.json')
    await writeFile(filename, JSON.stringify(plan))
    expect(await loadPlan(filename)).toMatchObject({ nonce: plan.nonce })
    await chmod(plan.workspace, 0o755)
    await expect(loadPlan(filename)).rejects.toThrow(/workspace/)
  })
})

describe('Mac 更新客户端', () => {
  it('复用 SDK 下载及 SHA-512 校验，不调用原生 Squirrel', async () => {
    const root = await directory(), archive = Buffer.from('a downloaded zip')
    const hash = createHash('sha512').update(archive).digest('base64')
    const updater = new MacUpdater(undefined, { version: '0.0.1', name: 'PetBloom', isPackaged: true, baseCachePath: root, userDataPath: root, whenReady: async () => {} })
    updater.logger = null
    updater.configOnDisk = { value: Promise.resolve({ updaterCacheDirName: 'petbloom-test' }) }
    const name = `PetBloom-0.0.2-mac-${process.arch}.zip`
    const downloaded = vi.fn()
    updater.on('update-downloaded', downloaded)
    updater.httpExecutor = { download: vi.fn(async (_url: URL, destination: string, options: { sha512: string }) => {
      expect(options.sha512).toBe(hash)
      await writeFile(destination, archive)
    }) }
    await updater.doDownloadUpdate({ updateInfoAndProvider: { info: { version: '0.0.2' }, provider: { resolveFiles: () => [{ url: new URL(`https://github.com/anthonyli/class-pet/releases/download/v0.0.2/${name}`), info: { url: name, sha512: hash, size: archive.length } }] } }, requestHeaders: {} })
    expect(updater.httpExecutor.download).toHaveBeenCalledTimes(1)
    expect(downloaded).toHaveBeenCalledTimes(1)
    expect(updater.downloaded).toMatchObject({ sha512: hash, version: '0.0.2' })
    expect(updater.nativeUpdater).toBeUndefined()
    await expect(updater.quitAndInstall()).rejects.toThrow(/not prepared/)
  })

  it.each(['http://github.com/anthonyli/class-pet/releases/download/v0.0.2/', 'https://example.com/anthonyli/class-pet/releases/download/v0.0.2/', 'https://github.com/other/repo/releases/download/v0.0.2/'])('拒绝非固定来源：%s', async prefix => {
    const updater = new MacUpdater(undefined, { version: '0.0.1', name: 'PetBloom' })
    const name = `PetBloom-0.0.2-mac-${process.arch}.zip`
    await expect(updater.doDownloadUpdate({ updateInfoAndProvider: { info: { version: '0.0.2' }, provider: { resolveFiles: () => [{ url: new URL(`${prefix}${name}`), info: { url: name, sha512: Buffer.alloc(64).toString('base64') } }] } } })).rejects.toThrow(/trusted/)
  })
})
