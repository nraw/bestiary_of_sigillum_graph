// Run with: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const G = require('../graph-logic.js');

const arc = (a, b, category) => ({ a, b, category, aToB: true, bToA: false, relations: [] });
const heroes = ['A1', 'A2', 'B1', 'B2', 'P1', 'P2', 'P3', 'P4', 'P5'];
const band = { mine: ['A1', 'A2'], theirs: ['B1', 'B2'] };
const arcs = [
    arc('A1', 'A2', 'partner'),   // within my band
    arc('A1', 'A2', 'counter'),   // counter inside my own band: never applies
    arc('A1', 'P1', 'partner'),   // to the pool
    arc('A2', 'P2', 'conflict'),
    arc('A1', 'P3', 'counter'),
    arc('A1', 'B1', 'partner'),   // can't partner with the enemy
    arc('A2', 'B2', 'counter'),   // my band vs theirs
    arc('B1', 'B2', 'partner'),   // their own synergy: noise
    arc('B1', 'P4', 'counter'),   // theirs vs a pool hero: matters for my next pick
    arc('B2', 'P5', 'partner'),   // their synergy with the pool: noise
    arc('P1', 'P2', 'partner')    // not touching my band
];
const keys = list => list.map(a => `${a.category}|${a.a}|${a.b}`).sort();

test('bandView shows my band\'s synergies within the band and to the pool', () => {
    const { arcs: shown } = G.bandView(arcs, heroes, band, { showOpponent: false });
    assert.deepStrictEqual(keys(shown), [
        'conflict|A2|P2', 'counter|A1|P3', 'partner|A1|A2', 'partner|A1|P1'
    ]);
});

test('bandView with the opponent adds only its counters, with my band and with the pool', () => {
    const { arcs: shown } = G.bandView(arcs, heroes, band, { showOpponent: true });
    assert.deepStrictEqual(keys(shown), [
        'conflict|A2|P2', 'counter|A1|P3', 'counter|A2|B2', 'counter|B1|P4', 'partner|A1|A2', 'partner|A1|P1'
    ]);
});

test('bandView states: mine selected, linked pool heroes connected, opponent rival when shown', () => {
    const off = G.bandView(arcs, heroes, band, { showOpponent: false }).states;
    assert.deepStrictEqual(Object.fromEntries(off), {
        A1: 'selected', A2: 'selected', B1: 'dim', B2: 'dim', P1: 'connected', P2: 'connected', P3: 'connected',
        P4: 'dim', P5: 'dim'
    });
    const on = G.bandView(arcs, heroes, band, { showOpponent: true }).states;
    assert.strictEqual(on.get('B1'), 'rival');
    assert.strictEqual(on.get('B2'), 'rival');
    assert.strictEqual(on.get('P1'), 'connected');
    assert.strictEqual(on.get('P4'), 'connected', 'countered by / countering the opponent');
    assert.strictEqual(on.get('P5'), 'dim');
});

test('bandView without an opponent band works the same', () => {
    const { arcs: shown, states } = G.bandView(arcs, heroes, { mine: ['A1', 'A2'], theirs: [] }, { showOpponent: true });
    assert.strictEqual(shown.length, 6); // pool arcs, incl. the B heroes as ordinary pool heroes
    assert.strictEqual(states.get('B1'), 'connected');
});

const band3 = { mine: ['A1', 'A2', 'A3'], theirs: ['B1', 'B2', 'B3'] };

test('bandAnchors packs my band top-left and the opponent top-right, far apart', () => {
    const { heroes: anchors } = G.bandAnchors(band3, { showOpponent: true }, 1000, 800);
    const mine = band3.mine.map(n => anchors.get(n));
    const theirs = band3.theirs.map(n => anchors.get(n));
    assert.ok(mine.every(a => a.x < 350) && theirs.every(b => b.x > 650), 'corners, with the middle left free');
    assert.ok([...mine, ...theirs].every(a => a.y < 300), 'both bands near the top');
    assert.strictEqual(new Set(mine.map(a => `${a.x},${a.y}`)).size, 3, 'members get their own spot');
    assert.strictEqual(anchors.has('P1'), false);
});

test('bandAnchors centres my band at the top when no opponent is shown', () => {
    const { heroes: anchors } = G.bandAnchors(band3, { showOpponent: false }, 1000, 800);
    const xs = band3.mine.map(n => anchors.get(n).x);
    assert.strictEqual((Math.min(...xs) + Math.max(...xs)) / 2, 500);
    assert.ok(anchors.get('A1').y < 300);
    assert.strictEqual(anchors.has('B1'), false);
});

test('bandAnchors puts the linked heroes\' target below the bands', () => {
    const { heroes: anchors, pool } = G.bandAnchors(band3, { showOpponent: true }, 1000, 800);
    assert.ok([...anchors.values()].every(a => pool.y > a.y + 100));
});

test('bandSprings ties each linked pool hero to the band heroes it has lines with, once per pair', () => {
    const view = G.bandView(arcs, heroes, band, { showOpponent: true });
    const springs = G.bandSprings(view).map(s => `${s.source}-${s.target}`).sort();
    // pool heroes are tied to the band (mine or theirs) they have lines with; none between the anchored bands
    assert.deepStrictEqual(springs, ['A1-P1', 'A1-P3', 'A2-P2', 'B1-P4']);
});

test('bandSprings joins two arcs between the same pair into one spring', () => {
    const view = G.bandView([arc('A1', 'P1', 'partner'), arc('A1', 'P1', 'counter')], heroes, band);
    assert.deepStrictEqual(G.bandSprings(view), [{ source: 'A1', target: 'P1' }]);
});
