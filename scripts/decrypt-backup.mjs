import { backupKey, cryptFile } from './lib/encrypted-backup.mjs'
const [source, destination, ...extra] = process.argv.slice(2)
if (!source || !destination || extra.length) throw new Error('Usage: node scripts/decrypt-backup.mjs source.enc destination')
try {
  await cryptFile(source, destination, backupKey(process.env.BACKUP_ENCRYPTION_KEY), true)
  console.log('Backup decrypted. Verify the manifest and restore into a new database only.')
} catch {
  console.error('Decryption failed; verify the key, file and destination. No output was published.')
  process.exitCode = 1
}
