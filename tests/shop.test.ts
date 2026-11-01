import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createDatabase } from '../lib/server/db'
import { Garden } from '../lib/server/garden'
import { MAX_CLASS_IMAGE_BYTES } from '../lib/shop'
import { editableText, localizedUserText } from '../lib/i18n'
import { petBackgrounds, petBackgroundById, versionFiveBackgroundIds, holidayBackgroundIds, versionSevenBackgroundIds } from '../lib/pet-backgrounds'
import { DomainError } from '../lib/server/errors'

let garden: Garden, owner: string, other: string, classId: string, otherClassId: string, studentId: string, secondStudentId: string
const reward = (stock = 2, cost = 1) => ({ name: { zh: '彩色铅笔', en: 'Colored pencil' }, description: { zh: '课堂绘画用品', en: 'For classroom drawing' }, category: 'stationery', icon: 'pencil', stock, cost })
const imageInput = async () => `data:image/png;base64,${(await sharp({ create: { width: 12, height: 12, channels: 4, background: '#6d4aff' } }).png().toBuffer()).toString('base64')}`
const findItem = (id: string) => garden.snapshot(owner).items.find(item => item.id === id)!
const lastRedemption = () => garden.snapshot(owner).redemptions[0]
const backgroundItem = (backgroundId = 'garden', id = classId, actor = owner) => garden.snapshot(actor, id).items.find(item => item.background_id === backgroundId)!
const backgroundStudent = (id = studentId) => garden.snapshot(owner, classId).students.find(student => student.id === id)!
const shopState = () => Object.fromEntries(['students', 'items', 'redemptions', 'badges'].map(table => [table, garden.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
function expectError(run: () => unknown, code: string, status: number) {
  let error: unknown
  try { run() } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(DomainError)
  expect(error).toMatchObject({ code, status })
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 1, 4))
  garden = new Garden(createDatabase(':memory:'))
  owner = garden.register({ username: 'shop-owner', password: 'Shop-password-123' }).user.id
  other = garden.register({ username: 'shop-other', password: 'Shop-password-456' }).user.id
  garden.saveProfile(owner, { displayName: '商店甲老师', subject: '美术', teachingRole: 'homeroom' })
  garden.saveProfile(other, { displayName: '商店乙老师', subject: '数学', teachingRole: 'subject' })
  classId = garden.createClass(owner, { name: '商店测试班级' }).id
  otherClassId = garden.createClass(other, { name: '其他教师商店班级' }).id
  const students = garden.addStudents(owner, { classId, students: [{ name: '学生一' }, { name: '学生二' }] })
  studentId = students[0]
  secondStudentId = students[1]
  garden.adopt(owner, studentId, { petId: 'panda' })
  garden.adopt(owner, secondStudentId, { petId: 'westie' })
  garden.addRule(owner, { classId, name: { zh: '等级奖励', en: 'Level reward' }, points: 40, category: 'other' })
  const ruleId = garden.snapshot(owner).rules.at(-1)!.id
  garden.evaluate(owner, { studentIds: [studentId, secondStudentId], ruleId })
})
afterEach(() => { vi.restoreAllMocks(); garden.db.close() })

describe('商品管理、归属与图片', () => {
  it('创建与修改双语商品，缺省商品无限库存', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward() })
    expect(findItem(id)).toMatchObject(reward())
    await garden.updateItem(owner, id, { ...reward(4, 2), name: { zh: '笔记本', en: 'Notebook' }, icon: 'notebook' })
    expect(findItem(id)).toMatchObject({ name: { zh: '笔记本', en: 'Notebook' }, stock: 4, cost: 2, icon: 'notebook' })
    const basic = await garden.addItem(owner, { classId, name: { zh: '奖励', en: 'Reward' }, cost: 1 })
    expect(findItem(basic.id)).toMatchObject({ stock: -1, icon: 'gift', category: 'other', description: { zh: '', en: '' }, image: null, background_id: null })
  })

  it('单次输入可创建商品与规则，旧商品只改库存时不覆盖翻译', async () => {
    const { id } = await garden.addItem(owner, { classId, name: localizedUserText('  一盒彩笔  ', 'zh'), description: localizedUserText('用于课堂绘画', 'zh'), cost: 1 })
    expect(findItem(id)).toMatchObject({ name: { zh: '一盒彩笔', en: '一盒彩笔' }, description: { zh: '用于课堂绘画', en: '用于课堂绘画' } })
    garden.addRule(owner, { classId, name: localizedUserText('主动帮助同学', 'zh'), points: 2, category: 'behavior' })
    expect(garden.snapshot(owner).rules.at(-1)!.name).toEqual({ zh: '主动帮助同学', en: '主动帮助同学' })

    const legacy = await garden.addItem(owner, { classId, ...reward() })
    const original = findItem(legacy.id)
    await garden.updateItem(owner, legacy.id, { ...reward(9), name: localizedUserText(editableText(original.name, 'en'), 'en', original.name), description: localizedUserText(editableText(original.description, 'en'), 'en', original.description) })
    expect(findItem(legacy.id)).toMatchObject({ name: original.name, description: original.description, stock: 9 })
  })

  it('拒绝非法价格、库存和图标，不写入部分商品', async () => {
    const before = garden.snapshot(owner).items.length
    for (const extra of [{ cost: 0 }, { stock: -2 }, { stock: 1.5 }, { icon: '../../private' }, { category: 'invalid' }, { description: { zh: 'x'.repeat(501), en: '' } }]) {
      await expect(garden.addItem(owner, { classId, ...reward(), ...extra })).rejects.toThrow()
    }
    expect(garden.snapshot(owner).items).toHaveLength(before)
  })

  it('只修改当前教师的商品，客户端owner_id不能改变商品归属', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward() })
    await expect(garden.updateItem(other, id, reward(9))).rejects.toThrow('notFound')
    expect(() => garden.deleteItem(other, id)).toThrow('notFound')
    const foreign = await garden.addItem(other, { ...reward(), classId: otherClassId, owner_id: owner })
    expect(garden.snapshot(owner).items.some(item => item.id === foreign.id)).toBe(false)
    expect(garden.snapshot(other).items.some(item => item.id === foreign.id)).toBe(true)
    await expect(garden.addItem('missing-owner', { classId, ...reward() })).rejects.toThrow('unauthorized')
    expect(findItem(id).stock).toBe(2)
  })

  it('图片按认证URL读取，编辑不传image时保留，null时清除', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward(), image: await imageInput() })
    const original = garden.itemImage(owner, id)
    expect(findItem(id).image).toMatch(new RegExp(`^/api/items/${id}/image\\?v=[a-f0-9]{64}$`))
    expect(JSON.stringify(garden.snapshot(owner))).not.toContain('data:image/')
    expect((await sharp(original.data).metadata()).format).toBe('webp')
    expect(() => garden.itemImage(other, id)).toThrow('notFound')
    await garden.updateItem(owner, id, reward(3))
    expect(garden.itemImage(owner, id)).toEqual(original)
    await garden.updateItem(owner, id, { ...reward(), image: null })
    expect(findItem(id).image).toBeNull()
    expect(() => garden.itemImage(owner, id)).toThrow('notFound')
  })

  it('空图片字符串不是合法的图片缺省值', async () => {
    const before = garden.snapshot(owner).items.length
    await expect(garden.addItem(owner, { classId, ...reward(), image: '' })).rejects.toThrow('invalidImage')
    expect(garden.snapshot(owner).items).toHaveLength(before)
  })

  it('坏图片写入与修改失败不改变原商品', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward() })
    const before = findItem(id)
    await expect(garden.updateItem(owner, id, { ...reward(99), image: 'data:image/png;base64,YQ==' })).rejects.toThrow('invalidImage')
    expect(findItem(id)).toEqual(before)
    await expect(garden.addItem(owner, { classId, ...reward(), image: 'data:image/svg+xml;base64,PHN2Zy8+' })).rejects.toThrow('invalidImage')
    expect(garden.snapshot(owner).items.filter(item => item.background_id === null)).toHaveLength(4)
    expect(garden.snapshot(owner).items.filter(item => item.background_id !== null)).toHaveLength(41)
  })

  it('图片总量限制独立于其他教师，替换图片排除旧图片额度', async () => {
    const image = await imageInput()
    const { id } = await garden.addItem(owner, { classId, ...reward(), image })
    garden.db.prepare('UPDATE items SET image_bytes = ? WHERE id = ?').run(MAX_CLASS_IMAGE_BYTES, id)
    await expect(garden.addItem(owner, { classId, ...reward(), image })).rejects.toThrow('imageStorageFull')
    await expect(garden.addItem(other, { ...reward(), classId: otherClassId, image })).resolves.toHaveProperty('id')
    await expect(garden.updateItem(owner, id, { ...reward(), image })).resolves.toBeUndefined()
    const stored = garden.db.prepare('SELECT image_bytes FROM items WHERE id = ?').get(id) as { image_bytes: number }
    expect(stored.image_bytes).toBeLessThan(MAX_CLASS_IMAGE_BYTES)
  })
})

describe('徽章兑换与库存事务', () => {
  it('编辑库存为待退款预留安全整数空间，退款后仍精确', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward(Number.MAX_SAFE_INTEGER) })
    garden.redeem(owner, { studentId, itemId: id })
    expect(findItem(id).stock).toBe(Number.MAX_SAFE_INTEGER - 1)
    await expect(garden.updateItem(owner, id, reward(Number.MAX_SAFE_INTEGER))).rejects.toThrow('stockLimitExceeded')
    expect(findItem(id).stock).toBe(Number.MAX_SAFE_INTEGER - 1)
    garden.undoRedemption(owner, lastRedemption().id)
    expect(findItem(id).stock).toBe(Number.MAX_SAFE_INTEGER)
    expect(Number.isSafeInteger(findItem(id).stock)).toBe(true)
  })
  it('有限库存扣一并记账，退款恢复库存与徽章且不能重复退款', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward() })
    garden.redeem(owner, { studentId, itemId: id })
    const redeemed = lastRedemption()
    expect(redeemed).toMatchObject({ item_name: reward().name, cost: 1, stock_deducted: 1, background_id: null })
    expect(findItem(id).stock).toBe(1)
    expect(garden.student(owner, studentId).spent_badges).toBe(1)
    garden.undoRedemption(owner, redeemed.id)
    expect(findItem(id).stock).toBe(2)
    expect(garden.student(owner, studentId).spent_badges).toBe(0)
    expect(() => garden.undoRedemption(owner, redeemed.id)).toThrow('notFound')
    expect(findItem(id).stock).toBe(2)
  })

  it('无限库存兑换与退款不改变库存', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward(-1) })
    garden.redeem(owner, { studentId, itemId: id })
    expect(lastRedemption().stock_deducted).toBe(0)
    expect(findItem(id).stock).toBe(-1)
    garden.undoRedemption(owner, lastRedemption().id)
    expect(findItem(id).stock).toBe(-1)
    expect(garden.student(owner, studentId).spent_badges).toBe(0)
  })

  it('售罄或徽章不足时库存、消费和兑换记录全部保持不变', async () => {
    const sold = await garden.addItem(owner, { classId, ...reward(0) })
    const expensive = await garden.addItem(owner, { classId, ...reward(2, 2) })
    expect(() => garden.redeem(owner, { studentId, itemId: sold.id })).toThrow('outOfStock')
    expect(() => garden.redeem(owner, { studentId, itemId: expensive.id })).toThrow('insufficientBadges')
    expect(findItem(sold.id).stock).toBe(0)
    expect(findItem(expensive.id).stock).toBe(2)
    expect(garden.student(owner, studentId).spent_badges).toBe(0)
    expect(garden.snapshot(owner).redemptions).toHaveLength(0)
  })

  it('两名学生争兑最后一件时不会超卖或扣第二人的徽章', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward(1) })
    garden.redeem(owner, { studentId, itemId: id })
    expect(() => garden.redeem(owner, { studentId: secondStudentId, itemId: id })).toThrow('outOfStock')
    expect(findItem(id).stock).toBe(0)
    expect(garden.student(owner, secondStudentId).spent_badges).toBe(0)
    expect(garden.snapshot(owner).redemptions).toHaveLength(1)
  })

  it('无限改有限后撤销旧兑换不能凭空增加库存', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward(-1) })
    garden.redeem(owner, { studentId, itemId: id })
    const redemptionId = lastRedemption().id
    await garden.updateItem(owner, id, reward(5))
    garden.undoRedemption(owner, redemptionId)
    expect(findItem(id).stock).toBe(5)
    expect(garden.student(owner, studentId).spent_badges).toBe(0)
  })

  it('有限改无限后撤销保持无限，不增加为零', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward(1) })
    garden.redeem(owner, { studentId, itemId: id })
    const redemptionId = lastRedemption().id
    await garden.updateItem(owner, id, reward(-1))
    garden.undoRedemption(owner, redemptionId)
    expect(findItem(id).stock).toBe(-1)
  })

  it('编辑商品不会改写已发生兑换的名称与价格', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward() })
    garden.redeem(owner, { studentId, itemId: id })
    const original = lastRedemption()
    await garden.updateItem(owner, id, { ...reward(4, 5), name: { zh: '新商品', en: 'New reward' } })
    expect(lastRedemption()).toEqual(original)
    garden.undoRedemption(owner, original.id)
    expect(garden.student(owner, studentId).spent_badges).toBe(0)
    expect(findItem(id).stock).toBe(5)
  })

  it('移除商品释放图片且仍可退款，不重新上架', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward(1), image: await imageInput() })
    garden.redeem(owner, { studentId, itemId: id })
    const original = lastRedemption()
    garden.deleteItem(owner, id)
    expect(garden.snapshot(owner).items.some(item => item.id === id)).toBe(false)
    expect(() => garden.itemImage(owner, id)).toThrow('notFound')
    expect(() => garden.redeem(owner, { studentId: secondStudentId, itemId: id })).toThrow('notFound')
    await expect(garden.updateItem(owner, id, reward())).rejects.toThrow('notFound')
    garden.undoRedemption(owner, original.id)
    const removed = garden.db.prepare('SELECT active, stock, image, image_key, image_bytes FROM items WHERE id = ?').get(id)
    expect(removed).toEqual({ active: 0, stock: 1, image: null, image_key: null, image_bytes: 0 })
    expect(garden.student(owner, studentId).spent_badges).toBe(0)
    expect(garden.snapshot(owner).items.some(item => item.id === id)).toBe(false)
    expect(lastRedemption()).toMatchObject({ item_name: original.item_name, cost: original.cost, undone: 1 })
  })

  it('其他教师不能兑换学生徽章、使用外部商品或退款', async () => {
    const { id } = await garden.addItem(owner, { classId, ...reward() })
    const foreign = await garden.addItem(other, { ...reward(), classId: otherClassId })
    expect(() => garden.redeem(other, { studentId, itemId: id })).toThrow('notFound')
    expect(() => garden.redeem(owner, { studentId, itemId: foreign.id })).toThrow('notFound')
    garden.redeem(owner, { studentId, itemId: id })
    expect(() => garden.undoRedemption(other, lastRedemption().id)).toThrow('notFound')
    expect(findItem(id).stock).toBe(1)
    expect(garden.student(owner, studentId).spent_badges).toBe(1)
  })
})

describe('背景勋章兑换、解锁与装扮', () => {
  it('目录41背景保留v5原四/v6固定28白名单且v7只追加9国内节日，完整双语且缺省不是免费解锁', () => {
    expect([...versionFiveBackgroundIds].sort()).toEqual(['beach', 'classroom', 'garden', 'starlight'])
    expect(versionFiveBackgroundIds).toHaveLength(4)
    expect(holidayBackgroundIds).toHaveLength(28)
    expect(new Set(holidayBackgroundIds).size).toBe(28)
    expect(holidayBackgroundIds.every(id => !new Set<string>(versionFiveBackgroundIds).has(id))).toBe(true)
    expect([...versionSevenBackgroundIds].sort()).toEqual(['lunar-new-years-eve', 'little-new-year', 'dragon-head-raising', 'winter-solstice', 'arbor-day', 'youth-day', 'cpc-founding-day', 'army-day', 'farmers-harvest-festival'].sort())
    expect(versionSevenBackgroundIds).toHaveLength(9)
    expect(new Set(versionSevenBackgroundIds).size).toBe(9)
    expect(versionSevenBackgroundIds.every(id => !new Set<string>([...versionFiveBackgroundIds, ...holidayBackgroundIds]).has(id))).toBe(true)
    expect(petBackgrounds).toHaveLength(41)
    expect(new Set(petBackgrounds.map(background => background.id)).size).toBe(41)
    expect(petBackgrounds.map(background => background.id).sort()).toEqual([...versionFiveBackgroundIds, ...holidayBackgroundIds, ...versionSevenBackgroundIds].sort())
    expect(petBackgrounds.filter(background => background.category === 'everyday')).toHaveLength(4)
    expect(petBackgrounds.filter(background => background.category === 'chinese')).toHaveLength(22)
    expect(petBackgrounds.filter(background => background.category === 'global')).toHaveLength(15)
    for (const background of petBackgrounds) {
      expect(background.name.zh.trim()).not.toBe('')
      expect(background.name.en.trim()).not.toBe('')
      expect(background.description.zh.trim()).not.toBe('')
      expect(background.description.en.trim()).not.toBe('')
      expect(petBackgroundById(background.id)).toEqual(background)
    }
    for (const invalid of [null, undefined, '', '../../secret', 'unknown']) expect(petBackgroundById(invalid)).toBeUndefined()
    expect(backgroundStudent()).toMatchObject({ background_id: null, owned_background_ids: [] })
  })

  it('注册模板及新班各有41个1徽章无限库存背景，班级价格/上下架与模板及其他班隔离', async () => {
    const templateRows = () => garden.db.prepare('SELECT * FROM items WHERE owner_id = ? AND class_id IS NULL AND background_id IS NOT NULL ORDER BY background_id').all(owner)
    const templates = templateRows(), first = backgroundItem(), foreign = backgroundItem('garden', otherClassId, other)
    expect(templates).toHaveLength(41)
    expect(templates).toEqual(expect.arrayContaining(petBackgrounds.map(background => expect.objectContaining({ background_id: background.id, cost: 1, stock: -1, image: null, active: 1 }))))
    expect(garden.db.prepare('SELECT COUNT(*) AS n FROM items WHERE owner_id = ? AND class_id IS NULL AND background_id IS NULL').get(owner)).toEqual({ n: 3 })
    expect(garden.db.prepare('SELECT COUNT(*) AS n FROM items WHERE owner_id = ? AND class_id IS NULL AND background_id IS NOT NULL').get(other)).toEqual({ n: 41 })
    await garden.updateItem(owner, first.id, { name: first.name, description: first.description, category: first.category, icon: first.icon, cost: 3, stock: 2 })
    expect(backgroundItem()).toMatchObject({ background_id: 'garden', cost: 3, stock: -1, name: first.name, description: first.description, image: null })
    garden.deleteItem(owner, backgroundItem('beach').id)
    const nextClass = garden.createClass(owner, { name: '独立新背景班' }).id
    const nextItems = garden.snapshot(owner, nextClass).items.filter(item => item.background_id !== null)
    expect(nextItems).toHaveLength(41)
    expect(nextItems.every(item => item.cost === 1 && item.stock === -1 && item.image === null)).toBe(true)
    expect(nextItems.every(item => !templates.some(row => (row as { id: string }).id === item.id) && item.id !== first.id && item.id !== foreign.id)).toBe(true)
    expect(backgroundItem('garden', otherClassId, other)).toEqual(foreign)
    expect(templateRows()).toEqual(templates)
  })

  it('兑换只解锁而不自动装扮，扣徽章并保持无限库存，保留背景与实际教师快照，null免费还原', async () => {
    const item = backgroundItem()
    await garden.updateItem(owner, item.id, { name: item.name, cost: 1, stock: 2 })
    garden.redeem(owner, { studentId, itemId: item.id, actor_user_id: other, actor_name: '伪造教师', background_id: 'beach' })
    expect(lastRedemption()).toMatchObject({ student_id: studentId, item_id: item.id, background_id: 'garden', cost: 1, stock_deducted: 0, actor_user_id: owner, actor_name: '商店甲老师', actor_subject: '美术' })
    expect(backgroundStudent()).toMatchObject({ background_id: null, owned_background_ids: ['garden'], spent_badges: 1 })
    expect(findItem(item.id).stock).toBe(-1)
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    expect(backgroundStudent()).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 1 })
    const count = garden.snapshot(owner).redemptions.length
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    garden.setBackground(owner, studentId, { backgroundId: null })
    expect(backgroundStudent()).toMatchObject({ background_id: null, owned_background_ids: ['garden'], spent_badges: 1 })
    expect(garden.snapshot(owner).redemptions).toHaveLength(count)
    expect(backgroundStudent(secondStudentId)).toMatchObject({ background_id: null, owned_background_ids: [] })
  })

  it('背景只允许改价，伪造身份、库存、上传图片和名称描述均不改目录身份', async () => {
    const item = backgroundItem(), original = garden.db.prepare('SELECT * FROM items WHERE id = ?').get(item.id) as Record<string, unknown>
    await garden.updateItem(owner, item.id, { cost: 4, stock: 0, background_id: 'beach', backgroundId: 'beach', image: await imageInput(), name: { zh: '伪造背景', en: 'Forged background' }, description: { zh: '伪造描述', en: 'Forged description' }, category: 'stationery', icon: 'pencil' })
    expect(garden.db.prepare('SELECT * FROM items WHERE id = ?').get(item.id)).toEqual({ ...original, cost: 4 })
    expect(findItem(item.id)).toMatchObject({ background_id: 'garden', stock: -1, image: null, name: item.name, description: item.description, cost: 4 })
  })

  it('不足徽章拒绝背景兑换，不扣库存不解锁也不写历史', () => {
    const poor = garden.addStudents(owner, { classId, students: [{ name: '未获徽章' }] })[0]
    const before = shopState()
    expectError(() => garden.redeem(owner, { studentId: poor, itemId: backgroundItem().id }), 'insufficientBadges', 409)
    expect(shopState()).toEqual(before)
  })

  it('同教师跨班商品、其他教师与不存在学生不能兑换或装扮，拒绝不写入', () => {
    const secondClass = garden.createClass(owner, { name: '同教师另一班' }).id
    const before = shopState()
    expectError(() => garden.redeem(owner, { studentId, itemId: backgroundItem('garden', secondClass).id }), 'notFound', 404)
    expectError(() => garden.redeem(owner, { studentId, itemId: backgroundItem('garden', otherClassId, other).id }), 'notFound', 404)
    expectError(() => garden.redeem(other, { studentId, itemId: backgroundItem().id }), 'notFound', 404)
    expectError(() => garden.setBackground(other, studentId, { backgroundId: null, owner_id: owner, classId }), 'notFound', 404)
    expectError(() => garden.setBackground(owner, 'missing-student', { backgroundId: null }), 'notFound', 404)
    expect(shopState()).toEqual(before)
  })

  it.each(['unknown', '../../secret', '/pet-backgrounds/garden.svg', '', 1, false, [], {}])('非目录背景%j返回400/invalidBackground且不写入', backgroundId => {
    const before = shopState()
    expectError(() => garden.setBackground(owner, studentId, { backgroundId }), 'invalidBackground', 400)
    expect(shopState()).toEqual(before)
  })

  it('目录中未持有背景返回409，伪造owned字段不能绕过；null无需消费', () => {
    const before = shopState()
    expectError(() => garden.setBackground(owner, studentId, { backgroundId: 'garden', owned_background_ids: ['garden'], actor_user_id: owner }), 'backgroundNotOwned', 409)
    expect(shopState()).toEqual(before)
    garden.setBackground(owner, studentId, { backgroundId: null })
    expect(shopState()).toEqual(before)
  })

  it('同班背景商品不能重复建档，并发请求兑换同一背景只能成功一次', async () => {
    garden.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
    const item = backgroundItem(), beforeDuplicate = shopState()
    expect(() => garden.db.prepare('INSERT INTO items (id, owner_id, class_id, name, cost, active, background_id) SELECT ?, owner_id, class_id, name, cost, active, background_id FROM items WHERE id = ?').run('duplicate-background-product', item.id)).toThrow('UNIQUE constraint failed')
    expect(shopState()).toEqual(beforeDuplicate)
    const results = await Promise.allSettled([item.id, item.id].map(itemId => Promise.resolve().then(() => garden.redeem(owner, { studentId, itemId }))))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'backgroundAlreadyOwned', status: 409 })
    expect(backgroundStudent()).toMatchObject({ spent_badges: 1, owned_background_ids: ['garden'] })
    expect(garden.db.prepare('SELECT background_id FROM redemptions WHERE student_id = ? AND undone = 0').all(studentId)).toEqual([{ background_id: 'garden' }])
    const before = shopState()
    expectError(() => garden.redeem(owner, { studentId, itemId: item.id }), 'backgroundAlreadyOwned', 409)
    expect(shopState()).toEqual(before)
    garden.redeem(owner, { studentId: secondStudentId, itemId: item.id })
    expect(backgroundStudent(secondStudentId).owned_background_ids).toEqual(['garden'])
  })

  it('换宠及毕业再领养不丢背景或已拥有集合，其他学生不共享', () => {
    garden.redeem(owner, { studentId, itemId: backgroundItem().id })
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    garden.changePet(owner, studentId, { petId: 'westie' })
    expect(backgroundStudent()).toMatchObject({ pet_id: 'westie', background_id: 'garden', owned_background_ids: ['garden'], generation: 1 })
    garden.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
    garden.adopt(owner, studentId, { petId: 'capybara' })
    expect(backgroundStudent()).toMatchObject({ pet_id: 'capybara', background_id: 'garden', owned_background_ids: ['garden'], generation: 2, spent_badges: 1, pet_exp: 0 })
    expect(backgroundStudent(secondStudentId).owned_background_ids).toEqual([])
  })

  it('商品下架和改价不改历史背景所有权，仍可装扮及退款', async () => {
    const item = backgroundItem()
    garden.redeem(owner, { studentId, itemId: item.id })
    const redemption = lastRedemption()
    await garden.updateItem(owner, item.id, { name: { zh: '改名背景', en: 'Renamed background' }, cost: 3, stock: -1 })
    garden.deleteItem(owner, item.id)
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    expect(backgroundStudent()).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'] })
    expect(lastRedemption()).toMatchObject({ id: redemption.id, background_id: 'garden', cost: 1, item_name: redemption.item_name })
    expect(garden.snapshot(owner).items.some(row => row.id === item.id)).toBe(false)
    garden.undoRedemption(owner, redemption.id)
    expect(backgroundStudent()).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    expect(garden.db.prepare('SELECT active FROM items WHERE id = ?').get(item.id)).toEqual({ active: 0 })
  })

  it('所有权查全量有效兑换而非最近200条历史，退款后才取消', () => {
    garden.redeem(owner, { studentId, itemId: backgroundItem().id })
    const redemption = lastRedemption(), ordinary = garden.snapshot(owner).items.find(item => item.background_id === null)!
    garden.db.prepare('UPDATE redemptions SET created_at = 1 WHERE id = ?').run(redemption.id)
    garden.db.transaction(() => {
      const insert = garden.db.prepare('INSERT INTO redemptions (id, student_id, item_id, item_name, cost, created_at, undone, stock_deducted, background_id) VALUES (?, ?, ?, ?, 1, ?, 1, 0, NULL)')
      for (let index = 0; index < 205; index++) insert.run(`later-ordinary-${index}`, studentId, ordinary.id, JSON.stringify(ordinary.name), 1000 + index)
    })()
    const state = garden.snapshot(owner)
    expect(state.redemptions).toHaveLength(200)
    expect(state.redemptions.some(row => row.id === redemption.id)).toBe(false)
    expect(backgroundStudent().owned_background_ids).toEqual(['garden'])
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    expect(backgroundStudent().background_id).toBe('garden')
    garden.undoRedemption(owner, redemption.id)
    expect(backgroundStudent()).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
  })

  it('退款同事务清除当前装备和所有权、归还原价并保持无限库存，不能退两次且可再次兑换', async () => {
    const item = backgroundItem()
    await garden.updateItem(owner, item.id, { name: item.name, cost: 1, stock: 2 })
    garden.redeem(owner, { studentId, itemId: item.id })
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    const redemption = lastRedemption()
    garden.undoRedemption(owner, redemption.id)
    expect(backgroundStudent()).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    expect(findItem(item.id).stock).toBe(-1)
    expect(lastRedemption()).toMatchObject({ id: redemption.id, background_id: 'garden', undone: 1, undone_by_user_id: owner, undone_by_name: '商店甲老师' })
    const before = shopState()
    expectError(() => garden.undoRedemption(owner, redemption.id), 'notFound', 404)
    expectError(() => garden.setBackground(owner, studentId, { backgroundId: 'garden' }), 'backgroundNotOwned', 409)
    expect(shopState()).toEqual(before)
    garden.redeem(owner, { studentId, itemId: item.id })
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    expect(backgroundStudent()).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'], spent_badges: 1 })
    expect(garden.db.prepare('SELECT undone FROM redemptions WHERE student_id = ? AND background_id = ? ORDER BY rowid').all(studentId, 'garden')).toEqual([{ undone: 1 }, { undone: 0 }])
  })

  it('退款未装备背景不清除另一个已拥有且正在使用的背景', () => {
    garden.evaluate(owner, { studentIds: [studentId], custom: { points: 700 } })
    garden.redeem(owner, { studentId, itemId: backgroundItem().id })
    const gardenRedemption = lastRedemption()
    garden.redeem(owner, { studentId, itemId: backgroundItem('beach').id })
    garden.setBackground(owner, studentId, { backgroundId: 'beach' })
    garden.undoRedemption(owner, gardenRedemption.id)
    expect(backgroundStudent()).toMatchObject({ background_id: 'beach', owned_background_ids: ['beach'], spent_badges: 1 })
  })

  it('兑换后续写入失败回滚库存、消费和背景所有权', async () => {
    const item = backgroundItem()
    await garden.updateItem(owner, item.id, { name: item.name, cost: 1, stock: 2 })
    const before = shopState()
    garden.db.exec("CREATE TRIGGER reject_background_redemption BEFORE INSERT ON redemptions BEGIN SELECT RAISE(ABORT, 'forced-background-redemption-failure'); END")
    expect(() => garden.redeem(owner, { studentId, itemId: item.id })).toThrow('forced-background-redemption-failure')
    expect(shopState()).toEqual(before)
  })

  it('退款后续写入失败回滚装备、库存、徽章和兑换状态', async () => {
    const item = backgroundItem()
    await garden.updateItem(owner, item.id, { name: item.name, cost: 1, stock: 2 })
    garden.redeem(owner, { studentId, itemId: item.id })
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    const redemption = lastRedemption(), before = shopState()
    garden.db.exec("CREATE TRIGGER reject_background_refund BEFORE UPDATE OF undone ON redemptions BEGIN SELECT RAISE(ABORT, 'forced-background-refund-failure'); END")
    expect(() => garden.undoRedemption(owner, redemption.id)).toThrow('forced-background-refund-failure')
    expect(shopState()).toEqual(before)
    expect(backgroundStudent()).toMatchObject({ background_id: 'garden', owned_background_ids: ['garden'] })
  })

  it.each([...holidayBackgroundIds, ...versionSevenBackgroundIds])('节日%s兑换→解锁→装扮→退款→重兑，目录分组不写入商品category且下架仍能装扮', backgroundId => {
    const catalog = petBackgroundById(backgroundId)!, item = backgroundItem(backgroundId)
    expect(['chinese', 'global']).toContain(catalog.category)
    expect(item).toMatchObject({ background_id: backgroundId, cost: 1, stock: -1, image: null, category: 'other', name: catalog.name, description: catalog.description })
    expectError(() => garden.setBackground(owner, studentId, { backgroundId }), 'backgroundNotOwned', 409)
    garden.redeem(owner, { studentId, itemId: item.id })
    expect(backgroundStudent()).toMatchObject({ background_id: null, owned_background_ids: [backgroundId], spent_badges: 1 })
    const redemption = lastRedemption()
    expect(redemption).toMatchObject({ background_id: backgroundId, stock_deducted: 0, actor_user_id: owner, actor_name: '商店甲老师' })
    garden.setBackground(owner, studentId, { backgroundId })
    expect(backgroundStudent()).toMatchObject({ background_id: backgroundId, owned_background_ids: [backgroundId] })
    expect(backgroundStudent(secondStudentId).owned_background_ids).toEqual([])
    const before = shopState()
    expectError(() => garden.redeem(owner, { studentId, itemId: item.id }), 'backgroundAlreadyOwned', 409)
    expect(shopState()).toEqual(before)
    garden.undoRedemption(owner, redemption.id)
    expect(backgroundStudent()).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    expect(findItem(item.id).stock).toBe(-1)
    garden.redeem(owner, { studentId, itemId: item.id })
    const repeated = lastRedemption()
    garden.deleteItem(owner, item.id)
    garden.setBackground(owner, studentId, { backgroundId })
    expect(backgroundStudent()).toMatchObject({ background_id: backgroundId, owned_background_ids: [backgroundId], spent_badges: 1 })
    garden.undoRedemption(owner, repeated.id)
    expect(backgroundStudent()).toMatchObject({ background_id: null, owned_background_ids: [], spent_badges: 0 })
    expect(garden.db.prepare('SELECT active, stock FROM items WHERE id = ?').get(item.id)).toEqual({ active: 0, stock: -1 })
  })

  it('装扮的归属、持有校验和保存都处于同一事务，退款后不能用旧所有权重新装备', () => {
    garden.redeem(owner, { studentId, itemId: backgroundItem().id })
    const redemption = lastRedemption(), prepare = garden.db.prepare.bind(garden.db), transactions: boolean[] = []
    vi.spyOn(garden.db, 'prepare').mockImplementation((...args) => {
      transactions.push(garden.db.inTransaction)
      return prepare(...args)
    })
    garden.setBackground(owner, studentId, { backgroundId: 'garden' })
    expect(transactions.length).toBeGreaterThanOrEqual(3)
    expect(transactions.every(Boolean)).toBe(true)
    vi.restoreAllMocks()
    garden.undoRedemption(owner, redemption.id)
    const before = shopState()
    expectError(() => garden.setBackground(owner, studentId, { backgroundId: 'garden' }), 'backgroundNotOwned', 409)
    expect(shopState()).toEqual(before)
  })
})