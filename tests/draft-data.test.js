// Run with: node --test tests/*.test.js
// Data used by the draft assistant: hero attributes and curated recommended bands
const test = require('node:test');
const assert = require('node:assert');

const data = require('../bestiary_reference_cards.json').bestiary_of_sigillum;
const heroes = data.characters;
const names = new Set(heroes.map(h => h.name));
const ATTRIBUTES = ['Strength', 'Agility', 'Intelligence'];

test('every hero has an attribute, 12 of each', () => {
    heroes.forEach(h => assert.ok(ATTRIBUTES.includes(h.attribute), h.name));
    ATTRIBUTES.forEach(a => assert.strictEqual(heroes.filter(h => h.attribute === a).length, 12, a));
});

test('recommended bands are 3 distinct, existing heroes with a source and note', () => {
    const bands = data.recommended_bands;
    assert.ok(Array.isArray(bands) && bands.length === 13);
    bands.forEach(b => {
        const label = b.heroes.join(', ');
        assert.strictEqual(b.heroes.length, 3, label);
        assert.strictEqual(new Set(b.heroes).size, 3, label);
        b.heroes.forEach(n => assert.ok(names.has(n), `${label}: unknown ${n}`));
        if (b.fourth !== undefined) {
            assert.ok(names.has(b.fourth) && !b.heroes.includes(b.fourth), label);
        }
        assert.ok(['rulebook', 'community', 'guide'].includes(b.source), label);
        assert.ok(typeof b.note === 'string' && b.note.length, label);
    });
});

test('no recommended band is listed twice', () => {
    const keys = data.recommended_bands.map(b => [...b.heroes].sort().join('|'));
    assert.strictEqual(new Set(keys).size, keys.length);
});
