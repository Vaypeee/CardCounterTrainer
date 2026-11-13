/* =========================================================
   Vite plugin `site`: static SEO for every page.
   In each HTML source it replaces:
     <!--@head-->         title, description, canonical, Open Graph,
                         Twitter card, icons, fonts, theme script,
                         stylesheet and JSON-LD (from site.config.js)
     <!--@nav-->          top line of the content pages
     <!--@footer-->       shared footer with internal links
     <!--@table:<name>--> a generated table (src/content/tables.js)
   It also emits sitemap.xml and robots.txt (served in dev too).
   ========================================================= */
import { BRAND, PAGES, SITE_NAME, SITE_URL, SITE_URL_IS_PLACEHOLDER } from '../site.config.js';
import { TABLES } from '../src/content/tables.js';

const PUBLISHED = '2026-11-11';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const abs = path => SITE_URL + path;
const today = () => new Date().toISOString().slice(0, 10);

/** Page entry for a Vite HTML path such as "/hi-lo/index.html". */
function pageFor(htmlPath) {
  const p = htmlPath.replace(/\\/g, '/').replace(/^\//, '');
  return PAGES.find(pg => pg.file === p);
}

function jsonLd(page) {
  // Site name for Google = the brand; the product name stays an alternate name.
  const org = { '@type': 'Organization', '@id': abs('/#org'), name: BRAND, url: abs('/'), logo: abs('/logo-512.png') };
  const site = {
    '@type': 'WebSite', '@id': abs('/#website'), url: abs('/'), name: BRAND,
    alternateName: [`${BRAND} ${SITE_NAME}`, SITE_NAME], inLanguage: 'en', publisher: { '@id': abs('/#org') },
  };
  let graph;
  if (page.type === 'app') {
    graph = [site, org, {
      '@type': 'WebApplication', '@id': abs('/#app'), name: SITE_NAME, alternateName: `${BRAND} ${SITE_NAME}`, publisher: { '@id': abs('/#org') }, url: abs('/'), description: page.description,
      applicationCategory: 'EducationalApplication', operatingSystem: 'Any', browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, image: abs('/og.png'),
    }];
  } else if (page.type === 'legal') {
    graph = [site, org, {
      '@type': 'WebPage', '@id': abs(page.path + '#page'), name: page.title, description: page.description,
      url: abs(page.path), inLanguage: 'en', isPartOf: { '@id': abs('/#website') },
    }];
  } else {
    graph = [site, org, {
      '@type': 'Article', '@id': abs(page.path + '#article'), headline: page.title, description: page.description,
      url: abs(page.path), mainEntityOfPage: abs(page.path), image: abs('/og.png'), inLanguage: 'en',
      datePublished: page.published || PUBLISHED, dateModified: page.modified || page.published || PUBLISHED,
      author: { '@id': abs('/#org') },
      publisher: { '@id': abs('/#org') },
      isPartOf: { '@id': abs('/#website') },
    }, {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Trainer', item: abs('/') },
        { '@type': 'ListItem', position: 2, name: page.crumb, item: abs(page.path) },
      ],
    }];
  }
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>`;
}

function head(page) {
  const url = abs(page.path), img = abs('/og.png');
  return `<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0d0f0e">
<meta property="og:type" content="${page.type === 'article' ? 'article' : 'website'}">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Card Counting Trainer: running count drill on a green felt">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(page.description)}">
<meta name="twitter:image" content="${img}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<!-- Optional single web font (monospace for numbers). Falls back to system monospace offline. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<script>
  /* Apply the saved theme before first paint to avoid a flash. */
  try { var t = JSON.parse(localStorage.getItem('cct.theme')); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
</script>
<link rel="stylesheet" href="/src/styles/main.css">
${jsonLd(page)}`;
}

const NAV_LINKS = [['/', 'trainer'], ['/how-to-count-cards/', 'guide'], ['/hi-lo/', 'hi-lo'], ['/card-counting-systems/', 'systems']];
function nav(page) {
  const links = NAV_LINKS.map(([href, label]) => `<a href="${href}"${href === page.path ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<nav class="topline" aria-label="Site">
    <a href="/" class="brand">♠ cct</a>
    <span class="links">${links}<button type="button" id="themeBtn">light/dark</button></span>
  </nav>`;
}

function footer(page) {
  const link = pg => `<a href="${pg.path}"${pg.path === page.path ? ' aria-current="page"' : ''}>${pg.type === 'app' ? 'Trainer' : pg.crumb}</a>`;
  // The trainer's footer stays short (owner's rule): SEO pages marked `appFooter: false` link to the trainer
  // and to each other, but the trainer does not link to them (the sitemap makes them discoverable).
  const links = PAGES.filter(pg => pg.type !== 'legal' && (page.type !== 'app' || pg.appFooter !== false)).map(link).join(' · ');
  const legal = PAGES.filter(pg => pg.type === 'legal').map(link).join(' · ');
  return `<footer><nav class="foot-links" aria-label="Pages">${links}</nav>${BRAND} · For educational purposes only. ${legal}</footer>`;
}

function sitemap() {
  const lastmod = today();
  const urls = PAGES.map(p => `  <url>
    <loc>${abs(p.path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority.toFixed(1)}</priority>
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
const robots = () => `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`;

export default function site() {
  return {
    name: 'site',
    config() {
      return { build: { rollupOptions: { input: Object.fromEntries(PAGES.map(p => [p.path === '/' ? 'main' : p.path.replace(/\//g, ''), p.file])) } } };
    },
    buildStart() {
      if (SITE_URL_IS_PLACEHOLDER && process.env.NODE_ENV === 'production') {
        this.warn(`SITE_URL is not set: canonical URLs and the sitemap use the placeholder ${SITE_URL}. Build with SITE_URL=https://your-domain before deploying.`);
      }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const page = pageFor(ctx.path);
        if (!page) return html;
        return html
          .replace('<!--@head-->', head(page))
          .replace('<!--@nav-->', nav(page))
          .replace('<!--@footer-->', footer(page))
          .replace(/<!--@table:([\w-]+)-->/g, (m, name) => {
            if (!TABLES[name]) throw new Error(`Unknown table placeholder "${name}" in ${page.file}`);
            return TABLES[name]();
          });
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/sitemap.xml') { res.setHeader('Content-Type', 'application/xml'); return res.end(sitemap()); }
        if (req.url === '/robots.txt') { res.setHeader('Content-Type', 'text/plain'); return res.end(robots()); }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap() });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots() });
    },
  };
}
