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
        assert.strictEqual(item.moreChips, item.reasons.filter(r => r.kind !== 'info' && r.factor !== 'ban').length - item.chips.length);
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

test('a full band is complete and has nothing left to rank', () => {
    const empty = V.draftView(D.createDraft('solo'), ctx);
    assert.ok(!('completions' in empty), 'completions live in the tile popover (Best with) now');
    const full = V.draftView(pickAll(D.createDraft('solo'), ['FIDEA', 'GOETIUM', 'MESSUM']), ctx);
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

test('two-player: best partners, intro and preview belong to the acting player', () => {
    const s = D.applyAction(D.createDraft('standard'), 'SAXUM');
    const v = V.draftView(s, ctx);
    assert.ok(v.suggestions.items.every(i => !i.bestWith.includes('SAXUM')), "Player 2's bands");
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


// ---- Tile chips and popover (#2) -----------------------------------------------------------

test('tiles get at most 2 short chips, a warning is never cut', () => {
    assert.strictEqual(V.MAX_CHIPS, 2);
    const s = pickAll(D.setEnemies(D.createDraft('solo'), ['SAXUM']), ['FERRARIUS', 'BALLISTARIUS']);
    const v = V.draftView(s, ctx);
    v.suggestions.items.forEach(item => {
        assert.ok(item.chips.length <= 2, item.name);
        assert.ok(item.chips.every(c => !c.reasonId.startsWith('ban:')), 'the ban line is the same on every tile');
        item.chips.forEach(c => assert.ok(c.short && c.short.length <= 32, `${item.name}: "${c.short}"`));
    });
    const fidea = v.suggestions.items.find(i => i.name === 'FIDEA');
    assert.ok(fidea.chips.some(c => c.short === 'Fills Supporter'), JSON.stringify(fidea.chips));
});

test('short chip texts', () => {
    const r = (id, text, extra = {}) => ({ id, text, kind: 'positive', delta: 1, heroes: [], ...extra });
    const fills = roles => r('fills', '…', { heroes: ['X'], roles });
    assert.strictEqual(V.shortReason(fills(['Supporter']), 'X'), 'Fills Supporter');
    assert.strictEqual(V.shortReason(fills(['Controller', 'Supporter']), 'X'), 'Fills Controller or Supporter');
    assert.strictEqual(V.shortReason(fills(['Controller', 'Attacker', 'Supporter']), 'X'), 'Fills any role');
    assert.strictEqual(V.shortReason(r('countered:SAXUM>FERRARIUS:x', 'Weak vs Saxum (Stun)', { kind: 'warning', attacker: 'SAXUM', victim: 'FERRARIUS' }), 'FERRARIUS'), 'Weak vs Saxum');
    assert.strictEqual(V.shortReason(r('counter:SAXUM>FERRARIUS:x', 'Counters Ferrarius (Stun)', { kind: 'counter', attacker: 'SAXUM', victim: 'FERRARIUS' }), 'SAXUM'), 'Counters Ferrarius');
    const syn = { beneficiary: 'TOXICUM', suppliers: ['EQUITA'], detail: 'Poison' };
    assert.strictEqual(V.shortReason(r('synergy:TOXICUM:Poison:X', 'Synergy: …', syn), 'TOXICUM'), 'Helped by Equita (Poison)');
    assert.strictEqual(V.shortReason(r('synergy:TOXICUM:Poison:X', 'Synergy: …', syn), 'EQUITA'), 'Helps Toxicum (Poison)');
    assert.strictEqual(V.shortReason(r('theme:Debuffs', 'Theme: Debuffs (Poison)'), 'X'), 'Theme: Debuffs');
    assert.strictEqual(V.shortReason(r('coverage:missing:Controller', 'No Controller', { kind: 'warning' }), 'X'), 'No Controller');
    assert.strictEqual(V.shortReason(r('ban:denies', 'Denies Player 2: A + B + C'), 'A'), 'Denies Player 2 this band');
});

test('suggestions name the partners of their best band (Best with)', () => {
    const s = D.applyAction(D.createDraft('solo'), 'FERRARIUS');
    V.draftView(s, ctx).suggestions.items.forEach(item => {
        assert.deepStrictEqual(item.bestWith, item.bestBand.filter(n => n !== item.name && n !== 'FERRARIUS'), item.name);
        assert.strictEqual(item.bestWith.length, 1);
    });
});

test('pool: the roles a hero would add to this band (the rest are dimmed), and how many enemies it counters', () => {
    const s = pickAll(D.setEnemies(D.createDraft('solo'), ['SAXUM', 'MAGNUS']), ['FERRARIUS', 'BALLISTARIUS']);
    const v = V.draftView(s, ctx);
    const fills = n => v.pool.find(p => p.name === n).fills;
    assert.deepStrictEqual(fills('FIDEA'), ['Supporter']);
    assert.deepStrictEqual(fills('TEMPUS'), ['Controller', 'Supporter']);
    assert.deepStrictEqual(fills('EQUITA'), []);
    v.pool.forEach(p => {
        const counters = p.suggestion ? p.suggestion.reasons.filter(r => r.kind === 'counter').length : 0;
        assert.strictEqual(p.counters, counters, p.name);
    });
    assert.ok(v.pool.some(p => p.counters > 0), 'someone counters Saxum or Magnus');
    const flexible = V.draftView(D.applyAction(D.createDraft('solo'), 'TOXICUM'), ctx);
    assert.deepStrictEqual(flexible.pool.find(p => p.name === 'MALLEUS').fills, ['Controller', 'Attacker', 'Supporter'],
        'a flexible band leaves every role open');
    const empty = V.draftView(D.createDraft('solo'), ctx);
    empty.pool.forEach(p => assert.deepStrictEqual(p.fills, p.battleRoles, 'no band yet: every role counts'));
    const ban = V.draftView(D.applyAction(D.createDraft('ban-first'), 'SAXUM'), ctx);
    ban.pool.forEach(p => assert.deepStrictEqual(p.fills, p.battleRoles, 'ban steps: nothing dimmed'));
});

test('popover reasons are grouped by type, each reason in exactly one group', () => {
    const s = pickAll(D.setEnemies(D.createDraft('solo'), ['SAXUM']), ['TOXICUM', 'TEMPUS']);
    V.draftView(s, ctx).suggestions.items.forEach(item => {
        const groups = V.reasonGroups(item.reasons);
        assert.deepStrictEqual(groups.flatMap(g => g.reasons.map(r => r.id)).sort(), item.reasons.map(r => r.id).sort(), item.name);
        groups.forEach(g => assert.ok(g.type && g.label && g.reasons.length, item.name));
        assert.strictEqual(new Set(groups.map(g => g.type)).size, groups.length);
    });
    const equita = V.draftView(s, ctx).suggestions.items.find(i => i.name === 'EQUITA');
    const types = Object.fromEntries(V.reasonGroups(equita.reasons).map(g => [g.type, g.reasons.map(r => r.id)]));
    assert.ok(types.synergy.every(id => id.startsWith('synergy:') || id.startsWith('broad:')));
    assert.ok((types.support || []).every(id => id.startsWith('enabler:')));
    assert.ok(Object.keys(types).every(t => V.REASON_TYPES.some(rt => rt.type === t)));
});

// ---- Grouped synergy and "Show N more" (#5) ------------------------------------------------

test('synergy is grouped by the hero who benefits, merging duplicate wording', () => {
    const v = V.draftView(pickAll(D.createDraft('solo'), ['TOXICUM', 'TEMPUS', 'EQUITA']), ctx);
    const groups = Object.fromEntries(v.analysis.synergyGroups.map(g => [g.hero, g.from.map(f => [f.heroes, f.details])]));
    assert.deepStrictEqual(groups.TOXICUM, [[['EQUITA'], ['Poison']], [['TEMPUS'], ['Swiftness', 'cooldowns']]]);
    assert.deepStrictEqual(groups.EQUITA, [[['TEMPUS'], ['Swiftness', 'cooldowns']]]);
    assert.deepStrictEqual(groups.TEMPUS, [[['TOXICUM', 'EQUITA'], ['Abilities on cooldown']]]);
    const ids = v.analysis.synergyGroups.flatMap(g => g.ids).sort();
    assert.deepStrictEqual(ids, v.analysis.synergy.map(r => r.id).sort(), 'every synergy reason lands in one group');
    assert.strictEqual(V.groupText(v.analysis.synergyGroups.find(g => g.hero === 'TOXICUM')),
        'Equita (Poison), Tempus (Swiftness, cooldowns)');
});

test('collapse shows the first items and counts the rest exactly', () => {
    assert.deepStrictEqual(V.collapse([1, 2, 3, 4, 5], 3, false), { items: [1, 2, 3], hidden: 2, expanded: false });
    assert.deepStrictEqual(V.collapse([1, 2, 3, 4, 5], 3, true), { items: [1, 2, 3, 4, 5], hidden: 2, expanded: true });
    assert.deepStrictEqual(V.collapse([1, 2], 3, false), { items: [1, 2], hidden: 0, expanded: false });
});

// ---- Reference cards modal --------------------------------------------------------------

test('reference cards: one tab per player, or your band and Against in solo', () => {
    const s = pickAll(D.createDraft('standard'), ['TOXICUM', 'SAXUM', 'TEMPUS', 'MALLEUS', 'EQUITA', 'FERRARIUS']);
    assert.deepStrictEqual(V.referenceSides(s), [
        { key: '1', label: 'Player 1', heroes: ['TOXICUM', 'TEMPUS', 'EQUITA'] },
        { key: '2', label: 'Player 2', heroes: ['SAXUM', 'MALLEUS', 'FERRARIUS'] }]);
    const band = pickAll(D.createDraft('solo'), ['FIDEA', 'GOETIUM', 'MESSUM']);
    assert.deepStrictEqual(V.referenceSides(band), [{ key: 'mine', label: 'Your band', heroes: ['FIDEA', 'GOETIUM', 'MESSUM'] }]);
    assert.deepStrictEqual(V.referenceSides(D.setEnemies(band, ['SAXUM'])).map(x => x.key), ['mine', 'against']);
});

// ---- Random hero roll ------------------------------------------------------------------------

test('rollFrames highlights candidates with growing delays and settles on the winner', () => {
    const frames = V.rollFrames(['A', 'B', 'C', 'D'], 'C', { steps: 10, rng: () => 0.5 });
    assert.strictEqual(frames.length, 10);
    assert.strictEqual(frames.at(-1).name, 'C');
    frames.forEach(f => assert.ok(['A', 'B', 'C', 'D'].includes(f.name)));
    frames.slice(1).forEach((f, i) => {
        assert.notStrictEqual(f.name, frames[i].name, 'never lights the same tile twice in a row');
        assert.ok(f.delay >= frames[i].delay, 'slows down as it settles');
    });
});

test('rollFrames with a single candidate shows only the winner', () => {
    assert.deepStrictEqual(V.rollFrames(['A'], 'A', { steps: 10 }).map(f => f.name), ['A']);
});

test('rollFrames alternates cleanly between two candidates', () => {
    for (const r of [0, 0.5, 0.99]) {
        const names = V.rollFrames(['A', 'B'], 'B', { steps: 9, rng: () => r }).map(f => f.name);
        assert.deepStrictEqual(names, ['B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
    }
});
