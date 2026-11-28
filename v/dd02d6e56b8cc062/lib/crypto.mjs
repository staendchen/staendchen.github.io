const subtle = globalThis.crypto.subtle;
const utf8 = new TextEncoder();

export const ROUNDS = 600000;
export const APP_URL = 'https://staendchen.github.io/';
export const SCOPE_KINDS = { binder: ['binder'], piece: ['piece', 'musicxml', 'timing', 'audio'], editor: ['library', 'mscz'] };
const ID = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const HASH = /^[0-9a-f]{64}$/;
const PART = /^[A-Za-z0-9_.-]{1,200}$/;
const BINDER_SALT = utf8.encode('staendchen|binder-salt|v1');
const CONSONANTS = 'bcdfghjkmnpqrstvwxz';
const VOWELS = 'aeiouy';
const DIGITS = '23456789';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VAULT_KEYS = ['format', 'version', 'rounds', 'salt', 'iv', 'data', 'check'];

export function toBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

export function fromBase64Url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error('invalid base64url');
  const bytes = new Uint8Array(Math.floor(text.length * 3 / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const c of text) {
    value = ((value << 6) | B64.indexOf(c)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (value >> bits) & 255;
    }
  }
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) throw new Error('invalid base64url');
  return bytes;
}

function checkKey(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new Error('key must be 32 bytes');
  return bytes;
}

function checkId(id) {
  if (typeof id !== 'string' || id.length > 80 || !ID.test(id)) throw new Error('invalid id');
  return id;
}

function checkShareVersion(version) {
  if (!Number.isSafeInteger(version) || version < 0 || version > 1000000) throw new Error('invalid share version');
  return version;
}

function checkVersion(version) {
  if (!Number.isSafeInteger(version) || version < 1 || version > 1000000) throw new Error('invalid key version');
  return version;
}

export function randomKey() {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export function decodeKey(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(text)) throw new Error('invalid key');
  return checkKey(fromBase64Url(text));
}

async function hkdf(key, info, length = 32) {
  const base = await subtle.importKey('raw', checkKey(key), 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(info) }, base, length * 8);
  return new Uint8Array(bits);
}

function sampler(bytes) {
  let index = 0;
  return n => {
    const limit = 256 - (256 % n);
    while (index < bytes.length) {
      const b = bytes[index++];
      if (b < limit) return b % n;
    }
    throw new Error('password stream exhausted');
  };
}

function passwordFrom(bytes, blocks) {
  const pick = sampler(bytes);
  const chars = [];
  for (let block = 0; block < blocks; block++) {
    for (let i = 0; i < 6; i++) chars.push(i % 2 ? VOWELS[pick(VOWELS.length)] : CONSONANTS[pick(CONSONANTS.length)]);
  }
  chars[pick(chars.length)] = DIGITS[pick(DIGITS.length)];
  return Array.from({ length: blocks }, (_, block) => chars.slice(block * 6, block * 6 + 6).join('')).join('-');
}

export async function binderPassword(master, binderId, keyVersion) {
  return passwordFrom(await hkdf(master, `staendchen|password|v1|${checkId(binderId)}|${checkVersion(keyVersion)}`, 256), 3);
}

export function randomPassword(blocks = 4) {
  return passwordFrom(globalThis.crypto.getRandomValues(new Uint8Array(256)), blocks);
}

export function normalizePassword(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKC').toLowerCase().normalize('NFKD').replace(/[l1]/g, 'i').replace(/0/g, 'o').replace(/[^a-z0-9]/g, '');
}

export async function passwordKey(password, salt, rounds = ROUNDS) {
  const normal = normalizePassword(password);
  if (!normal) throw new Error('empty password');
  const base = await subtle.importKey('raw', utf8.encode(normal), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, base, 256));
}

export async function binderKey(password, rounds = ROUNDS) {
  return passwordKey(password, BINDER_SALT, rounds);
}

export function binderLink(key) {
  return `${APP_URL}#${toBase64Url(checkKey(key))}`;
}

export function keyFromLink(link) {
  if (typeof link !== 'string') return null;
  const text = link.trim();
  const fragment = text.startsWith('#') ? text.slice(1) : text.startsWith(`${APP_URL}#`) ? text.slice(APP_URL.length + 1) : null;
  if (fragment === null || !/^[A-Za-z0-9_-]{43}$/.test(fragment)) return null;
  try {
    return decodeKey(fragment);
  } catch {
    return null;
  }
}

export async function pieceKey(master, pieceId, inputHash) {
  if (typeof inputHash !== 'string' || !HASH.test(inputHash)) throw new Error('invalid input hash');
  return hkdf(master, `staendchen|piece|v1|${checkId(pieceId)}|${inputHash}`);
}

export async function songKey(master, pieceId, shareVersion = 0) {
  return hkdf(master, `staendchen|song|v1|${checkId(pieceId)}|${checkShareVersion(shareVersion)}`);
}

export async function editorKey(master) {
  return hkdf(master, 'staendchen|editor|v1');
}

export async function masterCheck(master) {
  return toBase64Url(await hkdf(master, 'staendchen|check|v1', 16));
}

export async function fileKeys(key, scope) {
  if (!Object.prototype.hasOwnProperty.call(SCOPE_KINDS, scope)) throw new Error('invalid scope');
  const aes = await hkdf(key, `staendchen|${scope}|aes|v1`);
  const names = await hkdf(key, `staendchen|${scope}|names|v1`);
  return {
    scope,
    aes: await subtle.importKey('raw', aes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    names: await subtle.importKey('raw', names, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
  };
}

function checkKind(keys, kind) {
  if (!SCOPE_KINDS[keys?.scope]?.includes(kind)) throw new Error('invalid kind for this key');
}

export async function fileName(keys, kind, ...parts) {
  checkKind(keys, kind);
  if (parts.some(part => typeof part !== 'string' || !PART.test(part))) throw new Error('invalid name part');
  const label = ['staendchen', 'name', 'v1', keys.scope, kind, ...parts].join('|');
  const mac = new Uint8Array(await subtle.sign('HMAC', keys.names, utf8.encode(label)));
  return `x/${toBase64Url(mac).slice(0, 22)}.bin`;
}

function aad(kind, name) {
  if (typeof name !== 'string' || !/^x\/[A-Za-z0-9_-]{22}\.bin$/.test(name)) throw new Error('invalid file name');
  return utf8.encode(`staendchen|v1|${kind}|${name}`);
}

export async function encryptFile(keys, kind, name, content) {
  checkKind(keys, kind);
  const additionalData = aad(kind, name);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, keys.aes, content));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv);
  out.set(sealed, 12);
  return out;
}

export async function decryptFile(keys, kind, name, data) {
  checkKind(keys, kind);
  const additionalData = aad(kind, name);
  if (!(data instanceof Uint8Array) || data.length < 28) throw new Error('invalid ciphertext');
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12), additionalData }, keys.aes, data.slice(12)));
}

function vaultAad(rounds, salt, check) {
  return utf8.encode(`staendchen|vault|v1|${rounds}|${salt}|${check ?? ''}`);
}

function checkRounds(rounds, minRounds) {
  if (!Number.isSafeInteger(rounds) || rounds < minRounds || rounds > 10000000) throw new Error('invalid vault');
}

export async function sealVault(password, content, { rounds = ROUNDS, minRounds = ROUNDS, salt = globalThis.crypto.getRandomValues(new Uint8Array(16)), check } = {}) {
  checkRounds(rounds, minRounds);
  if (!(salt instanceof Uint8Array) || salt.length !== 16) throw new Error('invalid vault');
  if (check !== undefined && (typeof check !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(check))) throw new Error('invalid vault');
  const saltText = toBase64Url(salt);
  const key = await subtle.importKey('raw', await passwordKey(password, salt, rounds), 'AES-GCM', false, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = utf8.encode(JSON.stringify(content));
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: vaultAad(rounds, saltText, check) }, key, plain));
  const vault = { format: 'staendchen-vault', version: 1, rounds, salt: saltText, iv: toBase64Url(iv), data: toBase64Url(sealed) };
  if (check !== undefined) vault.check = check;
  return vault;
}

function readVault(vault, minRounds) {
  if (vault === null || typeof vault !== 'object' || Array.isArray(vault)) throw new Error('invalid vault');
  if (Object.keys(vault).some(key => !VAULT_KEYS.includes(key)) || vault.format !== 'staendchen-vault' || vault.version !== 1) throw new Error('invalid vault');
  const { rounds, salt, iv, data, check } = vault;
  checkRounds(rounds, minRounds);
  if (check !== undefined && (typeof check !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(check))) throw new Error('invalid vault');
  let saltBytes;
  let ivBytes;
  let sealed;
  try {
    saltBytes = fromBase64Url(salt);
    ivBytes = fromBase64Url(iv);
    sealed = fromBase64Url(data);
  } catch {
    throw new Error('invalid vault');
  }
  if (saltBytes.length !== 16 || ivBytes.length !== 12 || sealed.length < 17) throw new Error('invalid vault');
  return { rounds, salt, saltBytes, ivBytes, sealed, check };
}

export async function vaultKey(vault, password, { minRounds = ROUNDS } = {}) {
  const { rounds, saltBytes } = readVault(vault, minRounds);
  return subtle.importKey('raw', await passwordKey(password, saltBytes, rounds), 'AES-GCM', false, ['decrypt']);
}

export async function openVaultWithKey(vault, key, { minRounds = ROUNDS } = {}) {
  const { rounds, salt, ivBytes, sealed, check } = readVault(vault, minRounds);
  let plain;
  try {
    plain = await subtle.decrypt({ name: 'AES-GCM', iv: ivBytes, additionalData: vaultAad(rounds, salt, check) }, key, sealed);
  } catch {
    throw new Error('wrong password');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    throw new Error('invalid vault content');
  }
}

export async function openVault(vault, password, { minRounds = ROUNDS } = {}) {
  return openVaultWithKey(vault, await vaultKey(vault, password, { minRounds }), { minRounds });
}
