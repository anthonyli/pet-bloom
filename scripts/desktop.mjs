import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rebuild } from '@electron/rebuild'
import builder from 'electron-builder'
import sharp from 'sharp'
import { parse, stringify } from 'yaml'
import { mergeMacUpdateInfo } from './desktop-release.mjs'

// Actions supplies missing secrets as empty strings; builder treats an empty certificate path as the app directory.
if (!process.env.CSC_LINK) delete process.env.CSC_LINK

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const electronVersion = require('electron/package.json').version
const args = process.argv.slice(2)
const development = args.includes('--dev')
const release = args.includes('--release')
const output = path.resolve(root, process.env.DESKTOP_OUTPUT_DIR || 'dist')
const macUpdates = new Map()
const platform = args.includes('--win') ? 'win32' : args.includes('--mac') ? 'darwin' : process.platform
const architectures = args.includes('--all-arch') ? ['arm64', 'x64'] : [args.includes('--x64') ? 'x64' : args.includes('--arm64') ? 'arm64' : process.arch]
const supported = platform === 'darwin' ? ['arm64', 'x64'] : platform === 'win32' ? ['x64'] : []
const crossWindows = process.platform === 'darwin' && platform === 'win32' && !development && !release
const unsignedWindows = platform === 'win32' && args.includes('--allow-unsigned-windows') && !process.env.CSC_LINK
const signedMac = platform === 'darwin' && Boolean(process.env.CSC_LINK)
if ((platform !== process.platform && !crossWindows) || architectures.some(arch => !supported.includes(arch))) {
  throw new Error('Mac 安装包需要 macOS；Windows 正式版和开发模式需要 Windows，macOS 可交叉构建 Windows x64 预览包。/ Mac installers require macOS. Windows release and development builds require Windows; macOS can cross-build Windows x64 previews.')
}

if (release) {
  const required = platform === 'darwin' ? (signedMac ? ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'] : []) : (unsignedWindows ? [] : ['CSC_LINK'])
  if (development || args.includes('--dir') || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(metadata.version) || required.some(name => !process.env[name])) {
    throw new Error('正式构建需要稳定版本；Windows 需要代码签名或显式 --allow-unsigned-windows，Mac 若使用开发者证书则还需公证凭据，不能使用 --dev/--dir。/ Release builds require a stable version; Windows requires code signing or explicit --allow-unsigned-windows, and Mac builds using a developer certificate also require notarization credentials. --dev/--dir are not allowed.')
  }
}

function run(command, parameters, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, parameters, { cwd: root, stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)))
  })
}

const desktop = path.join(root, '.desktop')
await mkdir(desktop, { recursive: true })
// 使用 Next 自己的 CLI，避免 Windows 的 .cmd 与 shell 参数转义问题。
const nextEnvironmentFile = path.join(root, 'next-env.d.ts')
const nextEnvironment = await readFile(nextEnvironmentFile, 'utf8')
try {
  await run(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], {
    env: { ...process.env, BUILD_DIR: '.next-desktop', NEXT_PUBLIC_DESKTOP: 'true', NEXT_TELEMETRY_DISABLED: '1' }
  })
} finally {
  await writeFile(nextEnvironmentFile, nextEnvironment)
}
await run(process.execPath, [path.join(root, 'scripts/prepare-standalone.mjs')], { env: { ...process.env, BUILD_DIR: '.next-desktop' } })

const resources = path.join(desktop, 'resources')
await mkdir(resources, { recursive: true })
await sharp(path.join(root, 'desktop/icon.svg')).png().toFile(path.join(resources, 'icon.png'))

const npmCli = process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath
  : path.resolve(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js')
const npmVersion = JSON.parse(await readFile(path.resolve(npmCli, '../../package.json'), 'utf8')).version

for (const arch of architectures) {
  const appDirectory = path.join(desktop, `${platform}-${arch}`, 'app')
  await rm(appDirectory, { recursive: true, force: true })
  await mkdir(appDirectory, { recursive: true })
  const web = path.join(appDirectory, 'web')
  await cp(path.join(root, '.next-desktop/standalone'), web, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: source => !path.relative(path.join(root, '.next-desktop/standalone'), source).split(path.sep).some(part =>
      part === 'node_modules' || part === '.env' || part.startsWith('.env.')
    )
  })
  await cp(path.join(root, 'desktop'), path.join(appDirectory, 'desktop'), { recursive: true })
  await cp(path.join(resources, 'icon.png'), path.join(appDirectory, 'desktop/icon.png'))
  const dependencies = Object.fromEntries(await Promise.all([...Object.keys(metadata.dependencies), 'electron-updater'].map(async name => [
    name, JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version
  ])))
  await writeFile(path.join(appDirectory, 'package.json'), JSON.stringify({
    name: 'petbloom-desktop', productName: 'PetBloom', version: metadata.version,
    description: 'PetBloom · 萌芽 — 离线班级宠物园 / Offline classroom pet garden',
    author: 'PetBloom', private: true, main: 'desktop/main.cjs', packageManager: `npm@${npmVersion}`, dependencies
  }, null, 2))
  const installArguments = ['install', '--prefix', appDirectory, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${platform}`, `--cpu=${arch}`]
  // 独立安装生产依赖，避免 Windows junction 把安装包指向构建机。
  await run(process.execPath, [npmCli, ...installArguments], { cwd: appDirectory })
  if (crossWindows) {
    // Node-API 预构建不绑定 Electron ABI，跨系统不能调用 node-gyp。
    const binding = await readFile(path.join(appDirectory, 'node_modules/better-sqlite3/prebuilds/win32-x64.node'))
    const pe = binding.readUInt32LE(0x3c)
    if (binding.readUInt16LE(0) !== 0x5a4d || binding.readUInt32LE(pe) !== 0x4550 || binding.readUInt16LE(pe + 4) !== 0x8664 || !binding.includes(Buffer.from('napi_register_module_v1\0'))) {
      throw new Error('缺少有效的 Windows x64 Node-API 数据库模块，请改在 Windows 构建。/ A valid Windows x64 Node-API database module is required; build on Windows instead.')
    }
  } else {
    await rebuild({ buildPath: appDirectory, electronVersion, arch, onlyModules: ['better-sqlite3'], force: true })
  }
  if (development) {
    await run(require('electron'), [appDirectory])
    continue
  }
  const targetPlatform = platform === 'darwin' ? builder.Platform.MAC : builder.Platform.WINDOWS
  await builder.build({
    projectDir: appDirectory,
    targets: targetPlatform.createTarget(args.includes('--dir') ? ['dir'] : platform === 'darwin' ? ['dmg', 'zip'] : ['nsis'], builder.Arch[arch]),
    publish: 'never',
    config: {
      appId: 'app.petbloom.desktop', productName: 'PetBloom', electronVersion,
      publish: { provider: 'github', owner: 'anthonyli', repo: 'pet-bloom', private: false, releaseType: 'release' },
      forceCodeSigning: release && ((platform === 'win32' && !unsignedWindows) || signedMac),
      directories: { app: appDirectory, output, buildResources: resources },
      asar: false, npmRebuild: false,
      files: ['desktop/*.cjs', 'desktop/icon.png', 'package.json'],
      extraResources: [
        { from: web, to: 'app/web' },
        ...(platform === 'darwin' ? [{ from: path.join(root, 'desktop/locales'), to: '.' }] : [])
      ],
      artifactName: 'PetBloom-${version}-${os}-${arch}.${ext}',
      mac: {
        category: 'public.app-category.education', icon: path.join(resources, 'icon.png'), notarize: release && signedMac,
        ...(signedMac ? {} : { identity: '-' }),
        hardenedRuntime: true,
        extendInfo: { CFBundleDisplayName: 'PetBloom', CFBundleDevelopmentRegion: 'en', CFBundleLocalizations: ['en', 'zh_CN', 'zh_TW'], LSHasLocalizedDisplayName: true }
      },
      dmg: { title: 'PetBloom · 萌芽 ${version}', sign: release && signedMac },
      win: { icon: path.join(resources, 'icon.png'), signAndEditExecutable: true },
      nsis: {
        oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true, createStartMenuShortcut: true,
        shortcutName: '$(PetBloomAppName)', uninstallDisplayName: '$(PetBloomAppName)',
        deleteAppDataOnUninstall: false, installerLanguages: ['en_US', 'zh_CN', 'zh_TW'],
        include: path.join(root, 'desktop/installer.nsh')
      }
    }
  })
  if (platform === 'darwin' && !args.includes('--dir')) {
    macUpdates.set(arch, parse(await readFile(path.join(output, 'latest-mac.yml'), 'utf8')))
  }
}
if (macUpdates.size === 2) {
  await writeFile(path.join(output, 'latest-mac.yml'), stringify(mergeMacUpdateInfo(macUpdates.get('arm64'), macUpdates.get('x64'))))
}
