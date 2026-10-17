// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const { nodeMatchesSearch } = require('../search.js');

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
