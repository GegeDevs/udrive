import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const buf = await scryptAsync(password, salt, 64);
  return `${salt}:${buf.toString('hex')}`;
}

export async function verifyPassword(password, hash) {
  const [salt, key] = hash.split(':');
  const buf = await scryptAsync(password, salt, 64);
  return timingSafeEqual(Buffer.from(key, 'hex'), buf);
}
