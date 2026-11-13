/* Entry point: load settings, build the settings UI, bind events, start the clock tick,
   then connect to the backend (optional: the trainer works without it). */
import { loadSettings } from './state.js';
import { initSettingsUI } from './ui/settings.js';
import { initResultsShare } from './ui/results.js';
import { showScreen } from './ui/screens.js';
import { bindEvents } from './events.js';
import { startTicker } from './session.js';
import { initAccountUI } from './ui/account.js';
import { captureInvite, initDuelUI } from './ui/duel.js';
import * as Backend from './backend.js';

captureInvite();   // ?duel=CODE (friend challenge link)
loadSettings();
initSettingsUI();
initResultsShare();
bindEvents();
startTicker();
showScreen('settings');
Backend.init().then(() => { initAccountUI(); initDuelUI(); }).catch(err => console.warn('Backend unavailable:', err));
