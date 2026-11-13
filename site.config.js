/* =========================================================
   SITE CONFIG — one entry per indexable page.
   Used by the Vite `site` plugin (plugins/site.js) to build the
   <head> (title, description, canonical, Open Graph, JSON-LD),
   the multi-page build inputs and sitemap.xml.
   ========================================================= */

/** Public origin, no trailing slash. Set SITE_URL at build time once the domain is known. */
export const SITE_URL = (process.env.SITE_URL || 'https://cardcountingtrainer.example').replace(/\/+$/, '');
export const SITE_URL_IS_PLACEHOLDER = !process.env.SITE_URL;

export const SITE_NAME = 'Card Counting Trainer';
/** Brand (owner's choice, 2026-11-12): the site name Google shows above results, the Organization, og:site_name. */
export const BRAND = 'Velua';

export const PAGES = [
  {
    path: '/',
    file: 'index.html',
    type: 'app',
    title: 'Card Counting Trainer – Free Blackjack Counting Practice | Velua',
    description: 'Velua is a free blackjack card counting trainer. Practice the Hi-Lo running count, true count conversion, speed counting and index plays in timed drills, right in your browser.',
    changefreq: 'weekly',
    priority: 1.0,
  },
  {
    path: '/how-to-count-cards/',
    file: 'how-to-count-cards/index.html',
    type: 'article',
    title: 'How to Count Cards in Blackjack: A Beginner’s Guide',
    description: 'Learn to count cards in blackjack step by step: the running count, the true count, what your edge is at each count, how to bet, and a practice plan.',
    crumb: 'How to count cards',
    changefreq: 'monthly',
    priority: 0.9,
  },
  {
    path: '/hi-lo/',
    file: 'hi-lo/index.html',
    type: 'article',
    title: 'Hi-Lo Card Counting System: Values, True Count & Index Plays',
    description: 'The Hi-Lo card counting system explained: card values, running and true count, betting ramp, and the Illustrious 18 and Fab 4 index plays with their true count indices.',
    crumb: 'Hi-Lo system',
    changefreq: 'monthly',
    priority: 0.8,
  },
  {
    path: '/card-counting-systems/',
    file: 'card-counting-systems/index.html',
    type: 'article',
    title: 'Card Counting Systems Compared: Hi-Lo, KO, Omega II, Zen, Halves',
    description: 'Compare blackjack card counting systems side by side: card values, level, balanced or unbalanced, and betting and playing efficiency for Hi-Lo, KO, Omega II, Zen and Wong Halves.',
    crumb: 'Counting systems',
    changefreq: 'monthly',
    priority: 0.7,
  },
  // SEO pages (owner's rule, 2026-11-12): they link to the trainer, the trainer does not link to them.
  {
    path: '/true-count/',
    file: 'true-count/index.html',
    type: 'article',
    appFooter: false,
    title: 'True Count in Blackjack: How to Calculate It (with Conversion Table)',
    description: 'How to convert the running count to the true count: estimating decks left, rounding, a conversion table, what each true count is worth, and drills to do it fast.',
    crumb: 'True count',
    changefreq: 'monthly',
    priority: 0.8,
  },
  {
    path: '/basic-strategy/',
    file: 'basic-strategy/index.html',
    type: 'article',
    appFooter: false,
    title: 'Blackjack Basic Strategy Chart (6 Decks, S17, DAS) and How to Learn It',
    description: 'The complete blackjack basic strategy chart for 6 decks, dealer stands on soft 17, double after split and late surrender: hard totals, soft hands and pairs, with tips to memorise it.',
    crumb: 'Basic strategy',
    changefreq: 'monthly',
    priority: 0.8,
  },
  {
    path: '/illustrious-18/',
    file: 'illustrious-18/index.html',
    type: 'article',
    appFooter: false,
    title: 'Illustrious 18 and Fab 4: Hi-Lo Index Plays Explained',
    description: 'The Illustrious 18 and Fab 4 blackjack deviations for Hi-Lo: every index, why it works, which ones matter most, and how to drill them until they are automatic.',
    crumb: 'Illustrious 18',
    changefreq: 'monthly',
    priority: 0.8,
  },
  {
    path: '/is-card-counting-legal/',
    file: 'is-card-counting-legal/index.html',
    type: 'article',
    appFooter: false,
    title: 'Is Card Counting Illegal? Casinos, Back-offs and the Law',
    description: 'Is counting cards in blackjack legal? What casinos can and cannot do, back-offs and bans, Nevada and New Jersey, devices, and how counters avoid attention.',
    crumb: 'Is counting legal?',
    changefreq: 'yearly',
    priority: 0.6,
  },
  // Legal pages (type 'legal'): linked from the footer's second line, plain WebPage in JSON-LD.
  {
    path: '/privacy/',
    file: 'privacy/index.html',
    type: 'legal',
    title: 'Privacy Policy – Card Counting Trainer',
    description: 'What Card Counting Trainer stores about you: settings in your browser, and for optional accounts your email, player name and ranked match results.',
    crumb: 'Privacy',
    changefreq: 'yearly',
    priority: 0.2,
  },
  {
    path: '/terms/',
    file: 'terms/index.html',
    type: 'legal',
    title: 'Terms of Use – Card Counting Trainer',
    description: 'Terms of use of Card Counting Trainer: a free educational tool, fair play in ranked matches, player names and accounts.',
    crumb: 'Terms',
    changefreq: 'yearly',
    priority: 0.2,
  },
];
