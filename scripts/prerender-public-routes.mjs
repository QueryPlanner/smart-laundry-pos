// Generates static dist/<route>/index.html copies of the built SPA shell for
// public routes other than "/", each with its own <title>/description/canonical
// (and no homepage-only JSON-LD). The SPA rewrite in vercel.json otherwise
// serves the exact same index.html for every route, so a crawler that doesn't
// execute JS (many AI/answer-engine bots) would see the homepage's title,
// description, canonical, and FAQPage schema on /login and /install too -
// telling Google those routes are duplicates of "/" and misrepresenting what's
// on those pages to answer engines. React still hydrates and renders normally
// client-side; only the pre-hydration HTML in <head> differs per route.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, '..', 'dist');
const SITE_URL = 'https://smart-laundry-pos-english.vercel.app';

const ROUTES = [
  {
    path: '/login',
    title: 'Login - Smart Laundry POS',
    description:
      'Sign in or sign up as a laundry store owner with Smart Laundry POS. Free to use, no credit card required, and ready in 5 minutes.',
  },
  {
    path: '/install',
    title: 'Install Smart Laundry POS - Android, iOS, Desktop',
    description:
      'Guide to installing Smart Laundry POS as an app (PWA) on Android, iOS, Windows, and Mac. Access it offline with a native-app experience from your home screen.',
  },
];

const stripJsonLd = (html) =>
  html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/, '\n');

const setTagContent = (html, regex, replacement) => {
  if (!regex.test(html)) throw new Error(`Expected tag not found: ${regex}`);
  return html.replace(regex, replacement);
};

const buildRouteHtml = (baseHtml, route) => {
  const canonical = `${SITE_URL}${route.path}`;
  let html = baseHtml;
  html = setTagContent(html, /<title>.*?<\/title>/, `<title>${route.title}</title>`);
  html = setTagContent(
    html,
    /<meta name="description" content="[^"]*"\s*\/>/,
    `<meta name="description" content="${route.description}" />`
  );
  html = setTagContent(
    html,
    /<link rel="canonical" href="[^"]*"\s*\/>/,
    `<link rel="canonical" href="${canonical}" />`
  );
  html = setTagContent(html, /<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${route.title}" />`);
  html = setTagContent(
    html,
    /<meta property="og:description" content="[^"]*"\s*\/>/,
    `<meta property="og:description" content="${route.description}" />`
  );
  html = setTagContent(html, /<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${canonical}" />`);
  html = setTagContent(html, /<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${route.title}" />`);
  html = setTagContent(
    html,
    /<meta name="twitter:description" content="[^"]*"\s*\/>/,
    `<meta name="twitter:description" content="${route.description}" />`
  );
  html = stripJsonLd(html);
  return html;
};

const baseHtml = await readFile(join(DIST, 'index.html'), 'utf8');

for (const route of ROUTES) {
  const outDir = join(DIST, route.path.slice(1));
  await mkdir(outDir, { recursive: true });
  const html = buildRouteHtml(baseHtml, route);
  await writeFile(join(outDir, 'index.html'), html, 'utf8');
  console.log(`Prerendered ${route.path} -> dist${route.path}/index.html`);
}
