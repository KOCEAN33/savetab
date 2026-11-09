<script lang="ts">
  import { t } from '@/lib/i18n';

  const url = new URLSearchParams(location.search).get('url') ?? '';
  let copied = $state(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    copied = true;
  }
</script>

<main>
  <p>{t('placeholderMessage')}</p>
  <p class="row">
    <input class="placeholder-url" type="text" readonly aria-label={t('placeholderAddress')} value={url} />
    <button class="button button-primary" onclick={copy}>{copied ? t('copied') : t('copy')}</button>
  </p>
</main>
