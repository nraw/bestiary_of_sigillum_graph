// Run with: node --test tests/*.test.js
// Page metadata (index.html): title, social cards, icons and structured data for the companion site
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SITE = 'https://bos.nraw.eu/';
const root = file => path.join(__dirname, '..', file);
const html = fs.readFileSync(root('index.html'), 'utf8');
const head = html.slice(0, html.indexOf('</head>'));
const meta = (attr, key) => {
    const tag = head.match(new RegExp(`<meta[^>]*${attr}="${key}"[^>]*>`));
    return tag && tag[0].match(/content="([^"]*)"/)[1];
};
const link = rel => [...head.matchAll(/<link[^>]*>/g)].map(m => m[0]).filter(t => t.includes(`rel="${rel}"`));
const href = tag => tag.match(/href="([^"]*)"/)[1];
const pngSize = file => {
    const buf = fs.readFileSync(root(file));
    assert.strictEqual(buf.toString('ascii', 1, 4), 'PNG', file);
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

test('the title names the companion and both jobs, within what search results show', () => {
    const title = head.match(/<title>([^<]+)<\/title>/)[1].replace(/&amp;/g, '&');
    assert.match(title, /^Bestiary of Sigillum Companion/);
    assert.match(title, /Draft/);
    assert.ok(title.length <= 65, `${title.length} chars`);
});

test('the description covers drafting and the synergy graph in a snippet-sized sentence', () => {
    const description = meta('name', 'description');
    assert.match(description, /draft/i);
    assert.match(description, /synerg/i);
    assert.ok(description.length >= 110 && description.length <= 160, `${description.length} chars`);
    assert.strictEqual(meta('name', 'keywords'), null, 'search engines ignore keywords');
});

test('canonical and social urls point at the published site', () => {
    assert.strictEqual(href(link('canonical')[0]), SITE);
    assert.strictEqual(meta('property', 'og:url'), SITE);
    assert.match(meta('property', 'og:title'), /Companion/);
    assert.match(meta('property', 'og:site_name'), /Companion/);
    assert.ok(meta('property', 'og:description'));
});

test('the share image exists at 1200×630 and is linked absolutely, with alt text', () => {
    const image = meta('property', 'og:image');
    assert.ok(image.startsWith(SITE), image);
    assert.deepStrictEqual(pngSize(image.slice(SITE.length)), [1200, 630]);
    assert.strictEqual(meta('property', 'og:image:width'), '1200');
    assert.strictEqual(meta('property', 'og:image:height'), '630');
    assert.ok(meta('property', 'og:image:alt'));
});

test('twitter cards use name= (not property=) and the same image', () => {
    assert.strictEqual(meta('name', 'twitter:card'), 'summary_large_image');
    assert.strictEqual(meta('name', 'twitter:image'), meta('property', 'og:image'));
    assert.ok(meta('name', 'twitter:title'));
    assert.ok(!/property="twitter:/.test(head));
});

test('icons are relative (the page works from any path, e.g. a local server) and exist', () => {
    const icons = [...link('icon'), ...link('apple-touch-icon'), ...link('manifest')];
    assert.ok(icons.length >= 4);
    for (const tag of icons) {
        const file = href(tag);
        assert.ok(!file.startsWith('/') && !file.startsWith('http'), file);
        assert.ok(fs.existsSync(root(file)), file);
    }
    assert.ok(link('icon').some(t => t.includes('image/svg+xml')), 'svg favicon');
    assert.deepStrictEqual(pngSize(href(link('apple-touch-icon')[0])), [180, 180]);
    assert.ok(fs.existsSync(root('favicon.ico')), 'browsers ask for /favicon.ico regardless');
    assert.match(meta('name', 'theme-color'), /^#[0-9A-Fa-f]{6}$/);
});

test('the web manifest names the companion and its icons exist', () => {
    const manifest = JSON.parse(fs.readFileSync(root(href(link('manifest')[0])), 'utf8'));
    assert.match(manifest.name, /Companion/);
    assert.ok(manifest.icons.length >= 2);
    manifest.icons.forEach(i => assert.ok(fs.existsSync(root(i.src)), i.src));
});

test('structured data parses and describes the companion app', () => {
    const json = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    const data = JSON.parse(json);
    assert.strictEqual(data['@type'], 'WebApplication');
    assert.match(data.name, /Companion/);
    assert.strictEqual(data.url, SITE);
    assert.strictEqual(data.applicationCategory, 'GameApplication');
    assert.ok(data.featureList.some(f => /draft/i.test(f)));
    assert.strictEqual(data.isAccessibleForFree, true);
});

test('robots.txt points at the sitemap, which lists the app and every hero\'s ?hero= address', () => {
    assert.match(fs.readFileSync(root('robots.txt'), 'utf8'), new RegExp(`Sitemap: ${SITE}sitemap.xml`));
    const heroes = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
    const locs = [...fs.readFileSync(root('sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    assert.deepStrictEqual(locs, [SITE, ...heroes.map(h => `${SITE}?hero=${h.name.toLowerCase()}`).sort()]);
});

test('the visible heading matches the companion framing and the intro dialog is present', () => {
    assert.match(html, /<h1 class="title">Bestiary of Sigillum<\/h1>/);
    assert.match(html, /class="subtitle">[^<]*Draft/);
    assert.match(html, /<dialog[^>]*id="introDialog"/);
    assert.match(html, /<script src="intro.js"><\/script>/);
});

test('the intro explains the two tabs, synergies included, and opens them with tab-styled buttons', () => {
    const intro = html.match(/<dialog[^>]*id="introDialog"[\s\S]*?<\/dialog>/)[0];
    const steps = [...intro.matchAll(/<section class="intro-step"[\s\S]*?<\/section>/g)].map(m => m[0]);
    assert.strictEqual(steps.length, 2);
    assert.match(steps[0], /Graph/);
    // Synergies is its own toolbar toggle, not what selecting a hero shows
    const bullets = [...steps[0].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
    const synergy = bullets.filter(b => /synerg/i.test(b));
    assert.strictEqual(synergy.length, 1);
    assert.match(synergy[0], /<strong>Synergies<\/strong>/);
    assert.ok(!/pick a hero/i.test(synergy[0]));
    assert.match(steps[1], /Draft/);
    const actions = [...intro.matchAll(/<button[^>]*data-intro-tab="(\w+)"[^>]*>/g)];
    assert.deepStrictEqual(actions.map(m => m[1]), ['graph', 'draft']);
    actions.forEach(m => assert.match(m[0], /class="tab\b/));
});

test('the ? that reopens the intro sits outside the header', () => {
    const header = html.match(/<header class="header">[\s\S]*?<\/header>/)[0];
    assert.ok(!header.includes('id="introOpen"'));
    assert.match(html, /<button[^>]*class="[^"]*help-btn[^"]*"[^>]*id="introOpen"/);
});

test('fonts load from the head (preconnected), not through an @import in the stylesheet', () => {
    assert.ok(!/@import/.test(fs.readFileSync(root('styles.css'), 'utf8')));
    assert.ok(link('preconnect').some(t => t.includes('https://fonts.googleapis.com')));
    assert.ok(link('preconnect').some(t => t.includes('https://fonts.gstatic.com') && t.includes('crossorigin')));
    const fonts = link('stylesheet').find(t => t.includes('fonts.googleapis.com/css2'));
    assert.match(fonts, /family=Cinzel/);
    assert.match(fonts, /display=swap/);
    assert.ok(head.indexOf(fonts) < head.indexOf('href="styles.css"'));
});

test('without JavaScript the page still says what it is and links every hero\'s address', () => {
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
    assert.match(noscript, /JavaScript/);
    const heroes = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
    heroes.forEach(h => assert.ok(noscript.includes(`href="?hero=${h.name.toLowerCase()}"`), h.name));
});
