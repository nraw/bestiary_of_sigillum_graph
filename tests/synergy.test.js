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

test('deliberate wounding feeds heroes that benefit from their own Injuries', () => {
    ['IRATUS', 'MORTUM', 'VINCTUM', 'MAGNUS', 'SATURN'].forEach(name =>
        assert.deepStrictEqual(helpedOn(name, 'Injury'), ['GOETIUM'], name));
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
    assert.deepStrictEqual(names(forHero('MESSUM').counters), ['CATAPULTUS', 'SAXUM']); // Messum is also Small
    const equita = forHero('EQUITA').counteredBy.find(r => r.hero === 'CABALLUS');
    assert.deepStrictEqual(equita.reasons.map(r => r.rule).sort(), ['hindrance', 'opposite']);
});

test('counters: a formation a hero needs is punished by an opponent who feeds on it', () => {
    // Manus's Joint Assault wants allies packed around him; Lignum hits harder per adjacent ally
    assert.deepStrictEqual(names(forHero('MANUS').counteredBy), ['LIGNUM']);
    assert.deepStrictEqual(names(forHero('LIGNUM').counters.filter(c => c.reasons[0].rule === 'formation')), ['MANUS']);
    const lignum = forHero('MANUS').counteredBy[0];
    assert.deepStrictEqual(lignum.reasons.map(r => [r.rule, r.need.label, r.supply.label]),
        [['formation', 'Adjacent allies', 'Clustered enemies']]);
});

const counterReasons = (needer, supplier) => forHero(needer).counteredBy.find(c => c.hero === supplier)
    .reasons.map(r => [r.rule, r.need.label, r.supply.label]);

test('counters: a huddled band denies heroes who need lone or exposed targets', () => {
    // Harvest wants no allies next to the target; Shades wants empty hexes around it
    assert.deepStrictEqual(names(forHero('MANUS').counters), ['MESSUM', 'TENEBRIS']);
    assert.deepStrictEqual(counterReasons('MESSUM', 'MANUS'), [['formation', 'Isolated enemies', 'Adjacent allies']]);
    assert.deepStrictEqual(counterReasons('TENEBRIS', 'MANUS'), [['formation', 'Exposed enemies', 'Adjacent allies']]);
    // Lightning only needs Goetium's own band away from the target, which a huddle does not stop
    assert.ok(!names(forHero('GOETIUM').counteredBy).includes('MANUS'));
});

test('counters: an Obstacle blocks Ballista lines and crowds Shades targets', () => {
    // Rulebook: "When calculating Ballistarius's Attack points, consider a hex with the Obstacle marker as an occupied hex"
    assert.deepStrictEqual(names(forHero('ARCHITECTUS').counters), ['BALLISTARIUS', 'TENEBRIS']);
    assert.deepStrictEqual(counterReasons('BALLISTARIUS', 'ARCHITECTUS'), [['formation', 'Open line', 'Place obstacle']]);
    assert.deepStrictEqual(counterReasons('TENEBRIS', 'ARCHITECTUS'), [['formation', 'Exposed enemies', 'Place obstacle']]);
    // Ancestral Cannon only cannot hit adjacent hexes, so Obstacles do not matter to it
    assert.ok(!names(forHero('MECHANICUS').counteredBy).includes('ARCHITECTUS'));
});

test('counters: Small heroes (max Vitality 2) are immune to Catapult', () => {
    const small = heroes.filter(h => h.vitality === 2).map(h => h.name).sort();
    assert.strictEqual(small.length, 12);
    assert.deepStrictEqual(names(forHero('CATAPULTUS').counteredBy), small);
    assert.deepStrictEqual(counterReasons('CATAPULTUS', 'LIGNUM'), [['size', 'Big enemies', 'Small']]);
});

test('effect needs: every hero supplying the effect is a partner, nobody else is', () => {
    const helpers = name => [...new Set(forHero(name).helpedBy.map(e => e.hero))].sort();
    const carnifex = helpers('CARNIFEX');
    assert.strictEqual(carnifex.length, 21);
    assert.ok(carnifex.includes('TOXICUM') && carnifex.includes('FRIGUS'));
    assert.ok(!carnifex.includes('ARCHITECTUS') && !carnifex.includes('TEMPUS'));
    assert.ok(forHero('CARNIFEX').helpedBy.every(e => e.label === 'Negative effect' ? e.rule === 'effects' : true));
    const ignifer = helpers('IGNIFER');
    assert.ok(ignifer.includes('TEMPUS') && ignifer.includes('IRATUS'));
    assert.ok(!ignifer.includes('TOXICUM'));
    assert.ok(forHero('TOXICUM').helps.some(e => e.hero === 'CARNIFEX' && e.label === 'Negative effect'));
});

test('effect needs: own debuffs combo, but Aqus cannot copy his own buff', () => {
    const combos = name => forHero(name).selfCombos.map(c => [c.label, c.supply.label]);
    assert.deepStrictEqual(combos('FRIGUS'), [['Negative effect', 'Slowness'], ['Negative effect', 'Attack decrease']]);
    assert.deepStrictEqual(combos('CARNIFEX'), [['Negative effect', 'Control decrease']]);
    assert.deepStrictEqual(combos('AQUS'), []);
    assert.ok(forHero('AQUS').helpedBy.some(e => e.hero === 'IRATUS'));
});

test('flags: heroes who grow from their own Injuries, and those slowed by them', () => {
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

test('synergyArcs: one arc per hero pair and category, 157 in all', () => {
    assert.strictEqual(arcs.length, 157);
    assert.deepStrictEqual(Object.fromEntries(['partner', 'conflict', 'counter']
        .map(c => [c, arcs.filter(x => x.category === c).length])), { partner: 120, conflict: 14, counter: 23 });
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
        'conflict:MECHANICUS', 'conflict:VINCTUM', 'counter:CATAPULTUS',
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
    assert.strictEqual(S.describeRelation(find('counter', 'MANUS', 'LIGNUM')),
        'Lignum benefits from Clustered enemies (Puppet / Limp Hands), which punishes the Adjacent allies of Manus\'s Joint Assault');
    assert.strictEqual(S.describeRelation(find('counter', 'TENEBRIS', 'MANUS')),
        'Manus benefits from Adjacent allies (Joint Assault), which denies the Exposed enemies of Tenebris\'s Shades');
    assert.strictEqual(S.describeRelation(find('counter', 'BALLISTARIUS', 'ARCHITECTUS')),
        'Architectus has Place obstacle (Fortification), which blocks the Open line of Ballistarius\'s Ballista');
    assert.strictEqual(S.describeRelation(find('counter', 'CATAPULTUS', 'LIGNUM')),
        'Lignum is Small (max Vitality 2), which Catapultus\'s Catapult cannot target');
});

test('synergySummary lists unique heroes per non-empty group, in display order', () => {
    const tempus = S.synergySummary('TEMPUS', relations);
    assert.deepStrictEqual(tempus.groups.map(g => g.key), ['helpedBy', 'helps', 'conflicts']);
    assert.deepStrictEqual(tempus.groups[0], { key: 'helpedBy', label: 'Helped by', heroes: ['TOXICUM', 'BREWUS', 'EQUITA'], more: 0 });
    assert.deepStrictEqual(tempus.groups[2], { key: 'conflicts', label: 'Careful with', heroes: ['FIDEA'], more: 0 });
    assert.deepStrictEqual(tempus.notes, []);
});

test('synergySummary caps long hero lists and notes self-combos and flags', () => {
    const ill = S.synergySummary('ILLESEBRA', relations, 4);
    assert.deepStrictEqual(ill.groups[0].heroes, ['ARMUS', 'CATAPULTUS', 'FERRARIUS', 'MALLEUS']);
    assert.strictEqual(ill.groups[0].more, 5);
    assert.ok(ill.notes.includes('Self-combo'));
    const flagged = heroes.find(h => S.heroSynergies(h.name, relations).flags.dontFeed);
    assert.ok(S.synergySummary(flagged.name, relations).notes.includes("Don't feed"));
});
