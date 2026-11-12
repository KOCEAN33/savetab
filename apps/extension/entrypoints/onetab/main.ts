import { mount } from 'svelte';
import { loadPageLanguage, pageLanguageCached } from '@/lib/i18n';
import { loadPageTheme } from '@/lib/theme';
import '@/styles/base.css';
import App from './App.svelte';

const start = () => mount(App, { target: document.getElementById('app')! });

// Language and theme come back from extension storage after a round trip. A page that opened
// before holds both in localStorage and mounts without waiting for it.
const ready = Promise.all([loadPageLanguage(), loadPageTheme()]);
if (pageLanguageCached()) start();
else void ready.then(start);
