import { mount } from 'svelte';
import { loadPageLanguage } from '@/lib/i18n';
import { loadPageTheme } from '@/lib/theme';
import '@/styles/base.css';
import App from './App.svelte';

void Promise.all([loadPageLanguage(), loadPageTheme()]).then(() => mount(App, { target: document.getElementById('app')! }));
