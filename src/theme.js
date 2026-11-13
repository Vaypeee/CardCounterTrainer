/* Light/dark toggle, shared by the trainer and the content pages. */
import { Store } from './store.js';

export function applyTheme(t) { document.documentElement.dataset.theme = t; Store.set('theme', t); }
export function bindThemeToggle(btn) {
  if (btn) btn.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
}
