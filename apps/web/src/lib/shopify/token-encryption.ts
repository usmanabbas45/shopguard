/**
 * Shopify access token encryption/decryption.
 *
 * Uses AES-256-GCM (authenticated encryption) with a random 12-byte IV.
 * The stored format is: base64(iv):base64(ciphertext):base64(authTag)
 *
 * Required env var: SHOPIFY_TOKEN_ENCRYPTION_KEY
 *   - Must be exactly 64 hex chars (= 32 bytes = 256 bits)
 *   - Generate: openssl rand -hex 32
 *
 * Tokens are NEVER:
 *   - logged
 *   - returned in API responses
 *   - stored plaintext
 *   - exposed in error messages
 */
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12     // GCM standard
const TAG_LENGTH = 16    // GCM auth tag

function getKey(): Buffer {
  const hex = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY
  if (!hex) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY is not set')
  if (hex.length !== 64) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  return Buffer.from(hex, 'hex')
}

export function encryptToken(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`
}

export function decryptToken(stored: string): string {
  const key = getKey()
  const parts = stored.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted token format')
  const [ivB64, encB64, tagB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const encrypted = Buffer.from(encB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final('utf8')
}

/** Validate encryption key is configured and has correct entropy */
export function validateEncryptionKey(): void {
  const hex = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY
  if (!hex) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY must be set (generate with: openssl rand -hex 32)')
  if (hex.length !== 64) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes / 256 bits)')
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error('SHOPIFY_TOKEN_ENCRYPTION_KEY must be hex-encoded')
}
