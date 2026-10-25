// Run with: node --test tests/*.test.js
// Donate links (index.html): the footer, the intro and a finished draft, each tracked as donate_click by placement
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../analytics.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('index.html');
const DONATE = 'https://revolut.me/andrejmarsic';
const links = [...html.matchAll(/<a[^>]*data-donate="[^"]*"[^>]*>/g)].map(m => m[0]);
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

test('the footer, the intro and the finished draft each have one donate link', () => {
    assert.deepStrictEqual(links.map(l => attr(l, 'data-donate')).sort(), ['draft_end', 'footer', 'intro']);
});

test('each donate link opens the Revolut page in a new tab, safely', () => {
    links.forEach(l => {
        assert.strictEqual(attr(l, 'href'), DONATE, l);
        assert.strictEqual(attr(l, 'target'), '_blank', l);
        assert.match(attr(l, 'rel'), /noopener/, l);
    });
});

test('the links sit inside the footer, the intro dialog and the draft-complete note', () => {
    const within = (open, close, placement) => {
        const start = html.indexOf(open);
        const block = html.slice(start, html.indexOf(close, start));
        assert.ok(block.includes(`data-donate="${placement}"`), placement);
    };
    within('<footer class="footer">', '</footer>', 'footer');
    within('id="introDialog"', '</dialog>', 'intro');
    within('id="completeNote"', 'class="panel draft-pool"', 'draft_end');
});

test('donate clicks are tracked by placement', () => {
    assert.deepStrictEqual(A.EVENTS.donate_click, ['placement']);
    assert.match(read('draft-ui.js'), /\[data-donate\]/);
    assert.match(read('draft-ui.js'), /track\('donate_click'/);
});

test('the draft-complete note keeps its title, the cards button and the donate line apart', () => {
    const start = html.indexOf('id="completeNote"');
    const note = html.slice(start, html.indexOf('class="panel draft-pool"', start));
    assert.match(note, /class="complete-title" id="completeText"/);
    assert.match(note, /id="openMatch"/);
    assert.match(note, /class="complete-donate"[\s\S]*data-donate="draft_end"/);
});

test('the draft-complete note says the game can start, under a short "Draft complete" label and nothing more', () => {
    const start = html.indexOf('id="completeNote"');
    const note = html.slice(start, html.indexOf('class="panel draft-pool"', start));
    assert.match(note, /class="complete-eyebrow">Draft complete</);
    assert.match(note, /battle can begin/i);
    assert.doesNotMatch(note, /complete-sub/);
});

test('the donate link is always drawn as clipped gradient text, so the shimmer ends without a repaint blink', () => {
    const css = read('styles.css');
    const base = css.match(/\n\.complete-donate \.donate-link \{[^}]*\}/)[0];
    assert.match(base, /background-clip: text/);
    assert.doesNotMatch(css.match(/\.is-celebrating \.complete-donate \.donate-link \{[^}]*\}/)[0], /background-clip|color:/);
});

test('the finishing shine is skipped for reduced motion', () => {
    const css = read('styles.css');
    assert.match(css, /\.is-celebrating/);
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
    assert.match(reduced, /is-celebrating/);
    assert.match(read('draft-ui.js'), /celebrates\(/);
});
