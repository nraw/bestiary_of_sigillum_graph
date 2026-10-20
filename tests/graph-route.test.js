// Run with: node --test tests/*.test.js
// Graph selection <-> URL hash (graph-route.js): shareable, and the unit of back / forward navigation
const test = require('node:test');
const assert = require('node:assert');
const R = require('../graph-route.js');

const known = { heroes: ['AQUS', 'TEMPUS', 'CERBERUS', 'MANUS'], traits: ['Stun', 'Attack increase', 'Effect-Copy'] };

test('encodeRoute writes readable hashes', () => {
    assert.strictEqual(R.encodeRoute({ type: 'none' }), '#graph');
    assert.strictEqual(R.encodeRoute({ type: 'hero', name: 'AQUS' }), '#graph/hero/aqus');
    assert.strictEqual(R.encodeRoute({ type: 'trait', name: 'Attack increase' }), '#graph/trait/attack%20increase');
    assert.strictEqual(R.encodeRoute({ type: 'band', mine: ['AQUS', 'TEMPUS'], theirs: ['CERBERUS'] }),
        '#graph/band/aqus+tempus/vs/cerberus');
    assert.strictEqual(R.encodeRoute({ type: 'band', mine: ['AQUS'], theirs: [] }), '#graph/band/aqus');
});

test('decodeRoute round-trips every route to canonical names', () => {
    [
        { type: 'none' },
        { type: 'hero', name: 'AQUS' },
        { type: 'trait', name: 'Attack increase' },
        { type: 'trait', name: 'Effect-Copy' },
        { type: 'band', mine: ['AQUS', 'TEMPUS'], theirs: ['CERBERUS', 'MANUS'] },
        { type: 'band', mine: ['AQUS'], theirs: [] }
    ].forEach(route => assert.deepStrictEqual(R.decodeRoute(R.encodeRoute(route), known), route));
});

test('decodeRoute matches names case-insensitively', () => {
    assert.deepStrictEqual(R.decodeRoute('#graph/hero/AqUs', known), { type: 'hero', name: 'AQUS' });
    assert.deepStrictEqual(R.decodeRoute('#graph/trait/STUN', known), { type: 'trait', name: 'Stun' });
});

test('decodeRoute treats the bare graph and an empty hash as no selection', () => {
    assert.deepStrictEqual(R.decodeRoute('#graph', known), { type: 'none' });
    assert.deepStrictEqual(R.decodeRoute('', known), { type: 'none' });
});

test('decodeRoute rejects other hashes and unknown names', () => {
    ['#draft', '#draft/standard/1.2', '#graph/hero/nobody', '#graph/trait/flying-pigs',
        '#graph/band/aqus+nobody', '#graph/band/', '#graph/oops/aqus', '#graph/hero/%E0%A4%A']
        .forEach(hash => assert.strictEqual(R.decodeRoute(hash, known), null, hash));
});

test('isGraphRoute tells graph hashes from the draft tab\'s', () => {
    assert.ok(R.isGraphRoute('#graph/hero/aqus'));
    assert.ok(R.isGraphRoute('#graph'));
    assert.ok(!R.isGraphRoute('#draft'));
    assert.ok(!R.isGraphRoute('#graphite'));
});
