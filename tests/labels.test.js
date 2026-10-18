// Run with: node --test tests/*.test.js
// Curated trait labels derived from card cooldowns and features (see bestiary_reference_cards.json)
const test = require('node:test');
const assert = require('node:assert');
const G = require('../graph-logic.js');

const heroes = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
const withLabel = label => heroes.filter(h => h.labels.includes(label)).map(h => h.name).sort();

test('terrain synergies link every hero whose cooldown or card favours that terrain', () => {
    assert.deepStrictEqual(withLabel('Mountain-Synergy'), ['ARCHITECTUS', 'BALLISTARIUS', 'MAGNUS', 'SAXUM']);
    assert.deepStrictEqual(withLabel('Water-Synergy'), ['AQUS', 'FRIGUS', 'TOXICUM']);
    assert.deepStrictEqual(withLabel('Forest-Synergy'), ['ARBORUS', 'MANUS']);
});

test('heroes whose cooldowns shorten with their own Wounds share Wound-Synergy', () => {
    assert.deepStrictEqual(withLabel('Wound-Synergy'), ['IRATUS', 'MORTUM', 'VINCTUM']);
});

test('heroes whose cooldown grows per target affected share Scaling-Cooldown', () => {
    assert.deepStrictEqual(withLabel('Scaling-Cooldown'),
        ['BREWUS', 'CABALLUS', 'CLAMORIS', 'MAGNUS', 'MALLEUS', 'TOXICUM']);
});

test('heroes whose features say they affect cooldowns share Cooldown-Manipulation', () => {
    assert.deepStrictEqual(withLabel('Cooldown-Manipulation'), ['BREWUS', 'EQUITA', 'TEMPUS', 'TOXICUM']);
});

test('merged single-hero labels are gone', () => {
    ['Water-Dependent', 'Forest-Dependent', 'Berserker', 'Cooldown-Reduction'].forEach(label =>
        assert.deepStrictEqual(withLabel(label), [], label));
});

test('card features are reflected in the matching labels', () => {
    const implied = {
        'Hits multiple targets.': 'AoE',
        'High mobility.': 'Mobility',
        'Heals wounds.': 'Healing',
        'Repositions enemies.': 'Displacement',
        'Repositions units.': 'Displacement',
        'Repositions allies.': 'Displacement',
        'Repositions characters.': 'Displacement'
    };
    heroes.forEach(h => h.features.forEach(f => {
        if (implied[f]) assert.ok(h.labels.includes(implied[f]), `${h.name}: "${f}" but no ${implied[f]}`);
    }));
});

test('no hero lists a label twice', () => {
    heroes.forEach(h => assert.strictEqual(new Set(h.labels).size, h.labels.length, h.name));
});

test('terrain synergies sit in the Structure & terrain legend group', () => {
    ['Mountain-Synergy', 'Water-Synergy', 'Forest-Synergy'].forEach(label =>
        assert.strictEqual(G.getLabelCategory(label), 'Structure', label));
});
