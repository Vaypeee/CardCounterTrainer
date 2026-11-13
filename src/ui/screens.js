/* Screen switching: settings | train | results | stats | account | ranked | duel | ladder | history. (The guide is its own page.) */
import { $$ } from '../dom.js';
import { S, restoreOwnSettings } from '../state.js';
import { renderSettings } from './settings.js';
import { renderStats } from './stats.js';
import { renderAccount } from './account.js';
import { beforeScreen, renderHistory, renderLadder, renderLobby } from './duel.js';

export function showScreen(name) {
  if (!beforeScreen(name)) return;   // a live ranked duel cannot be left by navigating away
  // Fixed rules of a verified run only apply to the run and its results; leaving them gives the player's settings back.
  if (name !== 'train' && name !== 'results') restoreOwnSettings();
  S.screen = name;
  document.body.dataset.screen = name;
  $$('.screen').forEach(el => { el.hidden = el.id !== 'screen-' + name; });
  if (name === 'settings') renderSettings();
  if (name === 'stats') renderStats();
  if (name === 'account') renderAccount();
  if (name === 'ranked') renderLobby();
  if (name === 'ladder') renderLadder();
  if (name === 'history') renderHistory();
  window.scrollTo(0, 0);
}
