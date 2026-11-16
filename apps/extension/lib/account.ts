import { browser } from 'wxt/browser';
import {
  CryptoError,
  decodeRecoveryKey,
  encodeRecoveryKey,
  makePairingKeys,
  openPairedKey,
  pairingCode,
  pairingCommitment,
  pairingSecret,
  randomKey,
  sealPairedKey,
  unwrapDataKey,
  wrapDataKey,
} from '@savetab/core';
import { joinSync, leaveSync, type SyncAccount } from './db';
import { client, fromBase64, listAll, requestTokens, SyncError, toBase64, type Login } from './sync';

/** How often a pairing side asks the server for the other side's message. */
const PAIRING_POLL_MS = 1000;

export type AccountErrorCode =
  | 'loginFailed'
  | 'wrongRecoveryKey'
  | 'pairingExpired'
  | 'pairingMismatch'
  | 'serverFailed';

/** A failure the account page shows in its own words. */
export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(code);
  }
}

/** The code the page shows for any failure of an account step. */
export function accountErrorCode(err: unknown): AccountErrorCode {
  if (err instanceof AccountError) return err.code;
  if (err instanceof CryptoError) return 'wrongRecoveryKey';
  return 'serverFailed';
}

export interface Device {
  id: string;
  name: string;
  createdAt: number;
  current: boolean;
}

/** A pairing as the server relays it (plan P4, "Pairing relay"). Binary fields are base64. */
export interface Pairing {
  id: string;
  newDeviceName: string;
  commitment: string;
  oldPublic?: string;
  newPublic?: string;
  wrappedKey?: string;
}

/** The `Pairing` and `Device` of `apps/server/api/openapi.yaml`, less the fields no caller reads. */
interface WirePairing {
  id: string;
  new_device_name: string;
  commitment: string;
  old_public?: string;
  new_public?: string;
  wrapped_key?: string;
}
interface WireDevice {
  id: string;
  name: string;
  created_at: string;
  current: boolean;
}

const toPairing = (p: WirePairing): Pairing => ({
  id: p.id,
  newDeviceName: p.new_device_name,
  commitment: p.commitment,
  oldPublic: p.old_public,
  newPublic: p.new_public,
  wrappedKey: p.wrapped_key,
});

const base64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const json = (method: string, value: unknown): RequestInit => ({ method, body: JSON.stringify(value) });

/** The owner's sync server. Every device syncs through it. */
export const SYNC_SERVER = 'https://savetab.lab.hiriri.com';

/** An e2e build syncs through the local test server its fixture stores under this key. */
export const E2E_SERVER_KEY = 'e2eSyncServer';

async function syncServer(): Promise<string> {
  if (import.meta.env.MODE !== 'e2e') return SYNC_SERVER;
  const stored = await browser.storage.local.get(E2E_SERVER_KEY);
  return (stored[E2E_SERVER_KEY] as string | undefined) ?? SYNC_SERVER;
}

/** Open the server's login window and trade the code it ends with for this device's tokens. */
export async function logIn(deviceName: string): Promise<Login> {
  const server = { serverUrl: await syncServer() };
  const verifier = base64Url(randomKey());
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const state = base64Url(randomKey());
  const query = new URLSearchParams({
    redirect_uri: browser.identity.getRedirectURL(),
    code_challenge: base64Url(new Uint8Array(digest)),
    state,
  });
  // It rejects when the user closes the window or the server is not reachable.
  const landed = await browser.identity
    .launchWebAuthFlow({ url: `${server.serverUrl}/v2/authorizations?${query}`, interactive: true })
    .catch(() => undefined);
  const answer = new URL(landed ?? 'about:blank').searchParams;
  const code = answer.get('code');
  if (!code || answer.get('state') !== state) throw new AccountError('loginFailed');
  const grant = { grant_type: 'authorization_code', code, code_verifier: verifier, device_name: deviceName };
  return { ...server, ...(await requestTokens(server, grant)) };
}

/** The account's wrapped data key, or undefined when no device has made one yet. */
async function wrappedKey(login: Login): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    return fromBase64((await client(login)<{ data: string }>('/v2/key')).data);
  } catch (err) {
    if (err instanceof SyncError && err.status === 404) return undefined;
    throw err;
  }
}

export async function accountHasKey(login: Login): Promise<boolean> {
  return (await wrappedKey(login)) !== undefined;
}

/**
 * Set up the account's first device: make the data key, store it on the server wrapped by a new
 * recovery key, and join. Returns the recovery key as the user writes it down. Nothing keeps it.
 */
export async function createAccountKey(login: Login): Promise<string> {
  const dataKey = randomKey();
  const recoveryKey = randomKey();
  const data = toBase64(await wrapDataKey(recoveryKey, login.userId, dataKey));
  await client(login)('/v2/key', json('PUT', { data }));
  await joinSync({ ...login, dataKey });
  return encodeRecoveryKey(recoveryKey);
}

export async function joinByRecoveryKey(login: Login, recoveryKey: string): Promise<void> {
  const blob = await wrappedKey(login);
  if (!blob) throw new AccountError('serverFailed');
  const dataKey = await unwrapDataKey(decodeRecoveryKey(recoveryKey), login.userId, blob);
  await joinSync({ ...login, dataKey });
}

/** Ask for the pairing until `ready` picks a value out of it. The server answers 404 once it expires. */
async function awaitPairing<T>(login: Login, id: string, ready: (p: Pairing) => T | undefined): Promise<T> {
  const call = client(login);
  for (;;) {
    let value: T | undefined;
    try {
      value = ready(toPairing(await call<WirePairing>(`/v2/pairings/${id}`)));
    } catch (err) {
      if (err instanceof SyncError && err.status === 404) throw new AccountError('pairingExpired');
      throw err;
    }
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, PAIRING_POLL_MS));
  }
}

/**
 * The new device's side of a pairing. It resolves once a signed-in device has answered, with the
 * code both users compare. `join` waits for the data key and joins.
 */
export async function requestPairing(login: Login): Promise<{ code: string; join: () => Promise<void> }> {
  const call = client(login);
  const keys = await makePairingKeys();
  const commitment = toBase64(await pairingCommitment(keys.publicKey));
  // The id is the request's idempotency key.
  const id = crypto.randomUUID();
  await call('/v2/pairings', json('POST', { id, commitment }));
  const oldPublic = fromBase64(await awaitPairing(login, id, (p) => p.oldPublic));
  await call(`/v2/pairings/${id}`, json('PUT', { new_public: toBase64(keys.publicKey) }));
  const secret = await pairingSecret(keys.privateKey, oldPublic);
  return {
    code: await pairingCode(secret, oldPublic, keys.publicKey),
    join: async () => {
      const sealed = fromBase64(await awaitPairing(login, id, (p) => p.wrappedKey));
      await joinSync({ ...login, dataKey: await openPairedKey(secret, login.userId, sealed) });
    },
  };
}

/** The devices waiting for a signed-in device to answer their pairing. */
export async function waitingPairings(account: SyncAccount): Promise<Pairing[]> {
  const pairings = await listAll<WirePairing>(client(account), '/v2/pairings', 'pairings');
  return pairings.map(toPairing).filter((p) => p.oldPublic === undefined);
}

/**
 * The signed-in device's side of a pairing. It resolves with the code both users compare.
 * `approve` sends the data key, so the page calls it only after the user says the codes match.
 */
export async function answerPairing(
  account: SyncAccount,
  pairing: Pairing,
): Promise<{ code: string; approve: () => Promise<void> }> {
  const call = client(account);
  const path = `/v2/pairings/${pairing.id}`;
  const keys = await makePairingKeys();
  await call(path, json('PUT', { old_public: toBase64(keys.publicKey) }));
  const newPublic = fromBase64(await awaitPairing(account, pairing.id, (p) => p.newPublic));
  // A key that does not fit the hash sent first was picked after seeing ours, to steer the code.
  if (toBase64(await pairingCommitment(newPublic)) !== pairing.commitment) throw new AccountError('pairingMismatch');
  const secret = await pairingSecret(keys.privateKey, newPublic);
  return {
    code: await pairingCode(secret, keys.publicKey, newPublic),
    approve: async () => {
      const sealed = await sealPairedKey(secret, account.userId, account.dataKey);
      await call(path, json('PUT', { wrapped_key: toBase64(sealed) }));
    },
  };
}

export async function listDevices(account: SyncAccount): Promise<Device[]> {
  const devices = await listAll<WireDevice>(client(account), '/v2/devices', 'devices');
  return devices.map((d) => ({ id: d.id, name: d.name, createdAt: Date.parse(d.created_at), current: d.current }));
}

export async function revokeDevice(account: SyncAccount, id: string): Promise<void> {
  await client(account)(`/v2/devices/${id}`, { method: 'DELETE' });
}

/** Leave the account on this device. The server forgets the device when it is reachable and still knows it. */
export async function signOut(account: SyncAccount): Promise<void> {
  await revokeDevice(account, account.deviceId).catch((err: unknown) => console.warn('sign out', err));
  await leaveSync();
}
