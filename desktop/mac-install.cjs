const fs = require('node:fs/promises')
const { constants, createReadStream, createWriteStream } = require('node:fs')
const { createHash, randomBytes, randomUUID } = require('node:crypto')
const { execFile, fork } = require('node:child_process')
const { promisify } = require('node:util')
const { pipeline } = require('node:stream/promises')
const path = require('node:path')
const execute = promisify(execFile)
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const bundleId = 'app.petbloom.desktop'
const inside = (root, file) => file.startsWith(`${root}${path.sep}`)
const quote = value => `'${value.replace(/'/g, `'\\''`)}'`

async function run(command, args, options = {}) {
  const env = { ...process.env }
  delete env.DITTONORSRC
  delete env.DITTONOQTN
  delete env.ELECTRON_RUN_AS_NODE
  return execute(command, args, { env, timeout: 180000, maxBuffer: 1024 * 1024, ...options })
}

async function writeJson(filename, value) {
  const temporary = `${filename}.${randomBytes(6).toString('hex')}`
  await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
  await fs.rename(temporary, filename)
}

async function digest(file) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) hash.update(chunk)
  return hash.digest('base64')
}

async function extract(archive, directory, reader = require('yauzl')) {
  const zip = await new Promise((resolve, reject) => reader.open(archive, { lazyEntries: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)))
  const links = []
  let count = 0, bytes = 0
  try {
    await new Promise((resolve, reject) => {
      zip.once('error', reject)
      zip.once('end', resolve)
      zip.on('entry', entry => {
        ;(async () => {
          const name = entry.fileName
          if (++count > 100000 || (bytes += entry.uncompressedSize) > 8 * 1024 ** 3) throw new Error('更新包过大 / Update archive is too large')
          if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '.')) throw new Error('更新包包含不安全路径 / Unsafe archive path')
          const target = path.join(directory, name)
          const mode = entry.externalFileAttributes >>> 16, kind = mode & 0o170000
          if (mode & 0o6000 || ![0, 0o040000, 0o100000, 0o120000].includes(kind)) throw new Error('更新包包含危险文件权限 / Unsafe archive file mode')
          if (name.startsWith('__MACOSX/')) {
            if (kind === 0o120000) throw new Error('更新包元数据不能包含链接 / Archive metadata cannot contain links')
            zip.readEntry(); return
          }
          if (kind !== 0o120000 && mode & 0o022) throw new Error('更新包包含危险文件权限 / Unsafe archive file mode')
          if (name !== 'PetBloom.app/' && !name.startsWith('PetBloom.app/')) throw new Error('更新包内容不符 / Unexpected archive contents')
          if (name.endsWith('/')) await fs.mkdir(target, { recursive: true, mode: 0o755 })
          else {
            await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 })
            const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, value) => error ? reject(error) : resolve(value)))
            if (kind === 0o120000) {
              if (entry.uncompressedSize > 4096) throw new Error('更新包链接过长 / Archive link is too long')
              const chunks = []
              for await (const chunk of stream) chunks.push(chunk)
              const link = Buffer.concat(chunks).toString('utf8')
              if (!link || link.includes('\0') || path.isAbsolute(link) || !inside(path.join(directory, 'PetBloom.app'), path.resolve(path.dirname(target), link))) throw new Error('更新包包含外部链接 / Archive link escapes the app')
              links.push({ target, link })
            } else await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: mode & 0o111 ? 0o755 : 0o644 }))
          }
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
    // 最后创建链接，解压文件时不会沿链接写到临时目录之外。
    for (const { target, link } of links) await fs.symlink(link, target)
    const root = path.join(directory, 'PetBloom.app')
    for (const { target } of links) if (!inside(root, await fs.realpath(target))) throw new Error('更新包链接逃逸 / Archive link escapes the app')
    return root
  } finally { zip.close() }
}

async function verifyBundle(bundle, version, arch) {
  const stat = await fs.lstat(bundle)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('无效的应用目录 / Invalid app bundle')
  const root = await fs.realpath(bundle)
  if (root !== bundle) throw new Error('应用路径不能是符号链接 / App path must not be a symlink')
  async function scan(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      const stat = await fs.lstat(file)
      if (stat.mode & 0o6000 || (!stat.isFile() && !stat.isDirectory() && !stat.isSymbolicLink())) throw new Error('应用包含危险文件 / Unsafe bundle file')
      if (stat.isSymbolicLink()) {
        const link = await fs.readlink(file)
        if (path.isAbsolute(link) || !inside(root, await fs.realpath(file))) throw new Error('应用包含外部链接 / Bundle link escapes the app')
      } else if (stat.isDirectory()) await scan(file)
    }
  }
  await scan(bundle)
  const plist = path.join(bundle, 'Contents/Info.plist')
  const value = async key => (await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist])).stdout.trim()
  if (await value('CFBundleIdentifier') !== bundleId || await value('CFBundleExecutable') !== 'PetBloom' || await value('CFBundleShortVersionString') !== version) throw new Error('更新包的应用标识或版本不符 / Update bundle identity or version mismatch')
  const executable = path.join(bundle, 'Contents/MacOS/PetBloom')
  const handle = await fs.open(executable, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const header = Buffer.alloc(8)
    await handle.read(header, 0, 8, 0)
    if (header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== (arch === 'arm64' ? 0x100000c : 0x1000007)) throw new Error('更新包的芯片架构不符 / Update architecture mismatch')
  } finally { await handle.close() }
  try {
    await fs.access(path.join(bundle, 'Contents/_CodeSignature'))
  } catch (error) { if (error.code === 'ENOENT') return; throw error }
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
}

async function prepare({ archive, sha512, version, bundle, dataDirectory, arch, oldVersion, locale }) {
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) throw new Error('请先把应用移到 Applications，再检查更新。/ Move the app to Applications before updating.')
  if (await fs.realpath(bundle) !== bundle) throw new Error('应用路径不能是符号链接 / App path must not be a symlink')
  await verifyBundle(bundle, oldVersion, arch)
  const updates = path.join(dataDirectory, 'updates')
  await fs.mkdir(updates, { recursive: true, mode: 0o700 })
  const workspace = await fs.mkdtemp(path.join(updates, 'install-'))
  await fs.chmod(workspace, 0o700)
  try {
    const copy = path.join(workspace, 'update.zip')
    await fs.copyFile(archive, copy, constants.COPYFILE_EXCL)
    if (await digest(copy) !== sha512) throw new Error('更新包校验失败 / Update checksum mismatch')
    const candidate = await extract(copy, workspace)
    await verifyBundle(candidate, version, arch)
    // Node 下载不会自动附加 quarantine；交由 LaunchServices 正常执行系统安全确认。
    const quarantine = `0083;${Math.floor(Date.now() / 1000).toString(16)};PetBloom;${randomUUID()}`
    await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantine, candidate])
    const plan = { bundle, candidate, workspace, dataDirectory, version, oldVersion, arch, locale, archive: copy, sha512, quarantine, parentPid: process.pid, nonce: randomBytes(32).toString('hex') }
    const filename = path.join(workspace, 'plan.json')
    await fs.writeFile(filename, JSON.stringify(plan), { mode: 0o600, flag: 'wx' })
    await fs.copyFile(__filename, path.join(workspace, 'installer.cjs'), constants.COPYFILE_EXCL)
    return filename
  } catch (error) { await fs.rm(workspace, { recursive: true, force: true }); throw error }
}

async function loadPlan(filename) {
  const workspace = path.dirname(filename)
  const stat = await fs.lstat(workspace)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077 || await fs.realpath(workspace) !== workspace) throw new Error('无效的更新临时目录 / Invalid update workspace')
  const plan = JSON.parse(await fs.readFile(filename, 'utf8'))
  if (filename !== path.join(workspace, 'plan.json') || plan.workspace !== workspace || path.dirname(workspace) !== path.join(plan.dataDirectory, 'updates') || !/^install-[A-Za-z0-9]+$/.test(path.basename(workspace)) || !/^[a-f0-9]{64}$/.test(plan.nonce) || !path.isAbsolute(plan.bundle) || !plan.bundle.endsWith('.app') || plan.candidate !== path.join(workspace, 'PetBloom.app') || plan.archive !== path.join(workspace, 'update.zip') || !/^[A-Za-z0-9+/]{86}==$/.test(plan.sha512) || !/^0083;[a-f0-9]+;PetBloom;[a-f0-9-]+$/.test(plan.quarantine) || !['arm64', 'x64'].includes(plan.arch) || !Number.isSafeInteger(plan.parentPid) || plan.parentPid < 1) throw new Error('无效的更新计划 / Invalid update plan')
  return plan
}

async function launch(filename, executable) {
  await loadPlan(filename)
  const child = fork(path.join(path.dirname(filename), 'installer.cjs'), [filename], {
    execPath: executable, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.disconnect(); reject(new Error('更新辅助程序启动超时 / Update helper startup timed out')) }, 15000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`更新辅助程序退出 / Update helper exited: ${code}`)) })
    child.once('message', message => {
      clearTimeout(timeout)
      if (message !== 'ready') { child.disconnect(); reject(new Error('更新辅助程序初始化失败 / Update helper initialization failed')); return }
      child.send('install', error => {
        if (child.connected) child.disconnect()
        if (error) { reject(error); return }
        child.unref(); resolve()
      })
    })
  })
}

const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }
async function waitForExit(pid, timeout = 60000) {
  const end = Date.now() + timeout
  while (alive(pid)) { if (Date.now() > end) throw new Error('应用未退出，已取消更新 / The app did not quit; update cancelled'); await pause(250) }
}

async function authorize(script, locale) {
  const appleScript = 'on run argv\n do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges\nend run'
  await run('/usr/bin/osascript', ['-e', appleScript, script, locale === 'zh' ? '萌芽需要授权以安装已下载的更新。' : 'PetBloom needs permission to install the downloaded update.'], { timeout: 420000 })
}

const exists = file => fs.lstat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
const readJson = file => fs.readFile(file, 'utf8').then(JSON.parse, error => { if (error.code === 'ENOENT') return null; throw error })
const databaseFiles = ['pet-garden.db', 'pet-garden.db-wal', 'pet-garden.db-shm']

async function snapshotData(plan) {
  const directory = path.join(plan.workspace, 'database')
  await fs.mkdir(directory, { mode: 0o700 })
  const files = []
  // 调用方已等待旧主程序和服务全部退出，连同 WAL 保存一致的冷快照。
  for (const name of databaseFiles) {
    const source = path.join(plan.dataDirectory, name)
    if (!await exists(source)) continue
    const stat = await fs.lstat(source)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('数据库路径无效 / Invalid database path')
    await fs.copyFile(source, path.join(directory, name), constants.COPYFILE_EXCL)
    files.push(name)
  }
  await writeJson(path.join(directory, 'files.json'), files)
}

async function restoreData(plan) {
  const directory = path.join(plan.workspace, 'database')
  const files = await readJson(path.join(directory, 'files.json'))
  if (!files) return
  for (const name of databaseFiles) {
    const target = path.join(plan.dataDirectory, name)
    if (!files.includes(name)) await fs.rm(target, { force: true })
    else {
      const temporary = path.join(plan.dataDirectory, `.restore-${plan.nonce}-${name}`)
      await fs.copyFile(path.join(directory, name), temporary, constants.COPYFILE_EXCL)
      await fs.rename(temporary, target)
    }
  }
}

function privilegedScript(plan, transaction, action = 'install') {
  const previous = path.join(transaction, 'previous'), payload = path.join(transaction, 'unpacked/PetBloom.app')
  const expected = Buffer.from(plan.sha512, 'base64').toString('hex')
  const header = 'set -eu\nunset DITTONORSRC DITTONOQTN\n'
  if (action === 'cleanup') return `${header}[ -d ${quote(transaction)} ] && [ ! -L ${quote(transaction)} ]
/bin/rm -rf ${quote(transaction)}`
  if (action === 'rollback') return `${header}[ -d ${quote(previous)} ] && [ ! -L ${quote(transaction)} ]
if [ -e ${quote(plan.bundle)} ]; then /bin/mv ${quote(plan.bundle)} ${quote(path.join(transaction, 'failed'))}; fi
/bin/mv ${quote(previous)} ${quote(plan.bundle)}`
  return `${header}installed=0
created=0
finish() {
  result=$?
  if [ "$installed" != 1 ] && [ "$created" = 1 ]; then
    if [ -d ${quote(previous)} ]; then
      if [ -e ${quote(plan.bundle)} ]; then /bin/mv ${quote(plan.bundle)} ${quote(path.join(transaction, 'failed'))} || exit 1; fi
      /bin/mv ${quote(previous)} ${quote(plan.bundle)} || exit 1
    fi
    /bin/rm -rf ${quote(transaction)}
  fi
  exit "$result"
}
trap finish EXIT
/bin/mkdir -m 755 ${quote(transaction)}
created=1
/bin/cp -P ${quote(plan.archive)} ${quote(path.join(transaction, 'update.zip'))}
[ -f ${quote(path.join(transaction, 'update.zip'))} ] && [ ! -L ${quote(path.join(transaction, 'update.zip'))} ]
actual=$(/usr/bin/shasum -a 512 ${quote(path.join(transaction, 'update.zip'))})
[ "\${actual%% *}" = ${quote(expected)} ]
/usr/bin/ditto -x -k ${quote(path.join(transaction, 'update.zip'))} ${quote(path.join(transaction, 'unpacked'))}
/usr/bin/xattr -w com.apple.quarantine ${quote(plan.quarantine)} ${quote(payload)}
/bin/mv ${quote(plan.bundle)} ${quote(previous)}
/bin/mv ${quote(payload)} ${quote(plan.bundle)}
installed=1`
}


async function install(plan, options = {}) {
  const operation = options.run || run
  const open = options.open || (async failure => operation('/usr/bin/open', ['-n', plan.bundle, '--args', `--user-data-dir=${plan.dataDirectory}`, `--petbloom-update=${path.join(plan.workspace, 'plan.json')}`, `--petbloom-update-token=${plan.nonce}`, ...(failure ? ['--petbloom-update-failed'] : [])]))
  const transaction = path.join(path.dirname(plan.bundle), `.petbloom-install-${plan.nonce.slice(0, 24)}`)
  const previous = path.join(transaction, 'previous')
  const log = message => fs.appendFile(path.join(plan.dataDirectory, 'update.log'), `${new Date().toISOString()} ${message}\n`).catch(() => {})
  const elevation = options.authorize || authorize
  let privileged = false, committed = false, opened = false
  try {
    await snapshotData(plan)
    try { await fs.mkdir(transaction, { mode: 0o700 }) }
    catch (error) {
      if (!['EACCES', 'EPERM'].includes(error.code)) throw error
      privileged = true
      await elevation(privilegedScript(plan, transaction), plan.locale)
      await verifyBundle(plan.bundle, plan.version, plan.arch)
    }
    if (!privileged) {
      const archive = path.join(transaction, 'update.zip')
      await fs.copyFile(plan.archive, archive, constants.COPYFILE_EXCL)
      if (await digest(archive) !== plan.sha512) throw new Error('更新包校验失败 / Update checksum mismatch')
      const candidate = await extract(archive, path.join(transaction, 'unpacked'), options.zipReader)
      await verifyBundle(candidate, plan.version, plan.arch)
      await operation('/usr/bin/xattr', ['-w', 'com.apple.quarantine', plan.quarantine, candidate])
      await fs.rename(plan.bundle, previous)
      await fs.rename(candidate, plan.bundle)
    }
    opened = true
    await open(false)
    const end = Date.now() + (options.timeout ?? 180000)
    for (;;) {
      const ready = await readJson(path.join(plan.workspace, 'ready.json'))
      if (ready?.nonce === plan.nonce && ready.version === plan.version) break
      if (Date.now() > end) throw new Error('新版未能完成启动，可能需要系统安全确认。/ The new app did not finish starting; macOS security approval may be required.')
      await pause(250)
    }
    await writeJson(path.join(plan.workspace, 'commit.json'), { nonce: plan.nonce })
    committed = true
    const cleanup = privileged
      ? elevation(privilegedScript(plan, transaction, 'cleanup'), plan.locale)
      : fs.rm(transaction, { recursive: true, force: true })
    await cleanup.catch(error => log(`Previous app retained at ${previous}: ${error.message}`))
    await log(`Updated to ${plan.version}`)
    // 新版确认 commit 后才显示窗口，允许它先读完本次握手文件。
    const deadline = Date.now() + 10000
    while (!await exists(path.join(plan.workspace, 'ack')) && Date.now() < deadline) await pause(100)
    if (await exists(path.join(plan.workspace, 'ack'))) await fs.rm(plan.workspace, { recursive: true, force: true }).catch(error => log(error.message))
  } catch (error) {
    await log(error.stack || String(error))
    if (committed) return
    await fs.writeFile(path.join(plan.workspace, 'abort'), plan.nonce, { mode: 0o600 }).catch(() => {})
    const started = await readJson(path.join(plan.workspace, 'started.json')).catch(() => null)
    if (started?.nonce === plan.nonce && Number.isSafeInteger(started.pid) && started.pid > 1) {
      if (alive(started.pid)) process.kill(started.pid, 'SIGTERM')
      await waitForExit(started.pid)
    }
    if (await exists(previous)) {
      if (privileged) await elevation(privilegedScript(plan, transaction, 'rollback'), plan.locale)
      else {
        if (await exists(plan.bundle)) await fs.rename(plan.bundle, path.join(transaction, 'failed'))
        await fs.rename(previous, plan.bundle)
      }
    }
    await verifyBundle(plan.bundle, plan.oldVersion, plan.arch)
    if (opened) await restoreData(plan)
    await writeJson(path.join(plan.workspace, 'error.json'), { nonce: plan.nonce, message: error.message }).catch(() => {})
    await open(true)
    throw error
  }
}

async function receipt(app) {
  const filename = app.commandLine.getSwitchValue('petbloom-update')
  if (!filename) {
    const active = await readJson(path.join(app.getPath('userData'), 'updates/installing.json'))
    if (active && alive(active.pid)) throw new Error('正在安装更新，请稍候再打开应用。/ An update is being installed; please wait before reopening the app.')
    return
  }
  const plan = await loadPlan(filename)
  const failed = app.commandLine.hasSwitch('petbloom-update-failed')
  if (plan.dataDirectory !== app.getPath('userData') || plan.bundle !== path.resolve(path.dirname(process.execPath), '../..') || plan.nonce !== app.commandLine.getSwitchValue('petbloom-update-token') || app.getVersion() !== (failed ? plan.oldVersion : plan.version)) throw new Error('更新启动验证失败，已停止启动以保护数据。/ Update launch validation failed; startup stopped to protect data.')
  if (failed) {
    const error = await readJson(path.join(plan.workspace, 'error.json')).catch(() => null)
    return { failure: error?.nonce === plan.nonce ? error.message : '更新未完成，请检查 update.log。/ Update did not complete; check update.log.', async ready() { return true } }
  }
  await writeJson(path.join(plan.workspace, 'started.json'), { nonce: plan.nonce, pid: process.pid })
  let resolve, closed = false
  const committed = new Promise(complete => { resolve = complete })
  const close = () => { closed = true; clearTimeout(timer); process.removeListener('SIGTERM', abort) }
  const abort = () => { if (closed) return; close(); resolve(false); app.quit() }
  const poll = async () => {
    try {
      if (await fs.readFile(path.join(plan.workspace, 'abort'), 'utf8').catch(() => '') === plan.nonce) { abort(); return }
      if ((await readJson(path.join(plan.workspace, 'commit.json')))?.nonce === plan.nonce) {
        await fs.writeFile(path.join(plan.workspace, 'ack'), plan.nonce, { mode: 0o600 })
        if (!closed) { close(); resolve(true) }
      }
    } catch { abort() }
    if (!closed) { timer = setTimeout(poll, 250); timer.unref() }
  }
  let timer = setTimeout(poll, 250)
  timer.unref()
  process.once('SIGTERM', abort)
  return { async ready() {
    await writeJson(path.join(plan.workspace, 'ready.json'), { nonce: plan.nonce, version: app.getVersion() })
    return committed
  } }
}

if (require.main === module) {
  ;(async () => {
    const plan = await loadPlan(process.argv[2])
    const lock = path.join(plan.dataDirectory, 'updates/installing.json')
    const active = await readJson(lock)
    if (active && alive(active.pid)) throw new Error('已有更新正在安装 / Another update is being installed')
    await writeJson(lock, { pid: process.pid, nonce: plan.nonce })
    try {
      await verifyBundle(plan.candidate, plan.version, plan.arch)
      await verifyBundle(plan.bundle, plan.oldVersion, plan.arch)
      const zipReader = require('node:module').createRequire(path.join(plan.bundle, 'Contents/Resources/app/package.json'))('yauzl')
      const approved = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('安装未确认 / Installation was not confirmed')), 20000)
        process.once('message', value => { clearTimeout(timeout); value === 'install' ? resolve() : reject(new Error('安装已取消 / Installation cancelled')) })
        process.once('disconnect', () => { clearTimeout(timeout); reject(new Error('安装连接已关闭 / Installation connection closed')) })
      })
      process.send('ready')
      await approved
      await waitForExit(plan.parentPid)
      await install(plan, { zipReader })
    } catch (error) {
      await fs.appendFile(path.join(plan.dataDirectory, 'update.log'), `${new Date().toISOString()} ${error.stack || error}\nRecovery files: ${plan.workspace}\n`).catch(() => {})
      throw error
    } finally {
      if ((await readJson(lock))?.nonce === plan.nonce) await fs.rm(lock)
    }
  })().catch(error => { console.error(error); process.exitCode = 1 })
}

module.exports = { digest, extract, verifyBundle, prepare, loadPlan, launch, install, receipt, quote, privilegedScript }
