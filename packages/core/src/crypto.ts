import type { ItemRecord, Op } from './model';

/**
 * Client-side encryption for sync, on WebCrypto. The formats are in docs/plans/onetab-parity.md
 * "P4". The server stores what these functions seal and can open none of it.
 */

/** A blob, key, or recovery text that does not open: damaged, made for another user, or wrong. */
export class CryptoError extends Error {
  constructor() {
    super('The key or the data is not valid');
  }
}

type Bytes = Uint8Array<ArrayBuffer>;

const BLOB_VERSION = 1;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

const utf8 = (text: string): Bytes => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** WebCrypto reports a failed check by rejecting. Callers see one error type for all of them. */
async function checked<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch {
    throw new CryptoError();
  }
}

const aesKey = (raw: Uint8Array) =>
  checked(crypto.subtle.importKey('raw', raw as Bytes, 'AES-GCM', false, ['encrypt', 'decrypt']));

/** `0x01 | nonce | ciphertext and tag`, the layout of every blob. */
async function seal(key: CryptoKey, aad: string, plaintext: Uint8Array): Promise<Bytes> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: utf8(aad) }, key, plaintext as Bytes);
  return concat(Uint8Array.of(BLOB_VERSION), nonce, new Uint8Array(sealed));
}

async function open(key: CryptoKey, aad: string, blob: Uint8Array): Promise<Bytes> {
  if (blob[0] !== BLOB_VERSION) throw new CryptoError();
  const nonce = blob.slice(1, 1 + NONCE_BYTES);
  const sealed = blob.slice(1 + NONCE_BYTES);
  return new Uint8Array(await checked(crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: utf8(aad) }, key, sealed)));
}

async function hkdf(secret: Uint8Array, info: Uint8Array, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', secret as Bytes, 'HKDF', false, ['deriveBits']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: info as Bytes };
  return new Uint8Array(await crypto.subtle.deriveBits(params, key, bytes * 8));
}

/** 32 random bytes: a data key or a recovery key. */
export function randomKey(): Bytes {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

// Crockford base32 leaves out I, L, O, and U.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 256 bits in 5-bit characters: 51 full ones and one that carries the last bit. */
const RECOVERY_CHARS = 52;

/** The recovery key as the user writes it down: 13 groups of 4 characters. */
export function encodeRecoveryKey(key: Uint8Array): string {
  let bits = 0n;
  for (const byte of key) bits = (bits << 8n) | BigInt(byte);
  bits <<= BigInt(RECOVERY_CHARS * 5 - KEY_BYTES * 8);
  let text = '';
  for (let i = RECOVERY_CHARS - 1; i >= 0; i--) text += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)];
  return text.match(/.{4}/g)!.join('-');
}

/** Reads a typed recovery key. Case, hyphens, and spaces do not matter, and O, I, and L read as 0, 1, and 1. */
export function decodeRecoveryKey(text: string): Bytes {
  const typed = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (typed.length !== RECOVERY_CHARS) throw new CryptoError();
  let bits = 0n;
  for (const char of typed) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new CryptoError();
    bits = (bits << 5n) | BigInt(value);
  }
  const padding = BigInt(RECOVERY_CHARS * 5 - KEY_BYTES * 8);
  if (bits & ((1n << padding) - 1n)) throw new CryptoError();
  bits >>= padding;
  const key = new Uint8Array(KEY_BYTES);
  for (let i = KEY_BYTES - 1; i >= 0; i--) {
    key[i] = Number(bits & 255n);
    bits >>= 8n;
  }
  return key;
}

const wrappingKey = async (recoveryKey: Uint8Array) => aesKey(await hkdf(recoveryKey, utf8('savetab-wrap-v1'), KEY_BYTES));

/** The data key as the server stores it, readable only with the recovery key. */
export async function wrapDataKey(recoveryKey: Uint8Array, userId: string, dataKey: Uint8Array): Promise<Bytes> {
  return seal(await wrappingKey(recoveryKey), `savetab-wrap-v1|${userId}`, dataKey);
}

export async function unwrapDataKey(recoveryKey: Uint8Array, userId: string, blob: Uint8Array): Promise<Bytes> {
  return open(await wrappingKey(recoveryKey), `savetab-wrap-v1|${userId}`, blob);
}

/** The data key in the form `sealOp` and `openOp` take, imported once per session. */
export function importDataKey(dataKey: Uint8Array): Promise<CryptoKey> {
  return aesKey(dataKey);
}

const opAad = (userId: string, opId: string) => `savetab-op-v1|${userId}|${opId}`;

export function sealOp(key: CryptoKey, userId: string, op: Op): Promise<Bytes> {
  return seal(key, opAad(userId, op.opId), utf8(JSON.stringify(op)));
}

/** Opens a pulled op. `opId` is the id the server lists the blob under, which the blob must have been sealed for. */
export async function openOp(key: CryptoKey, userId: string, opId: string, blob: Uint8Array): Promise<Op> {
  return JSON.parse(new TextDecoder().decode(await open(key, opAad(userId, opId), blob))) as Op;
}

const snapshotAad = (userId: string, seq: number) => `savetab-snapshot-v1|${userId}|${seq}`;

/** Seals every record a device holds as the snapshot of the log up to `seq`. */
export function sealSnapshot(key: CryptoKey, userId: string, seq: number, records: ItemRecord[]): Promise<Bytes> {
  return seal(key, snapshotAad(userId, seq), utf8(JSON.stringify(records)));
}

/** Opens a snapshot. `seq` is the one the server lists the blob under, which the blob must have been sealed for. */
export async function openSnapshot(key: CryptoKey, userId: string, seq: number, blob: Uint8Array): Promise<ItemRecord[]> {
  return JSON.parse(new TextDecoder().decode(await open(key, snapshotAad(userId, seq), blob))) as ItemRecord[];
}

/** One side's key pair for a pairing. `publicKey` is the uncompressed point, 65 bytes. */
export interface PairingKeys {
  privateKey: CryptoKey;
  publicKey: Bytes;
}

export async function makePairingKeys(): Promise<PairingKeys> {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  return { privateKey: pair.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

/** What the new device sends before it sees the other public key, so it cannot pick its key to fit a code. */
export async function pairingCommitment(publicKey: Uint8Array): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', publicKey as Bytes));
}

export async function pairingSecret(privateKey: CryptoKey, otherPublic: Uint8Array): Promise<Bytes> {
  const other = await checked(crypto.subtle.importKey('raw', otherPublic as Bytes, ECDH, false, []));
  return new Uint8Array(await checked(crypto.subtle.deriveBits({ name: 'ECDH', public: other }, privateKey, 256)));
}

/** The 6 digits both users compare. They match only when both devices hold the same secret and saw the same two public keys. */
export async function pairingCode(secret: Uint8Array, oldPublic: Uint8Array, newPublic: Uint8Array): Promise<string> {
  const derived = await hkdf(secret, concat(utf8('savetab-pair-code-v1'), oldPublic, newPublic), 4);
  const number = new DataView(derived.buffer).getUint32(0) % 1_000_000;
  return String(number).padStart(6, '0');
}

const pairedKey = async (secret: Uint8Array) => aesKey(await hkdf(secret, utf8('savetab-pair-key-v1'), KEY_BYTES));

/** The data key as the signed-in device sends it to the new device, after both users confirmed the code. */
export async function sealPairedKey(secret: Uint8Array, userId: string, dataKey: Uint8Array): Promise<Bytes> {
  return seal(await pairedKey(secret), `savetab-pair-key-v1|${userId}`, dataKey);
}

export async function openPairedKey(secret: Uint8Array, userId: string, blob: Uint8Array): Promise<Bytes> {
  return open(await pairedKey(secret), `savetab-pair-key-v1|${userId}`, blob);
}
