// Run with: node --test tests/*.test.js
// Synergies deduced from typed trait links (synergy.js)
const test = require('node:test');
const assert = require('node:assert');
const S = require('../synergy.js');

const heroes = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
const relations = S.computeSynergies(heroes);
const forHero = name => S.heroSynergies(name, relations);
const names = list => [...new Set(list.map(r => r.hero))].sort();
const helpedOn = (name, label) => names(forHero(name).helpedBy.filter(r => r.label === label));

test('direct partners: a teammate supplies exactly what the hero needs', () => {
    assert.deepStrictEqual(helpedOn('ILLESEBRA', 'Stun'),
        ['ARMUS', 'BREWUS', 'CATAPULTUS', 'ERESIDA', 'FERRARIUS', 'MALLEUS', 'SATURN', 'SAXUM', 'VINCTUM']);
    assert.deepStrictEqual(helpedOn('SAXUM', 'Defense increase'), ['ARBORUS', 'ARMUS', 'MANUS']);
    assert.deepStrictEqual(helpedOn('EQUITA', 'Swiftness'), ['CLAMORIS', 'ERESIDA', 'FIDEA', 'IGNIFER', 'TEMPUS']);
    assert.deepStrictEqual(helpedOn('CABALLUS', 'Slowness'), ['FRIGUS']);
    assert.deepStrictEqual(helpedOn('TOXICUM', 'Poison'), ['EQUITA']);
});

test('partners are symmetric: the supplier sees whom it helps', () => {
    const helps = forHero('ARMUS').helps;
    assert.deepStrictEqual(names(helps.filter(r => r.label === 'Stun')), ['ERESIDA', 'ILLESEBRA']);
    assert.deepStrictEqual(names(helps.filter(r => r.label === 'Defense increase')), ['SAXUM']);
});

test('bridged rules: cooldown manipulation feeds enemy cooldowns, Control increase feeds tower control', () => {
    assert.deepStrictEqual(helpedOn('TEMPUS', 'Abilities on cooldown'), ['BREWUS', 'EQUITA', 'TOXICUM']);
    assert.deepStrictEqual(helpedOn('BREWUS', 'Abilities on cooldown'), ['EQUITA', 'TOXICUM']);
    assert.deepStrictEqual(helpedOn('ARCHITECTUS', 'Tower control'), ['CATAPULTUS', 'CORNIBUS', 'MALLEUS']);
    const tempus = forHero('TEMPUS').helpedBy.find(r => r.hero === 'BREWUS');
    assert.strictEqual(tempus.rule, 'cooldowns');
    assert.strictEqual(tempus.supply.label, 'Cooldown-Manipulation');
});

test('Tempus shortening allied cooldowns does not feed enemy-cooldown heroes', () => {
    assert.ok(!forHero('BREWUS').helpedBy.some(r => r.hero === 'TEMPUS'));
});

test('deliberate wounding feeds heroes that benefit from their own Wounds', () => {
    ['IRATUS', 'MORTUM', 'VINCTUM', 'MAGNUS', 'SATURN'].forEach(name =>
        assert.deepStrictEqual(helpedOn(name, 'Wound'), ['GOETIUM'], name));
});

test('terrain placement feeds terrain needs', () => {
    assert.deepStrictEqual(helpedOn('SAXUM', 'Mountain'), ['MAGNUS']);
    assert.deepStrictEqual(helpedOn('BALLISTARIUS', 'Mountain'), ['MAGNUS']);
    assert.deepStrictEqual(helpedOn('ARCHITECTUS', 'Mountain'), ['MAGNUS']);
    assert.deepStrictEqual(helpedOn('MANUS', 'Forest'), ['ARBORUS']);
    assert.deepStrictEqual(helpedOn('FRIGUS', 'Water'), ['TOXICUM']);
    assert.deepStrictEqual(helpedOn('AQUS', 'Water'), []); // Aqus itself must stand in Water; Toxicum only moves enemies
});

test('self-combos: one ability sets up another of the same hero', () => {
    const combos = name => forHero(name).selfCombos.map(c => `${c.supply.sources.join('/')}>${c.need.sources.join('/')}`);
    assert.deepStrictEqual(combos('ILLESEBRA'), ['TEMPTATION>HYPNOSIS']);
    assert.deepStrictEqual(combos('SAXUM'), ['STONESKIN>ROCK BLAST']);
    assert.deepStrictEqual(combos('SATURN'), ['GRAVITY LINK>ASTEROID BELT']);
    assert.deepStrictEqual(combos('ARBORUS'), ['CALL OF THE WOODS>ROOTS']);
    assert.deepStrictEqual(combos('CORNIBUS'), ['GARGOYLE>FLIGHT']);
    assert.deepStrictEqual(combos('MALLEUS'), []); // Ditch's condition and effect are the same ability
    ['ERESIDA', 'EQUITA', 'CABALLUS', 'TOXICUM', 'BREWUS'].forEach(n => assert.ok(forHero(n).selfCombos.length, n));
});

test('team conflicts: a teammate supplies what hinders the hero', () => {
    const hurtBy = name => names(forHero(name).conflicts.filter(c => c.direction === 'hurt-by'));
    // any ally carrying Swiftness raises Resurrection's cooldown, including self-buffers
    assert.deepStrictEqual(hurtBy('FIDEA'), ['CLAMORIS', 'EQUITA', 'ERESIDA', 'IGNIFER', 'MECHANICUS', 'TEMPUS']);
    assert.deepStrictEqual(hurtBy('MAGNUS'), ['BREWUS', 'EQUITA', 'TOXICUM']);
    assert.deepStrictEqual(hurtBy('FERRARIUS'), ['TOXICUM']);
    assert.deepStrictEqual(hurtBy('VINCTUM'), ['GOETIUM']);
    assert.deepStrictEqual(hurtBy('MECHANICUS'), ['GOETIUM']);
    assert.deepStrictEqual(hurtBy('CERBERUS'), ['ARBORUS', 'MAGNUS']);
    assert.deepStrictEqual(hurtBy('EQUITA'), []);
    // and the other side sees it too
    assert.deepStrictEqual(names(forHero('TOXICUM').conflicts.filter(c => c.direction === 'hurts')), ['FERRARIUS', 'MAGNUS']);
});

test('counters: an opponent inflicts what hinders you, or the opposite of what you rely on', () => {
    const counteredBy = name => names(forHero(name).counteredBy);
    assert.deepStrictEqual(counteredBy('EQUITA'), ['CABALLUS', 'FRIGUS']);
    assert.deepStrictEqual(counteredBy('SAXUM'), ['MESSUM']);
    assert.deepStrictEqual(counteredBy('CERBERUS'), ['ARBORUS', 'MAGNUS', 'TOXICUM']);
    assert.deepStrictEqual(names(forHero('MESSUM').counters), ['SAXUM']);
    const equita = forHero('EQUITA').counteredBy.find(r => r.hero === 'CABALLUS');
    assert.deepStrictEqual(equita.reasons.map(r => r.rule).sort(), ['hindrance', 'opposite']);
});

test('broad needs report the pool size instead of partners', () => {
    const broad = name => forHero(name).broad.map(b => [b.label, b.count]);
    assert.deepStrictEqual(broad('CARNIFEX'), [['Negative effect', 21]]);
    assert.deepStrictEqual(broad('AQUS'), [['Positive effect', 18]]);
    assert.deepStrictEqual(forHero('CARNIFEX').helpedBy, []);
});

test('flags: heroes who grow from their own Wounds, and those slowed by them', () => {
    const flagged = flag => heroes.map(h => h.name).filter(n => forHero(n).flags[flag]).sort();
    assert.deepStrictEqual(flagged('dontFeed'), ['IRATUS', 'MAGNUS', 'MORTUM', 'SATURN', 'VINCTUM']);
    assert.deepStrictEqual(flagged('punishWithDamage'), ['MECHANICUS', 'VINCTUM']);
});

test('no hero is its own partner, conflict or counter', () => {
    heroes.forEach(h => {
        const s = forHero(h.name);
        [...s.helpedBy, ...s.helps, ...s.conflicts, ...s.counteredBy, ...s.counters]
            .forEach(r => assert.notStrictEqual(r.hero, h.name, h.name));
    });
});

const arcs = S.synergyArcs(relations);
const arcBetween = (a, b, category) => arcs.find(x => x.category === category
    && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
// Arrow flags read from `from`'s point of view: does the help/harm flow from -> to?
const flows = (arc, from) => (arc.a === from ? { out: arc.aToB, in: arc.bToA } : { out: arc.bToA, in: arc.aToB });

test('synergyArcs: one arc per hero pair and category, 67 in all', () => {
    assert.strictEqual(arcs.length, 67);
    assert.deepStrictEqual(Object.fromEntries(['partner', 'conflict', 'counter']
        .map(c => [c, arcs.filter(x => x.category === c).length])), { partner: 47, conflict: 14, counter: 6 });
    assert.ok(arcs.every(x => x.a < x.b), 'pair ends are sorted so arcs are stable');
});

test('synergyArcs: arrows point from the hero who helps or hurts', () => {
    assert.deepStrictEqual(flows(arcBetween('ARMUS', 'ILLESEBRA', 'partner'), 'ARMUS'), { out: true, in: false });
    assert.deepStrictEqual(flows(arcBetween('ERESIDA', 'ILLESEBRA', 'partner'), 'ERESIDA'), { out: true, in: true });
    assert.deepStrictEqual(flows(arcBetween('CABALLUS', 'EQUITA', 'counter'), 'CABALLUS'), { out: true, in: false });
    // Fidea and Equita are both partners (Fidea grants Swiftness) and a conflict (Equita's Swiftness taxes Resurrection)
    assert.deepStrictEqual(flows(arcBetween('EQUITA', 'FIDEA', 'partner'), 'FIDEA'), { out: true, in: false });
    assert.deepStrictEqual(flows(arcBetween('EQUITA', 'FIDEA', 'conflict'), 'EQUITA'), { out: true, in: false });
});

test('synergyArcs can focus on one hero', () => {
    const focused = S.synergyArcs(relations, 'GOETIUM');
    assert.ok(focused.every(x => x.a === 'GOETIUM' || x.b === 'GOETIUM'));
    assert.deepStrictEqual(focused.map(x => `${x.category}:${x.a === 'GOETIUM' ? x.b : x.a}`).sort(), [
        'conflict:MECHANICUS', 'conflict:VINCTUM',
        'partner:IRATUS', 'partner:MAGNUS', 'partner:MORTUM', 'partner:SATURN', 'partner:VINCTUM'
    ]);
});

test('describeRelation words each relation for arc tooltips', () => {
    const find = (type, needer, supplier) => relations.find(r => r.type === type && r.needer === needer && r.supplier === supplier);
    assert.strictEqual(S.describeRelation(find('partner', 'ILLESEBRA', 'ARMUS')),
        'Armus inflicts Stun (Charge) for Illesebra\'s Hypnosis');
    assert.strictEqual(S.describeRelation(find('conflict', 'FERRARIUS', 'TOXICUM')),
        'Toxicum places Water (Vial of Venom), which hinders Ferrarius\'s Hearth of Hell');
    assert.strictEqual(S.describeRelation(find('counter', 'SAXUM', 'MESSUM')),
        'Messum inflicts Defense decrease (Frailty), which undoes Defense increase for Saxum\'s Rock Blast');
    assert.strictEqual(S.describeRelation(find('partner', 'TEMPUS', 'BREWUS')),
        'Brewus inflicts Cooldown-Manipulation (Fragrant Hop) for Tempus\'s Pendulum');
});
