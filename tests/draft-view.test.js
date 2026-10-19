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

test('slots: 3 in pick order, the first starts on the Castle', () => {
    const v = V.draftView(soloState(), ctx);
    assert.deepStrictEqual(v.slots.map(s => s.hero), ['FERRARIUS', 'BALLISTARIUS', null]);
    assert.deepStrictEqual(v.slots.map(s => s.startsOnCastle), [true, false, false]);
    assert.ok(v.slots.every(s => s.preview === false));
    assert.deepStrictEqual(v.against, ['SAXUM', 'ILLESEBRA', 'MAGNUS']);
    assert.deepStrictEqual(v.excluded, ['LIBRORUM', 'TENEBRIS']);
});

test('every chip comes from an engine reason, positives first, at least one warning kept', () => {
    const v = V.draftView(soloState(), ctx, { limit: 36 });
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

test('completions only when 2 or more slots are empty; swaps only when the band is full', () => {
    const empty = V.draftView(D.createDraft('solo'), ctx);
    assert.ok(Array.isArray(empty.completions) && empty.completions.length > 0);
    assert.strictEqual(empty.swaps, null);
    const one = V.draftView(D.applyAction(D.createDraft('solo'), 'FERRARIUS'), ctx);
    assert.ok(one.completions.every(c => c.heroes[0] === 'FERRARIUS'));
    assert.strictEqual(V.draftView(soloState(), ctx).completions, null);
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
    assert.deepStrictEqual(v.slots[2], { index: 2, hero: 'FIDEA', preview: true, startsOnCastle: false });
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

test('two-player: sequence, opponent row, bans and the action for the current step', () => {
    let s = D.createDraft('interleaved', { me: 1 });
    let v = V.draftView(s, ctx);
    assert.strictEqual(v.mode, 'two-player');
    assert.strictEqual(v.sequence.length, 12);
    assert.deepStrictEqual(v.sequence[0], { index: 0, player: 1, action: 'ban', mine: true, hero: null, status: 'current' });
    assert.strictEqual(v.step.label, 'Your ban 1 of 3');
    assert.strictEqual(v.suggestions.action, 'ban');
    assert.ok(v.suggestions.items.length > 0);

    s = D.applyAction(s, 'SAXUM');
    v = V.draftView(s, ctx);
    assert.strictEqual(v.step.label, 'Opponent ban 1 of 3');
    assert.strictEqual(v.suggestions.action, 'record');
    assert.strictEqual(v.suggestions.items.length, 0, 'no suggestions on opponent steps by default');
    assert.ok(V.draftView(s, ctx, { showOpponent: true }).suggestions.items.length > 0);
    assert.strictEqual(v.sequence[0].status, 'done');
    assert.strictEqual(v.sequence[0].hero, 'SAXUM');

    s = pickAll(s, ['TEMPUS', 'FERRARIUS', 'FIDEA']);
    v = V.draftView(s, ctx);
    assert.deepStrictEqual(v.bans, { mine: ['SAXUM'], theirs: ['TEMPUS'] });
    assert.deepStrictEqual(v.slots.map(x => x.hero), ['FERRARIUS', null, null]);
    assert.deepStrictEqual(v.against, ['FIDEA']);
    assert.strictEqual(v.pool.find(p => p.name === 'TEMPUS').unavailableReason, 'banned');
    assert.strictEqual(v.pool.find(p => p.name === 'FIDEA').unavailableReason, 'facing');
    assert.strictEqual(v.completions, null, 'two-player shows no completions on ban steps');
});

test('two-player completions appear on your own pick steps', () => {
    const v = V.draftView(D.createDraft('standard'), ctx);
    assert.strictEqual(v.suggestions.action, 'add');
    assert.ok(Array.isArray(v.completions));
    const opp = V.draftView(D.applyAction(D.createDraft('standard'), 'SAXUM'), ctx);
    assert.strictEqual(opp.completions, null);
});

test('two-player: a finished band gets no swap suggestions', () => {
    const s = pickAll(D.createDraft('standard'), ['FIDEA', 'SAXUM', 'GOETIUM', 'ARMUS', 'MESSUM', 'TEMPUS']);
    assert.strictEqual(V.draftView(s, ctx).swaps, null);
});
