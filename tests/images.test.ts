import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { normalizeItemImage, validateStoredImage } from '../lib/server/item-images'
import { MAX_ITEM_IMAGE_BYTES, MAX_STORED_IMAGE_BYTES } from '../lib/shop'

const dataUrl = (format: string, bytes: Buffer) => `data:image/${format};base64,${bytes.toString('base64')}`

describe('商品图片解码与安全持久化', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('接受真实 %s 并缩小为最多512像素的WebP', async format => {
    const original = await sharp({ create: { width: 900, height: 600, channels: 4, background: '#6d4aff' } }).toFormat(format).toBuffer()
    const result = await normalizeItemImage(dataUrl(format, original))
    const bytes = Buffer.from(result.image.split(',')[1], 'base64')
    const metadata = await sharp(bytes).metadata()
    expect(result.image).toMatch(/^data:image\/webp;base64,/)
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(512)
    expect(metadata.height).toBeLessThanOrEqual(512)
    expect(result.image_bytes).toBe(bytes.length)
    expect(result.image_bytes).toBeLessThanOrEqual(MAX_STORED_IMAGE_BYTES)
    expect(result.image_key).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('应用方向后剥离EXIF与ICC元数据，不放大小图', async () => {
    const original = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#ffa321' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const result = await normalizeItemImage(dataUrl('jpeg', original))
    const metadata = await sharp(Buffer.from(result.image.split(',')[1], 'base64')).metadata()
    expect(metadata.width).toBe(40)
    expect(metadata.height).toBe(80)
    expect(metadata.orientation).toBeUndefined()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
  })

  it('校验已存图片时保留原始字节及内容哈希', async () => {
    const original = await sharp({ create: { width: 150, height: 100, channels: 4, background: '#6d4aff' } }).png().toBuffer()
    const normalized = await normalizeItemImage(dataUrl('png', original))
    expect(await validateStoredImage(normalized.image)).toEqual(normalized)
  })

  it('拒绝SVG、外链、伪造MIME、损坏图片和非规范base64', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'white' } }).png().toBuffer()
    for (const value of [
      dataUrl('svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
      dataUrl('png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
      'https://foreign.example/image.png',
      dataUrl('jpeg', png),
      dataUrl('webp', Buffer.from('not-a-webp')),
      'data:image/png;base64,YQ',
      'data:image/png;base64,@@@',
      'data:image/png;base64,'
    ]) await expect(normalizeItemImage(value)).rejects.toThrow('invalidImage')
  })

  it('拒绝超过2MB原图及超过2000万像素的压缩图', async () => {
    await expect(normalizeItemImage(dataUrl('png', Buffer.alloc(MAX_ITEM_IMAGE_BYTES + 1)))).rejects.toThrow('imageTooLarge')
    const oversized = await sharp({ create: { width: 5001, height: 4000, channels: 3, background: 'white' } }).png().toBuffer()
    expect(oversized.length).toBeLessThan(MAX_ITEM_IMAGE_BYTES)
    await expect(normalizeItemImage(dataUrl('png', oversized))).rejects.toThrow('invalidImage')
  })

  it('拒绝真实多帧WebP而非只取第一帧', async () => {
    const pixels = Buffer.concat([
      Buffer.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]),
      Buffer.from([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255])
    ])
    const animation = await sharp(pixels, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer()
    expect((await sharp(animation).metadata()).pages).toBe(2)
    await expect(normalizeItemImage(dataUrl('webp', animation))).rejects.toThrow('invalidImage')
    await expect(validateStoredImage(dataUrl('webp', animation))).rejects.toThrow('invalidImage')
  })

  it('恢复图片拒绝超256KB、超512像素、元数据或非WebP内容', async () => {
    await expect(validateStoredImage(dataUrl('webp', Buffer.alloc(MAX_STORED_IMAGE_BYTES + 1)))).rejects.toThrow('invalidImage')
    const wide = await sharp({ create: { width: 513, height: 1, channels: 3, background: 'white' } }).webp().toBuffer()
    await expect(validateStoredImage(dataUrl('webp', wide))).rejects.toThrow('invalidImage')
    const tagged = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'white' } }).withMetadata().webp().toBuffer()
    expect((await sharp(tagged).metadata()).icc).toBeDefined()
    await expect(validateStoredImage(dataUrl('webp', tagged))).rejects.toThrow('invalidImage')
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'white' } }).png().toBuffer()
    await expect(validateStoredImage(dataUrl('webp', png))).rejects.toThrow('invalidImage')
  })
})
