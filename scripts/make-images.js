/* Generates the static images in public/: favicon.svg, apple-touch-icon.png (180×180), og.png (1200×630, the social
   sharing card) and the square logo (logo.svg, logo-120.png, logo-512.png). Run: bun run images */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../public/', import.meta.url);
mkdirSync(out, { recursive: true });
const MONO = 'JetBrains Mono, Consolas, Menlo, monospace';
const SANS = 'Helvetica Neue, Helvetica, Arial, sans-serif';

/** Favicon / touch icon: black and white, a light ♠ on the app's dark background (like the "♠ cct" brand). */
const icon = size => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="4" fill="#0d0f0e"/>
  <text x="32" y="47" font-size="42" text-anchor="middle" fill="#e8eae8" font-family="${SANS}">♠</text>
</svg>`;

/** Square brand logo (OAuth consent screen, profiles): K♠ and 5♥ fanned on the felt, "cct" on a dark band. */
const logoCard = (x, y, w, rank, suit, red, rot) => {
  const h = w * 1.4, c = red ? '#c8102e' : '#111';
  return `<g transform="translate(${x} ${y}) rotate(${rot} ${w / 2} ${h / 2})">
    <rect width="${w}" height="${h}" rx="3" fill="#fff" stroke="rgba(0,0,0,.3)"/>
    <text x="${w * 0.12}" y="${w * 0.26}" font-size="${w * 0.2}" font-weight="700" fill="${c}" font-family="${MONO}">${rank}</text>
    <text x="${w / 2}" y="${h / 2 + w * 0.17}" font-size="${w * 0.46}" text-anchor="middle" fill="${c}" font-family="${SANS}">${suit}</text>
  </g>`;
};
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <radialGradient id="lf" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="#17774c"/><stop offset="0.85" stop-color="#0d4f31"/></radialGradient>
  </defs>
  <rect width="120" height="120" fill="url(#lf)"/>
  ${logoCard(22, 12, 48, 'K', '♠', false, -10)}
  ${logoCard(50, 12, 48, '5', '♥', true, 8)}
  <rect y="88" width="120" height="32" fill="#0d0f0e"/>
  <text x="60" y="111" font-size="21" font-weight="700" text-anchor="middle" fill="#e8eae8" font-family="${MONO}">cct</text>
</svg>`;

/** A playing card at (x, y), width w. */
const card = (x, y, w, rank, suit, red, rot = 0) => {
  const h = w * 1.4, c = red ? '#c8102e' : '#111';
  return `<g transform="translate(${x} ${y}) rotate(${rot} ${w / 2} ${h / 2})">
    <rect width="${w}" height="${h}" rx="${w * 0.06}" fill="#fff" stroke="rgba(0,0,0,.25)"/>
    <text x="${w * 0.1}" y="${w * 0.22}" font-size="${w * 0.17}" font-weight="700" fill="${c}" font-family="${MONO}">${rank}</text>
    <text x="${w * 0.1}" y="${w * 0.38}" font-size="${w * 0.15}" fill="${c}" font-family="${SANS}">${suit}</text>
    <text x="${w / 2}" y="${h / 2 + w * 0.15}" font-size="${w * 0.42}" text-anchor="middle" fill="${c}" font-family="${SANS}">${suit}</text>
  </g>`;
};

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="felt" cx="50%" cy="35%" r="75%">
      <stop offset="0" stop-color="#17774c"/><stop offset="0.8" stop-color="#0d4f31"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0d0f0e"/>
  <rect x="60" y="60" width="1080" height="510" fill="#191c1a"/>
  <text x="100" y="128" font-size="22" fill="#8f9791" font-family="${MONO}">♠ cct</text>
  <text x="100" y="205" font-size="62" font-weight="700" fill="#e8eae8" font-family="${SANS}">Card Counting</text>
  <text x="100" y="275" font-size="62" font-weight="700" fill="#e8eae8" font-family="${SANS}">Trainer</text>
  <text x="100" y="335" font-size="25" fill="#8f9791" font-family="${SANS}">Free blackjack counting drills in your browser.</text>
  <line x1="100" y1="380" x2="560" y2="380" stroke="#2c312e" stroke-width="2"/>
  <text x="100" y="425" font-size="22" fill="#e8eae8" font-family="${MONO}">Hi-Lo · KO · Omega II · Zen · Halves</text>
  <text x="100" y="465" font-size="22" fill="#e8eae8" font-family="${MONO}">running count · true count · indices</text>
  <text x="100" y="525" font-size="22" font-weight="700" fill="#2fbf71" font-family="${MONO}">K 5 A → −1 +1 −1 = −1</text>
  <rect x="640" y="100" width="460" height="430" fill="url(#felt)"/>
  ${card(700, 200, 130, 'K', '♠', false, -8)}
  ${card(800, 185, 130, '5', '♥', true, 2)}
  ${card(900, 200, 130, 'A', '♦', true, 10)}
</svg>`;

const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true, defaultFontFamily: 'Arial' } }).render().asPng();

writeFileSync(new URL('favicon.svg', out), icon(64));
writeFileSync(new URL('apple-touch-icon.png', out), png(icon(180), 180));
writeFileSync(new URL('og.png', out), png(og, 1200));
writeFileSync(new URL('logo.svg', out), logo);
writeFileSync(new URL('logo-120.png', out), png(logo, 120));   // Google OAuth consent screen: square, 120×120, < 1 MB
writeFileSync(new URL('logo-512.png', out), png(logo, 512));
console.log('public/: favicon.svg, apple-touch-icon.png, og.png, logo.svg, logo-120.png, logo-512.png');
