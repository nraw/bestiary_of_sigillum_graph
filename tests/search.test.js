// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const { nodeMatchesSearch, getSuggestions, poolMatches, poolSuggestions, poolHasPills } = require('../search.js');

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

// Draft pool: heroes are found by name, card id or any of their terms (attribute, size, range, roles, traits)
const entries = [
    { name: 'MAGNUS', display: 'Magnus', id: 35, terms: [{ text: 'Intelligence', kind: 'attribute' }, { text: 'Supporter', kind: 'role' }, { text: 'Stun', kind: 'trait' }] },
    { name: 'MALLEUS', display: 'Malleus', id: 19, terms: [{ text: 'Strength', kind: 'attribute' }, { text: 'Controller', kind: 'role' }, { text: 'Stun', kind: 'trait' }, { text: 'Melee', kind: 'trait' }] },
    { name: 'ARMUS', display: 'Armus', id: 2, terms: [{ text: 'Strength', kind: 'attribute' }, { text: 'Melee', kind: 'trait' }, { text: 'Armour', kind: 'trait' }] }
];

test('poolMatches: name, exact card id or a term, case-insensitively; empty matches all', () => {
    assert.strictEqual(poolMatches(entries[0], 'magn'), true);
    assert.strictEqual(poolMatches(entries[0], '#35'), true);
    assert.strictEqual(poolMatches(entries[0], '3'), false, 'id is exact');
    assert.strictEqual(poolMatches(entries[1], 'stun'), true);
    assert.strictEqual(poolMatches(entries[2], 'stun'), false);
    assert.strictEqual(poolMatches(entries[2], '  '), true);
});

test('poolSuggestions: heroes, then the matching terms with how many shown heroes have them', () => {
    const s = poolSuggestions(entries, 'm');
    assert.deepStrictEqual(s.map(x => [x.type, x.label]), [
        ['hero', 'Magnus'], ['hero', 'Malleus'], ['term', 'Melee'], ['hero', 'Armus'], ['term', 'Armour']]);
    const melee = s.find(x => x.label === 'Melee');
    assert.deepStrictEqual([melee.kind, melee.count, melee.heroes], ['trait', 2, ['MALLEUS', 'ARMUS']]);
    assert.strictEqual(s[0].id, 35);
    assert.deepStrictEqual(poolSuggestions(entries, 'stun').map(x => [x.label, x.count]), [['Stun', 2]]);
});

test('poolSuggestions: an exact id first, a limit, and nothing for a blank term', () => {
    assert.deepStrictEqual(poolSuggestions(entries, '19').map(x => x.label), ['Malleus']);
    assert.strictEqual(poolSuggestions(entries, 'm', 2).length, 2);
    assert.deepStrictEqual(poolSuggestions(entries, ' '), []);
});

test('poolHasPills: a hero needs every pill as an exact term (case-insensitive); no pills keep everyone', () => {
    assert.strictEqual(poolHasPills(entries[1], ['Stun', 'melee']), true);
    assert.strictEqual(poolHasPills(entries[0], ['Stun', 'Melee']), false);
    assert.strictEqual(poolHasPills(entries[2], ['Arm']), false, 'exact, not a substring');
    assert.strictEqual(poolHasPills(entries[2], []), true);
});

test('poolSuggestions: terms already chosen as pills are not offered again', () => {
    assert.deepStrictEqual(poolSuggestions(entries, 'm', 8, { exclude: ['melee'] }).map(x => x.label), ['Magnus', 'Malleus', 'Armus', 'Armour']);
});
