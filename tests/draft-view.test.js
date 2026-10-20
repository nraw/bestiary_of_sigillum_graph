// Run with: node --test tests/*.test.js
// Draft view model (draft-view.js): exactly what the draft UI renders, derived from the engine
const test = require('node:test');
const assert = require('node:assert');
const D = require('../draft.js');
const V = require('../draft-view.js');
const S = require('../synergy.js');

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

test('percent explanations say what "Top N%" is a share of, in the same rounded numbers', () => {
    assert.strictEqual(V.percentExplain(0.01),
        'Top 1%: at most 1% of all possible 3-hero bands score as well or better.');
    assert.strictEqual(V.percentExplain(2.3, { facing: true }),
        'Top 3%: at most 3% of all possible 3-hero bands score as well or better against this opponent.');
    assert.strictEqual(V.percentExplain(80),
        'Bottom 21%: only about 21% of all possible 3-hero bands score this low or lower.');
    assert.strictEqual(V.percentExplain(null), '');
});

test('every battle role has a plain-language explanation', () => {
    assert.deepStrictEqual(Object.keys(V.ROLE_INFO), D.BATTLE_ROLES);
    Object.values(V.ROLE_INFO).forEach(text => assert.ok(text.length > 20 && text.length <= 160, text));
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
    const baseIds = new Set(plain.analysis.reasons.map(r => r.id));
    v.analysis.reasons.forEach(r => assert.strictEqual(r.preview, !baseIds.has(r.id), r.id));
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

test('step text, and no intro text', () => {
    const empty = V.draftView(D.createDraft('solo'), ctx);
    assert.strictEqual(empty.step.label, 'Your pick 1 of 3');
    assert.ok(!('intro' in empty));
    assert.ok(!('INTRO' in V));
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

test('two-player: best partners and preview belong to the acting player', () => {
    const s = D.applyAction(D.createDraft('standard'), 'SAXUM');
    const v = V.draftView(s, ctx);
    assert.ok(v.suggestions.items.every(i => !i.bestWith.includes('SAXUM')), "Player 2's bands");
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

// ---- Popover sections: who the reasons are with, and how much they weigh ------------------------

const itemOf = (v, name) => v.suggestions.items.find(i => i.name === name);
const sectionIds = section => section.lines.flatMap(l => l.ids);

test('strength: one dot per 1.5 points, at most 5; a net loss is a warning without dots', () => {
    assert.deepStrictEqual([0, 0.4, 1.5, 4.5, 6, 100].map(d => V.strength(d).dots), [0, 1, 1, 3, 4, 5]);
    assert.deepStrictEqual(V.strength(-4), { dots: 0, warning: true });
    assert.strictEqual(V.strength(3).warning, false);
});

test('popover sections: the band\'s teammates together, then the band as a whole, then the matchup', () => {
    const v = V.draftView(pickAll(D.setEnemies(D.createDraft('solo'), ['SAXUM']), ['TOXICUM']), ctx);
    const tempus = itemOf(v, 'TEMPUS');
    assert.deepStrictEqual(tempus.sections.map(x => x.key).filter(k => k !== 'matchup'), ['team', 'band']);
    const team = tempus.sections[0];
    assert.deepStrictEqual([team.label, team.title], ['With your band', 'Tempus with Toxicum']);
    assert.deepStrictEqual(sectionIds(team).filter(id => id.startsWith('enabler:')).sort(), ['enabler:cooldowns:TOXICUM', 'enabler:swiftness:TOXICUM']);
    assert.ok(sectionIds(tempus.sections[1]).includes('theme:Cooldowns') && sectionIds(tempus.sections[1]).includes('fills'));
    v.suggestions.items.forEach(item => {
        const ids = item.sections.flatMap(sectionIds).sort();
        assert.deepStrictEqual(ids, item.reasons.filter(r => r.kind !== 'info').map(r => r.id).sort(), `${item.name}: every reason on one line`);
        item.sections.forEach(x => {
            assert.strictEqual(x.delta, x.reasons.reduce((t, r) => t + r.delta, 0));
            assert.deepStrictEqual(x.strength, V.strength(x.delta));
            x.lines.forEach(l => assert.deepStrictEqual(l.reasons.map(r => r.id), l.ids));
        });
        const matchup = item.sections.find(x => x.key === 'matchup');
        if (matchup) assert.strictEqual(matchup.label, 'vs Against');
    });
});

test('popover lines: the same help to several teammates is one line', () => {
    const v = V.draftView(pickAll(D.createDraft('solo'), ['TOXICUM', 'MAGNUS']), ctx);
    const team = itemOf(v, 'ARBORUS').sections.find(x => x.key === 'team');
    assert.strictEqual(team.title, 'Arborus with Toxicum and Magnus');
    const keeps = team.lines.find(l => l.text === 'Arborus keeps Toxicum and Magnus alive');
    assert.deepStrictEqual(keeps && keeps.ids.sort(), ['enabler:protection:MAGNUS', 'enabler:protection:TOXICUM']);
    assert.ok(team.lines.some(l => l.text === 'Toxicum and Magnus move enemies into position for Arborus'));
    assert.strictEqual(team.lines.length, 2);
});

test('popover lines name the abilities behind a single relation', () => {
    const v = V.draftView(pickAll(D.createDraft('solo'), ['TOXICUM']), ctx);
    const line = itemOf(v, 'EQUITA').sections[0].lines.find(l => l.ids[0].startsWith('synergy:TOXICUM:Poison'));
    const relation = line.reasons[0].relations[0];
    assert.strictEqual(line.text, S.describeRelation(relation));
    assert.strictEqual(line.kind, 'positive');
});

test('popover sections on a ban step: the ban first, then the rival\'s reasons', () => {
    const v = V.draftView(D.createDraft('ban-first'), ctx);
    v.suggestions.items.slice(0, 5).forEach(item => {
        assert.deepStrictEqual([item.sections[0].key, item.sections[0].label], ['ban', 'Ban'], item.name);
        assert.ok(item.sections.every(x => x.key !== 'matchup' || x.label === 'vs Player 1'), item.name);
    });
});

// ---- Band analysis rows and score breakdown -----------------------------------------------------

const sectionOf = (v, key) => v.analysis.sections.find(x => x.key === key);

test('analysis sections: synergy by pair, conflicts, themes, matchup both ways, durability', () => {
    const v = V.draftView(pickAll(D.createDraft('solo'), ['TOXICUM', 'TEMPUS', 'EQUITA']), ctx);
    assert.deepStrictEqual(v.analysis.sections.map(x => [x.key, x.label]).filter(([k]) => ['synergy', 'theme'].includes(k)),
        [['synergy', 'Synergy in band'], ['theme', 'Themes']]);
    // Synergy rows are sentences, one per fact; the poison row names the abilities on both sides
    const poison = sectionOf(v, 'synergy').rows.find(r => r.reasons[0].id.startsWith('synergy:TOXICUM:Poison'));
    assert.deepStrictEqual([poison.label, poison.text, poison.title], ['', S.describeRelation(poison.reasons[0].relations[0]), 'Equita and Toxicum']);
    const team = D.scoreTeam(['TOXICUM', 'TEMPUS', 'EQUITA'], ctx).reasons;
    assert.deepStrictEqual(sectionOf(v, 'synergy').rows.flatMap(r => r.reasons.map(x => x.id)).sort(),
        team.filter(r => r.factor === 'synergy').map(r => r.id).sort(), 'every synergy reason in one row');
    // Member order follows the engine's cached band, so compare as a set
    const cooldowns = sectionOf(v, 'theme').rows.find(r => r.label === 'Cooldowns');
    assert.deepStrictEqual(cooldowns.text.split(', ').sort(), ['Equita', 'Tempus', 'Toxicum']);

    const clash = ctx.relations.find(r => r.type === 'conflict' && r.supplier !== r.needer);
    const careful = V.draftView(pickAll(D.createDraft('solo'), [clash.supplier, clash.needer]), ctx);
    assert.strictEqual(sectionOf(careful, 'conflict').label, 'Careful with');
    assert.ok(sectionOf(careful, 'conflict').rows.every(r => r.kind === 'warning' && r.label === '' && r.text));

    const counter = ctx.relations.find(r => r.type === 'counter' && r.rule !== 'size');
    const facing = V.draftView(D.applyAction(D.setEnemies(D.createDraft('solo'), [counter.supplier]), counter.needer), ctx);
    assert.strictEqual(sectionOf(facing, 'matchup').label, 'Matchup vs Against');
    const threat = sectionOf(facing, 'matchup').rows.find(r => r.kind === 'warning');
    assert.strictEqual(threat.label, `${S.titleCase(counter.supplier)} threatens ${S.titleCase(counter.needer)}`);
    const ours = V.draftView(D.applyAction(D.setEnemies(D.createDraft('solo'), [counter.needer]), counter.supplier), ctx);
    assert.ok(sectionOf(ours, 'matchup').rows.some(r => r.kind === 'counter'
        && r.label === `${S.titleCase(counter.supplier)} counters ${S.titleCase(counter.needer)}`));
    assert.deepStrictEqual(V.draftView(D.createDraft('solo'), ctx).analysis.sections, []);
});

test('analysis synergy: the same help to several teammates is one row, never a three-hero label', () => {
    const v = V.draftView(pickAll(D.createDraft('solo'), ['TOXICUM', 'MAGNUS', 'ARBORUS']), ctx);
    const rows = sectionOf(v, 'synergy').rows;
    const keeps = rows.find(r => r.text === 'Arborus keeps Toxicum and Magnus alive');
    assert.deepStrictEqual(keeps.reasons.map(r => r.id).sort(), ['enabler:protection:MAGNUS', 'enabler:protection:TOXICUM']);
    assert.strictEqual(keeps.title, 'Arborus, Toxicum and Magnus');
    assert.ok(rows.every(r => r.label === ''));
    // One need met by two teammates is a sentence too, not "A, B → C"
    const both = V.draftView(pickAll(D.createDraft('solo'), ['TOXICUM', 'TEMPUS', 'EQUITA']), ctx);
    assert.ok(sectionOf(both, 'synergy').rows.some(r => r.text === "Toxicum and Equita each supply Abilities on cooldown for Tempus's Pendulum"));
    assert.ok(sectionOf(both, 'synergy').rows.every(r => !r.text.includes('→')));
});

test('score breakdown: the points per factor, adding up to the band\'s value', () => {
    const band = ['TOXICUM', 'TEMPUS', 'EQUITA'];
    const v = V.draftView(D.setEnemies(pickAll(D.createDraft('solo'), band), ['SAXUM']), ctx);
    const total = D.scoreTeam(band, ctx).total + D.scoreMatchup(band, ['SAXUM'], ctx).total;
    const sum = v.analysis.breakdown.reduce((t, f) => t + f.delta, 0);
    assert.ok(Math.abs(sum - total) < 1e-9);
    assert.deepStrictEqual(v.analysis.breakdown.map(f => f.label).filter(l => ['Roles', 'Synergy', 'Themes'].includes(l)), ['Roles', 'Synergy', 'Themes']);
    v.analysis.breakdown.forEach(f => assert.ok(f.delta !== 0, f.label));
});

test('preview flags the rows only the previewed hero brings', () => {
    const s = pickAll(D.createDraft('solo'), ['TOXICUM', 'TEMPUS']);
    const v = V.draftView(s, ctx, { preview: 'EQUITA' });
    const rows = v.analysis.sections.flatMap(x => x.rows);
    assert.ok(rows.find(r => r.reasons.some(x => x.id.startsWith('synergy:TOXICUM:Poison'))).preview);
    const base = V.draftView(s, ctx).analysis.sections.flatMap(x => x.rows);
    assert.ok(base.every(r => !r.preview));
});

// ---- Inspector -------------------------------------------------------------------------------------

test('inspectView: the reasons in words, then each hero\'s card evidence', () => {
    const team = D.scoreTeam(['TOXICUM', 'TEMPUS', 'EQUITA'], ctx).reasons;
    const reasons = team.filter(r => r.factor === 'synergy' && [...r.heroes].sort().join('|') === 'EQUITA|TOXICUM');
    const view = V.inspectView(reasons, ctx, { title: 'Equita + Toxicum' });
    assert.strictEqual(view.title, 'Equita + Toxicum');
    assert.ok(view.lines.some(l => l.text === S.describeRelation(reasons.find(r => r.relations).relations[0])));
    assert.deepStrictEqual(view.sides.map(x => x.hero).sort(), ['EQUITA', 'TOXICUM']);
    const equita = view.sides.find(x => x.hero === 'EQUITA');
    assert.deepStrictEqual([equita.display, equita.image, equita.theirs], ['Equita', 'hero_images/equita.png', false]);
    assert.ok(equita.abilities.some(g => g.links.some(l => l.label === 'Poison')));
    // Abilities picked by index (no trait link) and notes come through too
    const cooldowns = V.inspectView([team.find(r => r.id === 'enabler:cooldowns:TOXICUM')], ctx);
    assert.deepStrictEqual(cooldowns.sides.find(x => x.hero === 'TOXICUM').abilities.map(g => g.index), [1, 2]);
    const frontline = D.scoreTeam(['SAXUM', 'TEMPUS'], ctx).reasons.find(r => r.id === 'durability:frontline');
    assert.deepStrictEqual(V.inspectView([frontline], ctx).sides[0].notes, [`Vitality ${heroes.find(h => h.name === 'SAXUM').vitality}`]);
});

test('inspectView merges the same help to several teammates into one line', () => {
    const team = D.scoreTeam(['ARBORUS', 'TOXICUM', 'MAGNUS'], ctx).reasons.filter(r => r.rule === 'protection');
    assert.deepStrictEqual(V.inspectView(team, ctx).lines.map(l => l.text), ['Arborus keeps Toxicum and Magnus alive']);
});

test('inspectView marks the opposing side and expands a ban into the band it denies', () => {
    const counter = ctx.relations.find(r => r.type === 'counter' && r.rule !== 'size');
    const lost = D.scoreMatchup([counter.needer], [counter.supplier], ctx).reasons.find(r => r.kind === 'warning');
    const view = V.inspectView([lost], ctx, { opponents: [counter.supplier] });
    assert.deepStrictEqual(view.sides.map(x => [x.hero, x.theirs]).sort(), [[counter.needer, false], [counter.supplier, true]].sort());
    const ban = D.suggestBan(D.createDraft('ban-first'), ctx, 1)[0].reasons.find(r => r.id === 'ban:denies');
    const denied = V.inspectView([ban], ctx);
    assert.strictEqual(denied.lines[0].text, ban.text);
    assert.ok(denied.lines.length > 1, 'the denied band\'s own reasons follow');
    assert.deepStrictEqual(denied.sides.map(x => x.hero).sort(), [...ban.band].sort());
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

test('reference cards for one hero (from the pool): a single side with just that card', () => {
    const s = pickAll(D.createDraft('standard'), ['TOXICUM']);
    assert.deepStrictEqual(V.referenceSides(s, { hero: 'TEMPUS' }), [{ key: 'hero', label: 'Tempus', heroes: ['TEMPUS'] }]);
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

test('graphAction: the graph\'s draft button follows the current step', () => {
    const solo = D.createDraft('solo');
    assert.deepStrictEqual(V.graphAction(solo, 'AQUS'), { label: 'Add to band', enabled: true });
    assert.deepStrictEqual(V.graphAction(pickAll(solo, ['AQUS']), 'AQUS'), { label: 'In your band', enabled: false });
    assert.deepStrictEqual(V.graphAction(D.setEnemies(solo, ['AQUS']), 'AQUS'), { label: 'Facing it', enabled: false });
    assert.deepStrictEqual(V.graphAction(D.setExcluded(solo, ['AQUS']), 'AQUS'), { label: 'Excluded', enabled: false });
    assert.deepStrictEqual(V.graphAction(pickAll(solo, ['TEMPUS', 'MANUS', 'CERBERUS']), 'AQUS'),
        { label: 'Band is full', enabled: false });

    const banFirst = D.createDraft('ban-first');
    assert.deepStrictEqual(V.graphAction(banFirst, 'AQUS'), { label: 'Ban for Player 1', enabled: true });
    assert.deepStrictEqual(V.graphAction(pickAll(banFirst, ['TEMPUS']), 'AQUS'), { label: 'Ban for Player 2', enabled: true });
    assert.deepStrictEqual(V.graphAction(pickAll(banFirst, ['AQUS']), 'AQUS'), { label: 'Banned', enabled: false });

    const standard = D.createDraft('standard');
    assert.deepStrictEqual(V.graphAction(standard, 'AQUS'), { label: 'Pick for Player 1', enabled: true });
    assert.deepStrictEqual(V.graphAction(pickAll(standard, ['TEMPUS']), 'TEMPUS'), { label: 'Already picked', enabled: false });
    assert.deepStrictEqual(V.graphAction(pickAll(standard, ['TEMPUS', 'AQUS']), 'AQUS'), { label: 'Already picked', enabled: false });
    const done = pickAll(standard, ['TEMPUS', 'AQUS', 'MANUS', 'CERBERUS', 'SAXUM', 'MAGNUS']);
    assert.deepStrictEqual(V.graphAction(done, 'FIDEA'), { label: 'Draft complete', enabled: false });
});
