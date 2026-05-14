let useNodeCrypto = true;

async function getNodeCrypto() {
  try {
    const { scrypt, randomBytes, timingSafeEqual } = await import('node:crypto');
    const { promisify } = await import('node:util');
    return { scrypt: promisify(scrypt), randomBytes, timingSafeEqual };
  } catch {
    useNodeCrypto = false;
    return null;
  }
}

async function hashWithWebCrypto(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    512
  );
  return Buffer.from(bits).toString('hex');
}

async function verifyWithWebCrypto(password, salt, key) {
  const derived = await hashWithWebCrypto(password, salt);
  return derived === key;
}

export async function hashPassword(password) {
  const nodeCrypto = await getNodeCrypto();

  if (nodeCrypto) {
    const salt = nodeCrypto.randomBytes(16).toString('hex');
    const buf = await nodeCrypto.scrypt(password, salt, 64);
    return `${salt}:${buf.toString('hex')}`;
  }

  // Web Crypto fallback
  const saltArray = new Uint8Array(16);
  crypto.getRandomValues(saltArray);
  const salt = Array.from(saltArray).map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await hashWithWebCrypto(password, salt);
  return `${salt}:${hash}:pbkdf2`;
}

export async function verifyPassword(password, stored) {
  const parts = stored.split(':');

  if (parts.length === 3 && parts[2] === 'pbkdf2') {
    // PBKDF2 hash
    const [salt, key] = parts;
    return verifyWithWebCrypto(password, salt, key);
  }

  // scrypt hash
  const [salt, key] = parts;
  const nodeCrypto = await getNodeCrypto();

  if (nodeCrypto) {
    const buf = await nodeCrypto.scrypt(password, salt, 64);
    return nodeCrypto.timingSafeEqual(Buffer.from(key, 'hex'), buf);
  }

  // Can't verify scrypt without node:crypto
  throw new Error('Cannot verify scrypt hash in this environment');
}
