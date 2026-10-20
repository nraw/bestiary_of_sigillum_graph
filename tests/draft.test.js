// Run with: node --test tests/*.test.js
// Draft assistant engine (draft.js): draft formats and state, battle roles, scoring and suggestions
const test = require('node:test');
const assert = require('node:assert');
const D = require('../draft.js');

const data = require('../bestiary_reference_cards.json').bestiary_of_sigillum;
const heroes = data.characters;
const byName = Object.fromEntries(heroes.map(h => [h.name, h]));
const ctx = D.createContext(heroes);

const pickAll = (state, names) => names.reduce((s, n) => D.applyAction(s, n), state);
const names = list => list.map(s => s.name);

// ---- Draft formats ---------------------------------------------------------------------------

test('standard format alternates picks starting with the First player', () => {
    assert.deepStrictEqual(D.draftSequence('standard').map(s => `${s.player}${s.action[0]}`),
        ['1p', '2p', '1p', '2p', '1p', '2p']);
});

test('ban-first format bans 3 each, alternating, then picks as standard', () => {
    assert.deepStrictEqual(D.draftSequence('ban-first').map(s => `${s.player}${s.action[0]}`),
        ['1b', '2b', '1b', '2b', '1b', '2b', '1p', '2p', '1p', '2p', '1p', '2p']);
});

test('interleaved format repeats ban, ban, pick, pick three times', () => {
    assert.deepStrictEqual(D.draftSequence('interleaved').map(s => `${s.player}${s.action[0]}`),
        ['1b', '2b', '1p', '2p', '1b', '2b', '1p', '2p', '1b', '2b', '1p', '2p']);
});

test('solo format is 3 picks for the user only', () => {
    assert.deepStrictEqual(D.draftSequence('solo'), [
        { player: 1, action: 'pick' }, { player: 1, action: 'pick' }, { player: 1, action: 'pick' }]);
});

test('unknown format throws', () => {
    assert.throws(() => D.draftSequence('chaos'));
});

// ---- Two-player draft state ------------------------------------------------------------------

test('a picked or banned hero is unavailable to both players', () => {
    let s = D.createDraft('ban-first');
    s = pickAll(s, ['SAXUM', 'TEMPUS']);
    assert.deepStrictEqual(D.bans(s), { 1: ['SAXUM'], 2: ['TEMPUS'] });
    assert.throws(() => D.applyAction(s, 'SAXUM'));
    s = pickAll(s, ['ARMUS', 'AQUS', 'FIDEA', 'MESSUM', 'FERRARIUS']);
    assert.deepStrictEqual(D.bands(s)[1], ['FERRARIUS']);
    assert.throws(() => D.applyAction(s, 'FERRARIUS'));
    assert.ok(!D.isAvailable(s, 'FERRARIUS') && !D.isAvailable(s, 'TEMPUS'));
    assert.ok(D.isAvailable(s, 'IRATUS'));
});

test('carry-over bans are unavailable from the start and use no ban step', () => {
    const s = D.createDraft('ban-first', { carryOverBans: ['MAGNUS', 'SATURN'] });
    assert.ok(!D.isAvailable(s, 'MAGNUS'));
    assert.deepStrictEqual(D.currentStep(s), { player: 1, action: 'ban' });
    assert.strictEqual(D.availableHeroes(s, heroes).length, 34);
    assert.throws(() => D.applyAction(s, 'SATURN'));
});

test('the draft ends after 3 picks each and undo restores the previous state exactly', () => {
    let s = D.createDraft('standard', { me: 2 });
    s = pickAll(s, ['SAXUM', 'TEMPUS', 'ARMUS', 'AQUS', 'FIDEA']);
    const before = JSON.parse(JSON.stringify(s));
    const done = D.applyAction(s, 'MESSUM');
    assert.strictEqual(D.currentStep(done), null);
    assert.ok(D.isComplete(done));
    assert.throws(() => D.applyAction(done, 'IRATUS'));
    assert.deepStrictEqual(D.undo(done), before);
    assert.deepStrictEqual(D.myBand(done), ['TEMPUS', 'AQUS', 'MESSUM']);
    assert.deepStrictEqual(D.opponentBand(done), ['SAXUM', 'ARMUS', 'FIDEA']);
});

test('undo at the start of a draft changes nothing', () => {
    const s = D.createDraft('standard');
    assert.deepStrictEqual(D.undo(s), s);
});

// ---- Solo state ------------------------------------------------------------------------------

test('solo picks fill the band in order and stop at 3', () => {
    const s = pickAll(D.createDraft('solo'), ['FERRARIUS', 'BALLISTARIUS', 'TEMPUS']);
    assert.deepStrictEqual(D.myBand(s), ['FERRARIUS', 'BALLISTARIUS', 'TEMPUS']);
    assert.strictEqual(D.currentStep(s), null);
    assert.throws(() => D.applyAction(s, 'SAXUM'));
});

test('solo: excluded and enemy heroes cannot be picked, and are kept apart from the band', () => {
    let s = D.createDraft('solo');
    s = D.setExcluded(s, ['MAGNUS']);
    s = D.setEnemies(s, ['SAXUM', 'ILLESEBRA']);
    assert.throws(() => D.applyAction(s, 'MAGNUS'));
    assert.throws(() => D.applyAction(s, 'SAXUM'));
    s = D.applyAction(s, 'FERRARIUS');
    assert.throws(() => D.setEnemies(s, ['FERRARIUS']));
    assert.throws(() => D.setExcluded(s, ['FERRARIUS']));
    assert.throws(() => D.setExcluded(s, ['SAXUM']), 'a hero cannot be both facing and excluded');
    assert.throws(() => D.setEnemies(s, ['SAXUM', 'ILLESEBRA', 'MAGNUS', 'AQUS']));
    assert.deepStrictEqual(D.opponentBand(s), ['SAXUM', 'ILLESEBRA']);
    assert.deepStrictEqual(D.unavailableReason(s, 'MAGNUS'), 'excluded');
    assert.deepStrictEqual(D.unavailableReason(s, 'SAXUM'), 'facing');
    assert.deepStrictEqual(D.unavailableReason(s, 'FERRARIUS'), 'picked');
    assert.strictEqual(D.unavailableReason(s, 'AQUS'), null);
});

test('solo: removing the middle hero keeps the others in order; movePick reorders', () => {
    let s = pickAll(D.createDraft('solo'), ['FERRARIUS', 'BALLISTARIUS', 'TEMPUS']);
    assert.deepStrictEqual(D.myBand(D.removePick(s, 'BALLISTARIUS')), ['FERRARIUS', 'TEMPUS']);
    assert.deepStrictEqual(D.myBand(D.movePick(s, 0, 2)), ['BALLISTARIUS', 'TEMPUS', 'FERRARIUS']);
    assert.deepStrictEqual(D.myBand(D.movePick(s, 2, 1)), ['FERRARIUS', 'TEMPUS', 'BALLISTARIUS']);
});

test('solo: undo reverses band, enemy and exclusion changes one at a time', () => {
    const s0 = D.createDraft('solo');
    const s1 = D.applyAction(s0, 'FERRARIUS');
    const s2 = D.setEnemies(s1, ['SAXUM']);
    const s3 = D.removePick(s2, 'FERRARIUS');
    assert.deepStrictEqual(D.undo(s3), s2);
    assert.deepStrictEqual(D.undo(D.undo(s3)), s1);
    assert.deepStrictEqual(D.undo(s1), s0);
});

test('solo editing functions throw in two-player formats', () => {
    const s = D.createDraft('standard');
    assert.throws(() => D.setEnemies(s, ['SAXUM']));
    assert.throws(() => D.setExcluded(s, ['SAXUM']));
    assert.throws(() => D.removePick(s, 'SAXUM'));
    assert.throws(() => D.movePick(s, 0, 1));
});

// ---- Hero facts and battle roles -------------------------------------------------------------

test('size classes follow the rulebook vitality bands', () => {
    assert.strictEqual(D.size(byName.SAXUM), 'Big');
    assert.strictEqual(D.size(byName.FERRARIUS), 'Medium');
    assert.strictEqual(D.size(byName.TEMPUS), 'Medium');
    assert.strictEqual(D.size(byName.FIDEA), 'Small');
});

test('battle roles include every role the strategy guide names', () => {
    const guide = {
        Controller: ['FERRARIUS', 'VINCTUM', 'TEMPUS', 'MANUS'],
        Attacker: ['ARCHITECTUS', 'SAXUM', 'BALLISTARIUS', 'CERBERUS', 'CORNIBUS', 'ARBORUS'],
        Supporter: ['ARMUS', 'REDUX', 'FIDEA', 'GOETIUM', 'MESSUM']
    };
    Object.entries(guide).forEach(([role, list]) => list.forEach(n =>
        assert.ok(D.battleRoles(byName[n]).includes(role), `${n} should be a ${role}: ${D.battleRoles(byName[n])}`)));
});

test('Ferrarius and Manus can play any role; Fidea only supports', () => {
    assert.deepStrictEqual(D.battleRoles(byName.FERRARIUS), D.BATTLE_ROLES);
    assert.deepStrictEqual(D.battleRoles(byName.MANUS), D.BATTLE_ROLES);
    assert.deepStrictEqual(D.battleRoles(byName.FIDEA), ['Supporter']);
});

test('every hero has at least one battle role, listed in canonical order', () => {
    heroes.forEach(h => {
        const roles = D.battleRoles(h);
        assert.ok(roles.length >= 1, h.name);
        assert.deepStrictEqual(roles, D.BATTLE_ROLES.filter(r => roles.includes(r)), h.name);
    });
});

test('manual battle role overrides carry a reason', () => {
    heroes.filter(h => h.battle_roles).forEach(h => {
        assert.ok(h.battle_roles.every(r => D.BATTLE_ROLES.includes(r)), h.name);
        assert.ok(typeof h.battle_roles_note === 'string' && h.battle_roles_note.length, h.name);
    });
});

test('versatility counts battle roles, with vitality breaking ties', () => {
    assert.ok(D.versatility(byName.FERRARIUS) > D.versatility(byName.FIDEA));
    assert.ok(D.versatility(byName.FERRARIUS) > D.versatility(byName.MANUS), 'same roles, more vitality');
});

// ---- Team scoring ----------------------------------------------------------------------------

const ALL_BANDS = D.allBands(heroes.map(h => h.name));
const teamScores = ALL_BANDS.map(b => D.scoreTeam(b, ctx).total).sort((a, b) => b - a);
const rankPercent = score => (teamScores.filter(s => s > score).length + 1) / teamScores.length * 100;

test('there are C(36,3) = 7140 possible bands', () => {
    assert.strictEqual(ALL_BANDS.length, 7140);
});

const curatedPercents = data.recommended_bands.map(b => rankPercent(D.scoreTeam(b.heroes, ctx).total));

// Curated bands are fixtures, not gospel: one may fall outside the cutoff (named in the test output), never more
const MAX_OUTLIERS = 1;
const checkOutliers = (t, outliers) => {
    outliers.forEach(o => t.diagnostic(`outlier: ${o}`));
    assert.ok(outliers.length <= MAX_OUTLIERS, `${outliers.length} curated bands miss the cutoff:\n${outliers.join('\n')}`);
};

test('all but one curated band score in the top 30% of all bands', t => {
    checkOutliers(t, data.recommended_bands
        .map((b, i) => [b, curatedPercents[i]])
        .filter(([, pct]) => pct > 30)
        .map(([b, pct]) => `${b.heroes.join(', ')} is only in the top ${pct.toFixed(1)}%`));
});

test('the median curated band scores in the top 10% of all bands', () => {
    const sorted = [...curatedPercents].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    assert.ok(median <= 10, `median curated band is in the top ${median.toFixed(1)}%`);
});

test('every non-zero score contribution has a matching reason', () => {
    [['FERRARIUS', 'BALLISTARIUS', 'TEMPUS'], ['TEMPUS', 'FIDEA', 'IGNIFER'], ['FIDEA', 'GOETIUM', 'MESSUM']]
        .forEach(band => {
            const s = D.scoreTeam(band, ctx);
            const sum = s.reasons.reduce((t, r) => t + r.delta, 0);
            assert.ok(Math.abs(sum - s.total) < 1e-9, band.join(','));
            s.reasons.forEach(r => {
                assert.ok(r.id && r.text && ['positive', 'counter', 'warning', 'info'].includes(r.kind), JSON.stringify(r));
                assert.ok(r.delta !== 0 || r.kind === 'info', `zero delta must be info: ${r.id}`);
            });
        });
});

test('an internal conflict gives a warning reason with a penalty', () => {
    const s = D.scoreTeam(['TEMPUS', 'FIDEA'], ctx);
    const conflict = s.reasons.find(r => r.factor === 'conflict');
    assert.ok(conflict && conflict.kind === 'warning' && conflict.delta < 0);
    assert.deepStrictEqual([...conflict.heroes].sort(), ['FIDEA', 'TEMPUS']);
});

test('a band with no conflicts says so', () => {
    const s = D.scoreTeam(['VINCTUM', 'ERESIDA', 'ILLESEBRA'], ctx);
    assert.ok(s.reasons.some(r => r.id === 'conflict:none' && r.kind === 'info'));
});

test('role coverage assigns each hero one role', () => {
    assert.strictEqual(D.roleCoverage(['FIDEA'], ctx).covered.length, 1);
    assert.deepStrictEqual(D.roleCoverage(['FIDEA', 'GOETIUM', 'MESSUM'], ctx).missing.sort(), ['Attacker', 'Controller'].sort());
    const cov = D.roleCoverage(['FERRARIUS', 'BALLISTARIUS', 'FIDEA'], ctx);
    assert.deepStrictEqual(cov.missing, []);
    assert.strictEqual(cov.assignment.Supporter, 'FIDEA');
});

// ---- Matchup ---------------------------------------------------------------------------------

test('matchup is zero with no opponent and rewards counters', () => {
    const empty = D.scoreMatchup(['SAXUM'], [], ctx);
    assert.strictEqual(empty.total, 0);
    assert.deepStrictEqual(empty.reasons, []);
    const counter = ctx.relations.find(r => r.type === 'counter');
    const won = D.scoreMatchup([counter.supplier], [counter.needer], ctx);
    assert.ok(won.total > 0 && won.reasons.some(r => r.kind === 'counter'));
    const lost = D.scoreMatchup([counter.needer], [counter.supplier], ctx);
    assert.ok(lost.total < 0 && lost.reasons.some(r => r.kind === 'warning'));
});

// ---- Suggestions -----------------------------------------------------------------------------

test('first pick from an empty draft: versatile heroes lead, Ferrarius is in the top half, Fidea in the bottom third', () => {
    const list = names(D.suggestPick(D.createDraft('solo'), ctx, Infinity));
    assert.strictEqual(list.length, 36);
    list.slice(0, 10).forEach(n => assert.ok(D.battleRoles(byName[n]).length >= 2, `${n} is a single-role first pick`));
    assert.ok(list.indexOf('FERRARIUS') < 18, `Ferrarius at ${list.indexOf('FERRARIUS') + 1}`);
    assert.ok(list.indexOf('FIDEA') >= 24, `Fidea at ${list.indexOf('FIDEA') + 1}`);
});

test('poor first picks get a warning reason', () => {
    const fidea = D.suggestPick(D.createDraft('solo'), ctx, Infinity).find(s => s.name === 'FIDEA');
    assert.ok(fidea.reasons.some(r => r.id === 'versatility:poor-first-pick' && r.kind === 'warning'));
});

test('second pick after a Controller+Attacker first pick: the top suggestion can support', () => {
    const s = D.applyAction(D.createDraft('solo'), 'VINCTUM');
    assert.deepStrictEqual(D.battleRoles(byName.VINCTUM).includes('Supporter'), false);
    const top = D.suggestPick(s, ctx, 1)[0];
    assert.ok(D.battleRoles(byName[top.name]).includes('Supporter'), top.name);
});

test('a suggestion that fills a missing role says which role', () => {
    const s = pickAll(D.createDraft('solo'), ['FERRARIUS', 'BALLISTARIUS']);
    const fidea = D.suggestPick(s, ctx, Infinity).find(p => p.name === 'FIDEA');
    const fills = fidea.reasons.find(r => r.id === 'fills');
    assert.ok(fills && fills.kind === 'positive' && fills.delta > 0);
    assert.deepStrictEqual([fills.roles, fills.text], [['Supporter'], 'Fills the Supporter role']);
    // Vinctum takes Controller, and Ferrarius moves over to support
    const vinctum = D.suggestPick(s, ctx, Infinity).find(p => p.name === 'VINCTUM');
    assert.deepStrictEqual(vinctum.reasons.find(r => r.id === 'fills').roles, ['Controller']);
    const tempus = D.suggestPick(s, ctx, Infinity).find(p => p.name === 'TEMPUS');
    assert.strictEqual(tempus.reasons.find(r => r.id === 'fills').text, 'Can fill Controller or Supporter');
    const equita = D.suggestPick(s, ctx, Infinity).find(p => p.name === 'EQUITA');
    assert.ok(!equita.reasons.some(r => r.id.startsWith('fills')), 'Equita adds no new role');
});

test('suggestions never include unavailable heroes', () => {
    let s = D.setExcluded(D.createDraft('solo'), ['MAGNUS']);
    s = D.setEnemies(s, ['SAXUM']);
    s = D.applyAction(s, 'FERRARIUS');
    const list = names(D.suggestPick(s, ctx, Infinity));
    assert.strictEqual(list.length, 33);
    ['MAGNUS', 'SAXUM', 'FERRARIUS'].forEach(n => assert.ok(!list.includes(n), n));
});

test('a hero that counters the opponent ranks higher with that opponent set', () => {
    const counter = ctx.relations.find(r => r.type === 'counter');
    const base = D.applyAction(D.createDraft('solo'), 'FERRARIUS');
    const without = names(D.suggestPick(base, ctx, Infinity));
    if (counter.supplier === 'FERRARIUS' || counter.needer === 'FERRARIUS') return;
    const withOpp = names(D.suggestPick(D.setEnemies(base, [counter.needer]), ctx, Infinity));
    assert.ok(withOpp.indexOf(counter.supplier) < without.indexOf(counter.supplier) || without.indexOf(counter.supplier) === 0);
});

test('suggestions carry a best-band percentile, matching the completions on the last pick', () => {
    const s = pickAll(D.createDraft('solo'), ['FERRARIUS', 'BALLISTARIUS']);
    const picks = D.suggestPick(s, ctx, 5);
    const bands = D.suggestBands(s, ctx, 5);
    assert.deepStrictEqual(picks.map(p => p.topPercent), bands.map(b => b.topPercent));
    assert.deepStrictEqual(picks.map(p => p.name), bands.map(b => b.heroes[2]));
    picks.forEach(p => assert.ok(p.topPercent > 0 && p.topPercent <= 100));
});

test('suggestBands completes the current band and never uses unavailable heroes', () => {
    let s = D.setExcluded(D.createDraft('solo'), ['TEMPUS']);
    s = D.applyAction(s, 'FERRARIUS');
    const bands = D.suggestBands(s, ctx, 20);
    assert.strictEqual(bands.length, 20);
    bands.forEach(b => {
        assert.strictEqual(b.heroes[0], 'FERRARIUS');
        assert.strictEqual(b.heroes.length, 3);
        assert.ok(!b.heroes.includes('TEMPUS'));
    });
    for (let i = 1; i < bands.length; i++) assert.ok(bands[i - 1].score >= bands[i].score);
});

test('from an empty band all but one curated band are in the top 30% of suggestBands', t => {
    const all = D.suggestBands(D.createDraft('solo'), ctx, Infinity);
    assert.strictEqual(all.length, 7140);
    const keyOf = b => [...b].sort().join('|');
    const rank = new Map(all.map((b, i) => [keyOf(b.heroes), i]));
    checkOutliers(t, data.recommended_bands
        .filter(b => rank.get(keyOf(b.heroes)) >= 7140 * 0.3)
        .map(b => `${b.heroes.join(', ')} is suggestion #${rank.get(keyOf(b.heroes)) + 1}`));
});

test('two-player suggestions are for whoever acts; ban steps suggest bans', () => {
    let s = D.createDraft('interleaved', { me: 2 });
    const ban = D.suggestFor(s, ctx, 3);
    assert.strictEqual(ban.action, 'ban');
    assert.strictEqual(ban.player, 1);
    assert.strictEqual(ban.items.length, 3);
    s = pickAll(s, ['SAXUM', 'TEMPUS']);
    const pick = D.suggestFor(s, ctx, 3);
    assert.strictEqual(pick.action, 'pick');
    assert.ok(pick.items.every(i => i.name !== 'SAXUM' && i.name !== 'TEMPUS'));
});

test('a full band gets swap suggestions that improve it', () => {
    const s = pickAll(D.createDraft('solo'), ['FIDEA', 'GOETIUM', 'MESSUM']);
    const swaps = D.suggestSwaps(s, ctx);
    assert.strictEqual(swaps.length, 3);
    const current = D.scoreTeam(D.myBand(s), ctx).total;
    swaps.forEach(sw => {
        assert.ok(D.myBand(s).includes(sw.out) && !D.myBand(s).includes(sw.in));
        assert.ok(sw.score > current);
    });
});

test('solo: replacePick swaps a hero in place as one undo step', () => {
    const s = pickAll(D.createDraft('solo'), ['FERRARIUS', 'BALLISTARIUS', 'TEMPUS']);
    const r = D.replacePick(s, 'BALLISTARIUS', 'FIDEA');
    assert.deepStrictEqual(D.myBand(r), ['FERRARIUS', 'FIDEA', 'TEMPUS']);
    assert.deepStrictEqual(D.undo(r), s);
    assert.throws(() => D.replacePick(s, 'SAXUM', 'FIDEA'), 'not in band');
    assert.throws(() => D.replacePick(s, 'TEMPUS', 'FERRARIUS'), 'already picked');
    assert.throws(() => D.replacePick(D.createDraft('standard'), 'A', 'B'));
});

test('solo: fillBand adds several heroes as one undo step', () => {
    const s = D.applyAction(D.createDraft('solo'), 'FERRARIUS');
    const f = D.fillBand(s, ['BALLISTARIUS', 'TEMPUS']);
    assert.deepStrictEqual(D.myBand(f), ['FERRARIUS', 'BALLISTARIUS', 'TEMPUS']);
    assert.deepStrictEqual(D.undo(f), s);
    assert.throws(() => D.fillBand(s, ['BALLISTARIUS', 'TEMPUS', 'FIDEA']), 'too many');
    assert.throws(() => D.fillBand(D.setEnemies(s, ['SAXUM']), ['SAXUM']), 'unavailable');
    assert.throws(() => D.fillBand(s, ['FIDEA', 'FIDEA']), 'duplicate');
});

test('suggestion reasons name the role filled instead of a generic coverage count', () => {
    const first = D.suggestPick(D.createDraft('solo'), ctx, 5);
    first.forEach(p => assert.ok(!p.reasons.some(r => r.factor === 'coverage'), `${p.name}: versatility explains a first pick`));
    const s = pickAll(D.createDraft('solo'), ['FERRARIUS', 'BALLISTARIUS']);
    D.suggestPick(s, ctx, Infinity).forEach(p => assert.ok(!p.reasons.some(r => r.id === 'coverage'), p.name));
});

test('fillable roles: every role the hero could take that adds one the band lacks', () => {
    // A flexible band leaves every role open to a flexible hero, not one arbitrary role
    assert.deepStrictEqual(D.fillableRoles(['TOXICUM'], 'MALLEUS', ctx), ['Controller', 'Attacker', 'Supporter']);
    // Ferrarius covers Controller or Supporter, Ballistarius covers Attacker
    assert.deepStrictEqual(D.fillableRoles(['FERRARIUS', 'BALLISTARIUS'], 'VINCTUM', ctx), ['Controller']);
    assert.deepStrictEqual(D.fillableRoles(['FERRARIUS', 'BALLISTARIUS'], 'TEMPUS', ctx), ['Controller', 'Supporter']);
    assert.deepStrictEqual(D.fillableRoles(['FERRARIUS', 'BALLISTARIUS'], 'EQUITA', ctx), []);
    assert.deepStrictEqual(D.fillableRoles([], 'TEMPUS', ctx), ['Controller', 'Supporter']);
});

// ---- UX support: reset as an undo step, ban wording, structured reasons ----------------------

test('reset is an undoable step in both modes', () => {
    const two = pickAll(D.createDraft('ban-first', { carryOverBans: ['MAGNUS'] }), ['SAXUM', 'TEMPUS']);
    const fresh = D.reset(two);
    assert.deepStrictEqual([fresh.format, fresh.history, fresh.carryOverBans], ['ban-first', [], ['MAGNUS']]);
    assert.deepStrictEqual(D.undo(fresh), two);
    const picked = D.applyAction(fresh, 'FIDEA');
    assert.deepStrictEqual(D.undo(D.undo(picked)), two, 'undo walks back through the reset');

    const solo = pickAll(D.setEnemies(D.createDraft('solo'), ['SAXUM']), ['FERRARIUS', 'TEMPUS']);
    const cleared = D.reset(solo);
    assert.deepStrictEqual([cleared.band, cleared.enemies, cleared.excluded], [[], [], []]);
    assert.deepStrictEqual(D.undo(cleared), solo);
    const blank = D.createDraft('solo');
    assert.strictEqual(D.undo(blank), blank, 'nothing to undo without a reset');
});

test('ban reasons say what the ban denies instead of repeating "strong pick"', () => {
    const s = D.applyAction(D.createDraft('interleaved'), 'SAXUM');
    D.suggestBan(s, ctx, 5).forEach(b => {
        assert.ok(!b.reasons.some(r => /Strong pick/.test(r.text)), b.name);
        const denies = b.reasons.find(r => r.id === 'ban:denies');
        assert.ok(denies, b.name);
        assert.match(denies.text, /^Denies Player 1: /);
        b.bestBand.forEach(n => assert.ok(denies.text.includes(n.charAt(0) + n.slice(1).toLowerCase()), `${b.name} names ${n}`));
    });
});

test('synergy reasons name who benefits, who supplies and a short detail', () => {
    const reasons = D.scoreTeam(['TOXICUM', 'TEMPUS', 'EQUITA'], ctx).reasons.filter(r => r.factor === 'synergy');
    assert.ok(reasons.length > 0);
    reasons.forEach(r => {
        assert.ok(r.beneficiary && r.heroes.includes(r.beneficiary), r.id);
        assert.ok(r.suppliers.length > 0 && r.suppliers.every(s => s !== r.beneficiary), r.id);
        assert.ok(typeof r.detail === 'string' && r.detail.length > 0, r.id);
    });
    const poison = reasons.find(r => r.id.startsWith('synergy:TOXICUM:Poison'));
    assert.deepStrictEqual([poison.beneficiary, poison.suppliers, poison.detail], ['TOXICUM', ['EQUITA'], 'Poison']);
    const cooldowns = reasons.find(r => r.id === 'enabler:cooldowns:TOXICUM');
    assert.deepStrictEqual([cooldowns.suppliers, cooldowns.detail], [['TEMPUS'], 'cooldowns']);
});

test('matchup reasons carry the relation behind them', () => {
    const counter = ctx.relations.find(r => r.type === 'counter' && r.supply.sources.length);
    const lost = D.scoreMatchup([counter.needer], [counter.supplier], ctx).reasons.find(r => r.kind === 'warning');
    assert.deepStrictEqual([lost.attacker, lost.victim], [counter.supplier, counter.needer]);
    assert.ok(lost.supply.label && Array.isArray(lost.supply.sources) && lost.rule);
});

// ---- Random hero -----------------------------------------------------------------------------

test('randomHero chooses among the available candidates using the given rng', () => {
    const s = pickAll(D.createDraft('standard'), ['FERRARIUS']);
    const candidates = ['FERRARIUS', 'TEMPUS', 'IRATUS'];
    assert.strictEqual(D.randomHero(s, candidates, () => 0), 'TEMPUS');
    assert.strictEqual(D.randomHero(s, candidates, () => 0.99), 'IRATUS');
});

test('randomHero returns null when no candidate is available or the draft is complete', () => {
    const s = pickAll(D.createDraft('standard'), ['FERRARIUS']);
    assert.strictEqual(D.randomHero(s, ['FERRARIUS'], () => 0), null);
    const done = pickAll(D.createDraft('solo'), ['FERRARIUS', 'TEMPUS', 'IRATUS']);
    assert.ok(D.isComplete(done));
    assert.strictEqual(D.randomHero(done, ['MAGNUS'], () => 0), null);
});

test('effect needs score once per teammate supplying the effect, and not for others', () => {
    const effectReasons = band => D.scoreTeam(band, ctx).reasons
        .filter(r => r.factor === 'synergy' && r.beneficiary === 'CARNIFEX' && r.detail === 'Negative effect');
    const two = effectReasons(['CARNIFEX', 'TOXICUM', 'LIBRORUM']);
    const one = effectReasons(['CARNIFEX', 'TOXICUM', 'ARCHITECTUS']);
    assert.deepStrictEqual(two.map(r => r.suppliers).sort(), [['LIBRORUM'], ['TOXICUM']]);
    assert.deepStrictEqual(one.map(r => r.suppliers), [['TOXICUM']]);
    assert.deepStrictEqual(effectReasons(['CARNIFEX', 'ARCHITECTUS', 'TEMPUS']), []);
    two.forEach(r => assert.strictEqual(r.delta, ctx.weights.effect));
    assert.match(two[0].text, /^Synergy: (Toxicum|Librorum) → Carnifex \(Negative effect\)$/);
});
