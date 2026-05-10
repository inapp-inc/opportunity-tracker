import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64, SCRYPT_OPTS);
  return Buffer.concat([salt, hash]).toString('base64');
}

export function verifyPassword(plain, storedB64) {
  try {
    const buf = Buffer.from(storedB64, 'base64');
    if (buf.length < 17) return false;
    const salt = buf.subarray(0, 16);
    const expected = buf.subarray(16);
    const actual = scryptSync(plain, salt, 64, SCRYPT_OPTS);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
