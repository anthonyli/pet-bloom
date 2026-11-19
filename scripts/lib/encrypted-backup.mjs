import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, link, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

const magic = Buffer.from('PBLOOM01')
export function backupKey(value) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hexadecimal characters')
  return Buffer.from(value, 'hex')
}

// Envelope: magic (8), nonce (12), ciphertext, GCM authentication tag (16).
// Publish output only after successful encryption/authentication; never overwrite.
export async function cryptFile(source, destination, key, decrypt = false) {
  const temporary = `${destination}.${randomBytes(8).toString('hex')}.tmp`
  try {
    let cipher, input, prefix
    if (decrypt) {
      const handle = await open(source, 'r')
      try {
        const { size } = await handle.stat()
        if (size < 36) throw new Error('Invalid encrypted backup')
        const header = Buffer.alloc(20), tag = Buffer.alloc(16)
        await handle.read(header, 0, 20, 0)
        await handle.read(tag, 0, 16, size - 16)
        if (!header.subarray(0, 8).equals(magic)) throw new Error('Invalid encrypted backup')
        cipher = createDecipheriv('aes-256-gcm', key, header.subarray(8))
        cipher.setAAD(magic)
        cipher.setAuthTag(tag)
        input = size === 36 ? [] : createReadStream(source, { start: 20, end: size - 17 })
      } finally { await handle.close() }
    } else {
      const nonce = randomBytes(12)
      cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(magic)
      prefix = Buffer.concat([magic, nonce])
      input = createReadStream(source)
    }
    async function* transform() {
      if (prefix) yield prefix
      for await (const chunk of input) yield cipher.update(chunk)
      yield cipher.final()
      if (!decrypt) yield cipher.getAuthTag()
    }
    await pipeline(transform(), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
    await link(temporary, destination)
  } finally { await rm(temporary, { force: true }) }
}
