import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { MAX_ITEM_IMAGE_BYTES, MAX_STORED_IMAGE_BYTES } from '../shop'
import { DomainError } from './errors'

export async function normalizeItemImage(value: string) {
  if (value.length > Math.ceil(MAX_ITEM_IMAGE_BYTES / 3) * 4 + 100) throw new DomainError('imageTooLarge', 413)
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) throw new DomainError('invalidImage')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.toString('base64') !== match[2]) throw new DomainError('invalidImage')
  if (bytes.length > MAX_ITEM_IMAGE_BYTES) throw new DomainError('imageTooLarge', 413)
  let output: Buffer
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning' })
    const metadata = await image.metadata()
    if (metadata.format !== match[1] || (metadata.pages || 1) !== 1) throw new Error('format')
    output = await image.rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  } catch { throw new DomainError('invalidImage') }
  if (output.length > MAX_STORED_IMAGE_BYTES) throw new DomainError('imageTooLarge', 413)
  return { image: `data:image/webp;base64,${output.toString('base64')}`, image_key: createHash('sha256').update(output).digest('hex'), image_bytes: output.length }
}

export async function validateStoredImage(value: string) {
  const match = /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || value.length > Math.ceil(MAX_STORED_IMAGE_BYTES / 3) * 4 + 100) throw new DomainError('invalidImage')
  const bytes = Buffer.from(match[1], 'base64')
  if (!bytes.length || bytes.length > MAX_STORED_IMAGE_BYTES || bytes.toString('base64') !== match[1]) throw new DomainError('invalidImage')
  try {
    const image = sharp(bytes, { limitInputPixels: 512 * 512, failOn: 'warning' })
    const metadata = await image.metadata()
    if (metadata.format !== 'webp' || !metadata.width || !metadata.height || metadata.width > 512 || metadata.height > 512 || (metadata.pages || 1) !== 1 || metadata.exif || metadata.icc || metadata.xmp || metadata.iptc) throw new Error('format')
    await image.raw().toBuffer()
  } catch { throw new DomainError('invalidImage') }
  return { image: value, image_key: createHash('sha256').update(bytes).digest('hex'), image_bytes: bytes.length }
}
