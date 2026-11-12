<script lang="ts">
  import { liveQuery } from 'dexie';
  import { browser } from 'wxt/browser';
  import {
    accountErrorCode,
    accountHasKey,
    answerPairing,
    createAccountKey,
    joinByRecoveryKey,
    listDevices,
    logIn,
    requestPairing,
    revokeDevice,
    signOut,
    waitingPairings,
    type AccountErrorCode,
    type Device,
    type Pairing,
  } from '@/lib/account';
  import { syncAccount, syncStatus, type SyncAccount } from '@/lib/db';
  import { shortDate, t } from '@/lib/i18n';
  import type { Login } from '@/lib/sync';

  /** How often the page asks the server for the device list and for devices waiting to pair. */
  const REFRESH_MS = 3000;
  const OS_NAMES: Record<string, string> = { mac: 'macOS', win: 'Windows', linux: 'Linux', cros: 'ChromeOS', android: 'Android' };
  const ERROR_TEXT = {
    badServerUrl: 'syncErrBadServerUrl',
    loginFailed: 'syncErrLoginFailed',
    wrongRecoveryKey: 'syncErrWrongRecoveryKey',
    pairingExpired: 'syncErrPairingExpired',
    pairingMismatch: 'syncErrPairingMismatch',
    serverFailed: 'syncErrServerFailed',
  } as const;

  // null once the database has answered that the device has no account.
  const account = liveQuery(async () => (await syncAccount()) ?? null);
  const status = liveQuery(syncStatus);

  let serverUrl = $state('');
  let deviceName = $state('');
  void browser.runtime.getPlatformInfo().then(({ os }) => {
    deviceName = `${import.meta.env.FIREFOX ? 'Firefox' : 'Chrome'}, ${OS_NAMES[os] ?? os}`;
  });

  /** Logged in to an account that has a key, which this device does not hold yet. */
  let login = $state<Login>();
  let typedKey = $state('');
  /** The recovery key made on this device. It lives only in this page, so it shows once. */
  let madeKey = $state<string>();
  let copied = $state(false);
  let awaitingDevice = $state(false);
  let pairing = $state<{ code: string; confirm: () => Promise<void> }>();
  let devices = $state<Device[]>([]);
  let waiting = $state<Pairing[]>([]);
  let busy = $state(false);
  let error = $state<AccountErrorCode>();

  async function run(step: () => Promise<void>) {
    error = undefined;
    busy = true;
    try {
      await step();
    } catch (err) {
      console.warn(err);
      error = accountErrorCode(err);
    } finally {
      busy = false;
    }
  }

  const signIn = () =>
    run(async () => {
      const made = await logIn(serverUrl, deviceName);
      if (await accountHasKey(made)) login = made;
      else madeKey = await createAccountKey(made);
    });

  const join = () =>
    run(async () => {
      await joinByRecoveryKey(login!, typedKey);
      login = undefined;
      typedKey = '';
    });

  const startPairing = () =>
    run(async () => {
      awaitingDevice = true;
      try {
        const { code, join } = await requestPairing(login!);
        pairing = {
          code,
          confirm: async () => {
            await join();
            login = undefined;
          },
        };
      } finally {
        awaitingDevice = false;
      }
    });

  const answer = (current: SyncAccount, request: Pairing) =>
    run(async () => {
      const { code, approve } = await answerPairing(current, request);
      waiting = waiting.filter((w) => w.id !== request.id);
      pairing = { code, confirm: approve };
    });

  const confirmPairing = () =>
    run(async () => {
      await pairing!.confirm();
      pairing = undefined;
    });

  async function copyKey() {
    await navigator.clipboard.writeText(madeKey!);
    copied = true;
  }

  // One account per page load: tokens change under it, and `client` reads the stored ones itself.
  const joined = $derived($account?.deviceId);
  $effect(() => {
    if (!joined) return;
    const current = $state.snapshot($account) as SyncAccount;
    const load = () => {
      // A failure here shows as the sync status once the next cycle fails the same way.
      void listDevices(current).then((d) => (devices = d), console.warn);
      void waitingPairings(current).then((w) => (waiting = w), console.warn);
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  });

  const time = (ms: number) => new Date(ms).toLocaleString(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<main>
  <header class="page-header">
    <h1 class="page-total">{t('syncTitle')}</h1>
    <nav class="page-nav"><a class="link-button" href={browser.runtime.getURL('/onetab.html')}>{t('backToSavetab')}</a></nav>
  </header>

  {#if error}<p class="notice" role="alert">{t(ERROR_TEXT[error])}</p>{/if}

  {#if $account}
    {#if madeKey}
      <section class="notice" aria-label={t('syncRecoveryKey')}>
        <p>{t('syncRecoveryShown')}</p>
        <code class="recovery-key shown-key"
          >{#each madeKey.split('-') as group, i (i)}<span>{group}{i < 12 ? '-' : ''}</span>{/each}</code
        >
        <p class="actions">
          <button class="button button-primary" onclick={() => (madeKey = undefined)}>{t('syncRecoverySaved')}</button>
          <button class="button" onclick={copyKey}>{copied ? t('copied') : t('copy')}</button>
        </p>
      </section>
    {/if}

    <p role="status">
      {#if !$status}
        {t('syncStatusNever')}
      {:else if $status.error === 'signedOut'}
        {t('syncStatusSignedOut')}
      {:else if $status.error}
        {t('syncStatusFailed', { date: time($status.at) })}
      {:else}
        {t('syncStatusOk', { date: time($status.at) })}
      {/if}
    </p>
    <p class="meta">{$account.serverUrl}</p>

    {#if pairing}
      <section class="notice" aria-label={t('syncPair')}>
        <p>{t('syncPairCompare')}</p>
        <p class="pair-code">{pairing.code}</p>
        <button class="button button-primary" disabled={busy} onclick={confirmPairing}>{t('syncPairMatch')}</button>
      </section>
    {:else if waiting.length > 0}
      <h2 class="section-title">{t('syncWaiting')}</h2>
      {#each waiting as request (request.id)}
        <div class="row device">
          <span>{request.newDeviceName}</span>
          <button class="button" disabled={busy} onclick={() => answer($account, request)}>{t('syncPair')}</button>
        </div>
      {/each}
    {/if}

    <h2 class="section-title">{t('syncDevices')}</h2>
    {#each devices as device (device.id)}
      <div class="row device">
        <span>{device.name}</span>
        <span class="meta">{t('syncDeviceAdded', { date: shortDate(device.createdAt) })}</span>
        {#if device.current}
          <span class="meta">{t('syncThisDevice')}</span>
        {:else}
          <button
            class="link-button"
            disabled={busy}
            onclick={() =>
              run(async () => {
                await revokeDevice($account, device.id);
                devices = devices.filter((d) => d.id !== device.id);
              })}>{t('remove')}</button
          >
        {/if}
      </div>
    {/each}

    <p class="actions">
      <button class="button" disabled={busy} onclick={() => run(() => signOut($account))}>{t('syncSignOut')}</button>
    </p>
  {:else if login}
    {#if pairing}
      <p>{t('syncPairCompare')}</p>
      <p class="pair-code">{pairing.code}</p>
      <p class="actions">
        <button class="button button-primary" disabled={busy} onclick={confirmPairing}>{t('syncPairMatch')}</button>
        <button class="button" onclick={() => location.reload()}>{t('cancel')}</button>
      </p>
    {:else if awaitingDevice}
      <p role="status">{t('syncPairWaiting')}</p>
      <p class="actions"><button class="button" onclick={() => location.reload()}>{t('cancel')}</button></p>
    {:else}
      <p>{t('syncJoinIntro')}</p>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void join();
        }}
      >
        <label class="field">
          {t('syncRecoveryKey')}
          <input type="text" class="recovery-key" autocomplete="off" spellcheck="false" bind:value={typedKey} />
        </label>
        <p class="actions">
          <button class="button button-primary" type="submit" disabled={busy || !typedKey.trim()}>{t('syncJoin')}</button>
          <button class="button" type="button" disabled={busy} onclick={startPairing}>{t('syncPairStart')}</button>
          <button class="button" type="button" onclick={() => location.reload()}>{t('cancel')}</button>
        </p>
      </form>
    {/if}
  {:else if $account === null}
    <p>{t('syncIntro')}</p>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void signIn();
      }}
    >
      <label class="field">
        {t('syncServer')}
        <input type="text" inputmode="url" placeholder="https://sync.example.com" bind:value={serverUrl} />
      </label>
      <label class="field">
        {t('syncDeviceName')}
        <input type="text" bind:value={deviceName} />
      </label>
      <p class="actions">
        <button class="button button-primary" type="submit" disabled={busy || !serverUrl.trim() || !deviceName.trim()}
          >{t('syncSignIn')}</button
        >
      </p>
    </form>
  {/if}
</main>
