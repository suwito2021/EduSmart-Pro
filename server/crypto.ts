import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const KEY_FILE = path.join(DATA_DIR, '.master.key');

function getMasterKey(): Buffer {
  if (process.env.KEY_ENCRYPTION_SECRET && process.env.KEY_ENCRYPTION_SECRET.length >= 32) {
    return crypto.createHash('sha256').update(process.env.KEY_ENCRYPTION_SECRET).digest();
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(KEY_FILE)) {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (hex.length === 64) {
      return Buffer.from(hex, 'hex');
    }
  }
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

const MASTER_KEY = getMasterKey();

export function encryptSecret(plainText: string): {
  encryptedKey: string;
  iv: string;
  authTag: string;
} {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');
  return {
    encryptedKey: encrypted,
    iv: iv.toString('base64'),
    authTag,
  };
}

export function decryptSecret(encryptedKey: string, ivBase64: string, authTagBase64: string): string {
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedKey, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function maskSecret(plainText: string): string {
  const trimmed = plainText.trim();
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 6)}••••••${trimmed.slice(-4)}`;
}

export interface AuthTokenPayload {
  userId: string;
  username: string;
  role: string;
  className: string;
  sessionVersion: number;
  exp: number;
}

export function signToken(payload: Omit<AuthTokenPayload, 'exp'>, ttlHours = 24): string {
  const full: AuthTokenPayload = {
    ...payload,
    exp: Date.now() + ttlHours * 3600 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', MASTER_KEY).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', MASTER_KEY).update(encoded).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AuthTokenPayload;
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
