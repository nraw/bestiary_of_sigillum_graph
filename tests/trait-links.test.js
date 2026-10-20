// Run with: node --test tests/*.test.js
// Typed hero -> trait links (bestiary_reference_cards.json "trait_links"): each records the role,
// the abilities it comes from and, for conditions, whose state matters.
const test = require('node:test');
const assert = require('node:assert');
const G = require('../graph-logic.js');

const heroes = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
const byName = Object.fromEntries(heroes.map(h => [h.name, h]));

const GIVING = ['inflicts', 'grants', 'gains'];
const CONDITIONS = ['benefits_from', 'hindered_by'];
const ROLES = ['has', ...GIVING, 'places', ...CONDITIONS];
const TERRAIN = ['Mountain', 'Water', 'Forest'];
const SUBJECTS = ['self', 'ally', 'enemy', null];

const abilities = h => [h.core_ability, ...h.support_abilities];
const links = (name, label, role) =>
    byName[name].trait_links.filter(l => l.label === label && (!role || l.role === role));
const heroesWith = (label, role, on) => heroes
    .filter(h => h.trait_links.some(l => l.label === label && l.role === role && (on === undefined || l.on === on)))
    .map(h => h.name).sort();

test('every hero has trait links whose labels are exactly its labels list', () => {
    heroes.forEach(h => {
        assert.ok(Array.isArray(h.trait_links) && h.trait_links.length, h.name);
        assert.deepStrictEqual([...new Set(h.trait_links.map(l => l.label))], h.labels, h.name);
    });
});

test('links use known roles, real ability sources and a subject only for conditions', () => {
    heroes.forEach(h => {
        const names = abilities(h).map(a => a.name);
        h.trait_links.forEach(l => {
            const where = `${h.name} / ${l.label}`;
            assert.ok(ROLES.includes(l.role), `${where}: role ${l.role}`);
            assert.ok(Array.isArray(l.sources), where);
            l.sources.forEach(s => assert.ok(names.includes(s), `${where}: unknown source ${s}`));
            if (CONDITIONS.includes(l.role) || l.role === 'places') assert.ok(SUBJECTS.includes(l.on), `${where}: on ${l.on}`);
            else if (l.role === 'inflicts' && 'on' in l) assert.ok(['self', 'ally'].includes(l.on), `${where}: inflicts defaults to enemies`);
            else assert.ok(!('on' in l), `${where}: "on" only for conditions, places and self-inflicted harm`);
        });
    });
});

test('no duplicate (label, role, on) link per hero', () => {
    heroes.forEach(h => {
        const keys = h.trait_links.map(l => `${l.label}|${l.role}|${l.on}`);
        assert.strictEqual(new Set(keys).size, keys.length, h.name);
    });
});

test('giving roles only point at official effects, cooldown manipulation or deliberate injuring', () => {
    heroes.forEach(h => h.trait_links.filter(l => GIVING.includes(l.role)).forEach(l =>
        assert.ok(G.getLabelCategory(l.label) === 'Effect' || l.label === 'Cooldown-Manipulation'
            || (l.label === 'Injury' && l.role === 'inflicts' && l.on), `${h.name} ${l.role} ${l.label}`)));
});

test('places links move characters onto terrain', () => {
    heroes.forEach(h => h.trait_links.filter(l => l.role === 'places').forEach(l =>
        assert.ok(TERRAIN.includes(l.label), `${h.name} places ${l.label}`)));
    assert.deepStrictEqual(links('MAGNUS', 'Mountain'), [{ label: 'Mountain', role: 'places', sources: ['DARKSTONE'], on: null }]);
    assert.deepStrictEqual(links('TOXICUM', 'Water'), [{ label: 'Water', role: 'places', sources: ['VIAL OF VENOM'], on: 'enemy' }]);
    assert.deepStrictEqual(links('ARBORUS', 'Forest').map(l => [l.role, l.sources, l.on]),
        [['benefits_from', ['ROOTS'], 'enemy'], ['places', ['CALL OF THE WOODS'], null]]);
});

test('only card-stated self-harm counts as inflicting Injury (every attack injures enemies)', () => {
    assert.deepStrictEqual(heroesWith('Injury', 'inflicts'), ['GOETIUM', 'SATURN']);
    assert.strictEqual(links('GOETIUM', 'Injury', 'inflicts')[0].on, 'ally');   // Ritual of Vitality
    assert.strictEqual(links('SATURN', 'Injury', 'inflicts')[0].on, 'self');    // Gravity Link
});

test('every official effect a support ability applies is linked to that ability', () => {
    const effects = ['Attack increase', 'Attack decrease', 'Defense increase', 'Defense decrease',
        'Control increase', 'Control decrease', 'Swiftness', 'Slowness', 'Flying', 'Resistance',
        'Vampirism', 'Stun', 'Silence', 'Poison'];
    heroes.forEach(h => h.support_abilities.forEach(a => effects.forEach(e => {
        if (!a.effect.toLowerCase().includes(e.toLowerCase())) return;
        const linked = h.trait_links.some(l => l.label === e && GIVING.includes(l.role) && l.sources.includes(a.name));
        assert.ok(linked, `${h.name} / ${a.name} applies ${e} but has no giving link`);
    })));
});

test('target wording decides inflicts / grants / gains', () => {
    assert.ok(links('ARMUS', 'Stun', 'inflicts').length);               // Charge: any enemy
    assert.ok(links('ARMUS', 'Defense increase', 'grants').length);     // Armus and all allies
    assert.ok(links('SAXUM', 'Defense increase', 'gains').length);      // Stoneskin: Saxum
    assert.ok(links('FIDEA', 'Flying', 'grants').length);               // Fidea or any ally
    assert.ok(links('ERESIDA', 'Stun', 'inflicts').length);             // Web: enemy gets Stun
    assert.ok(links('ERESIDA', 'Swiftness', 'grants').length);          // Web: ally gains Swiftness
});

test('status conditions point at the effect node instead of a vague dependency trait', () => {
    assert.deepStrictEqual(heroesWith('Stun', 'benefits_from', 'enemy'), ['ERESIDA', 'ILLESEBRA']);
    assert.deepStrictEqual(heroesWith('Slowness', 'benefits_from', 'enemy'), ['CABALLUS']);
    assert.deepStrictEqual(heroesWith('Poison', 'benefits_from', 'enemy'), ['TOXICUM']);
    assert.deepStrictEqual(heroesWith('Defense increase', 'benefits_from', 'self'), ['SAXUM']);
    assert.deepStrictEqual(heroesWith('Swiftness', 'benefits_from', 'self'), ['EQUITA']);
    assert.deepStrictEqual(heroesWith('Slowness', 'hindered_by', 'self'), ['EQUITA']);
    assert.deepStrictEqual(heroesWith('Negative effect', 'benefits_from', 'enemy'), ['CARNIFEX', 'FRIGUS']);
    assert.deepStrictEqual(heroesWith('Positive effect', 'benefits_from'), ['AQUS', 'IGNIFER']);
});

test('Injury conditions distinguish whose Injuries matter', () => {
    assert.deepStrictEqual(heroesWith('Injury', 'benefits_from', 'enemy'),
        ['CERBERUS', 'CLAMORIS', 'MORTUM', 'TENEBRIS', 'TOXICUM']);
    assert.deepStrictEqual(heroesWith('Injury', 'benefits_from', 'self'),
        ['IRATUS', 'MAGNUS', 'MORTUM', 'SATURN', 'VINCTUM']);
    assert.deepStrictEqual(heroesWith('Injury', 'hindered_by', 'self'), ['MECHANICUS', 'VINCTUM']);
});

test('terrain nodes carry both benefits and hindrances', () => {
    assert.deepStrictEqual(heroesWith('Mountain', 'benefits_from'), ['ARCHITECTUS', 'BALLISTARIUS', 'SAXUM']);
    assert.deepStrictEqual(heroesWith('Water', 'benefits_from'), ['AQUS', 'FRIGUS']);
    // Shackling Cold recharges faster on a target in Water, Spell of Frost when Frigus stands in Water
    assert.deepStrictEqual(links('FRIGUS', 'Water').map(l => [l.on, l.sources]),
        [['enemy', ['SHACKLING COLD']], ['self', ['SPELL OF FROST']]]);
    assert.deepStrictEqual(heroesWith('Forest', 'benefits_from'), ['ARBORUS', 'MANUS']);
    ['Mountain', 'Forest', 'Water'].forEach(t =>
        assert.deepStrictEqual(heroesWith(t, 'hindered_by', 'self'), ['CERBERUS'], t));
    assert.deepStrictEqual(heroesWith('Water', 'hindered_by', 'enemy'), ['FERRARIUS']);
    ['Mountain', 'Water', 'Forest'].forEach(t => assert.strictEqual(G.getLabelCategory(t), 'Structure', t));
});

test('cooldown links: manipulators give it, Tempus and Brewus feed on enemy cooldowns', () => {
    assert.deepStrictEqual(heroesWith('Cooldown-Manipulation', 'inflicts'), ['BREWUS', 'EQUITA', 'TOXICUM']);
    assert.deepStrictEqual(heroesWith('Cooldown-Manipulation', 'grants'), ['TEMPUS']);
    assert.deepStrictEqual(heroesWith('Abilities on cooldown', 'benefits_from', 'enemy'), ['BREWUS', 'TEMPUS']);
    // Magnetic Hand scales with enemies' *available* abilities, so enemy cooldowns work against Magnus
    assert.deepStrictEqual(heroesWith('Abilities on cooldown', 'hindered_by', 'enemy'), ['MAGNUS']);
});

test('traits replaced by roles or condition nodes are gone', () => {
    ['Status-Dependent', 'Damage-Dependent', 'Defense-Dependent', 'Speed-Dependent', 'Effect-Dependent',
     'Self-Damage-Dependent', 'Wound-Synergy', 'Scaling-AoE', 'Self-Buff', 'Debuffer', 'Terrain-Restricted',
     'Mountain-Synergy', 'Water-Synergy', 'Forest-Synergy', 'Water-Dependent', 'Forest-Dependent',
     'Berserker', 'Cooldown-Reduction', 'Ability-Count-Dependent', 'Anti-Large',
     // merged into an existing trait, or redundant / inconsistently applied
     'Anti-Group', 'Positioning', 'Counter-Magic', 'Terrain-Control', 'Line-Attack', 'Scaling-Cooldown',
     'Structure-Counter', 'Wound'
    ].forEach(label => assert.ok(!heroes.some(h => h.labels.includes(label)), label));
});

test('ability-level placement: chips can be grouped under the ability that causes them', () => {
    assert.deepStrictEqual(links('ARMUS', 'Stun')[0].sources, ['CHARGE']);
    assert.deepStrictEqual(links('MORTUM', 'Injury').map(l => [l.on, l.sources]),
        [['enemy', ['BLOODLUST']], ['self', ['VAMPIRIC DRAIN']]]);
});

test('every trait comes from an ability on the card (no invented card-level archetypes)', () => {
    heroes.forEach(h => h.trait_links.forEach(l =>
        assert.ok(l.sources.length, `${h.name} / ${l.label}: no source ability`)));
    ['Support', 'Tank', 'Utility', 'Assassin', 'Mobile-Striker']
        .forEach(label => assert.ok(!heroes.some(h => h.labels.includes(label)), label));
});

test('condition traits are named after the condition, not "-Dependent"', () => {
    heroes.forEach(h => h.labels.forEach(l => assert.ok(!/-Dependent$/.test(l), `${h.name}: ${l}`)));
});

test('positional conditions say whose position matters', () => {
    assert.deepStrictEqual(heroesWith('Isolated enemies', 'benefits_from', 'enemy'), ['GOETIUM', 'MESSUM', 'TENEBRIS']);
    assert.deepStrictEqual(heroesWith('Clustered enemies', 'benefits_from', 'enemy'), ['LIGNUM']);
    assert.deepStrictEqual(heroesWith('Adjacent allies', 'benefits_from', 'ally'), ['MANUS']);
    assert.deepStrictEqual(heroesWith('Adjacent enemies', 'benefits_from', 'enemy'), ['IRATUS', 'REDUX']);
    assert.deepStrictEqual(heroesWith('Tower control', 'benefits_from', 'ally'), ['ARCHITECTUS', 'CORNIBUS', 'MALLEUS']);
    // Siege Tank hits enemies in the control areas of Towers the opponent holds
    assert.deepStrictEqual(links('MECHANICUS', 'Tower control'),
        [{ label: 'Tower control', role: 'benefits_from', sources: ['SIEGE TANK'], on: 'enemy' }]);
    assert.deepStrictEqual(heroesWith('High-vitality enemies', 'benefits_from', 'enemy'), ['FIDEA', 'SATURN']);
    assert.deepStrictEqual(heroesWith('Big enemies', 'benefits_from', 'enemy'), ['CATAPULTUS']);
    assert.strictEqual(G.getLabelCategory('Tower control'), 'Structure');
});

// Rulebook p. 4: "According to the Core Ability range (attack action), there are Melee and Ranged characters"
const MELEE = ['AQUS', 'ARMUS', 'BREWUS', 'CARNIFEX', 'CERBERUS', 'EQUITA', 'ERESIDA', 'FERRARIUS', 'IRATUS',
    'MAGNUS', 'MALLEUS', 'MANUS', 'MORTUM', 'SATURN', 'SAXUM', 'TEMPUS', 'TENEBRIS', 'VINCTUM'];

test('every hero is exactly one of Melee or Ranged, from its core attack', () => {
    heroes.forEach(h => {
        const kind = MELEE.includes(h.name) ? 'Melee' : 'Ranged';
        assert.ok(h.labels.includes(kind), `${h.name} should be ${kind}`);
        assert.ok(!h.labels.includes(kind === 'Melee' ? 'Ranged' : 'Melee'), `${h.name} is both`);
        assert.deepStrictEqual(links(h.name, kind), [{ label: kind, role: 'has', sources: [h.core_ability.name] }], h.name);
    });
    assert.deepStrictEqual(heroesWith('Ranged', 'has').filter(n => ['TOXICUM', 'FRIGUS', 'MESSUM', 'IGNIFER'].includes(n)),
        ['FRIGUS', 'IGNIFER', 'MESSUM', 'TOXICUM']); // the rulebook's "band of Ranged characters" + Ignifer
});

test('AoE marks every ability that hits all enemies in an area, and only those', () => {
    const hitsAll = a => /^(target )?all\b/i.test(a.target) && /enem/i.test(a.target);
    heroes.forEach(h => {
        const sources = abilities(h).filter(hitsAll).map(a => a.name);
        const aoe = links(h.name, 'AoE');
        if (!sources.length) assert.deepStrictEqual(aoe, [], `${h.name} has no all-enemies ability`);
        else assert.deepStrictEqual(aoe, [{ label: 'AoE', role: 'has', sources }], h.name);
    });
    ['BREWUS', 'MAGNUS', 'MECHANICUS'].forEach(n => assert.ok(byName[n].labels.includes('AoE'), n));
});

test('Mobility covers heroes that give themselves Swiftness', () => {
    assert.deepStrictEqual(links('EQUITA', 'Mobility'), [{ label: 'Mobility', role: 'has', sources: ['TWILIGHT MOMENTUM'] }]);
    assert.ok(byName.MECHANICUS.labels.includes('Mobility'));
});
