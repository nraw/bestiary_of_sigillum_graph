// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const G = require('../graph-logic.js');

const heroes = [
    { id: 1, name: 'ALPHA', vitality: 5, labels: ['Melee', 'Stun'],
      core_ability: { target: 't', effect: 'e' }, support_abilities: [] },
    { id: 2, name: 'BETA', vitality: 2, labels: ['Ranged', 'Stun'],
      core_ability: { target: 't', effect: 'e' }, support_abilities: [] },
    { id: 3, name: 'GAMMA', vitality: 3, labels: ['Ranged', 'Healing'],
      core_ability: { target: 't', effect: 'e' }, support_abilities: [] },
    { id: 4, name: 'DELTA', vitality: 3, labels: ['Tank'],
      core_ability: { target: 't', effect: 'e' }, support_abilities: [] }
];

const { nodes, links } = G.buildGraph(heroes);
const byId = new Map(nodes.map(n => [n.id, n]));
const adjacency = G.buildAdjacency(links);

test('buildGraph creates hero and unique label nodes with links', () => {
    assert.strictEqual(nodes.filter(n => n.type === 'hero').length, 4);
    assert.deepStrictEqual(
        nodes.filter(n => n.type === 'label').map(n => n.name).sort(),
        ['Healing', 'Melee', 'Ranged', 'Stun', 'Tank']
    );
    assert.strictEqual(links.length, 7);
    assert.deepStrictEqual([links[0].source, links[0].target], ['hero_1', 'label_Melee']);
});

test('hero nodes carry primary type, image and vitality-based radius', () => {
    const alpha = byId.get('hero_1');
    assert.strictEqual(alpha.primaryType, 'Melee');
    assert.strictEqual(alpha.image, 'hero_images/alpha.png');
    assert.ok(alpha.radius > byId.get('hero_2').radius, 'higher vitality = bigger node');
    assert.strictEqual(byId.get('hero_4').primaryType, 'Other');
});

test('label nodes record degree and grow with it', () => {
    const stun = byId.get('label_Stun');
    const tank = byId.get('label_Tank');
    assert.strictEqual(stun.degree, 2);
    assert.strictEqual(tank.degree, 1);
    assert.ok(stun.radius > tank.radius);
    assert.strictEqual(stun.category, 'Effect');
});

test('getPrimaryType prefers AoE > Ranged > Melee > Support', () => {
    assert.strictEqual(G.getPrimaryType(['Melee', 'AoE']), 'AoE');
    assert.strictEqual(G.getPrimaryType(['Support', 'Ranged', 'Melee']), 'Ranged');
    assert.strictEqual(G.getPrimaryType(['Support']), 'Support');
    assert.strictEqual(G.getPrimaryType(['Tank']), 'Other');
});

test('vitalityRadius is clamped and monotonic', () => {
    assert.ok(G.vitalityRadius(2) < G.vitalityRadius(3));
    assert.ok(G.vitalityRadius(3) < G.vitalityRadius(5));
    assert.strictEqual(G.vitalityRadius(99), G.vitalityRadius(5));
    assert.strictEqual(G.vitalityRadius(0), G.vitalityRadius(2));
});

test('buildAdjacency is symmetric and accepts resolved link objects', () => {
    assert.ok(adjacency.get('hero_1').has('label_Stun'));
    assert.ok(adjacency.get('label_Stun').has('hero_1'));
    const resolved = G.buildAdjacency([{ source: { id: 'a' }, target: { id: 'b' } }]);
    assert.ok(resolved.get('b').has('a'));
});

test('computeHighlight for a hero: labels connected, label-sharing heroes secondary', () => {
    const h = G.computeHighlight('hero_1', adjacency, byId);
    assert.strictEqual(h.get('hero_1'), 'selected');
    assert.strictEqual(h.get('label_Melee'), 'connected');
    assert.strictEqual(h.get('label_Stun'), 'connected');
    assert.strictEqual(h.get('hero_2'), 'secondary');
    assert.strictEqual(h.get('hero_3'), 'dim');
    assert.strictEqual(h.get('label_Ranged'), 'dim');
});

test('computeHighlight for a label: only heroes are connected, no label secondaries', () => {
    const h = G.computeHighlight('label_Ranged', adjacency, byId);
    assert.strictEqual(h.get('hero_2'), 'connected');
    assert.strictEqual(h.get('hero_3'), 'connected');
    assert.strictEqual(h.get('label_Stun'), 'dim');
});

test('linkState classifies edges relative to a highlight map', () => {
    const h = G.computeHighlight('hero_1', adjacency, byId);
    assert.strictEqual(G.linkState({ source: 'hero_1', target: 'label_Stun' }, h), 'direct');
    assert.strictEqual(G.linkState({ source: 'hero_2', target: 'label_Stun' }, h), 'secondary');
    assert.strictEqual(G.linkState({ source: 'hero_2', target: 'label_Ranged' }, h), 'dim');
});

test('relatedHeroes lists heroes sharing labels, most shared first', () => {
    const extra = [...heroes, { id: 5, name: 'EPSILON', vitality: 3, labels: ['Melee', 'Stun'] }];
    const related = G.relatedHeroes(extra[0], extra);
    assert.deepStrictEqual(related.map(r => r.hero.name), ['EPSILON', 'BETA']);
    assert.deepStrictEqual(related[0].shared, ['Melee', 'Stun']);
});

test('filterNodes by term matches heroes and labels', () => {
    const ids = G.filterNodes(nodes, { term: 'ra' });
    assert.deepStrictEqual([...ids].sort(), ['label_Ranged']);
    assert.deepStrictEqual([...G.filterNodes(nodes, { term: '#3' })], ['hero_3']);
});

test('filterNodes by category keeps heroes with that label plus the label node', () => {
    const ids = G.filterNodes(nodes, { category: 'Ranged' });
    assert.deepStrictEqual([...ids].sort(), ['hero_2', 'hero_3', 'label_Ranged']);
});

test('filterNodes combines category and term on heroes', () => {
    const ids = G.filterNodes(nodes, { category: 'Ranged', term: 'gam' });
    assert.deepStrictEqual([...ids].sort(), ['hero_3', 'label_Ranged']);
});

test('filterNodes with no criteria returns null (no filtering)', () => {
    assert.strictEqual(G.filterNodes(nodes, {}), null);
    assert.strictEqual(G.filterNodes(nodes, { term: '  ', category: 'All' }), null);
});

test('fitTransform centers bounds and respects max scale', () => {
    const t = G.fitTransform({ x0: 0, y0: 0, x1: 100, y1: 100 }, 400, 200, 0, 10);
    assert.strictEqual(t.k, 2);
    assert.strictEqual(t.x, 100);
    assert.strictEqual(t.y, 0);
    const capped = G.fitTransform({ x0: 0, y0: 0, x1: 1, y1: 1 }, 400, 200, 0, 1.5);
    assert.strictEqual(capped.k, 1.5);
});

test('escapeHtml neutralises markup', () => {
    assert.strictEqual(G.escapeHtml('<a href="x">&\'</a>'),
        '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('filterNodes by labelCategory keeps only trait nodes of that group', () => {
    const ids = G.filterNodes(nodes, { labelCategory: 'Combat' });
    assert.deepStrictEqual([...ids].sort(), ['label_Melee', 'label_Ranged']);
});

test('effectIcon maps official effects that have artwork, else null', () => {
    assert.strictEqual(G.effectIcon('Attack increase'), 'effect_images/attack_increase.png');
    assert.strictEqual(G.effectIcon('Place obstacle'), 'effect_images/place_obstacle.png');
    assert.strictEqual(G.effectIcon('Silence'), null);
    assert.strictEqual(G.effectIcon('Melee'), null);
});

test('nearestInDirection picks the closest node within the direction cone', () => {
    const from = { id: 'o', x: 0, y: 0 };
    const pts = [
        from,
        { id: 'right-near', x: 50, y: 10 },
        { id: 'right-far', x: 200, y: 0 },
        { id: 'up', x: 0, y: -40 },
        { id: 'diag', x: 30, y: 60 }
    ];
    assert.strictEqual(G.nearestInDirection(from, pts, 'right').id, 'right-near');
    assert.strictEqual(G.nearestInDirection(from, pts, 'up').id, 'up');
    assert.strictEqual(G.nearestInDirection(from, pts, 'down').id, 'diag');
    assert.strictEqual(G.nearestInDirection(from, pts, 'left'), null);
});

test('hero nodes carry card features, sync note and ability names/ranges/cooldowns', () => {
    const [hero] = G.buildGraph([{
        id: 9, name: 'EPSILON', vitality: 3, labels: ['Melee'],
        features: ['Blocks movement.'], sync_note: 'Needs water.',
        core_ability: { name: 'BITE', target: 't', effect: 'e', range: 'adjacent' },
        support_abilities: [{ name: 'DASH', target: 't', effect: 'e', range: null, cooldown: '3' }]
    }]).nodes;
    assert.deepStrictEqual(hero.features, ['Blocks movement.']);
    assert.strictEqual(hero.sync_note, 'Needs water.');
    assert.strictEqual(hero.core_ability.name, 'BITE');
    assert.strictEqual(hero.support_abilities[0].cooldown, '3');
});

test('hero nodes default missing card fields', () => {
    const alpha = byId.get('hero_1');
    assert.deepStrictEqual(alpha.features, []);
    assert.strictEqual(alpha.sync_note, null);
});

test('abilityRange maps a range key to its image and description', () => {
    assert.deepStrictEqual(G.abilityRange('one_hex_gap_line'), {
        src: 'ability_images/one_hex_gap_line.png',
        label: 'The target is in any hex 1 unoccupied hex away in a straight line'
    });
    assert.strictEqual(G.abilityRange('self').label, 'The target is the Ability bearer');
    assert.strictEqual(G.abilityRange(null), null);
    assert.strictEqual(G.abilityRange('nonsense'), null);
});

test('every range key in the data has a description', () => {
    const data = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
    const ranges = data.flatMap(c => [c.core_ability, ...c.support_abilities]).map(a => a.range).filter(Boolean);
    assert.ok(ranges.length > 0);
    ranges.forEach(r => assert.ok(G.abilityRange(r), `no description for ${r}`));
});

test('relatedHeroes never lists the hero itself when given its graph node', () => {
    const alphaNode = byId.get('hero_1');
    const related = G.relatedHeroes(alphaNode, heroes);
    assert.ok(!related.some(r => r.hero.id === 1), 'ALPHA must not be related to itself');
    assert.deepStrictEqual(related.map(r => r.hero.name), ['BETA']);
});
