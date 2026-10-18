// Run with: node --test tests/*.test.js
// Typed (role) edges: graph building, direction, grouping and filtering
const test = require('node:test');
const assert = require('node:assert');
const G = require('../graph-logic.js');

const link = (label, role, sources = [], on) => (on === undefined ? { label, role, sources } : { label, role, sources, on });
const heroes = [
    { id: 1, name: 'SAXUM', vitality: 5, labels: ['AoE', 'Defense increase', 'Tank'],
      core_ability: { name: 'ROCK BLAST', target: 't', effect: 'e' },
      support_abilities: [{ name: 'STONESKIN', target: 't', effect: 'e', cooldown: '3' },
                          { name: 'SHAKING EARTH', target: 't', effect: 'e', cooldown: '3' }],
      trait_links: [link('AoE', 'has', ['ROCK BLAST', 'SHAKING EARTH']),
                    link('Defense increase', 'benefits_from', ['ROCK BLAST'], 'self'),
                    link('Tank', 'has'),
                    link('Defense increase', 'gains', ['STONESKIN'])] },
    { id: 2, name: 'ARMUS', vitality: 3, labels: ['Defense increase', 'Stun'],
      core_ability: { name: 'SHIELD SLAM', target: 't', effect: 'e' },
      support_abilities: [{ name: 'CHARGE', target: 't', effect: 'e' }, { name: 'ANCESTRAL PROTECTION', target: 't', effect: 'e' }],
      trait_links: [link('Defense increase', 'grants', ['ANCESTRAL PROTECTION']), link('Stun', 'inflicts', ['CHARGE'])] },
    { id: 3, name: 'LEGACY', vitality: 2, labels: ['Melee'],
      core_ability: { target: 't', effect: 'e' }, support_abilities: [] }
];
const { nodes, links } = G.buildGraph(heroes);
const linkOf = (hero, label) => links.find(l => l.source === `hero_${hero}` && l.target === `label_${label}`);

test('one link per hero-trait pair, carrying every role of that pair', () => {
    assert.strictEqual(links.filter(l => l.source === 'hero_1').length, 3);
    assert.deepStrictEqual(linkOf(1, 'Defense increase').roles.map(r => r.role), ['benefits_from', 'gains']);
    assert.deepStrictEqual(linkOf(1, 'Defense increase').roles[0], { role: 'benefits_from', sources: ['ROCK BLAST'], on: 'self' });
});

test('heroes without trait_links fall back to plain "has" links', () => {
    assert.deepStrictEqual(linkOf(3, 'Melee').roles, [{ role: 'has', sources: [] }]);
});

test('link kind is the single non-"has" role, or mixed', () => {
    assert.strictEqual(linkOf(2, 'Stun').kind, 'inflicts');
    assert.strictEqual(linkOf(2, 'Defense increase').kind, 'grants');
    assert.strictEqual(linkOf(1, 'Tank').kind, 'has');
    assert.strictEqual(linkOf(1, 'Defense increase').kind, 'mixed');
    assert.strictEqual(G.linkKind([{ role: 'benefits_from', on: 'self' }, { role: 'benefits_from', on: 'enemy' }]), 'benefits_from');
});

test('direction: giving roles point hero -> trait, conditions point trait -> hero', () => {
    assert.deepStrictEqual(G.linkDirection(linkOf(2, 'Stun').roles), { toTrait: true, toHero: false });
    assert.deepStrictEqual(G.linkDirection([{ role: 'hindered_by', on: 'self' }]), { toTrait: false, toHero: true });
    assert.deepStrictEqual(G.linkDirection(linkOf(1, 'Defense increase').roles), { toTrait: true, toHero: true });
    assert.deepStrictEqual(G.linkDirection(linkOf(1, 'Tank').roles), { toTrait: false, toHero: false });
});

test('every role has display text and a direction', () => {
    G.ROLES.forEach(r => assert.ok(G.ROLE_INFO[r].label && ['out', 'in', 'none'].includes(G.ROLE_INFO[r].direction), r));
    assert.strictEqual(G.ROLE_INFO.benefits_from.label, 'Benefits from');
});

test('abilityTraits groups links under each ability, card-level links last', () => {
    const saxum = nodes.find(n => n.id === 'hero_1');
    const groups = G.abilityTraits(saxum);
    assert.deepStrictEqual(groups.map(g => g.ability ? g.ability.name : null), ['ROCK BLAST', 'STONESKIN', 'SHAKING EARTH', null]);
    assert.deepStrictEqual(groups[0].links.map(l => `${l.role}:${l.label}`), ['has:AoE', 'benefits_from:Defense increase']);
    assert.deepStrictEqual(groups[2].links.map(l => l.label), ['AoE']);
    assert.deepStrictEqual(groups[3].links.map(l => l.label), ['Tank']);
});

test('abilityTraits on a legacy hero puts every label at card level', () => {
    const groups = G.abilityTraits(nodes.find(n => n.id === 'hero_3'));
    assert.deepStrictEqual(groups.at(-1).links.map(l => l.label), ['Melee']);
});

test('traitHeroesByRole lists heroes per role in role order', () => {
    const groups = G.traitHeroesByRole('Defense increase', nodes);
    assert.deepStrictEqual(groups.map(g => g.role), ['grants', 'gains', 'benefits_from']);
    assert.deepStrictEqual(groups[2].entries.map(e => [e.hero.name, e.on, e.sources]), [['SAXUM', 'self', ['ROCK BLAST']]]);
});

test('filterByRole keeps links with that role and their end nodes', () => {
    const { nodeIds, links: kept } = G.filterByRole(links, 'inflicts');
    assert.deepStrictEqual([...kept].map(l => l.target), ['label_Stun']);
    assert.deepStrictEqual([...nodeIds].sort(), ['hero_2', 'label_Stun']);
    assert.strictEqual(G.filterByRole(links, 'gains').links.size, 1); // mixed links count for each of their roles
});

test('linkSummary words each role for tooltips', () => {
    assert.deepStrictEqual(G.linkSummary('SAXUM', 'Defense increase', linkOf(1, 'Defense increase').roles), [
        'SAXUM benefits from Defense increase on self, via ROCK BLAST',
        'SAXUM gains Defense increase, via STONESKIN'
    ]);
    assert.deepStrictEqual(G.linkSummary('SAXUM', 'Tank', [{ role: 'has', sources: [] }]), ['SAXUM has Tank']);
    assert.deepStrictEqual(G.linkSummary('X', 'Water', [{ role: 'benefits_from', sources: [], on: null }]),
        ['X benefits from Water']);
});

test('trimSegment pulls both ends back to the node rims', () => {
    const seg = G.trimSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 5);
    assert.deepStrictEqual(seg, { x1: 10, y1: 0, x2: 95, y2: 0 });
    const overlap = G.trimSegment({ x: 0, y: 0 }, { x: 4, y: 0 }, 10, 10);
    assert.deepStrictEqual(overlap, { x1: 2, y1: 0, x2: 2, y2: 0 });
});

test('real data: every link gets roles and Saxum/Defense is mixed', () => {
    const data = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
    const real = G.buildGraph(data).links;
    assert.ok(real.every(l => l.roles.length && l.kind));
    const saxumDefense = real.find(l => l.source === 'hero_20' && l.target === 'label_Defense increase');
    assert.strictEqual(saxumDefense.kind, 'mixed');
});

test('places is a giving role pointing hero -> terrain', () => {
    assert.ok(G.ROLES.includes('places'));
    assert.deepStrictEqual(G.linkDirection([{ role: 'places', on: null }]), { toTrait: true, toHero: false });
    assert.deepStrictEqual(G.linkSummary('MAGNUS', 'Mountain', [{ role: 'places', sources: ['DARKSTONE'], on: null }]),
        ['MAGNUS places Mountain, via DARKSTONE']);
});

test('linkSummary names an unusual subject on giving roles', () => {
    assert.deepStrictEqual(G.linkSummary('GOETIUM', 'Wound', [{ role: 'inflicts', sources: ['RITUAL OF VITALITY'], on: 'ally' }]),
        ['GOETIUM inflicts Wound on allies, via RITUAL OF VITALITY']);
});

test('arcPath bends a curve to one side and trims both ends to the node rims', () => {
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const flat = G.arcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 0, 0.2);
    assert.deepStrictEqual([flat.x1, flat.y1, flat.cx, flat.cy, flat.x2, flat.y2], [0, 0, 50, 20, 100, 0]);
    assert.strictEqual(flat.d, 'M0,0Q50,20 100,0');
    const trimmed = G.arcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 10, 0.2);
    const len = Math.hypot(50, 20);
    assert.ok(near(trimmed.x1, 500 / len) && near(trimmed.y1, 200 / len));
    assert.ok(near(trimmed.x2, 100 - 500 / len) && near(trimmed.y2, 200 / len));
    assert.deepStrictEqual([trimmed.mx, trimmed.my], [50, 10]); // curve midpoint for tooltips
});
