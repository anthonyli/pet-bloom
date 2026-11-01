import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'
import { parse, stringify } from 'yaml'

async function regularFile(filename) {
  const stat = await lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`必须是普通文件，不能是符号链接 / Expected a regular file, not a symlink: ${filename}`)
  }
}

async function directory(dirname) {
  const stat = await lstat(dirname)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`必须是目录，不能是符号链接 / Expected a directory, not a symlink: ${dirname}`)
  }
}

async function emptyOutput(dirname) {
  try {
    await directory(dirname)
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
  if ((await readdir(dirname)).length !== 0) {
    throw new Error(`输出目录非空，拒绝覆盖 / Output directory is not empty; refusing to overwrite: ${dirname}`)
  }
  return true
}

function assetName(name, allowed) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || !allowed.has(name)) {
    throw new Error(`资产名不安全或不在当前版本及架构白名单中 / Unsafe or unexpected asset name for this version and architecture: ${String(name)}`)
  }
  return name
}

async function digestFile(filename) {
  const hash = createHash('sha512')
  let size = 0
  const stream = createReadStream(filename, { flags: constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) })
  for await (const chunk of stream) {
    hash.update(chunk)
    size += chunk.length
  }
  return { sha512: hash.digest('base64'), size }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function manifestFiles(manifest, version, names, label) {
  if (!object(manifest) || manifest.version !== version || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`清单版本不匹配或 files 无效 / Manifest version mismatch or invalid files: ${label}`)
  }
  const allowed = new Set(names)
  const entries = new Map()
  for (const entry of manifest.files) {
    if (!object(entry)) throw new Error(`清单文件条目无效 / Invalid manifest file entry: ${label}`)
    const name = assetName(entry.url, allowed)
    if (typeof entry.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(entry.sha512)) {
      throw new Error(`清单 SHA-512 无效 / Invalid manifest SHA-512: ${name}`)
    }
    if (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || entry.size < 0)) {
      throw new Error(`清单文件大小无效 / Invalid manifest file size: ${name}`)
    }
    if (entries.has(name) && !isDeepStrictEqual(entries.get(name), entry)) {
      throw new Error(`重复条目存在冲突 / Conflicting duplicate manifest entry: ${name}`)
    }
    entries.set(name, entry)
  }
  for (const name of names) {
    if (!entries.has(name)) {
      throw new Error(`清单缺少必需文件 / Manifest is missing a required file: ${name}`)
    }
  }
  if (manifest.size !== undefined && (manifest.path === undefined || !Number.isSafeInteger(manifest.size) || manifest.size < 0)) {
    throw new Error(`顶层文件大小无效 / Invalid top-level file size: ${label}`)
  }
  if (manifest.path !== undefined || manifest.sha512 !== undefined) {
    const topEntry = entries.get(assetName(manifest.path, allowed))
    if (manifest.sha512 !== topEntry.sha512) {
      throw new Error(`顶层 SHA-512 与 files 冲突 / Top-level SHA-512 conflicts with files: ${label}`)
    }
    if (manifest.size !== undefined && topEntry.size !== undefined && manifest.size !== topEntry.size) {
      throw new Error(`顶层大小与 files 冲突 / Top-level size conflicts with files: ${label}`)
    }
  }
  return names.map(name => entries.get(name))
}

function latestReleaseDate(manifests) {
  const dates = []
  for (const manifest of manifests) {
    if (manifest.releaseDate === undefined) continue
    const date = typeof manifest.releaseDate === 'string' ? Date.parse(manifest.releaseDate) : NaN
    if (!Number.isFinite(date)) {
      throw new Error('清单发布日期无效 / Invalid manifest releaseDate')
    }
    dates.push(date)
  }
  return dates.length ? new Date(Math.max(...dates)).toISOString() : undefined
}

export function mergeMacUpdateInfo(arm64Info, x64Info) {
  const version = arm64Info?.version
  if (typeof version !== 'string' || !stableVersion.test(version)) {
    throw new Error('Mac 清单必须使用稳定版本 / Mac manifests must use a stable version')
  }
  const armFiles = manifestFiles(arm64Info, version, [`PetBloom-${version}-mac-arm64.zip`, `PetBloom-${version}-mac-arm64.dmg`], 'mac-arm64')
  const x64Files = manifestFiles(x64Info, version, [`PetBloom-${version}-mac-x64.zip`, `PetBloom-${version}-mac-x64.dmg`], 'mac-x64')
  const { size, ...base } = x64Info
  const zip = x64Files[0]
  return {
    ...base,
    files: [...armFiles, ...x64Files].sort((a, b) => Number(b.url.endsWith('.zip')) - Number(a.url.endsWith('.zip'))),
    path: zip.url, sha512: zip.sha512,
    ...(size !== undefined && zip.size !== undefined ? { size: zip.size } : {}),
    releaseDate: latestReleaseDate([arm64Info, x64Info])
  }
}

async function release(input, output, version) {
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  if (!stableVersion.test(version) || version !== metadata.version) {
    throw new Error(`只允许与 package.json 一致的稳定版本 / Version must be stable and equal package.json.version: ${metadata.version}`)
  }
  await emptyOutput(output)
  await directory(input)

  const configurations = [
    { folder: 'PetBloom-mac-arm64', manifest: 'latest-mac.yml', names: [`PetBloom-${version}-mac-arm64.zip`, `PetBloom-${version}-mac-arm64.dmg`] },
    { folder: 'PetBloom-mac-x64', manifest: 'latest-mac.yml', names: [`PetBloom-${version}-mac-x64.zip`, `PetBloom-${version}-mac-x64.dmg`] },
    { folder: 'PetBloom-win-x64', manifest: 'latest.yml', names: [`PetBloom-${version}-win-x64.exe`] }
  ]
  const manifests = []
  const assets = []

  for (const configuration of configurations) {
    const source = path.join(input, configuration.folder)
    await directory(source)
    const manifestPath = path.join(source, configuration.manifest)
    await regularFile(manifestPath)
    const manifest = parse(await readFile(manifestPath, 'utf8'), { uniqueKeys: true, maxAliasCount: 100 })
    const files = manifestFiles(manifest, version, configuration.names, manifestPath)
    for (const entry of files) {
      const filename = path.join(source, entry.url)
      await regularFile(filename)
      const digest = await digestFile(filename)
      if (digest.sha512 !== entry.sha512 || (entry.size !== undefined && digest.size !== entry.size) ||
        (manifest.path === entry.url && manifest.size !== undefined && digest.size !== manifest.size)) {
        throw new Error(`文件 SHA-512 或大小校验失败 / File SHA-512 or size mismatch: ${entry.url}`)
      }
      assets.push({ source: filename, name: entry.url, ...digest })
      const blockmap = `${filename}.blockmap`
      let exists = true
      try {
        await regularFile(blockmap)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        exists = false
      }
      if (exists) assets.push({ source: blockmap, name: `${entry.url}.blockmap`, ...await digestFile(blockmap) })
    }
    manifests.push({ ...manifest, files })
  }

  const releaseDate = latestReleaseDate(manifests) ?? new Date().toISOString()
  const [arm64, x64, windows] = manifests
  const mac = mergeMacUpdateInfo(arm64, x64)
  const winExe = windows.files[0]
  const outputManifests = [
    ['latest-mac.yml', { ...mac, releaseDate }],
    ['latest.yml', { ...windows, path: winExe.url, sha512: winExe.sha512, releaseDate }]
  ].map(([name, manifest]) => [name, stringify(manifest)])

  await mkdir(path.dirname(output), { recursive: true })
  let staging = await mkdtemp(path.join(path.dirname(output), '.petbloom-release-'))
  try {
    for (const asset of assets) {
      const target = path.join(staging, asset.name)
      await copyFile(asset.source, target, constants.COPYFILE_EXCL)
      const copied = await digestFile(target)
      if (copied.sha512 !== asset.sha512 || copied.size !== asset.size) {
        throw new Error(`校验后源文件发生变化 / Source file changed after validation: ${asset.name}`)
      }
    }
    for (const [name, contents] of outputManifests) {
      await writeFile(path.join(staging, name), contents, { flag: 'wx' })
    }
    if (await emptyOutput(output)) await rmdir(output)
    await rename(staging, output)
    staging = undefined
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true })
  }
  console.log(`发布资产已准备就绪 / Release assets prepared: ${output}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 3) {
      throw new Error('用法 / Usage: node scripts/desktop-release.mjs <inputDirectory> <outputDirectory> <version>')
    }
    await release(path.resolve(args[0]), path.resolve(args[1]), args[2])
  } catch (error) {
    console.error(`桌面发布失败 / Desktop release failed: ${error.message}`)
    process.exitCode = 1
  }
}
