/* =========================================================
   AUDIO (WebAudio, generated — no files)
   ========================================================= */
import { S } from './state.js';

export const Sound = {
  ctx: null, snap: null, brown: null, ambient: null,
  ensure() {
    if (!S.settings.sound) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  tone(freq, dur, type = 'sine', vol = 0.06, delay = 0) {
    const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  deal() {
    const ctx = this.ensure(); if (!ctx) return;
    if (!this.snap) {
      const len = Math.floor(ctx.sampleRate * 0.04), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      this.snap = b;
    }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.snap; f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 0.8; g.gain.value = 0.35;
    src.connect(f).connect(g).connect(ctx.destination); src.start();
  },
  good() { this.tone(880, 0.1, 'sine', 0.07); this.tone(1318, 0.14, 'sine', 0.06, 0.08); },
  bad()  { this.tone(185, 0.28, 'triangle', 0.1); },
  chip() { this.tone(2400 + Math.random() * 1200, 0.05, 'square', 0.012); this.tone(3000 + Math.random() * 800, 0.04, 'square', 0.01, 0.05); },
  startAmbient() {
    const ctx = this.ensure(); if (!ctx || this.ambient) return;
    if (!this.brown) {
      const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      this.brown = b;
    }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.brown; src.loop = true; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.12;
    src.connect(f).connect(g).connect(ctx.destination); src.start();
    this.ambient = src;
  },
  stopAmbient() { if (this.ambient) { try { this.ambient.stop(); } catch {} this.ambient = null; } },
};
