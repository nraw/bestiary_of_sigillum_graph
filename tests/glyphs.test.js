// Run with: node --test tests/*.test.js
// Official card art (traced from the V2 Character Reference PDF) is defined once, in graph-logic.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../graph-logic.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('every attribute has its own card-banner emblem', () => {
    assert.deepStrictEqual(Object.keys(G.ATTRIBUTE_GLYPHS).sort(), [...G.ATTRIBUTES].sort());
    const paths = Object.values(G.ATTRIBUTE_GLYPHS);
    assert.strictEqual(new Set(paths).size, paths.length);
    paths.forEach(d => assert.match(d, /^M[\d. MLCZ-]+$/));
});

test('attributeGlyph draws the emblem as a 24-unit stroked svg', () => {
    const svg = G.attributeGlyph('Agility', 'ico');
    assert.match(svg, /^<svg class="ico glyph-attr" viewBox="0 0 24 24" aria-hidden="true">/);
    assert.ok(svg.includes(`<path d="${G.ATTRIBUTE_GLYPHS.Agility}"/>`));
    assert.match(G.attributeGlyph('Strength'), /class="glyph-attr"/);
});

test('official heart and ability-row markers are available as filled paths', () => {
    for (const key of ['heart', 'target', 'effect', 'cooldown']) {
        assert.match(G.GLYPHS[key], /^M[\d. MLCZ-]+$/, key);
    }
    assert.match(G.glyphSymbol('heart-glyph', 'heart'),
        /^<symbol id="heart-glyph" viewBox="0 0 24 24"><path d="M[^"]+"\/><\/symbol>$/);
});

test('no view keeps its own copy of the attribute or heart icons', () => {
    const draftUi = read('draft-ui.js');
    const icons = draftUi.slice(draftUi.indexOf('const ICON = {'), draftUi.indexOf('};', draftUi.indexOf('const ICON = {')));
    ['Strength', 'Agility', 'Intelligence'].forEach(a => assert.ok(!icons.includes(`${a}:`), `draft-ui ICON.${a}`));

    const script = read('script.js');
    assert.ok(!/symbol: '(plus|triangle|star)'/.test(script.slice(0, script.indexOf('LABEL_SHAPES'))),
        'HERO_ATTRIBUTES uses d3 shapes');
    assert.ok(!script.includes('BURST_POINTS'), 'hand-drawn effect burst');
    assert.ok(!read('index.html').includes('id="heart-glyph"'), 'index.html hardcodes the heart');
});
