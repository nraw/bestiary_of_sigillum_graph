// Run with: node --test tests/*.test.js
// Graph selection <-> URL query (graph-route.js): shareable, indexable, and the unit of back / forward navigation
const test = require('node:test');
const assert = require('node:assert');
const R = require('../graph-route.js');

const known = { heroes: ['AQUS', 'TEMPUS', 'CERBERUS', 'MANUS'], traits: ['Stun', 'Attack increase', 'Effect-Copy'] };
const at = (search = '', hash = '') => ({ search, hash });

test('encodeRoute writes readable query strings; no selection is no query', () => {
    assert.strictEqual(R.encodeRoute({ type: 'none' }), '');
    assert.strictEqual(R.encodeRoute({ type: 'hero', name: 'AQUS' }), '?hero=aqus');
    assert.strictEqual(R.encodeRoute({ type: 'trait', name: 'Attack increase' }), '?trait=attack%20increase');
    assert.strictEqual(R.encodeRoute({ type: 'band', mine: ['AQUS', 'TEMPUS'], theirs: ['CERBERUS'] }),
        '?band=aqus,tempus&vs=cerberus');
    assert.strictEqual(R.encodeRoute({ type: 'band', mine: ['AQUS'], theirs: [] }), '?band=aqus');
});

test('decodeRoute round-trips every route to canonical names', () => {
    [
        { type: 'none' },
        { type: 'hero', name: 'AQUS' },
        { type: 'trait', name: 'Attack increase' },
        { type: 'trait', name: 'Effect-Copy' },
        { type: 'band', mine: ['AQUS', 'TEMPUS'], theirs: ['CERBERUS', 'MANUS'] },
        { type: 'band', mine: ['AQUS'], theirs: [] }
    ].forEach(route => assert.deepStrictEqual(R.decodeRoute(at(R.encodeRoute(route)), known), route));
});

test('decodeRoute matches names case-insensitively and accepts + for spaces', () => {
    assert.deepStrictEqual(R.decodeRoute(at('?hero=AqUs'), known), { type: 'hero', name: 'AQUS' });
    assert.deepStrictEqual(R.decodeRoute(at('?trait=STUN'), known), { type: 'trait', name: 'Stun' });
    assert.deepStrictEqual(R.decodeRoute(at('?trait=attack+increase'), known), { type: 'trait', name: 'Attack increase' });
});

test('tracking parameters are ignored; no query is no selection', () => {
    assert.deepStrictEqual(R.decodeRoute(at(''), known), { type: 'none' });
    assert.deepStrictEqual(R.decodeRoute(at('?utm_source=bgg'), known), { type: 'none' });
    assert.deepStrictEqual(R.decodeRoute(at('?hero=aqus&fbclid=x'), known), { type: 'hero', name: 'AQUS' });
});

test('decodeRoute rejects unknown names and mixed selections', () => {
    ['?hero=nobody', '?trait=flying-pigs', '?band=aqus,nobody', '?band=', '?hero=aqus&trait=stun',
        '?vs=aqus', '?hero=%E0%A4%A'].forEach(search => assert.strictEqual(R.decodeRoute(at(search), known), null, search));
});

test('old #graph links still open their selection (to be rewritten as a query)', () => {
    assert.deepStrictEqual(R.decodeRoute(at('', '#graph/hero/aqus'), known), { type: 'hero', name: 'AQUS' });
    assert.deepStrictEqual(R.decodeRoute(at('', '#graph/trait/attack%20increase'), known), { type: 'trait', name: 'Attack increase' });
    assert.deepStrictEqual(R.decodeRoute(at('', '#graph/band/aqus+tempus/vs/cerberus'), known),
        { type: 'band', mine: ['AQUS', 'TEMPUS'], theirs: ['CERBERUS'] });
    assert.deepStrictEqual(R.decodeRoute(at('', '#graph'), known), { type: 'none' });
    assert.strictEqual(R.decodeRoute(at('', '#graph/hero/nobody'), known), null);
    assert.ok(R.isLegacyRoute('#graph/hero/aqus'));
    assert.ok(R.isLegacyRoute('#graph'));
    assert.ok(!R.isLegacyRoute('#draft'));
    assert.ok(!R.isLegacyRoute('#graphite'));
});

test('a draft hash is not a graph selection', () => {
    assert.deepStrictEqual(R.decodeRoute(at('', '#draft'), known), { type: 'none' });
    assert.deepStrictEqual(R.decodeRoute(at('?hero=aqus', '#draft/standard/1.2'), known), { type: 'hero', name: 'AQUS' });
});

// Page metadata per selection: what search engines index for ?hero= / ?trait= addresses
const data = require('../bestiary_reference_cards.json').bestiary_of_sigillum;
const ctx = { heroes: data.characters, traitDescriptions: data.trait_descriptions };
const BASE = 'https://bos.nraw.eu/';

test('a hero selection gets its own title, description and canonical address', () => {
    data.characters.forEach(h => {
        const meta = R.routeMeta({ type: 'hero', name: h.name }, ctx, BASE);
        const name = h.name.charAt(0) + h.name.slice(1).toLowerCase();
        assert.ok(meta.title.startsWith(`${name} – Bestiary of Sigillum`), meta.title);
        assert.ok(meta.title.length <= 65, `${meta.title} (${meta.title.length})`);
        assert.ok(meta.description.includes(name) && meta.description.includes(h.attribute), meta.description);
        assert.ok(meta.description.length >= 70 && meta.description.length <= 160, `${meta.description} (${meta.description.length})`);
        assert.strictEqual(meta.canonical, `${BASE}?hero=${h.name.toLowerCase()}`);
    });
    const descriptions = data.characters.map(h => R.routeMeta({ type: 'hero', name: h.name }, ctx, BASE).description);
    assert.strictEqual(new Set(descriptions).size, descriptions.length);
});

test('a trait selection is described by its rule or gloss', () => {
    const meta = R.routeMeta({ type: 'trait', name: 'Stun' }, ctx, BASE);
    assert.ok(meta.title.startsWith('Stun – Bestiary of Sigillum'), meta.title);
    assert.ok(meta.description.length <= 160 && meta.description.length >= 40, meta.description);
    assert.strictEqual(meta.canonical, `${BASE}?trait=stun`);
});

test('no selection or a band keeps the page\'s own metadata', () => {
    assert.strictEqual(R.routeMeta({ type: 'none' }, ctx, BASE), null);
    assert.strictEqual(R.routeMeta({ type: 'band', mine: ['AQUS'], theirs: [] }, ctx, BASE), null);
});

// Typing in the search box clears the selection, but is not a history step of its own
test('historyStep: a new selection is a step; typing a search waits for the pick', () => {
    const step = o => R.historyStep({ url: '/?hero=tempus', current: '/?hero=goetium', typing: false, term: '', ...o });
    assert.strictEqual(step({}), 'push');
    assert.strictEqual(step({ current: '/?hero=tempus' }), 'none');
    // Typing: the address keeps the last selection until a result is picked
    assert.strictEqual(step({ url: '/', typing: true, term: 'temp' }), 'defer');
    // The search was abandoned (cleared / Esc): the address catches up without a new step
    assert.strictEqual(step({ url: '/', typing: true, term: '' }), 'replace');
    assert.strictEqual(step({ url: '/?hero=goetium', typing: true, term: '' }), 'none');
});
