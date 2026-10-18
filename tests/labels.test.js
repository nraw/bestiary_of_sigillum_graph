// Run with: node --test tests/*.test.js
// Curated trait labels stay consistent with the card features (typed links: trait-links.test.js)
const test = require('node:test');
const assert = require('node:assert');

const heroes = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;

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
