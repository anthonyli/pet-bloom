import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { badgeLevels } from '../lib/data/badges'
import badgeManifest from '../public/badges/manifest.json'
import backgroundDerivatives from '../public/pet-backgrounds/derivatives.json'
import { petBackgrounds, backgroundCategories, filterPetBackgrounds, versionFiveBackgroundIds, holidayBackgroundIds, versionSevenBackgroundIds } from '../lib/pet-backgrounds'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import petsData from '../lib/data/pets.json'
import planned from '../lib/data/zodiac-plan.json'
import type { Pet } from '../lib/types'
import { filterPetCatalog } from '../lib/pet-catalog'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { petImage } from '../lib/i18n'
import { exportBackup, restoreBackup } from '../lib/server/backup'
const pets = petsData as Pet[]
const filter = (collection: 'all' | 'zodiac' | 'shanhai', query = '') => filterPetCatalog(pets, { collection, kind: 'all', query, locale: 'zh' })
describe('真实八阶段宠物与参考图鉴分类', () => {
  it('未领养显示宠物蛋，领养后使用对应成长形态', () => {
    expect(petImage(null)).toBe('/pets/egg.webp')
    expect(petImage(null, 8)).toBe('/pets/egg.webp')
    expect(existsSync(resolve(`public${petImage(null)}`))).toBe(true)
    expect(pets.some(pet => pet.id === 'egg')).toBe(false)
    expect(petImage('panda', 3)).toBe('/pets/panda/lv3.webp')
  })
  it('50 个唯一编号，分类和双语完整', () => {
    expect(pets).toHaveLength(50)
    expect(new Set(pets.map(pet => pet.id)).size).toBe(50)
    expect(pets.every(pet => pet.kind && pet.collections?.length && pet.name.zh && pet.name.en)).toBe(true)
  })
  it('保留参考图鉴的分组，新增三个生肖归入萌宠系', () => {
    for (const [group, count] of [['fairy', 2], ['shanhai', 6], ['anime', 1], ['cute', 41]] as const) expect(pets.filter(pet => pet.collections?.includes(group))).toHaveLength(count)
  })
  it('十二生肖完整开放，已生成的鼠牛蛇全部注册且顺序正确', () => {
    const zodiac = filter('zodiac')
    expect(zodiac).toHaveLength(12)
    expect(zodiac.map(pet => pet.zodiac!.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(planned).toHaveLength(3)
    for (const item of planned) {
      expect(item.status).toBe('ready')
      expect(item.requiredStages).toBe(8)
      expect(zodiac.find(pet => pet.id === item.id)?.zodiac?.order).toBe(item.order)
    }
  })
  it('山海主题按参考图鉴分组，不混入外部异兽单图', () => {
    expect(filter('shanhai').map(pet => pet.id).sort()).toEqual(['nine-tail-fox', 'pixiu', 'suanni', 'azure-dragon', 'white-tiger', 'vermilion-bird'].sort())
    expect(pets.some(pet => pet.id.startsWith('shanhai-'))).toBe(false)
  })
  it('中英文、生肖和动物类型可组合筛选', () => {
    expect(filter('zodiac', '卯兔')[0].id).toBe('rabbit')
    expect(filter('zodiac', 'Horse')[0].id).toBe('horse')
    expect(filter('zodiac', '子鼠')[0].id).toBe('zodiac-rat')
    expect(filter('zodiac', 'Ox')[0].id).toBe('zodiac-ox')
    expect(filter('zodiac', 'Snake')[0].id).toBe('zodiac-snake')
    const dogs = filterPetCatalog(pets, { collection: 'all', kind: 'dog', query: '', locale: 'en' })
    expect(dogs.length).toBeGreaterThan(5)
    expect(dogs.every(pet => pet.kind === 'dog')).toBe(true)
  })
  it('全部400张阶段图都存在，每只宠物8张文件内容均不同', () => {
    for (const pet of pets) {
      const hashes = []
      for (let level = 1; level <= 8; level++) {
        const path = resolve(`public/pets/${pet.id}/lv${level}.webp`)
        expect(existsSync(path)).toBe(true)
        hashes.push(createHash('sha256').update(readFileSync(path)).digest('hex'))
      }
      expect(new Set(hashes).size, `${pet.id}不能重复用一张图`).toBe(8)
    }
  })
  it.each(['zodiac-rat', 'zodiac-ox', 'zodiac-snake'])('新增生肖 %s 可以领养、评价和备份恢复', async (petId) => {
    const garden = new Garden(createDatabase(':memory:'))
    try {
      const owner = garden.register({ username: 'catalog-teacher', password: 'Catalog-password-123' }).user.id
      garden.saveProfile(owner, { displayName: '图鉴老师', subject: '科学', teachingRole: 'homeroom' })
      const classId = garden.createClass(owner, { name: '分类测试' }).id
      const [student] = garden.addStudents(owner, { classId, students: [{ name: '生肖学生' }] })
      garden.adopt(owner, student, { petId })
      const rule = garden.snapshot(owner).rules.find(item => item.points === 3)!
      garden.evaluate(owner, { studentIds: [student], ruleId: rule.id })
      const result = await restoreBackup(garden, owner, exportBackup(garden, owner))
      expect(result.imported).toBe(1)
      const restored = garden.snapshot(owner, result.classIds[0]).students[0]
      expect(restored.id).not.toBe(student)
      expect(garden.snapshot(owner, classId).students[0].id).toBe(student)
      expect(restored.pet_id).toBe(petId)
      expect(restored.points).toBe(3)
      expect(restored.pet_exp).toBe(3)
    } finally { garden.db.close() }
  })
})

describe('宠物背景本地素材', () => {
  it('41景保留v5原4和v6原28，v7仅新增9种国内节日且三类双语完整', () => {
    expect(versionFiveBackgroundIds).toEqual(['garden', 'starlight', 'beach', 'classroom'])
    expect(holidayBackgroundIds).toHaveLength(28)
    expect(versionSevenBackgroundIds).toEqual(['lunar-new-years-eve', 'little-new-year', 'dragon-head-raising', 'winter-solstice', 'arbor-day', 'youth-day', 'cpc-founding-day', 'army-day', 'farmers-harvest-festival'])
    expect(petBackgrounds).toHaveLength(41)
    expect(new Set(petBackgrounds.map(row => row.id)).size).toBe(41)
    expect(petBackgrounds.map(row => row.id).sort()).toEqual([...versionFiveBackgroundIds, ...holidayBackgroundIds, ...versionSevenBackgroundIds].sort())
    for (const [category, count] of [['everyday', 4], ['chinese', 22], ['global', 15]] as const) expect(petBackgrounds.filter(row => row.category === category)).toHaveLength(count)
    expect(backgroundCategories.map(row => row.id)).toEqual(['everyday', 'chinese', 'global'])
    for (const row of [...backgroundCategories, ...petBackgrounds]) expect(row.name.zh.trim() && row.name.en.trim()).not.toBe('')
    for (const row of petBackgrounds) expect(row.description.zh.trim() && row.description.en.trim()).not.toBe('')
    expect(new Set(petBackgrounds.map(row => createHash('sha256').update(readFileSync(resolve(`public${row.image}`))).digest('hex'))).size).toBe(41)
  })
  it('中英文搜索可与分类组合，空白不限制，无结果不泄露未拥有目录', () => {
    expect(filterPetBackgrounds(petBackgrounds, 'all', '  ')).toEqual(petBackgrounds)
    expect(filterPetBackgrounds(petBackgrounds, 'chinese', '')).toHaveLength(22)
    expect(filterPetBackgrounds(petBackgrounds, 'chinese', '建军').map(row => row.id)).toEqual(['army-day'])
    expect(filterPetBackgrounds(petBackgrounds, 'all', ' AUGUST FIRST ').map(row => row.id)).toEqual(['army-day'])
    expect(filterPetBackgrounds(petBackgrounds, 'global', '')).toHaveLength(15)
    expect(filterPetBackgrounds(petBackgrounds, 'all', '中秋').map(row => row.id)).toEqual(['mid-autumn'])
    expect(filterPetBackgrounds(petBackgrounds, 'all', ' CHRISTMAS ').map(row => row.id)).toEqual(['christmas'])
    expect(filterPetBackgrounds(petBackgrounds, 'chinese', 'Christmas')).toEqual([])
    const owned = petBackgrounds.filter(row => ['garden', 'spring-festival', 'christmas'].includes(row.id))
    expect(filterPetBackgrounds(owned, 'chinese', '').map(row => row.id)).toEqual(['spring-festival'])
    expect(filterPetBackgrounds(owned, 'global', 'Easter')).toEqual([])
    expect(filterPetBackgrounds(owned, 'all', '没有这个节日')).toEqual([])
    expect(owned).toHaveLength(3)
  })
  it.each(petBackgrounds)('$id场景完整可解码且不包含外部引用或脚本', async background => {
    const file = resolve(`public${background.image}`), content = readFileSync(file, 'utf8')
    expect(content).not.toMatch(/<script|\son\w+=|(?:href|src)\s*=/i)
    expect(await sharp(file).metadata()).toMatchObject({ format: 'svg', width: 640, height: 480 })
  })
  it('国庆以大红为主，国旗使用30×20网格且包含完整五颗黄星', async () => {
    const file = resolve('public/pet-backgrounds/national-day.svg'), content = readFileSync(file, 'utf8')
    const flag = content.match(/<g id="national-flag"[^>]*>([\s\S]*?)<\/g>/)?.[1]
    expect(flag).toMatch(/<rect width="30" height="20" fill="#EE1C25"/)
    expect(flag?.match(/<polygon\b/g)).toHaveLength(5)
    expect(flag).toContain('fill="#FFFF00"')
    for (const position of ['10 2', '12 4', '12 7', '10 9']) expect(flag).toContain(`translate(${position})`)
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let red = 0
    for (let index = 0; index < data.length; index += info.channels) if (data[index] >= 150 && data[index] > data[index + 1] * 1.6 && data[index] > data[index + 2] * 1.35) red++
    expect(red / (info.width * info.height)).toBeGreaterThan(.6)
  })
  it('透明展示副本完整覆盖三个白底生肖的八阶段，不替换原图', () => {
    expect(backgroundDerivatives.assets).toHaveLength(24)
    for (const pet of ['zodiac-rat', 'zodiac-ox', 'zodiac-snake']) {
      const rows = backgroundDerivatives.assets.filter(row => row.source.startsWith(`public/pets/${pet}/`))
      expect(rows.map(row => row.source).sort()).toEqual(Array.from({ length: 8 }, (_, index) => `public/pets/${pet}/lv${index + 1}.webp`))
      expect(new Set(rows.map(row => row.sha256)).size).toBe(8)
    }
  })
  it.each([
    { pet: 'zodiac-rat', level: 3, ground: [250, 459], paw: [257, 430] },
    { pet: 'zodiac-rat', level: 8, ground: [310, 483], paw: [252, 473] },
    { pet: 'zodiac-ox', level: 6, ground: [190, 485], paw: [250, 477] }
  ])('$pet Lv.$level移除接地底片且保留脚掌', async ({ pet, level, ground, paw }) => {
    const pixels = await sharp(resolve(`public/pet-backgrounds/pets/${pet}/lv${level}.webp`)).ensureAlpha().raw().toBuffer()
    expect(pixels[(ground[1] * 560 + ground[0]) * 4 + 3]).toBe(0)
    expect(pixels[(paw[1] * 560 + paw[0]) * 4 + 3]).toBe(255)
  })
  it('牛Lv.4透明副本保留原有前景花草', async () => {
    const pixels = await sharp(resolve('public/pet-backgrounds/pets/zodiac-ox/lv4.webp')).ensureAlpha().raw().toBuffer()
    expect(pixels[(360 * 560 + 114) * 4 + 3]).toBe(255)
  })
  it.each(backgroundDerivatives.assets)('$file保持原主体像素，透明白底可合成且来源哈希一致', async asset => {
    const original = readFileSync(resolve(asset.source)), derived = readFileSync(resolve(asset.file))
    const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex')
    expect(hash(original)).toBe(asset.source_sha256)
    expect(hash(derived)).toBe(asset.sha256)
    const metadata = await sharp(derived).metadata()
    expect(metadata).toMatchObject({ format: 'webp', width: asset.width, height: asset.height, hasAlpha: true })
    expect(metadata.xmp?.toString()).toContain(asset.source)
    expect(metadata.xmp?.toString()).toContain(asset.source_sha256)
    const before = await sharp(original).ensureAlpha().raw().toBuffer(), after = await sharp(derived).ensureAlpha().raw().toBuffer()
    let removed = 0, retained = 0
    for (let index = 0; index < after.length; index += 4) {
      if (after[index + 3] === 0) { removed++; continue }
      retained++
      if (before[index] !== after[index] || before[index + 1] !== after[index + 1] || before[index + 2] !== after[index + 2]) throw new Error(`${asset.file}主体像素发生改变`)
    }
    expect(removed).toBe(asset.transparent_pixels)
    expect(removed).toBeGreaterThan(asset.width * asset.height * .5)
    expect(retained).toBeGreaterThan(asset.width * asset.height * .1)
  })
})

describe('Codex 正式等级徽章素材', () => {
  it('Lv.2至Lv.8均有独立图片且与交付清单一致', () => {
    expect(badgeLevels.map(badge => badge.level)).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(badgeManifest.assets).toHaveLength(7)
    const hashes = badgeLevels.map(badge => {
      expect(badge.image).toBe(`/badges/lv${badge.level}.png`)
      const image = readFileSync(resolve(`public${badge.image}`))
      const hash = createHash('sha256').update(image).digest('hex')
      expect(hash).toBe(badgeManifest.assets.find(asset => asset.level === badge.level)?.sha256)
      return hash
    })
    expect(new Set(hashes).size).toBe(7)
  })
  it.each(badgeLevels)('Lv.$level图片完整可解码，512px且保持透明背景', async badge => {
    const file = resolve(`public${badge.image}`)
    const metadata = await sharp(file).metadata()
    expect(metadata).toMatchObject({ format: 'png', width: 512, height: 512, hasAlpha: true })
    const pixels = await sharp(file).ensureAlpha().raw().toBuffer()
    expect(pixels[3]).toBe(0)
    expect(pixels.at(-1)).toBe(0)
    expect(pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
  })
})
