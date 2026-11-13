/* Distraction mode: casino chatter, ghost cards and ambient noise (cosmetic randomness only). */
import { CHATTER, QUESTION_MODES, RANKS, SUITS } from '../core/config.js';
import { looseRng } from '../core/rng.js';
import { $ } from '../dom.js';
import { S } from '../state.js';
import { Sound } from '../audio.js';

const { int: randInt, pick } = looseRng;

export const Distraction = {
  active: false, timer: null,
  start() {
    if (!S.settings.distraction || QUESTION_MODES.includes(S.mode) || this.active) return;
    this.active = true;
    $('#stage').classList.add('distract');
    Sound.startAmbient();
    this.loop();
  },
  stop() {
    this.active = false;
    clearTimeout(this.timer);
    $('#stage').classList.remove('distract');
    $('#distraction').replaceChildren();
    Sound.stopAmbient();
  },
  loop() {
    if (!this.active) return;
    this.spawn();
    this.timer = setTimeout(() => this.loop(), 450 + Math.random() * 900);
  },
  spawn() {
    const el = document.createElement('div');
    const ghost = Math.random() < 0.22;
    el.className = 'chatter' + (ghost ? ' ghost' : '');
    el.textContent = ghost ? pick(RANKS) + pick(SUITS).sym : pick(CHATTER);
    el.style.left = randInt(2, 72) + '%';
    el.style.top = (Math.random() < 0.5 ? randInt(3, 20) : randInt(76, 90)) + '%';  // keep the centre readable
    el.style.fontSize = randInt(13, 22) + 'px';
    el.style.setProperty('--rot', randInt(-12, 12) + 'deg');
    $('#distraction').appendChild(el);
    setTimeout(() => el.remove(), 2700);
    if (Math.random() < 0.4) Sound.chip();
  },
};
