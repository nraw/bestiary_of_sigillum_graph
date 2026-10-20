// Run with: node --test tests/*.test.js
// Every trait node has a description (bestiary_reference_cards.json "trait_descriptions"):
// official effects quote their rule and name its source, other traits get a short plain-language gloss
const test = require('node:test');
const assert = require('node:assert');
const G = require('../graph-logic.js');

const data = require('../bestiary_reference_cards.json').bestiary_of_sigillum;
const descriptions = data.trait_descriptions;
const labels = new Set(data.characters.flatMap(h => h.labels));
const SOURCES = ['Rulebook', 'Character Reference V2'];

test('every trait label has a non-empty description', () => {
    labels.forEach(label => {
        const d = descriptions[label];
        assert.ok(d, `${label} has no description`);
        assert.strictEqual(typeof d.text, 'string', label);
        assert.ok(d.text.trim().length > 10, `${label} description is too short`);
    });
});

test('no descriptions for labels that no hero uses', () => {
    Object.keys(descriptions).forEach(label => assert.ok(labels.has(label), `stale description: ${label}`));
});

test('official effects cite the source of their rule; other traits do not', () => {
    labels.forEach(label => {
        const { source } = descriptions[label];
        if (G.getLabelCategory(label) === 'Effect') assert.ok(SOURCES.includes(source), `${label}: source ${source}`);
        else assert.strictEqual(source, undefined, `${label} is not an official effect`);
    });
});

test('official effect rules quote the rulebook wording', () => {
    assert.match(descriptions.Stun.text, /cannot perform a maneuver or use any Abilities/);
    assert.match(descriptions.Resistance.text, /cannot be targeted by an enemy's Support Abilities/);
    assert.match(descriptions.Poison.text, /1 round longer for each Poison marker/);
});

test('other trait descriptions stay short enough for a tooltip', () => {
    labels.forEach(label => {
        if (G.getLabelCategory(label) !== 'Effect') {
            assert.ok(descriptions[label].text.length <= 200, `${label}: ${descriptions[label].text.length} chars`);
        }
    });
});
