import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  decodeRecoveryKey,
  encodeRecoveryKey,
  importDataKey,
  makePairingKeys,
  openOp,
  openPairedKey,
  pairingCode,
  pairingCommitment,
  pairingSecret,
  randomKey,
  sealOp,
  sealPairedKey,
  unwrapDataKey,
  wrapDataKey,
  type Op,
} from '../src';

// The expected blobs, keys, and code below come from the formats in docs/plans/onetab-parity.md
// "P4", computed with Go's crypto packages and Python's base64, not with this code.

const hex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const seq = (start: number, length: number) => Uint8Array.from({ length }, (_, i) => start + i);

const USER = '0190a000-0000-7000-8000-000000000001';
const OTHER_USER = '0190a000-0000-7000-8000-000000000002';
const DATA_KEY = seq(0x00, 32);
const RECOVERY_KEY = seq(0x40, 32);

const OP: Op = {
  v: 1,
  opId: '0190a000-0000-7000-8000-0000000000aa',
  itemId: '0190a000-0000-7000-8000-0000000000bb',
  kind: 'tab',
  hlc: '1750000000000-0-dev',
  fields: { title: 'Exämple' },
};
// 0x01, the nonce a0..ab, then ciphertext and tag.
const OP_BLOB = hex(
  '01a0a1a2a3a4a5a6a7a8a9aaab9d3a0a0f7ffa2e9d0d15ceb72540e2ee41956971a2877241ac3e16b6529c4531e25b7fcf9f127e0d6fac34f8394ab3c9777a276a4ef2730a2433423a864aa7808585b50e0095d4cdc4d2cf28a2f9fc8afd269394f5f1b44ade450eaa81aa7da4bfe649892f8ce4f2f0bf246aa7fc8c4a067c43c6b256b9060dfee9918465c27df521804fe372ad271a3d9bfd3066b3b0e1bcc10fcdf2c0f7dfb9d481c3a21611e45d67721207307ae728565fd9a5295bd627df1a85c423647bff3daa',
);
const WRAPPED = hex(
  '01b0b1b2b3b4b5b6b7b8b9babb64de17a0bb56ecbc32a9c0fa767ccdaf2c3f72557ef59d9d97a216bb190f21696edff68f591551eb288f615c32e209cd',
);
const RECOVERY_TEXT = '810M-4GT4-8N34-EJ29-995M-RKAE-9X85-2MJK-AHAN-CNTR-B5D5-PQ2X-BSFG';

// P-256 private scalars 01..20 and 21..40.
const OLD_PKCS8 = hex(
  '308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b02010104200102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20a14403420004515c3d6eb9e396b904d3feca7f54fdcd0cc1e997bf375dca515ad0a6c3b4035f4536be3a50f318fbf9a5475902a221502bef0d57e08c53b2cc0a56f17d9f9354',
);
const NEW_PKCS8 = hex(
  '308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b02010104202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40a144034200041f140146bfb1b251f84f4ddbe0d4cdcfd77afd984a9520e35794021f8312bb9eec995a08b1fa7704df3dcc0b50a9665263fb7711f95f9f8a449c5096e47c892b',
);
const OLD_PUBLIC = hex(
  '04515c3d6eb9e396b904d3feca7f54fdcd0cc1e997bf375dca515ad0a6c3b4035f4536be3a50f318fbf9a5475902a221502bef0d57e08c53b2cc0a56f17d9f9354',
);
const NEW_PUBLIC = hex(
  '041f140146bfb1b251f84f4ddbe0d4cdcfd77afd984a9520e35794021f8312bb9eec995a08b1fa7704df3dcc0b50a9665263fb7711f95f9f8a449c5096e47c892b',
);
const COMMITMENT = 'f6140efc538823718229c03b61bdac222543e69b5d0cba12d9dcf917284fa5a6';
const SHARED = '4fe243908f378aa1c2a69538822e6ed908c3225d8692575507c649901245150a';
const PAIRED_KEY = hex(
  '01c0c1c2c3c4c5c6c7c8c9cacb455fa9fc3091fea6a578d10d58574b5e85d3807b799a9506cc009f5a5ef802c674378c1e7b67d29154e9637954a98a2e',
);

const privateKey = (pkcs8: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);

/** Every way a blob can be damaged that the format must catch. */
function damaged(blob: Uint8Array): Record<string, Uint8Array> {
  const flip = (at: number) => blob.map((b, i) => (i === at ? b ^ 1 : b));
  return {
    'another version byte': flip(0),
    'a changed nonce': flip(1),
    'a changed ciphertext': flip(13),
    'a changed tag': flip(blob.length - 1),
    'a cut blob': blob.slice(0, blob.length - 1),
    'no ciphertext': blob.slice(0, 13),
    'nothing': new Uint8Array(),
  };
}

describe('op blob', () => {
  it('opens a blob made by another implementation', async () => {
    const key = await importDataKey(DATA_KEY);
    expect(await openOp(key, USER, OP.opId, OP_BLOB)).toEqual(OP);
  });

  it('seals an op into version, nonce, ciphertext, and tag that open again', async () => {
    const key = await importDataKey(DATA_KEY);
    const blob = await sealOp(key, USER, OP);
    const plaintext = new TextEncoder().encode(JSON.stringify(OP)).length;
    expect(blob[0]).toBe(1);
    expect(blob.length).toBe(1 + 12 + plaintext + 16);
    expect(await openOp(key, USER, OP.opId, blob)).toEqual(OP);
  });

  it('uses a new nonce for every seal', async () => {
    const key = await importDataKey(DATA_KEY);
    const nonces = new Set<string>();
    for (let i = 0; i < 20; i++) nonces.add(toHex((await sealOp(key, USER, OP)).slice(1, 13)));
    expect(nonces.size).toBe(20);
  });

  it('rejects a damaged blob', async () => {
    const key = await importDataKey(DATA_KEY);
    for (const blob of Object.values(damaged(OP_BLOB))) {
      await expect(openOp(key, USER, OP.opId, blob)).rejects.toThrow(CryptoError);
    }
  });

  it('rejects a blob moved to another user, another op id, or another key', async () => {
    const key = await importDataKey(DATA_KEY);
    await expect(openOp(key, OTHER_USER, OP.opId, OP_BLOB)).rejects.toThrow(CryptoError);
    await expect(openOp(key, USER, OP.itemId, OP_BLOB)).rejects.toThrow(CryptoError);
    await expect(openOp(await importDataKey(seq(0x01, 32)), USER, OP.opId, OP_BLOB)).rejects.toThrow(CryptoError);
  });
});

describe('recovery key', () => {
  it('shows 32 bytes as Crockford base32 in groups of 4', () => {
    expect(encodeRecoveryKey(RECOVERY_KEY)).toBe(RECOVERY_TEXT);
    expect(encodeRecoveryKey(new Uint8Array(32))).toBe(Array(13).fill('0000').join('-'));
    expect(encodeRecoveryKey(new Uint8Array(32).fill(0xff))).toBe(`${Array(12).fill('ZZZZ').join('-')}-ZZZG`);
  });

  it('reads back what it shows', () => {
    expect(decodeRecoveryKey(RECOVERY_TEXT)).toEqual(RECOVERY_KEY);
    expect(decodeRecoveryKey(`${Array(12).fill('ZZZZ').join('-')}-ZZZG`)).toEqual(new Uint8Array(32).fill(0xff));
  });

  it('reads a key typed in lower case, without hyphens, with spaces, or with look-alike letters', () => {
    expect(decodeRecoveryKey(RECOVERY_TEXT.toLowerCase())).toEqual(RECOVERY_KEY);
    expect(decodeRecoveryKey(RECOVERY_TEXT.replaceAll('-', ''))).toEqual(RECOVERY_KEY);
    expect(decodeRecoveryKey(`  ${RECOVERY_TEXT.replaceAll('-', ' ')}\n`)).toEqual(RECOVERY_KEY);
    // Crockford reads O as 0 and I or L as 1.
    expect(decodeRecoveryKey(RECOVERY_TEXT.replace('810M', '8IOM'))).toEqual(RECOVERY_KEY);
    expect(decodeRecoveryKey(RECOVERY_TEXT.replace('810M', '8lom'))).toEqual(RECOVERY_KEY);
  });

  it('rejects text that is not a recovery key', () => {
    const bad = {
      'one character short': RECOVERY_TEXT.slice(0, -1),
      'one character long': `${RECOVERY_TEXT}0`,
      'a letter outside the alphabet': RECOVERY_TEXT.replace('810M', '81UM'),
      // The last character carries one bit of the key, so only 0 and G can end one.
      'bits past the 256th': RECOVERY_TEXT.replace(/G$/, 'Z'),
      'empty text': '',
    };
    for (const text of Object.values(bad)) expect(() => decodeRecoveryKey(text)).toThrow(CryptoError);
  });
});

describe('wrapped data key', () => {
  it('unwraps a blob made by another implementation', async () => {
    expect(await unwrapDataKey(RECOVERY_KEY, USER, WRAPPED)).toEqual(DATA_KEY);
  });

  it('wraps into version, nonce, ciphertext, and tag that unwrap again', async () => {
    const blob = await wrapDataKey(RECOVERY_KEY, USER, DATA_KEY);
    expect(blob[0]).toBe(1);
    expect(blob.length).toBe(1 + 12 + 32 + 16);
    expect(toHex(blob.slice(1, 13))).not.toBe(toHex(WRAPPED.slice(1, 13)));
    expect(await unwrapDataKey(RECOVERY_KEY, USER, blob)).toEqual(DATA_KEY);
  });

  it('rejects a damaged blob, another recovery key, and another user', async () => {
    for (const blob of Object.values(damaged(WRAPPED))) {
      await expect(unwrapDataKey(RECOVERY_KEY, USER, blob)).rejects.toThrow(CryptoError);
    }
    await expect(unwrapDataKey(seq(0x41, 32), USER, WRAPPED)).rejects.toThrow(CryptoError);
    await expect(unwrapDataKey(RECOVERY_KEY, OTHER_USER, WRAPPED)).rejects.toThrow(CryptoError);
  });
});

describe('pairing', () => {
  it('derives the shared secret, commitment, and code another implementation derives', async () => {
    const fromOld = await pairingSecret(await privateKey(OLD_PKCS8), NEW_PUBLIC);
    const fromNew = await pairingSecret(await privateKey(NEW_PKCS8), OLD_PUBLIC);
    expect(toHex(fromOld)).toBe(SHARED);
    expect(toHex(fromNew)).toBe(SHARED);
    expect(toHex(await pairingCommitment(NEW_PUBLIC))).toBe(COMMITMENT);
    expect(await pairingCode(fromOld, OLD_PUBLIC, NEW_PUBLIC)).toBe('943385');
  });

  it('gives two devices with fresh keys the same code and a key only they can open', async () => {
    const [oldSide, newSide] = [await makePairingKeys(), await makePairingKeys()];
    expect(oldSide.publicKey.length).toBe(65);
    expect(oldSide.publicKey[0]).toBe(4);
    expect(toHex(oldSide.publicKey)).not.toBe(toHex(newSide.publicKey));

    const oldSecret = await pairingSecret(oldSide.privateKey, newSide.publicKey);
    const newSecret = await pairingSecret(newSide.privateKey, oldSide.publicKey);
    const code = await pairingCode(oldSecret, oldSide.publicKey, newSide.publicKey);
    expect(code).toMatch(/^\d{6}$/);
    expect(await pairingCode(newSecret, oldSide.publicKey, newSide.publicKey)).toBe(code);

    const blob = await sealPairedKey(oldSecret, USER, DATA_KEY);
    expect(await openPairedKey(newSecret, USER, blob)).toEqual(DATA_KEY);
  });

  it('gives a server in the middle a code that differs from the new device', async () => {
    // The server swaps in its own key toward each side, so each side holds another secret.
    const [oldSide, newSide, server] = [await makePairingKeys(), await makePairingKeys(), await makePairingKeys()];
    const oldSecret = await pairingSecret(oldSide.privateKey, server.publicKey);
    const newSecret = await pairingSecret(newSide.privateKey, server.publicKey);
    expect(toHex(oldSecret)).not.toBe(toHex(newSecret));
    await expect(openPairedKey(newSecret, USER, await sealPairedKey(oldSecret, USER, DATA_KEY))).rejects.toThrow(CryptoError);
  });

  it('opens a paired key made by another implementation and rejects a damaged one', async () => {
    const secret = hex(SHARED);
    expect(await openPairedKey(secret, USER, PAIRED_KEY)).toEqual(DATA_KEY);
    for (const blob of Object.values(damaged(PAIRED_KEY))) {
      await expect(openPairedKey(secret, USER, blob)).rejects.toThrow(CryptoError);
    }
    await expect(openPairedKey(secret, OTHER_USER, PAIRED_KEY)).rejects.toThrow(CryptoError);
  });

  it('rejects a public key that is not a P-256 point', async () => {
    const key = await privateKey(OLD_PKCS8);
    await expect(pairingSecret(key, NEW_PUBLIC.map((b, i) => (i === 64 ? b ^ 1 : b)))).rejects.toThrow(CryptoError);
    await expect(pairingSecret(key, NEW_PUBLIC.slice(0, 33))).rejects.toThrow(CryptoError);
  });
});

describe('randomKey', () => {
  it('makes 32 bytes that differ each time', () => {
    const [a, b] = [randomKey(), randomKey()];
    expect(a.length).toBe(32);
    expect(toHex(a)).not.toBe(toHex(b));
  });
});
