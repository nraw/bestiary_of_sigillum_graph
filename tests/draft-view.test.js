// Run with: node --test tests/*.test.js
// Draft view model (draft-view.js): exactly what the draft UI renders, derived from the engine
const test = require('node:test');
const assert = require('node:assert');
const D = require('../draft.js');
const V = require('../draft-view.js');

const heroes = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
const ctx = D.createContext(heroes);
const pickAll = (state, names) => names.reduce((s, n) => D.applyAction(s, n), state);

function soloState() {
    let s = D.setExcluded(D.createDraft('solo'), ['LIBRORUM', 'TENEBRIS']);
    s = D.setEnemies(s, ['SAXUM', 'ILLESEBRA', 'MAGNUS']);
    return pickAll(s, ['FERRARIUS', 'BALLISTARIUS']);
}

test('pool: every hero appears once with why it is unavailable', () => {
    const v = V.draftView(soloState(), ctx);
    assert.strictEqual(v.pool.length, 36);
    const reason = Object.fromEntries(v.pool.map(p => [p.name, p.unavailableReason]));
    assert.strictEqual(reason.FERRARIUS, 'picked');
    assert.strictEqual(reason.SAXUM, 'facing');
    assert.strictEqual(reason.LIBRORUM, 'excluded');
    assert.strictEqual(reason.AQUS, null);
    v.pool.forEach(p => assert.strictEqual(p.available, p.unavailableReason === null, p.name));
    assert.deepStrictEqual(v.counts, { available: 29, unavailable: 7 });
});

test('pool entries carry display facts', () => {
    const fidea = V.draftView(D.createDraft('solo'), ctx).pool.find(p => p.name === 'FIDEA');
    assert.deepStrictEqual(
        { display: fidea.display, attribute: fidea.attribute, size: fidea.size, battleRoles: fidea.battleRoles, image: fidea.image },
        { display: 'Fidea', attribute: 'Intelligence', size: 'Small', battleRoles: ['Supporter'], image: 'hero_images/fidea.png' });
});

test('slots: 3 in pick order', () => {
    const v = V.draftView(soloState(), ctx);
    assert.deepStrictEqual(v.slots.map(s => s.hero), ['FERRARIUS', 'BALLISTARIUS', null]);
    assert.ok(v.slots.every(s => !('startsOnCastle' in s)), 'the Castle note is gone from the cards');
    assert.ok(v.slots.every(s => s.preview === false));
    assert.deepStrictEqual(v.against, ['SAXUM', 'ILLESEBRA', 'MAGNUS']);
    assert.deepStrictEqual(v.excluded, ['LIBRORUM', 'TENEBRIS']);
});

test('every chip comes from an engine reason, positives first, at least one warning kept', () => {
    const v = V.draftView(soloState(), ctx);
    assert.ok(v.suggestions.items.length > 0);
    v.suggestions.items.forEach(item => {
        const ids = new Set(item.reasons.map(r => r.id));
        item.chips.forEach(c => assert.ok(ids.has(c.reasonId), `${item.name}: chip ${c.reasonId} has no reason`));
        assert.ok(item.chips.length <= V.MAX_CHIPS);
        const kinds = item.chips.map(c => c.kind);
        const firstWarning = kinds.indexOf('warning');
        if (firstWarning >= 0) assert.ok(kinds.slice(firstWarning).every(k => k === 'warning'), item.name);
        if (item.reasons.some(r => r.kind === 'warning')) assert.ok(kinds.includes('warning'), `${item.name} hides its warning`);
        assert.strictEqual(item.moreChips, item.reasons.filter(r => r.kind !== 'info').length - item.chips.length);
    });
});

test('chip kinds map to the three chip colours', () => {
    assert.strictEqual(V.chipKind({ kind: 'positive' }), 'synergy');
    assert.strictEqual(V.chipKind({ kind: 'counter' }), 'counter');
    assert.strictEqual(V.chipKind({ kind: 'warning' }), 'warning');
});

test('percent labels: "Top N%" rounded up, never below 1%; the weaker half reads "Bottom N%"', () => {
    assert.strictEqual(V.percentLabel(0.01), 'Top 1%');
    assert.strictEqual(V.percentLabel(2.3), 'Top 3%');
    assert.strictEqual(V.percentLabel(50), 'Top 50%');
    assert.strictEqual(V.percentLabel(80), 'Bottom 21%');
    assert.strictEqual(V.percentLabel(100), 'Bottom 1%');
});

test('completions while any slot is empty (including the last pick); swaps only when the band is full', () => {
    const empty = V.draftView(D.createDraft('solo'), ctx);
    assert.ok(Array.isArray(empty.completions) && empty.completions.length > 0);
    assert.strictEqual(empty.swaps, null);
    const one = V.draftView(D.applyAction(D.createDraft('solo'), 'FERRARIUS'), ctx);
    assert.ok(one.completions.every(c => c.heroes[0] === 'FERRARIUS'));
    const last = V.draftView(soloState(), ctx).completions;
    assert.ok(Array.isArray(last) && last.length > 0, 'the last pick still shows complete bands');
    last.forEach(card => assert.deepStrictEqual(card.heroes.slice(0, 2), ['FERRARIUS', 'BALLISTARIUS']));
    const full = V.draftView(pickAll(D.createDraft('solo'), ['FIDEA', 'GOETIUM', 'MESSUM']), ctx);
    assert.strictEqual(full.completions, null);
    assert.ok(Array.isArray(full.swaps) && full.swaps.length > 0);
    assert.strictEqual(full.suggestions.items.length, 0);
    assert.ok(full.complete);
});

test('analysis: best reachable score while incomplete, band score when full', () => {
    const s = soloState();
    const v = V.draftView(s, ctx);
    assert.strictEqual(v.analysis.score.complete, false);
    assert.strictEqual(v.analysis.score.percent, D.suggestBands(s, ctx, 1)[0].topPercent);
    assert.strictEqual(v.analysis.score.label, `Best reachable: ${V.percentLabel(v.analysis.score.percent)}`);
    assert.strictEqual(v.suggestions.items[0].topPercent, v.analysis.score.percent, 'last pick: top suggestion = best band');
    const full = V.draftView(D.applyAction(s, 'FIDEA'), ctx);
    assert.strictEqual(full.analysis.score.complete, true);
    assert.match(full.analysis.score.label, /^Band: Top \d+%$/);
});

test('analysis: roles list who covers each role', () => {
    const v = V.draftView(soloState(), ctx);
    assert.deepStrictEqual(v.analysis.roles.map(r => r.role), D.BATTLE_ROLES);
    assert.strictEqual(v.analysis.coveredCount, 2);
    const missing = v.analysis.roles.filter(r => r.coveredBy === null);
    assert.strictEqual(missing.length, 1);
});

test('analysis: threats come from the opponents, synergy from inside the band', () => {
    const counter = ctx.relations.find(r => r.type === 'counter');
    let s = D.setEnemies(D.createDraft('solo'), [counter.supplier]);
    s = D.applyAction(s, counter.needer);
    const v = V.draftView(s, ctx);
    assert.ok(v.analysis.threats.length > 0 && v.analysis.threats.every(r => r.kind === 'warning'));
    const band = V.draftView(pickAll(D.createDraft('solo'), ['VINCTUM', 'ERESIDA']), ctx);
    assert.ok(band.analysis.synergy.length > 0 && band.analysis.synergy.every(r => r.factor === 'synergy'));
    assert.deepStrictEqual(V.draftView(D.createDraft('solo'), ctx).analysis.threats, []);
});

test('preview marks the previewed slot and the analysis change, without changing state', () => {
    const s = soloState();
    const plain = V.draftView(s, ctx);
    assert.ok(plain.analysis.roles.every(r => r.change === null));
    assert.strictEqual(plain.analysis.score.change, null);

    const v = V.draftView(s, ctx, { preview: 'FIDEA' });
    assert.deepStrictEqual(v.slots[2], { index: 2, hero: 'FIDEA', preview: true });
    const supporter = v.analysis.roles.find(r => r.role === 'Supporter');
    assert.deepStrictEqual([supporter.coveredBy, supporter.change], ['FIDEA', 'added']);
    assert.ok(v.analysis.score.change && typeof v.analysis.score.change.from === 'number');
    assert.deepStrictEqual(v.suggestions.items.map(i => i.name), plain.suggestions.items.map(i => i.name),
        'suggestions are for the real state');
    assert.deepStrictEqual(D.myBand(s), ['FERRARIUS', 'BALLISTARIUS']);
    const baseIds = new Set(plain.analysis.synergy.map(r => r.id));
    v.analysis.synergy.forEach(r => assert.strictEqual(r.preview, !baseIds.has(r.id), r.id));
});

test('preview of a complete band fills every empty slot', () => {
    const s = D.applyAction(D.createDraft('solo'), 'FERRARIUS');
    const v = V.draftView(s, ctx, { preview: ['FERRARIUS', 'BALLISTARIUS', 'TEMPUS'] });
    assert.deepStrictEqual(v.slots.map(x => [x.hero, x.preview]), [['FERRARIUS', false], ['BALLISTARIUS', true], ['TEMPUS', true]]);
});

test('previewing an unavailable hero is ignored', () => {
    const v = V.draftView(soloState(), ctx, { preview: 'SAXUM' });
    assert.ok(v.slots.every(x => !x.preview));
});

test('step and intro text', () => {
    const empty = V.draftView(D.createDraft('solo'), ctx);
    assert.strictEqual(empty.step.label, 'Your pick 1 of 3');
    assert.ok(empty.intro && /versatile/i.test(empty.intro));
    assert.strictEqual(V.draftView(soloState(), ctx).intro, null);
});



test('two-player: a finished band gets no swap suggestions', () => {
    const s = pickAll(D.createDraft('standard'), ['FIDEA', 'SAXUM', 'GOETIUM', 'ARMUS', 'MESSUM', 'TEMPUS']);
    assert.strictEqual(V.draftView(s, ctx).swaps, null);
});

test('every available hero is ranked, and the pool carries each rank', () => {
    const v = V.draftView(soloState(), ctx);
    assert.strictEqual(v.suggestions.items.length, v.counts.available, 'all candidates, not a top-N');
    v.suggestions.items.forEach((item, i) => {
        const entry = v.pool.find(p => p.name === item.name);
        assert.strictEqual(entry.suggestion.rank, i + 1, item.name);
        assert.strictEqual(entry.suggestion.percentLabel, item.percentLabel);
        assert.deepStrictEqual(entry.suggestion.reasons, item.reasons);
    });
    v.pool.filter(p => !p.available).forEach(p => assert.strictEqual(p.suggestion, null, p.name));
});

// ---- Two-player: a neutral helper for Player 1 and Player 2 -------------------------------

test('two-player: both players by number, sequence and bans, Player 1 first', () => {
    let s = D.createDraft('interleaved');
    let v = V.draftView(s, ctx);
    assert.strictEqual(v.mode, 'two-player');
    assert.strictEqual(v.sequence.length, 12);
    assert.deepStrictEqual(v.sequence[0], { index: 0, player: 1, action: 'ban', hero: null, status: 'current' });
    assert.strictEqual(v.step.label, 'Player 1 ban 1 of 3');
    assert.deepStrictEqual(v.players.map(p => [p.player, p.label, p.acting]), [[1, 'Player 1', true], [2, 'Player 2', false]]);

    s = D.applyAction(s, 'SAXUM');
    v = V.draftView(s, ctx);
    assert.strictEqual(v.step.label, 'Player 2 ban 1 of 3');
    assert.deepStrictEqual(v.sequence[0], { index: 0, player: 1, action: 'ban', hero: 'SAXUM', status: 'done' });

    s = pickAll(s, ['TEMPUS', 'FERRARIUS', 'FIDEA']);
    v = V.draftView(s, ctx);
    assert.deepStrictEqual(v.players[0].bans, ['SAXUM']);
    assert.deepStrictEqual(v.players[1].bans, ['TEMPUS']);
    assert.deepStrictEqual(v.players[0].slots.map(x => x.hero), ['FERRARIUS', null, null]);
    assert.deepStrictEqual(v.players[1].slots.map(x => x.hero), ['FIDEA', null, null]);
    const reason = n => v.pool.find(p => p.name === n).unavailableReason;
    assert.deepStrictEqual([reason('FERRARIUS'), reason('FIDEA'), reason('TEMPUS')], ['player1', 'player2', 'banned']);
    assert.strictEqual(v.completions, null, 'no completions on ban steps');
});

test('two-player: suggestions are always ranked for whoever acts, with select / ban', () => {
    const s0 = D.createDraft('standard');
    const v0 = V.draftView(s0, ctx);
    assert.deepStrictEqual([v0.suggestions.action, v0.suggestions.player], ['select', 1]);
    const s1 = D.applyAction(s0, 'SAXUM');
    const v1 = V.draftView(s1, ctx);
    assert.deepStrictEqual([v1.suggestions.action, v1.suggestions.player], ['select', 2]);
    assert.strictEqual(v1.suggestions.items.length, v1.counts.available, 'Player 2 is ranked without asking');
    assert.deepStrictEqual(v1.suggestions.items.map(i => i.name), D.suggestPick(s1, ctx, Infinity, { player: 2 }).map(i => i.name));
    const ban = V.draftView(D.createDraft('ban-first'), ctx).suggestions;
    assert.deepStrictEqual([ban.action, ban.player], ['ban', 1]);
});

test('two-player: completions, intro and preview belong to the acting player', () => {
    const s = D.applyAction(D.createDraft('standard'), 'SAXUM');
    const v = V.draftView(s, ctx);
    assert.ok(v.completions.every(c => !c.heroes.includes('SAXUM')), "Player 2's completions");
    assert.ok(v.intro, 'Player 2 has no hero yet');
    const p = V.draftView(s, ctx, { preview: 'FIDEA' });
    assert.deepStrictEqual(p.players[1].slots[0], { index: 0, hero: 'FIDEA', preview: true });
    assert.ok(p.players[0].slots.every(x => !x.preview));
});

test('two-player: analysis follows the acting player unless another is chosen', () => {
    const s = pickAll(D.createDraft('standard'), ['SAXUM', 'TEMPUS']);
    const v = V.draftView(s, ctx);
    assert.strictEqual(v.focus, 1, 'Player 1 acts');
    assert.strictEqual(v.analysis.roles.filter(r => r.coveredBy).map(r => r.coveredBy)[0], 'SAXUM');
    const p2 = V.draftView(s, ctx, { player: 2 });
    assert.strictEqual(p2.focus, 2);
    assert.ok(p2.analysis.roles.some(r => r.coveredBy === 'TEMPUS'));
    const done = pickAll(s, ['FIDEA', 'GOETIUM', 'MESSUM', 'ARMUS']);
    assert.strictEqual(V.draftView(done, ctx).focus, 1, 'a finished draft shows Player 1 first');
});

