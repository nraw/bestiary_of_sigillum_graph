// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const { nodeMatchesSearch, getSuggestions } = require('../search.js');

const mechanicus = { id: 'hero_26', originalId: 26, name: 'MECHANICUS', type: 'hero' };
const armus = { id: 'hero_2', originalId: 2, name: 'ARMUS', type: 'hero' };
const label = { id: 'label_Melee', name: 'Melee', type: 'label' };

test('matches hero by exact character id', () => {
    assert.strictEqual(nodeMatchesSearch(mechanicus, '26'), true);
    assert.strictEqual(nodeMatchesSearch(armus, '26'), false);
});

test('id match is exact, not substring', () => {
    assert.strictEqual(nodeMatchesSearch(armus, '2'), true);
    assert.strictEqual(nodeMatchesSearch(mechanicus, '2'), false);
});

test('id match tolerates surrounding whitespace and leading #', () => {
    assert.strictEqual(nodeMatchesSearch(mechanicus, ' 26 '), true);
    assert.strictEqual(nodeMatchesSearch(mechanicus, '#26'), true);
});

test('still matches by name, case-insensitively', () => {
    assert.strictEqual(nodeMatchesSearch(mechanicus, 'mecha'), true);
    assert.strictEqual(nodeMatchesSearch(label, 'mel'), true);
    assert.strictEqual(nodeMatchesSearch(label, 'xyz'), false);
});

test('label nodes never match numeric ids', () => {
    assert.strictEqual(nodeMatchesSearch(label, '26'), false);
});

const pool = [
    { id: 'hero_7', originalId: 7, name: 'MALLEUS', type: 'hero' },
    { id: 'hero_8', originalId: 8, name: 'MAGNUS', type: 'hero' },
    { id: 'hero_9', originalId: 9, name: 'ARMUS', type: 'hero' },
    { id: 'label_Mobility', name: 'Mobility', type: 'label' },
    { id: 'label_Melee', name: 'Melee', type: 'label' }
];

test('suggestions rank prefix matches before substring matches', () => {
    const names = getSuggestions(pool, 'ma').map(n => n.name);
    assert.deepStrictEqual(names, ['MAGNUS', 'MALLEUS']);
    const mus = getSuggestions(pool, 'mus').map(n => n.name);
    assert.deepStrictEqual(mus, ['ARMUS']);
});

test('suggestions list heroes before labels at the same rank', () => {
    const names = getSuggestions(pool, 'm').map(n => n.name);
    assert.deepStrictEqual(names, ['MAGNUS', 'MALLEUS', 'Melee', 'Mobility', 'ARMUS']);
});

test('suggestions put an exact id match first and honour the limit', () => {
    assert.strictEqual(getSuggestions(pool, '9')[0].name, 'ARMUS');
    assert.strictEqual(getSuggestions(pool, 'm', 2).length, 2);
    assert.deepStrictEqual(getSuggestions(pool, '   '), []);
});
