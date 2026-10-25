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

// A two-player draft with these picks (and bans) for each player, made in sequence order
function drafted(p1, p2 = [], { format = 'standard', bans1 = [], bans2 = [], carryOverBans = [] } = {}) {
    const queue = { '1pick': [...p1], '2pick': [...p2], '1ban': [...bans1], '2ban': [...bans2] };
    let s = D.createDraft(format, { carryOverBans });
    for (const step of D.draftSequence(format)) {
        const next = queue[`${step.player}${step.action}`];
        if (!next.length) break;
        s = D.applyAction(s, next.shift());
    }
    assert.ok(Object.values(queue).every(q => !q.length), 'picks out of sequence');
    return s;
}

// Player 1 picks next, holding Ferrarius and Ballistarius against Saxum and Illesebra
const midDraft = () => drafted(['FERRARIUS', 'BALLISTARIUS'], ['SAXUM', 'ILLESEBRA'], { carryOverBans: ['LIBRORUM', 'TENEBRIS'] });
const others = (...taken) => heroes.map(h => h.name).filter(n => !taken.includes(n));

test('pool: every hero appears once with why it is unavailable', () => {
    const v = V.draftView(midDraft(), ctx);
    assert.strictEqual(v.pool.length, 36);
    const reason = Object.fromEntries(v.pool.map(p => [p.name, p.unavailableReason]));
    assert.strictEqual(reason.FERRARIUS, 'player1');
    assert.strictEqual(reason.SAXUM, 'player2');
    assert.strictEqual(reason.LIBRORUM, 'banned');
    assert.strictEqual(reason.AQUS, null);
    v.pool.forEach(p => assert.strictEqual(p.available, p.unavailableReason === null, p.name));
    assert.deepStrictEqual(v.counts, { available: 30, unavailable: 6 });
});

test('pool entries carry display facts', () => {
    const fidea = V.draftView(D.createDraft('standard'), ctx).pool.find(p => p.name === 'FIDEA');
    assert.deepStrictEqual(
        { display: fidea.display, attribute: fidea.attribute, size: fidea.size, battleRoles: fidea.battleRoles, image: fidea.image },
        { display: 'Fidea', attribute: 'Intelligence', size: 'Small', battleRoles: ['Supporter'], image: 'hero_images/fidea.png' });
});

test('pool entries list the terms the search finds them by, each once and tagged with its kind', () => {
    const fidea = V.draftView(D.createDraft('standard'), ctx).pool.find(p => p.name === 'FIDEA');
    const kinds = Object.fromEntries(fidea.terms.map(t => [t.text, t.kind]));
    assert.strictEqual(kinds.Intelligence, 'attribute');
    assert.strictEqual(kinds.Small, 'size');
    assert.strictEqual(kinds.Supporter, 'role');
    const hero = heroes.find(h => h.name === 'FIDEA');
    hero.labels.forEach(l => assert.ok(kinds[l], l));
    const texts = fidea.terms.map(t => t.text.toLowerCase());
    assert.strictEqual(new Set(texts).size, texts.length);
});

test('slots: 3 per player in pick order, and the carried-over bans', () => {
    const v = V.draftView(midDraft(), ctx);
    assert.deepStrictEqual(v.players[0].slots.map(s => s.hero), ['FERRARIUS', 'BALLISTARIUS', null]);
    assert.deepStrictEqual(v.players[1].slots.map(s => s.hero), ['SAXUM', 'ILLESEBRA', null]);
    assert.ok(v.players.every(p => p.slots.every(s => s.preview === false)));
    assert.deepStrictEqual(v.carryOverBans, ['LIBRORUM', 'TENEBRIS']);
    ['mode', 'slots', 'against', 'excluded'].forEach(key => assert.ok(!(key in v), `no solo ${key}`));
});

test('every chip comes from an engine reason, positives first, at least one warning kept', () => {
    const v = V.draftView(midDraft(), ctx);
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
    const empty = V.draftView(D.createDraft('standard'), ctx);
    assert.ok(!('completions' in empty), 'completions live in the tile popover (Best with) now');
    const full = V.draftView(drafted(['FIDEA', 'GOETIUM', 'MESSUM'], ['AQUS', 'IRATUS', 'SAXUM']), ctx);
    assert.strictEqual(full.suggestions.items.length, 0);
    assert.ok(full.complete);
});

test('analysis: best reachable score while incomplete, band score when full', () => {
    const s = midDraft();
    const v = V.draftView(s, ctx);
    assert.strictEqual(v.analysis.score.complete, false);
    const pool = v.pool.filter(p => p.available).map(p => p.name);
    assert.strictEqual(v.analysis.score.percent, D.bestBand(D.myBand(s), pool, D.opponentBand(s), ctx).topPercent);
    assert.strictEqual(v.analysis.score.label, `Best reachable: ${V.percentLabel(v.analysis.score.percent)}`);
    assert.strictEqual(v.suggestions.items[0].topPercent, v.analysis.score.percent, 'last pick: top suggestion = best band');
    const full = V.draftView(D.applyAction(s, 'FIDEA'), ctx, { player: 1 });
    assert.strictEqual(full.analysis.score.complete, true);
    assert.match(full.analysis.score.label, /^Band: Top \d+%$/);
});

test('analysis: roles list who covers each role', () => {
    const v = V.draftView(midDraft(), ctx);
    assert.deepStrictEqual(v.analysis.roles.map(r => r.role), D.BATTLE_ROLES);
    assert.strictEqual(v.analysis.coveredCount, 2);
    const missing = v.analysis.roles.filter(r => r.coveredBy === null);
    assert.strictEqual(missing.length, 1);
});

test('preview marks the previewed slot and the analysis change, without changing state', () => {
    const s = midDraft();
    const plain = V.draftView(s, ctx);
    assert.ok(plain.analysis.roles.every(r => r.change === null));
    assert.strictEqual(plain.analysis.score.change, null);

    const v = V.draftView(s, ctx, { preview: 'FIDEA' });
    assert.deepStrictEqual(v.players[0].slots[2], { index: 2, hero: 'FIDEA', preview: true });
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
    const s = drafted(['FERRARIUS'], ['AQUS']);
    const v = V.draftView(s, ctx, { preview: ['FERRARIUS', 'BALLISTARIUS', 'TEMPUS'] });
    assert.deepStrictEqual(v.players[0].slots.map(x => [x.hero, x.preview]), [['FERRARIUS', false], ['BALLISTARIUS', true], ['TEMPUS', true]]);
});

test('previewing an unavailable hero is ignored', () => {
    const v = V.draftView(midDraft(), ctx, { preview: 'SAXUM' });
    assert.ok(v.players.every(p => p.slots.every(x => !x.preview)));
});

test('step text, and no intro text', () => {
    const empty = V.draftView(D.createDraft('standard'), ctx);
    assert.strictEqual(empty.step.label, 'Player 1 pick 1 of 3');
    assert.ok(!('intro' in empty));
    assert.ok(!('INTRO' in V));
});



test('every available hero is ranked, and the pool carries each rank', () => {
    const v = V.draftView(midDraft(), ctx);
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
    const v = V.draftView(drafted(['FERRARIUS', 'BALLISTARIUS'], ['SAXUM', 'AQUS']), ctx);
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
    const s = drafted(['FERRARIUS'], ['AQUS']);
    V.draftView(s, ctx).suggestions.items.forEach(item => {
        assert.deepStrictEqual(item.bestWith, item.bestBand.filter(n => n !== item.name && n !== 'FERRARIUS'), item.name);
        assert.strictEqual(item.bestWith.length, 1);
    });
});

test('pool: the roles a hero would add to this band (the rest are dimmed), and how many enemies it counters', () => {
    const v = V.draftView(drafted(['FERRARIUS', 'BALLISTARIUS'], ['SAXUM', 'MAGNUS']), ctx);
    const fills = n => v.pool.find(p => p.name === n).fills;
    assert.deepStrictEqual(fills('FIDEA'), ['Supporter']);
    assert.deepStrictEqual(fills('TEMPUS'), ['Controller', 'Supporter']);
    assert.deepStrictEqual(fills('EQUITA'), []);
    v.pool.forEach(p => {
        const counters = p.suggestion ? p.suggestion.reasons.filter(r => r.kind === 'counter').length : 0;
        assert.strictEqual(p.counters, counters, p.name);
    });
    assert.ok(v.pool.some(p => p.counters > 0), 'someone counters Saxum or Magnus');
    const flexible = V.draftView(drafted(['TOXICUM'], ['AQUS']), ctx);
    assert.deepStrictEqual(flexible.pool.find(p => p.name === 'MALLEUS').fills, ['Controller', 'Attacker', 'Supporter'],
        'a flexible band leaves every role open');
    const empty = V.draftView(D.createDraft('standard'), ctx);
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

test('popover sections: interactions with the band, interactions with the opponent, then what the hero brings in general', () => {
    const v = V.draftView(drafted(['TOXICUM'], ['SAXUM']), ctx);
    const tempus = itemOf(v, 'TEMPUS');
    assert.deepStrictEqual(tempus.sections.map(x => x.key).filter(k => k !== 'matchup'), ['team', 'general']);
    const team = tempus.sections[0];
    assert.deepStrictEqual([team.label, team.title, team.group], ['Interactions with your band', 'Tempus with Toxicum', 'interaction']);
    assert.deepStrictEqual([tempus.sections[1].label, tempus.sections[1].group], ['General', 'general']);
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
        if (matchup) assert.deepStrictEqual([matchup.label, matchup.group], ['Interactions vs Player 2', 'interaction']);
    });
});

test('popover lines: the same help to several teammates is one line', () => {
    const v = V.draftView(drafted(['TOXICUM', 'MAGNUS'], ['AQUS', 'IRATUS']), ctx);
    const team = itemOf(v, 'ARBORUS').sections.find(x => x.key === 'team');
    assert.strictEqual(team.title, 'Arborus with Toxicum and Magnus');
    const keeps = team.lines.find(l => l.text === 'Arborus keeps Toxicum and Magnus alive');
    assert.deepStrictEqual(keeps && keeps.ids.sort(), ['enabler:protection:MAGNUS', 'enabler:protection:TOXICUM']);
    assert.ok(team.lines.some(l => l.text === 'Toxicum and Magnus move enemies into position for Arborus'));
    assert.strictEqual(team.lines.length, 2);
});

test('popover lines name the abilities behind a single relation', () => {
    const v = V.draftView(drafted(['TOXICUM'], ['AQUS']), ctx);
    const line = itemOf(v, 'EQUITA').sections[0].lines.find(l => l.ids[0].startsWith('synergy:TOXICUM:Poison'));
    const relation = line.reasons[0].relations[0];
    assert.strictEqual(line.text, S.describeRelation(relation));
    assert.strictEqual(line.kind, 'positive');
});

test('popover sections on a ban step: the ban first, then the rival\'s reasons', () => {
    const v = V.draftView(D.createDraft('ban-first'), ctx);
    v.suggestions.items.slice(0, 5).forEach(item => {
        assert.deepStrictEqual([item.sections[0].key, item.sections[0].label], ['ban', 'Ban'], item.name);
        assert.ok(item.sections.every(x => x.key !== 'matchup' || x.label === 'Interactions vs Player 1'), item.name);
    });
});

// ---- Band analysis rows and score breakdown -----------------------------------------------------

const sectionOf = (v, key) => v.analysis.sections.find(x => x.key === key);

test('analysis sections: the same sections and lines as the popover, for the whole band', () => {
    const band = ['TOXICUM', 'MAGNUS', 'ARBORUS'];
    const opponents = ['AQUS', 'IRATUS', 'CERBERUS'];
    const v = V.draftView(drafted(band, opponents), ctx);
    const team = sectionOf(v, 'team');
    assert.deepStrictEqual([team.label, team.group, team.title], ['Interactions within Player 1\'s band', 'interaction', 'Player 1\'s band']);
    assert.ok(team.lines.some(l => l.text === 'Arborus keeps Toxicum and Magnus alive'), 'the same help merged, as in the popover');
    assert.ok(team.lines.some(l => l.text === 'Toxicum and Magnus move enemies into position for Arborus'));
    const general = sectionOf(v, 'general');
    assert.deepStrictEqual([general.label, general.group], ['General', 'general']);
    // Every reason but role coverage (Team balance shows it) and info lines lands on exactly one line
    const reasons = [...D.scoreTeam(band, ctx).reasons, ...D.scoreMatchup(band, opponents, ctx).reasons]
        .filter(r => r.factor !== 'coverage' && r.kind !== 'info');
    assert.deepStrictEqual(v.analysis.sections.flatMap(sectionIds).sort(), reasons.map(r => r.id).sort());
    v.analysis.sections.forEach(x => x.lines.forEach(l => assert.ok(V.TOPICS[l.topic], `${l.text}: ${l.topic}`)));
    assert.deepStrictEqual(V.draftView(D.createDraft('standard'), ctx).analysis.sections, []);
});

test('analysis sections: conflicts sit with the band\'s interactions, counters and threats with the opponent\'s', () => {
    const clash = ctx.relations.find(r => r.type === 'conflict' && r.supplier !== r.needer);
    const careful = V.draftView(drafted([clash.supplier, clash.needer], others(clash.supplier, clash.needer).slice(0, 2)), ctx);
    assert.ok(sectionOf(careful, 'team').lines.some(l => l.kind === 'warning' && l.topic === 'conflict'));
    const counter = ctx.relations.find(r => r.type === 'counter' && r.rule !== 'size');
    const facing = V.draftView(drafted([counter.needer], [counter.supplier]), ctx);
    const matchup = sectionOf(facing, 'matchup');
    assert.deepStrictEqual([matchup.label, matchup.group], ['Interactions vs Player 2', 'interaction']);
    assert.ok(matchup.lines.some(l => l.kind === 'warning' && l.text === S.describeRelation(counter)));
    const two = V.draftView(pickAll(D.createDraft('standard'), ['TOXICUM', 'SAXUM', 'EQUITA']), ctx, { player: 1 });
    assert.strictEqual(sectionOf(two, 'team').label, 'Interactions within Player 1\'s band');
    assert.ok(!sectionOf(two, 'matchup') || sectionOf(two, 'matchup').label === 'Interactions vs Player 2');
});

test('every line has a topic for its bullet colour', () => {
    const cases = [
        [{ id: 'synergy:X', factor: 'synergy' }, 'synergy'], [{ id: 'enabler:x:Y', factor: 'synergy' }, 'support'],
        [{ id: 'fills', factor: 'coverage' }, 'roles'], [{ id: 'versatility', factor: 'versatility' }, 'roles'],
        [{ id: 'theme:Ranged', factor: 'theme' }, 'theme'], [{ id: 'durability:frontline', factor: 'durability' }, 'durability'],
        [{ id: 'conflict:A>B:x', factor: 'conflict' }, 'conflict'], [{ id: 'counter:A>B:x', factor: 'matchup' }, 'matchup'],
        [{ id: 'ban:denies', factor: 'ban' }, 'ban']
    ];
    cases.forEach(([reason, topic]) => assert.strictEqual(V.topicOf(reason), topic, reason.id));
    Object.values(V.TOPICS).forEach(t => assert.ok(t.label, 'each topic has a legend label'));
    const v = V.draftView(drafted(['TOXICUM'], ['SAXUM']), ctx);
    v.suggestions.items.forEach(item => item.sections.forEach(x => x.lines.forEach(l => assert.ok(V.TOPICS[l.topic], `${item.name}: ${l.text}`))));
});

test('score breakdown: the points per factor, adding up to the band\'s value', () => {
    const band = ['TOXICUM', 'TEMPUS', 'EQUITA'];
    const v = V.draftView(drafted(band, ['SAXUM', 'AQUS', 'IRATUS']), ctx);
    const total = D.scoreTeam(band, ctx).total + D.scoreMatchup(band, ['SAXUM', 'AQUS', 'IRATUS'], ctx).total;
    const sum = v.analysis.breakdown.reduce((t, f) => t + f.delta, 0);
    assert.ok(Math.abs(sum - total) < 1e-9);
    assert.deepStrictEqual(v.analysis.breakdown.map(f => f.label).sort(), ['Conflicts', 'Durability', 'Matchup', 'Roles', 'Synergy', 'Themes']);
    v.analysis.breakdown.forEach(f => assert.ok(Math.abs(f.delta - f.reasons.reduce((t, r) => t + r.delta, 0)) < 1e-9, f.label));
});

test('score breakdown: every factor is listed, even at zero, the one varying most between bands first, the same for every band', () => {
    const v = V.draftView(drafted(['TOXICUM']), ctx, { player: 1 });
    const ranges = D.factorRanges(ctx);
    const order = v.analysis.breakdown.map(f => f.factor);
    assert.deepStrictEqual([...order].sort(), ['conflict', 'coverage', 'durability', 'matchup', 'synergy', 'theme']);
    order.slice(1).forEach((f, i) => assert.ok(ranges[order[i]].sd >= ranges[f].sd, `${order[i]} before ${f}`));
    assert.deepStrictEqual(order, ['synergy', 'theme', 'matchup', 'conflict', 'coverage', 'durability']);
    const full = V.draftView(drafted(['TOXICUM', 'TEMPUS', 'EQUITA'], ['SAXUM', 'AQUS', 'IRATUS']), ctx).analysis.breakdown;
    assert.deepStrictEqual(full.map(f => f.factor), order, 'the order does not follow the band\'s points');
    const matchup = v.analysis.breakdown.find(f => f.factor === 'matchup');
    assert.deepStrictEqual([matchup.delta, matchup.reasons], [0, []]);
    v.analysis.breakdown.forEach(f => f.reasons.forEach(r => assert.notStrictEqual(r.kind, 'info')));
    assert.deepStrictEqual(V.draftView(D.createDraft('standard'), ctx).analysis.breakdown, [], 'nothing to break down without a hero');
});

test('sortPool: recommended by rank, counters first, A–Z by name, or by card id', () => {
    const entries = [
        { name: 'B', display: 'Beta', id: 3, counters: 0, suggestion: { rank: 1 } },
        { name: 'A', display: 'Alpha', id: 2, counters: 2, suggestion: { rank: 3 } },
        { name: 'C', display: 'Gamma', id: 1, counters: 0, suggestion: { rank: 2 } },
        { name: 'D', display: 'Delta', id: 4, counters: 0, suggestion: null }
    ];
    const order = sort => V.sortPool(entries, sort).map(e => e.name);
    assert.deepStrictEqual(order('recommended'), ['B', 'C', 'A', 'D']);
    assert.deepStrictEqual(order('counters'), ['A', 'B', 'C', 'D']);
    assert.deepStrictEqual(order('name'), ['A', 'B', 'D', 'C']);
    assert.deepStrictEqual(order('id'), ['C', 'A', 'B', 'D']);
    // Without ranks (draft complete) the recommended order falls back to the card id
    assert.deepStrictEqual(V.sortPool(entries.map(e => ({ ...e, suggestion: null })), 'recommended').map(e => e.name), ['C', 'A', 'B', 'D']);
    assert.deepStrictEqual(entries.map(e => e.name), ['B', 'A', 'C', 'D'], 'input untouched');
});

test('preview flags the lines only the previewed hero brings', () => {
    const s = drafted(['TOXICUM', 'TEMPUS'], ['AQUS', 'IRATUS']);
    const lines = V.draftView(s, ctx, { preview: 'EQUITA' }).analysis.sections.flatMap(x => x.lines);
    assert.ok(lines.find(l => l.ids.some(id => id.startsWith('synergy:TOXICUM:Poison'))).preview);
    assert.ok(lines.some(l => !l.preview), 'what the band already has is not flagged');
    assert.ok(V.draftView(s, ctx).analysis.sections.flatMap(x => x.lines).every(l => !l.preview));
});

// ---- Inspector -------------------------------------------------------------------------------------

test('inspectView: one item per line, each with only its own card evidence', () => {
    const v = V.draftView(drafted(['TOXICUM', 'MAGNUS'], ['AQUS', 'IRATUS']), ctx);
    const team = v.suggestions.items.find(i => i.name === 'ARBORUS').sections.find(x => x.key === 'team');
    const view = V.inspectView(team.reasons, ctx, { title: team.title });
    assert.strictEqual(view.title, team.title);
    assert.deepStrictEqual(view.items.map(i => i.text), team.lines.map(l => l.text), 'the same lines as the popover');
    const keeps = view.items.find(i => i.text === 'Arborus keeps Toxicum and Magnus alive');
    assert.deepStrictEqual(keeps.sides.map(x => x.hero), ['ARBORUS', 'TOXICUM', 'MAGNUS']);
    assert.deepStrictEqual(keeps.strength, V.strength(keeps.delta));
    assert.deepStrictEqual(view.items.map(i => i.topic), team.lines.map(l => l.topic), 'bullet colours match the popover');
    // The overview: which ability on each side, with what it does there
    const arborus = keeps.sides[0];
    assert.deepStrictEqual([arborus.display, arborus.image, arborus.theirs], ['Arborus', 'hero_images/arborus.png', false]);
    assert.deepStrictEqual(arborus.overview, [{ name: 'Shield of the Forest', tags: ['grants Defense increase'] }]);
    assert.deepStrictEqual(keeps.sides[1].notes, ['Attacker', `Vitality ${heroes.find(h => h.name === 'TOXICUM').vitality}`]);
    assert.ok(keeps.sides[1].overview.length > 0 && keeps.sides[1].abilities.length === keeps.sides[1].overview.length);
});

test('inspectView: a relation names the abilities on both sides; abilities without a trait get no tags', () => {
    const team = D.scoreTeam(['TOXICUM', 'TEMPUS', 'EQUITA'], ctx).reasons;
    const poison = team.find(r => r.id.startsWith('synergy:TOXICUM:Poison'));
    const [item] = V.inspectView([poison], ctx).items;
    assert.strictEqual(item.text, S.describeRelation(poison.relations[0]));
    assert.ok(item.sides.find(x => x.hero === 'EQUITA').overview.every(o => o.tags.includes('inflicts Poison')));
    const cooldowns = V.inspectView([team.find(r => r.id === 'enabler:cooldowns:TOXICUM')], ctx).items[0];
    const toxicum = cooldowns.sides.find(x => x.hero === 'TOXICUM');
    assert.deepStrictEqual(toxicum.abilities.map(g => g.index), [1, 2]);
    assert.ok(toxicum.overview.every(o => o.tags.length === 0));
    const frontline = D.scoreTeam(['SAXUM', 'TEMPUS'], ctx).reasons.find(r => r.id === 'durability:frontline');
    assert.deepStrictEqual(V.inspectView([frontline], ctx).items[0].sides[0].notes, [`Vitality ${heroes.find(h => h.name === 'SAXUM').vitality}`]);
});

test('inspectView merges the same help to several teammates into one item', () => {
    const team = D.scoreTeam(['ARBORUS', 'TOXICUM', 'MAGNUS'], ctx).reasons.filter(r => r.rule === 'protection');
    assert.deepStrictEqual(V.inspectView(team, ctx).items.map(i => i.text), ['Arborus keeps Toxicum and Magnus alive']);
});

test('inspectView marks the opposing side and lists a ban\'s denied band line by line', () => {
    const counter = ctx.relations.find(r => r.type === 'counter' && r.rule !== 'size');
    const lost = D.scoreMatchup([counter.needer], [counter.supplier], ctx).reasons.find(r => r.kind === 'warning');
    const [item] = V.inspectView([lost], ctx, { opponents: [counter.supplier] }).items;
    assert.deepStrictEqual(item.sides.map(x => [x.hero, x.theirs]).sort(), [[counter.needer, false], [counter.supplier, true]].sort());
    const ban = D.suggestBan(D.createDraft('ban-first'), ctx, 1)[0].reasons.find(r => r.id === 'ban:denies');
    const denied = V.inspectView([ban], ctx).items;
    assert.deepStrictEqual([denied[0].text, denied[0].sides], [ban.text, []]);
    assert.ok(denied.length > 1 && denied.slice(1).every(i => i.sides.length > 0), 'then the denied band\'s own lines');
});

test('collapse shows the first items and counts the rest exactly', () => {
    assert.deepStrictEqual(V.collapse([1, 2, 3, 4, 5], 3, false), { items: [1, 2, 3], hidden: 2, expanded: false });
    assert.deepStrictEqual(V.collapse([1, 2, 3, 4, 5], 3, true), { items: [1, 2, 3, 4, 5], hidden: 2, expanded: true });
    assert.deepStrictEqual(V.collapse([1, 2], 3, false), { items: [1, 2], hidden: 0, expanded: false });
});

// ---- Reference cards modal --------------------------------------------------------------

test('reference cards: one tab per player', () => {
    const s = pickAll(D.createDraft('standard'), ['TOXICUM', 'SAXUM', 'TEMPUS', 'MALLEUS', 'EQUITA', 'FERRARIUS']);
    assert.deepStrictEqual(V.referenceSides(s), [
        { key: '1', label: 'Player 1', heroes: ['TOXICUM', 'TEMPUS', 'EQUITA'] },
        { key: '2', label: 'Player 2', heroes: ['SAXUM', 'MALLEUS', 'FERRARIUS'] }]);
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

test('theme lines lead with the theme (the bullet colour says it is one): members or effects after it', () => {
    const v = V.draftView(drafted(['TOXICUM', 'TEMPUS', 'EQUITA'], ['AQUS', 'IRATUS', 'CERBERUS']), ctx);
    const lines = v.analysis.sections.flatMap(x => x.lines).filter(l => l.topic === 'theme');
    assert.ok(lines.length > 0 && lines.every(l => !l.text.startsWith('Theme:')));
    const cooldowns = lines.find(l => l.ids[0] === 'theme:Cooldowns');
    assert.match(cooldowns.text, /^Cooldowns: \w+, \w+ and \w+$/);
    assert.deepStrictEqual(cooldowns.text.replace('Cooldowns: ', '').split(/, | and /).sort(), ['Equita', 'Tempus', 'Toxicum']);
    assert.strictEqual(lines.find(l => l.ids[0] === 'theme:Debuffs').text, 'Debuffs: Poison');
});

// ---- What beats this band (end of the band analysis) -------------------------------------------

test('what beats this band: once the draft is complete, the strongest bands against the analysed band', () => {
    const mine = ['TOXICUM', 'TEMPUS', 'EQUITA'];
    const theirs = ['SAXUM', 'MALLEUS', 'FERRARIUS'];
    const s = drafted(mine, theirs);
    assert.strictEqual(V.draftView(D.undo(s), ctx, { player: 1 }).analysis.beats, null, 'not before the draft is complete');
    const beats = V.draftView(s, ctx).analysis.beats;
    assert.deepStrictEqual([beats.title, beats.target, beats.vs], ['What beats Player 1\'s band', mine, 'Player 1']);
    assert.deepStrictEqual(beats.bands.map(b => b.heroes), D.counterBands(mine, ctx).map(b => b.heroes));
    assert.deepStrictEqual(beats.counteredBy, D.counteredBy(mine, ctx).map(S.titleCase));
    const first = beats.bands[0];
    assert.strictEqual(first.label, first.heroes.map(S.titleCase).join(' + '));
    assert.deepStrictEqual(first.images, first.heroes.map(n => `hero_images/${n.toLowerCase()}.png`));
    assert.deepStrictEqual(first.reasons, D.counterBands(mine, ctx)[0].reasons, 'the inspector gets every reason');
    // How it beats the band: its matchup lines, counters first
    assert.ok(first.lines.length > 0 && first.lines.every(l => l.topic === 'matchup'));
    assert.strictEqual(first.lines[0].kind, 'counter');
    assert.strictEqual(first.counters, first.reasons.filter(r => r.kind === 'counter').length);
    const p2 = V.draftView(s, ctx, { player: 2 }).analysis.beats;
    assert.deepStrictEqual([p2.title, p2.target], ['What beats Player 2\'s band', theirs]);
});

test('what beats this band: a band no card counters says so', () => {
    const safe = ['FERRARIUS', 'ARBORUS', 'TEMPUS'];
    const beats = V.draftView(drafted(safe, ['AQUS', 'IRATUS', 'SAXUM']), ctx).analysis.beats;
    assert.deepStrictEqual(beats.counteredBy, []);
    assert.ok(beats.bands.length === 3 && beats.bands.every(b => b.counters === 0));
});

test('score breakdown: one scale for every factor, zero in the middle, ticks at each factor\'s range', () => {
    const band = ['TOXICUM', 'TEMPUS', 'EQUITA'];
    const v = V.draftView(drafted(band, ['SAXUM', 'AQUS', 'IRATUS']), ctx);
    const ranges = D.factorRanges(ctx);
    const scale = Math.max(...Object.values(ranges).flatMap(r => [Math.abs(r.min), Math.abs(r.max)]));
    v.analysis.breakdown.forEach(f => {
        const r = ranges[f.factor];
        assert.deepStrictEqual([f.min, f.max], [r.min, r.max], f.label);
        const at = x => 50 + x / scale * 50;
        assert.ok(Math.abs(f.ticks.min - at(r.min)) < 1e-9 && Math.abs(f.ticks.max - at(r.max)) < 1e-9, f.label);
        assert.ok(Math.abs(f.bar.left - Math.min(50, at(f.delta))) < 1e-9, `${f.label} bar starts at zero or its value`);
        assert.ok(Math.abs(f.bar.width - Math.abs(f.delta) / scale * 50) < 1e-9, `${f.label} width is the points, same scale`);
        assert.ok(f.bar.left >= 0 && f.bar.left + f.bar.width <= 100 + 1e-9);
        assert.strictEqual(f.maxBand.length, 3, 'the band reaching the top');
        assert.strictEqual(Boolean(f.maxOpponents), f.factor === 'matchup', `${f.label}: opponents only for the matchup`);
    });
});

test('score breakdown: the same points draw the same bar whichever factor and band', () => {
    const a = V.draftView(drafted(['TOXICUM', 'TEMPUS', 'EQUITA'], ['SAXUM', 'AQUS', 'IRATUS']), ctx).analysis.breakdown;
    const b = V.draftView(drafted(['ARCHITECTUS', 'ARMUS', 'ARBORUS'], ['SAXUM', 'AQUS', 'IRATUS']), ctx).analysis.breakdown;
    const width = new Map();
    [...a, ...b].forEach(f => {
        const key = Math.abs(f.delta).toFixed(6);
        if (width.has(key)) assert.ok(Math.abs(width.get(key) - f.bar.width) < 1e-9, f.label);
        else width.set(key, f.bar.width);
    });
});

test('the finishing celebration plays only on the action that completes the draft', () => {
    const almost = pickAll(D.createDraft('standard'), ['SAXUM', 'TEMPUS', 'FIDEA', 'GOETIUM', 'MESSUM']);
    const done = D.applyAction(almost, 'ARMUS');
    assert.ok(!D.isComplete(almost) && D.isComplete(done));
    assert.strictEqual(V.celebrates(almost, done), true, 'the last pick');
    assert.strictEqual(V.celebrates(done, done), false, 'a re-render of a finished draft');
    assert.strictEqual(V.celebrates(done, almost), false, 'undoing the last pick');
    assert.strictEqual(V.celebrates(D.createDraft('standard'), D.applyAction(D.createDraft('standard'), 'SAXUM')), false);
});
