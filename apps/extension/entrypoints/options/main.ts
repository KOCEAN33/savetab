import { mount } from 'svelte';
import { loadPageLanguage } from '@/lib/i18n';
import '@/styles/base.css';
import App from './App.svelte';

void loadPageLanguage().then(() => mount(App, { target: document.getElementById('app')! }));
