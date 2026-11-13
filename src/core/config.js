/* =========================================================
   CONFIG (pure data, no DOM)
   Counting systems are data-driven: add an entry here and it
   shows up everywhere (select, reference table, logic).
   tags: value per rank key (T = any ten-valued card).
   irc:  initial running count as a function of deck count.
   ========================================================= */
export const SYSTEMS = {
  hilo:   { name: 'Hi-Lo',          level: 1, balanced: true,
            tags: { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0, T: -1, A: -1 },
            irc: () => 0, note: 'Level 1, balanced. The most widely used system; a full shoe ends at 0.' },
  ko:     { name: 'KO (Knock-Out)', level: 1, balanced: false,
            tags: { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 0, T: -1, A: -1 },
            irc: d => 4 - 4 * d, note: 'Level 1, unbalanced (+4 per deck). Start at IRC = 4 − 4 × decks; a full shoe ends at +4.' },
  omega2: { name: 'Omega II',       level: 2, balanced: true,
            tags: { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 0, 9: -1, T: -2, A: 0 },
            irc: () => 0, note: 'Level 2, balanced. Aces are 0 (side-counted separately in practice).' },
  zen:    { name: 'Zen Count',      level: 2, balanced: true,
            tags: { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 0, 9: 0, T: -2, A: -1 },
            irc: () => 0, note: 'Level 2, balanced.' },
  halves: { name: 'Wong Halves',    level: 3, balanced: true,
            tags: { 2: 0.5, 3: 1, 4: 1, 5: 1.5, 6: 1, 7: 0.5, 8: 0, 9: -0.5, T: -1, A: -1 },
            irc: () => 0, note: 'Level 3, balanced, uses half points (answers like 2.5 are valid).' },
};
export const TAG_KEYS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = [{ sym: '♠', red: false }, { sym: '♥', red: true }, { sym: '♦', red: true }, { sym: '♣', red: false }];

export const MODES = {
  flash:      { name: 'Flash Cards', desc: 'One card at a time. Keep the running count.' },
  hands:      { name: 'Hands',       desc: 'Real rounds: player hands + dealer.' },
  speed:      { name: 'Speed Count', desc: 'Flip the whole shoe as fast as you can.' },
  truecount:  { name: 'True Count',  desc: 'Convert running count to true count.' },
  deviations: { name: 'Deviations',  desc: 'Illustrious 18 + Fab 4 index plays.' },
};
export const QUESTION_MODES = ['truecount', 'deviations'];
export const UNTIMED_QUESTIONS = 20;

/* Difficulty presets for the dealt modes (Flash Cards / Hands).
   Changing the speed by hand switches the level to "custom". */
export const LEVELS = {
  low:    { name: 'Low',    speed: 2.0 },
  medium: { name: 'Medium', speed: 1.0 },
  hard:   { name: 'Hard',   speed: 0.5 },
};
export const LEVELED_MODES = ['flash', 'hands'];
/** Level key for the current settings: low | medium | hard | custom-0.7 | manual */
export function levelKeyOf(st) {
  if (st.manual) return 'manual';
  return LEVELS[st.level] ? st.level : `custom-${st.speed.toFixed(1)}`;
}
/** Human label for a stored level key. */
export function levelLabel(key) {
  if (!key) return '—';
  if (key === 'manual') return 'Manual';
  if (LEVELS[key]) return LEVELS[key].name;
  if (key.startsWith('custom-')) return `Custom ${key.slice(7)}s`;
  return key;
}

export const DEFAULTS = {
  mode: 'flash', system: 'hilo', decks: 6, speed: 1.0, manual: false,
  players: 3, cardsPerHand: 'auto', duration: 60,
  checksEnabled: true, checkMin: 10, checkMax: 30,
  penetration: 75, deckRounding: 'half', tcRounding: 'floor',
  faceUp: true, sound: false, wheels: false, distraction: false, level: 'medium', review: true,
};

/* Index plays (Hi-Lo, multi-deck, S17, DAS). Deviation applies at TC >= idx.
   yes = play at/above index, no = play below. Insurance (TC >= +3) is the
   top I18 play but is not a hand action, so it is not quizzed here. */
export const ACTIONS = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', R: 'Surrender' };
export const DEVIATIONS = [
  { hand: '16', up: 'T', idx: 0,  yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '15', up: 'T', idx: 4,  yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: 'TT', up: '5', idx: 5,  yes: 'P', no: 'S', ls: false, set: 'Illustrious 18' },
  { hand: 'TT', up: '6', idx: 4,  yes: 'P', no: 'S', ls: false, set: 'Illustrious 18' },
  { hand: '10', up: 'T', idx: 4,  yes: 'D', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '12', up: '3', idx: 2,  yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '12', up: '2', idx: 3,  yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '11', up: 'A', idx: 1,  yes: 'D', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '9',  up: '2', idx: 1,  yes: 'D', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '10', up: 'A', idx: 4,  yes: 'D', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '9',  up: '7', idx: 3,  yes: 'D', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '16', up: '9', idx: 5,  yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '13', up: '2', idx: -1, yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '12', up: '4', idx: 0,  yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '12', up: '5', idx: -2, yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '12', up: '6', idx: -1, yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '13', up: '3', idx: -2, yes: 'S', no: 'H', ls: false, set: 'Illustrious 18' },
  { hand: '14', up: 'T', idx: 3,  yes: 'R', no: 'H', ls: true,  set: 'Fab 4' },
  { hand: '15', up: 'T', idx: 0,  yes: 'R', no: 'H', ls: true,  set: 'Fab 4' },
  { hand: '15', up: '9', idx: 2,  yes: 'R', no: 'H', ls: true,  set: 'Fab 4' },
  { hand: '15', up: 'A', idx: 1,  yes: 'R', no: 'H', ls: true,  set: 'Fab 4' },
];

export const CHATTER = ['Place your bets!', 'Blackjack!', 'Cocktails?', 'Insurance?', 'Dealer busts!', 'Push.', 'Nice hit!',
  'Color up?', 'No more bets', 'Shuffle up!', 'Hit me!', 'Split ’em!', 'Double down!', 'Jackpot on 7!', '$25 min', 'Cash play!', 'Winner!'];
