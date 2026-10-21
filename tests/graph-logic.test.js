// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const G = require('../graph-logic.js');

const heroes = [
    { id: 1, name: 'ALPHA', vitality: 5, attribute: 'Strength', labels: ['Melee', 'Stun'],
      core_ability: { target: 't', effect: 'e' }, support_abilities: [] },
    { id: 2, name: 'BETA', vitality: 2, attribute: 'Agility', labels: ['Ranged', 'Stun'],
      core_ability: { target: 't', effect: 'e' }, support_abilities: [] },
    { id: 3, name: 'GAMMA', vitality: 3, attribute: 'Intelligence', labels: ['Ranged', 'Healing'],
      core_ability: { target: 't', effect: 'e' }, support_abilities: [] },
    { id: 4, name: 'DELTA', vitality: 3, attribute: 'Intelligence', labels: ['Tank'],
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

test('hero nodes carry attribute, image and a uniform radius', () => {
    const alpha = byId.get('hero_1');
    assert.strictEqual(alpha.attribute, 'Strength');
    assert.ok(!('primaryType' in alpha), 'colour comes from the attribute, not the attack type');
    assert.strictEqual(alpha.image, 'hero_images/alpha.png');
    assert.strictEqual(alpha.radius, G.HERO_RADIUS);
    assert.strictEqual(byId.get('hero_2').radius, alpha.radius, 'size does not depend on vitality');
});

test('label nodes record degree and grow with it', () => {
    const stun = byId.get('label_Stun');
    const tank = byId.get('label_Tank');
    assert.strictEqual(stun.degree, 2);
    assert.strictEqual(tank.degree, 1);
    assert.ok(stun.radius > tank.radius);
    assert.strictEqual(stun.category, 'Effect');
});

test('label nodes carry their trait description (null when none is given)', () => {
    const stunRule = { text: 'Cannot maneuver or use Abilities.', source: 'Rulebook' };
    const described = new Map(G.buildGraph(heroes, { Stun: stunRule }).nodes.map(n => [n.id, n]));
    assert.deepStrictEqual(described.get('label_Stun').description, stunRule);
    assert.strictEqual(described.get('label_Tank').description, null);
    assert.strictEqual(byId.get('label_Stun').description, null, 'descriptions are optional');
});

test('ATTRIBUTES lists the three card attributes in card order', () => {
    assert.deepStrictEqual(G.ATTRIBUTES, ['Strength', 'Agility', 'Intelligence']);
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
    assert.strictEqual(G.effectIcon('Silence'), 'effect_images/silence.png');
    assert.strictEqual(G.effectIcon('Web'), 'effect_images/web.png');
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

test('abilityImage maps a hero and ability position (0 = core) to its icon', () => {
    assert.strictEqual(G.abilityImage('ARCHITECTUS', 0), 'hero_ability_images/architectus/1.png');
    assert.strictEqual(G.abilityImage('Tenebris', 2), 'hero_ability_images/tenebris/3.png');
});

test('every ability in the data has an icon on disk', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const data = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
    data.forEach(c => [c.core_ability, ...c.support_abilities].forEach((_, i) => {
        const file = G.abilityImage(c.name, i);
        assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `missing ${file}`);
    }));
});


test('filterNodes by attribute keeps only heroes of that attribute', () => {
    assert.deepStrictEqual([...G.filterNodes(nodes, { attribute: 'Intelligence' })].sort(), ['hero_3', 'hero_4']);
    assert.deepStrictEqual([...G.filterNodes(nodes, { attribute: 'Strength' })], ['hero_1']);
});

test('focusIds is the selection plus its direct neighbours', () => {
    assert.deepStrictEqual([...G.focusIds('hero_1', adjacency)].sort(), ['hero_1', 'label_Melee', 'label_Stun']);
    assert.deepStrictEqual([...G.focusIds('label_Stun', adjacency)].sort(), ['hero_1', 'hero_2', 'label_Stun']);
    assert.deepStrictEqual([...G.focusIds('missing', adjacency)], ['missing']);
});

test('vitalityTokens stacks one token per vitality along the bottom-left rim', () => {
    const R = G.HERO_RADIUS;
    for (const vitality of [2, 3, 4, 5]) {
        const tokens = G.vitalityTokens(vitality, R);
        assert.strictEqual(tokens.length, vitality);
        tokens.forEach(t => {
            assert.ok(Math.abs(Math.hypot(t.x, t.y) - R) < 1e-9, 'token centres sit on the rim');
            assert.ok(t.x < 0, 'tokens stay on the left half, clear of the attribute badge');
        });
        const meanAngle = tokens.reduce((s, t) => s + Math.atan2(t.y, t.x), 0) / vitality * 180 / Math.PI;
        assert.ok(Math.abs(meanAngle - 145) < 1e-6, `stack is centred on the bottom-left (${meanAngle})`);
        for (let i = 1; i < tokens.length; i++) {
            const gap = Math.hypot(tokens[i].x - tokens[i - 1].x, tokens[i].y - tokens[i - 1].y);
            assert.ok(gap < 2 * G.TOKEN_RADIUS, 'neighbouring tokens overlap like a stack');
            assert.ok(gap > G.TOKEN_RADIUS, 'but each token stays readable');
            assert.ok(tokens[i].y > tokens[i - 1].y, 'drawn top to bottom so lower tokens lie on top');
        }
    }
    assert.deepStrictEqual(G.vitalityTokens(0, R), []);
});

test('vitalityTokensSvg draws the same token stack as markup for HTML portraits', () => {
    const svg = G.vitalityTokensSvg(4);
    assert.match(svg, /^<svg class="vitality-stack"/);
    assert.match(svg, new RegExp(`viewBox="-${G.HERO_RADIUS} -${G.HERO_RADIUS} ${G.HERO_RADIUS * 2} ${G.HERO_RADIUS * 2}"`),
        'one viewBox unit per graph unit, so the stack scales with the portrait');
    assert.match(svg, /aria-hidden="true"/);
    assert.strictEqual((svg.match(/class="vitality-token"/g) || []).length, 4);
    assert.strictEqual((svg.match(/href="#heart-glyph"/g) || []).length, 4);
    const [first] = G.vitalityTokens(4, G.HERO_RADIUS);
    assert.ok(svg.includes(`translate(${first.x.toFixed(2)},${first.y.toFixed(2)})`), 'tokens use the graph layout');
});

test('gradientVector: runs from the tail to the arrowhead; none for two-way or undirected edges', () => {
    const seg = { x1: 0, y1: 0, x2: 10, y2: 5 };
    assert.deepStrictEqual(G.gradientVector(seg, { toTrait: true, toHero: false }), { x1: 0, y1: 0, x2: 10, y2: 5 });
    assert.deepStrictEqual(G.gradientVector(seg, { toTrait: false, toHero: true }), { x1: 10, y1: 5, x2: 0, y2: 0 });
    assert.strictEqual(G.gradientVector(seg, { toTrait: true, toHero: true }), null);
    assert.strictEqual(G.gradientVector(seg, { toTrait: false, toHero: false }), null);
});
