import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

const root = fileURLToPath(new URL('..', import.meta.url))
const script = path.join(root, 'scripts/desktop-release.mjs')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
const targets = ['mac-arm64', 'mac-x64', 'win-x64'] as const
type Target = typeof targets[number]
type UpdateFile = { url: string; sha512: string; size?: number; [key: string]: unknown }
type Manifest = { version: string; files: UpdateFile[]; path?: string; sha512?: string; releaseDate?: string; [key: string]: unknown }
type Fixture = { directory: string; input: string; output: string; sources: Record<Target, string>; manifests: Record<Target, Manifest> }
const temporaryDirectories: string[] = []

function names(target: Target) {
  return (target === 'win-x64' ? ['exe'] : ['dmg', 'zip']).map(extension => `PetBloom-${version}-${target}.${extension}`)
}

function sha512(bytes: string | Buffer) {
  return createHash('sha512').update(bytes).digest('base64')
}

async function saveManifest(fixture: Fixture, target: Target) {
  await writeFile(path.join(fixture.sources[target], target === 'win-x64' ? 'latest.yml' : 'latest-mac.yml'), stringify(fixture.manifests[target]))
}

async function setup(blockmaps = false): Promise<Fixture> {
  const directory = await mkdtemp(path.join(tmpdir(), 'petbloom-release-test-'))
  temporaryDirectories.push(directory)
  const input = path.join(directory, 'downloaded artifacts')
  const fixture: Fixture = {
    directory, input, output: path.join(directory, 'release assets'),
    sources: {} as Record<Target, string>, manifests: {} as Record<Target, Manifest>
  }
  for (const [index, target] of targets.entries()) {
    const source = path.join(input, `PetBloom-${target}`)
    fixture.sources[target] = source
    await mkdir(source, { recursive: true })
    const files: UpdateFile[] = []
    for (const name of names(target)) {
      const bytes = Buffer.from(`fake package ${name}\0\n`)
      await writeFile(path.join(source, name), bytes)
      if (blockmaps) await writeFile(path.join(source, `${name}.blockmap`), `blockmap for ${name}`)
      files.push({ url: name, sha512: sha512(bytes), size: bytes.length, blockMapSize: 42, custom: { preserved: true } })
    }
    fixture.manifests[target] = {
      version, files, path: files[0].url, sha512: files[0].sha512,
      releaseDate: `2026-10-${28 + index}T10:00:00.000Z`, releaseNotes: '更新 / Update'
    }
    await saveManifest(fixture, target)
  }
  return fixture
}

function cli(fixture: Fixture, requestedVersion = version) {
  return spawnSync(process.execPath, [script, fixture.input, fixture.output, requestedVersion], {
    cwd: root, encoding: 'utf8', timeout: 15_000
  })
}

async function rejected(fixture: Fixture, message: RegExp, requestedVersion = version) {
  const result = cli(fixture, requestedVersion)
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(1)
  expect(result.stderr).toMatch(message)
  await expect(lstat(fixture.output)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readdir(fixture.directory)).some(name => name.startsWith('.petbloom-release-'))).toBe(false)
}

async function outputManifest(fixture: Fixture, name: string): Promise<Manifest> {
  return parse(await readFile(path.join(fixture.output, name), 'utf8')) as Manifest
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('桌面正式发布资产 CLI', () => {
  it('作为模块导入时不执行 CLI，也不要求命令行参数', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(pathToFileURL(script).href)})`], {
      cwd: root, encoding: 'utf8', timeout: 15_000
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('真实 Node 子进程可复用纯 Mac 合并函数，不改变输入且验证版本及路径', async () => {
    const fixture = await setup()
    const program = `
      import assert from 'node:assert/strict'
      import { mergeMacUpdateInfo } from ${JSON.stringify(pathToFileURL(script).href)}
      const [arm, x64] = JSON.parse(process.argv[1])
      const before = JSON.stringify([arm, x64])
      const merged = mergeMacUpdateInfo(arm, x64)
      assert.equal(JSON.stringify([arm, x64]), before)
      assert.deepEqual(merged.files, [arm.files[1], x64.files[1], arm.files[0], x64.files[0]])
      assert.equal(merged.path, x64.files[1].url)
      assert.equal(merged.sha512, x64.files[1].sha512)
      assert.equal(merged.releaseDate, x64.releaseDate)
      assert.throws(() => mergeMacUpdateInfo(arm, { ...x64, version: '0.9.0' }), /version mismatch/)
      assert.throws(() => mergeMacUpdateInfo(arm, { ...x64, path: '../secret.zip' }), /Unsafe or unexpected/)
      const noDates = mergeMacUpdateInfo({ ...arm, releaseDate: undefined }, { ...x64, releaseDate: undefined })
      assert.equal(noDates.releaseDate, undefined)
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program,
      JSON.stringify([fixture.manifests['mac-arm64'], fixture.manifests['mac-x64']])], {
      cwd: root, encoding: 'utf8', timeout: 15_000
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('合并两个独立 Mac 清单，ZIP 在前，x64 ZIP 兼容字段和所有条目完整保留', async () => {
    const fixture = await setup(true)
    const result = cli(fixture)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const expectedNames = targets.flatMap(names)
    expect((await readdir(fixture.output)).sort()).toEqual([
      ...expectedNames, ...expectedNames.map(name => `${name}.blockmap`), 'latest-mac.yml', 'latest.yml'
    ].sort())
    for (const target of targets) {
      for (const name of names(target).flatMap(name => [name, `${name}.blockmap`])) {
        expect(await readFile(path.join(fixture.output, name))).toEqual(await readFile(path.join(fixture.sources[target], name)))
      }
    }
    const mac = await outputManifest(fixture, 'latest-mac.yml')
    const windows = await outputManifest(fixture, 'latest.yml')
    const arm = fixture.manifests['mac-arm64'].files
    const x64 = fixture.manifests['mac-x64'].files
    expect(mac.files).toEqual([arm[1], x64[1], arm[0], x64[0]])
    expect(mac.path).toBe(x64[1].url)
    expect(mac.sha512).toBe(x64[1].sha512)
    expect(windows.files).toEqual(fixture.manifests['win-x64'].files)
    expect(windows.path).toBe(names('win-x64')[0])
    expect(windows.sha512).toBe(fixture.manifests['win-x64'].files[0].sha512)
    expect(mac.version).toBe(version)
    expect(windows.version).toBe(version)
    expect(mac.releaseDate).toBe('2026-10-30T10:00:00.000Z')
    expect(windows.releaseDate).toBe(mac.releaseDate)
    expect(mac.releaseNotes).toBe('更新 / Update')
    expect((await readdir(fixture.directory)).sort()).toEqual(['downloaded artifacts', 'release assets'])
  })

  it('接受已存在的空输出目录，不要求 sidecar、size、旧版顶层字段或发布日期', async () => {
    const fixture = await setup()
    await mkdir(fixture.output)
    for (const target of targets) {
      const manifest = fixture.manifests[target]
      delete manifest.path
      delete manifest.sha512
      delete manifest.releaseDate
      for (const entry of manifest.files) delete entry.size
      await saveManifest(fixture, target)
    }
    const result = cli(fixture)
    expect(result.status, result.stderr).toBe(0)
    expect((await readdir(fixture.output)).length).toBe(7)
    const mac = await outputManifest(fixture, 'latest-mac.yml')
    expect(Number.isFinite(Date.parse(mac.releaseDate!))).toBe(true)
    expect((await outputManifest(fixture, 'latest.yml')).releaseDate).toBe(mac.releaseDate)
  })

  it('重复的完全相同条目去重，且转换顶层 DMG 路径时同步 size', async () => {
    const fixture = await setup()
    const manifest = fixture.manifests['mac-x64']
    manifest.size = manifest.files[0].size
    delete manifest.files[0].size
    manifest.files.push({ ...manifest.files[1] })
    await saveManifest(fixture, 'mac-x64')
    const result = cli(fixture)
    expect(result.status, result.stderr).toBe(0)
    const mac = await outputManifest(fixture, 'latest-mac.yml')
    expect(mac.files.length).toBe(4)
    expect(mac.size).toBe(manifest.files[1].size)
  })

  it('白名单外的敏感文件、源码、额外包和目录均不复制', async () => {
    const fixture = await setup()
    for (const source of [fixture.input, ...Object.values(fixture.sources)]) {
      for (const name of ['.env', '.env.production', 'pet-garden.db', 'main.cjs', 'app.ts', 'PetBloom-0.9.0-mac-arm64.zip', 'debug.yml']) {
        await writeFile(path.join(source, name), 'do not publish')
      }
      await mkdir(path.join(source, 'source-code'))
      await writeFile(path.join(source, 'source-code', '.env'), 'private')
    }
    const result = cli(fixture)
    expect(result.status, result.stderr).toBe(0)
    expect((await readdir(fixture.output)).sort()).toEqual([...targets.flatMap(names), 'latest-mac.yml', 'latest.yml'].sort())
    expect(await readFile(path.join(fixture.input, '.env'), 'utf8')).toBe('do not publish')
  })

  const requiredFiles = targets.flatMap(target => names(target).map(name => ({ target, name })))
  it.each(requiredFiles)('拒绝清单漏掉必需的 $name，即使磁盘上存在该文件', async ({ target, name }) => {
    const fixture = await setup()
    fixture.manifests[target].files = fixture.manifests[target].files.filter(entry => entry.url !== name)
    await saveManifest(fixture, target)
    await rejected(fixture, /missing a required file|invalid files/)
  })

  it.each(requiredFiles)('拒绝磁盘上缺失的 $name', async ({ target, name }) => {
    const fixture = await setup()
    await rm(path.join(fixture.sources[target], name))
    await rejected(fixture, /ENOENT/)
  })

  it.each(targets)('拒绝 %s 的实际哈希不符，校验失败不生成正式输出', async target => {
    const fixture = await setup()
    await writeFile(path.join(fixture.sources[target], names(target)[0]), 'corrupted package')
    await rejected(fixture, /SHA-512 or size mismatch/)
  })

  it.each(targets)('拒绝 %s 的声明大小不符', async target => {
    const fixture = await setup()
    fixture.manifests[target].files[0].size! += 1
    await saveManifest(fixture, target)
    await rejected(fixture, /SHA-512 or size mismatch/)
  })

  it.each([-1, 1.5, NaN, Infinity, '123'])('拒绝非法 size：%s', async size => {
    const fixture = await setup()
    fixture.manifests['win-x64'].files[0].size = size as number
    await saveManifest(fixture, 'win-x64')
    await rejected(fixture, /Invalid manifest file size/)
  })

  it.each(targets)('拒绝 %s 的清单版本冲突', async target => {
    const fixture = await setup()
    fixture.manifests[target].version = '0.9.0'
    await saveManifest(fixture, target)
    await rejected(fixture, /Manifest version mismatch/)
  })

  it.each(['1.0.0-beta.1', '1.0.0+build.1', 'v1.0.0', '01.0.0', '2.0.0', ''])('拒绝非稳定或非项目版本参数：%s', async requestedVersion => {
    const fixture = await setup()
    await rejected(fixture, /Version must be stable and equal package.json.version/, requestedVersion)
  })

  it.each(['sha512', 'size', 'custom'])('拒绝重复条目的 %s 冲突', async field => {
    const fixture = await setup()
    const manifest = fixture.manifests['mac-arm64']
    const duplicate = { ...manifest.files[0] }
    duplicate[field] = field === 'sha512' ? sha512('other file') : field === 'size' ? 999 : { preserved: false }
    manifest.files.push(duplicate)
    await saveManifest(fixture, 'mac-arm64')
    await rejected(fixture, /Conflicting duplicate manifest entry/)
  })

  it.each([
    ['mac-arm64', `PetBloom-${version}-mac-x64.zip`],
    ['mac-x64', `PetBloom-${version}-mac-arm64.dmg`],
    ['win-x64', `PetBloom-${version}-win-arm64.exe`],
    ['mac-arm64', 'PetBloom-0.9.0-mac-arm64.zip']
  ] as const)('拒绝 %s 清单中错误架构或跨版本资产 %s', async (target, name) => {
    const fixture = await setup()
    fixture.manifests[target].files[0].url = name
    await saveManifest(fixture, target)
    await rejected(fixture, /Unsafe or unexpected asset name/)
  })

  const unsafeNames = [
    '../secret.zip', '..\\secret.zip', '/tmp/secret.zip', 'C:\\secret.zip', '\\\\server\\share\\secret.zip',
    'nested/secret.zip', 'https://example.com/secret.zip', 'file:///tmp/secret.zip',
    '%2e%2e%2fsecret.zip', '%2E%2E%5Csecret.zip', '%252e%252e%252fsecret.zip',
    `PetBloom-${version}-mac-arm64.zip?token=secret`, '..', ''
  ]
  describe.each(['files', 'path'] as const)('拒绝 %s 中的路径、URL 和编码穿越', location => {
    it.each(unsafeNames)('%s', async name => {
      const fixture = await setup()
      const manifest = fixture.manifests['mac-arm64']
      if (location === 'files') manifest.files[0].url = name
      else manifest.path = name
      await saveManifest(fixture, 'mac-arm64')
      await rejected(fixture, /Unsafe or unexpected asset name/)
    })
  })

  it('拒绝顶层 sha512 与 files 冲突', async () => {
    const fixture = await setup()
    fixture.manifests['win-x64'].sha512 = sha512('different')
    await saveManifest(fixture, 'win-x64')
    await rejected(fixture, /Top-level SHA-512 conflicts/)
  })

  it('拒绝顶层声明大小与实际文件不符，即使 files 中未声明 size', async () => {
    const fixture = await setup()
    fixture.manifests['win-x64'].size = 999
    delete fixture.manifests['win-x64'].files[0].size
    await saveManifest(fixture, 'win-x64')
    await rejected(fixture, /SHA-512 or size mismatch/)
  })

  it.each(['not-a-date', 123, null])('拒绝无效的 releaseDate：%s', async date => {
    const fixture = await setup()
    fixture.manifests['win-x64'].releaseDate = date as string
    await saveManifest(fixture, 'win-x64')
    await rejected(fixture, /Invalid manifest releaseDate/)
  })

  it.each(['invalid', null, ''])('拒绝无效的 sha512：%s', async hash => {
    const fixture = await setup()
    fixture.manifests['win-x64'].files[0].sha512 = hash as string
    await saveManifest(fixture, 'win-x64')
    await rejected(fixture, /Invalid manifest SHA-512/)
  })

  it('拒绝 YAML 重复键', async () => {
    const fixture = await setup()
    const filename = path.join(fixture.sources['win-x64'], 'latest.yml')
    await writeFile(filename, `${await readFile(filename, 'utf8')}version: ${version}\n`)
    await rejected(fixture, /unique|duplicate/i)
  })

  it('保留非空输出目录的所有现有文件，并且不留下任何部分资产', async () => {
    const fixture = await setup()
    await mkdir(fixture.output)
    const existing = names('win-x64')[0]
    await writeFile(path.join(fixture.output, existing), 'existing release')
    await writeFile(path.join(fixture.output, '.env'), 'existing secret')
    const result = cli(fixture)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/Output directory is not empty/)
    expect((await readdir(fixture.output)).sort()).toEqual(['.env', existing])
    expect(await readFile(path.join(fixture.output, existing), 'utf8')).toBe('existing release')
    expect(await readFile(path.join(fixture.output, '.env'), 'utf8')).toBe('existing secret')
  })

  it('校验失败时已存在的空输出目录仍为空', async () => {
    const fixture = await setup()
    await mkdir(fixture.output)
    await writeFile(path.join(fixture.sources['win-x64'], names('win-x64')[0]), 'corrupted last package')
    const result = cli(fixture)
    expect(result.status).toBe(1)
    expect(await readdir(fixture.output)).toEqual([])
    expect((await readdir(fixture.directory)).some(name => name.startsWith('.petbloom-release-'))).toBe(false)
  })

  it('拒绝把已有普通文件当作输出目录', async () => {
    const fixture = await setup()
    await writeFile(fixture.output, 'keep me')
    const result = cli(fixture)
    expect(result.status).toBe(1)
    expect(await readFile(fixture.output, 'utf8')).toBe('keep me')
  })

  it.skipIf(process.platform === 'win32').each(['package', 'blockmap', 'manifest', 'directory', 'output'])('拒绝 %s 符号链接', async kind => {
    const fixture = await setup()
    const target = 'win-x64'
    const filename = path.join(fixture.sources[target], names(target)[0])
    const external = path.join(fixture.directory, 'external')
    if (kind === 'directory' || kind === 'output') {
      await mkdir(external)
      if (kind === 'directory') {
        await rm(fixture.sources[target], { recursive: true })
        await symlink(external, fixture.sources[target])
      } else {
        await symlink(external, fixture.output)
      }
    } else {
      const destination = kind === 'package' ? filename : kind === 'blockmap' ? `${filename}.blockmap` : path.join(fixture.sources[target], 'latest.yml')
      await writeFile(external, kind === 'blockmap' ? 'blockmap' : await readFile(destination))
      await rm(destination, { force: true })
      await symlink(external, destination)
    }
    const result = cli(fixture)
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/not a symlink/)
    expect(await readdir(external).catch(() => [])).toEqual([])
    if (kind !== 'output') await expect(lstat(fixture.output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('参数数量不正确时返回用法和非零退出码', () => {
    for (const args of [[], ['input', 'output'], ['input', 'output', version, 'extra']]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', timeout: 15_000 })
      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/Usage: node scripts\/desktop-release.mjs/)
    }
  })
})
