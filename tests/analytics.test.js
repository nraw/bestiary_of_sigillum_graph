// Run with: node --test tests/*.test.js
// Analytics (analytics.js): the GA4 event catalogue, payload cleaning and the draft / hover / search helpers
const test = require('node:test');
const assert = require('node:assert');
const A = require('../analytics.js');
const Draft = require('../draft.js');

test('every event name is GA4-safe and every param is a registered dimension or metric', () => {
    const registered = new Set([...A.DIMENSIONS, ...A.METRICS, ...A.BUILT_IN]);
    for (const [name, params] of Object.entries(A.EVENTS)) {
        assert.match(name, /^[a-z][a-z0-9_]{0,39}$/, name);
        assert.ok(params.length <= 25, `${name} has too many params`);
        params.forEach(p => assert.ok(registered.has(p), `${name}.${p} is not registered`));
    }
});

test('registered dimensions and metrics fit the GA4 free limits and are all used', () => {
    assert.ok(A.DIMENSIONS.length <= 50);
    assert.ok(A.METRICS.length <= 50);
    const used = new Set(Object.values(A.EVENTS).flat());
    [...A.DIMENSIONS, ...A.METRICS].forEach(p => assert.ok(used.has(p), `${p} is registered but never sent`));
});

test('the plan in docs lists every registered dimension', () => {
    const doc = require('node:fs').readFileSync(require('node:path').join(__dirname, '../docs/analytics-tracking-plan.md'), 'utf8');
    [...A.DIMENSIONS, ...A.METRICS].forEach(p => assert.ok(doc.includes(p), `${p} missing from docs/analytics-tracking-plan.md`));
});

test('payload drops empty values, stringifies booleans and trims long strings', () => {
    const p = A.payload('node_select', { node_type: 'hero', node_name: 'x'.repeat(150), source: null });
    assert.deepStrictEqual(Object.keys(p), ['node_type', 'node_name']);
    assert.strictEqual(p.node_name.length, 100);
    assert.deepStrictEqual(A.payload('arc_click', { hero_a: 'a', hero_b: 'b', synergy_category: 'x', hero_selected: false }).hero_selected, 'false');
    assert.strictEqual(A.payload('draft_pick', { pick_number: 2 }).pick_number, 2);
    assert.deepStrictEqual(A.payload('names_toggle', { state: '' }), {});
});

test('payload refuses unknown events and params', () => {
    assert.throws(() => A.payload('nope', {}), /Unknown analytics event/);
    assert.throws(() => A.payload('names_toggle', { colour: 'red' }), /not a param of names_toggle/);
});

test('the tracker sends cleaned payloads, and a bad call is reported instead of thrown', () => {
    const sent = [];
    const errors = [];
    const t = A.createTracker({ send: (name, params) => sent.push([name, params]), onError: e => errors.push(e.message) });
    t.track('names_toggle', { state: 'on' });
    t.track('nope');
    assert.deepStrictEqual(sent, [['names_toggle', { state: 'on' }]]);
    assert.strictEqual(errors.length, 1);
});

test('a disabled tracker sends nothing', () => {
    const sent = [];
    const t = A.createTracker({ send: () => sent.push(1), enabled: false });
    t.track('names_toggle', { state: 'on' });
    assert.strictEqual(sent.length, 0);
});

test('once is true only the first time per key', () => {
    const t = A.createTracker({ send() {} });
    assert.strictEqual(t.once('a'), true);
    assert.strictEqual(t.once('a'), false);
    assert.strictEqual(t.once('b'), true);
});

test('tracking is off on localhost and local files', () => {
    ['localhost', '127.0.0.1', '[::1]', '', '0.0.0.0'].forEach(h => assert.strictEqual(A.shouldTrack(h), false, h));
    assert.strictEqual(A.shouldTrack('bos.nraw.eu'), true);
});

test('bandKey sorts so pick order does not matter', () => {
    assert.strictEqual(A.bandKey(['saxum', 'aqus', 'brewus']), 'aqus,brewus,saxum');
    assert.strictEqual(A.bandKey(['brewus', 'saxum', 'aqus']), 'aqus,brewus,saxum');
    assert.strictEqual(A.bandKey([]), '');
});

test('entryOf names how the visit started', () => {
    assert.strictEqual(A.entryOf({ search: '', hash: '' }), 'direct');
    assert.strictEqual(A.entryOf({ search: '?hero=saxum', hash: '' }), 'hero_link');
    assert.strictEqual(A.entryOf({ search: '?trait=Melee', hash: '' }), 'trait_link');
    assert.strictEqual(A.entryOf({ search: '?band=a,b&vs=c', hash: '' }), 'band_link');
    assert.strictEqual(A.entryOf({ search: '', hash: '#draft' }), 'draft_tab');
    assert.strictEqual(A.entryOf({ search: '', hash: '#draft/standard/1.2.3.4.5.6' }), 'draft_share');
    assert.strictEqual(A.entryOf({ search: '', hash: '#graph/hero/saxum' }), 'hero_link');
});

// A delay with fake timers
function fakeTimers() {
    let next = 1;
    const pending = new Map();
    return {
        setTimer: (fn, ms) => { const id = next++; pending.set(id, fn); return id; },
        clearTimer: id => pending.delete(id),
        flush() { const fns = [...pending.values()]; pending.clear(); fns.forEach(fn => fn()); },
        get count() { return pending.size; }
    };
}

test('a delay fires after its wait unless cancelled, and a new start replaces the old one', () => {
    const timers = fakeTimers();
    const d = A.createDelay({ wait: 700, ...timers });
    const fired = [];
    d.start(() => fired.push('a'));
    d.cancel();
    timers.flush();
    assert.deepStrictEqual(fired, []);
    d.start(() => fired.push('b'));
    d.start(() => fired.push('c'));
    assert.strictEqual(timers.count, 1);
    timers.flush();
    assert.deepStrictEqual(fired, ['c']);
});

test('settled search sends a term once, only after typing stops, and never the same term twice in a row', () => {
    const timers = fakeTimers();
    const sent = [];
    const s = A.createSettledSearch({ wait: 1000, send: term => sent.push(term), ...timers });
    ['a', 'ar', 'arc', 'arch'].forEach(t => s.input(t));
    timers.flush();
    s.input('arch');
    timers.flush();
    s.input('  ');
    timers.flush();
    s.input('saxum');
    s.flush();
    assert.deepStrictEqual(sent, ['arch', 'saxum']);
    assert.strictEqual(timers.count, 0);
});

// ---- Draft events --------------------------------------------------------------------------

const two = format => Draft.createDraft(format);
const add = (s, hero, player, action = 'pick') => ({ ...s, history: [...s.history, { player, action, hero }] });

test('a two-player pick or ban becomes draft_pick / draft_ban with its player and number', () => {
    let s = two('ban-first');
    const first = add(s, 'saxum', 1, 'ban');
    assert.deepStrictEqual(A.draftEvents(s, first, { method: 'tile' }), [
        { name: 'draft_start', params: { format: 'ban-first' } },
        { name: 'draft_ban', params: { hero: 'saxum', format: 'ban-first', player: 1, pick_number: 1, method: 'tile' } }
    ]);
    s = add(add(first, 'aqus', 2, 'ban'), 'brewus', 1, 'ban');
    const next = add(s, 'mortum', 2, 'ban');
    assert.deepStrictEqual(A.draftEvents(s, next), [
        { name: 'draft_ban', params: { hero: 'mortum', format: 'ban-first', player: 2, pick_number: 2 } }
    ]);
});

test('solo picks: each hero added to the band is a pick, numbered by its slot', () => {
    const s = { ...Draft.createDraft('solo'), band: ['aqus'] };
    const after = { ...s, band: ['aqus', 'brewus', 'saxum'] };
    assert.deepStrictEqual(A.draftEvents(s, after, { method: 'fill' }).map(e => [e.name, e.params.hero, e.params.pick_number]),
        [['draft_pick', 'brewus', 2], ['draft_pick', 'saxum', 3]]);
    assert.deepStrictEqual(A.draftEvents(Draft.createDraft('solo'), { ...Draft.createDraft('solo'), band: ['aqus'] }).map(e => e.name),
        ['draft_start', 'draft_pick']);
});

test('no events for unchanged states, undo, or a different draft', () => {
    const s = add(two('standard'), 'saxum', 1);
    assert.deepStrictEqual(A.draftEvents(s, s), []);
    assert.deepStrictEqual(A.draftEvents(s, two('standard')), []);
    assert.deepStrictEqual(A.draftEvents(s, add(two('interleaved'), 'aqus', 1, 'ban')), []);
});

test('completion: one band event and one event per hero on each side', () => {
    let s = two('standard');
    [['aqus', 1], ['saxum', 2], ['brewus', 1], ['mortum', 2], ['caballus', 1], ['tempus', 2]].forEach(([h, p]) => { s = add(s, h, p); });
    const events = A.completionEvents(s, { bands: Draft.bands(s), bans: Draft.bans(s), topPercent: 12.5, scoreLabel: 'Band: Top 13%', rolesCovered: 3, durationSec: 95 });
    assert.deepStrictEqual(events[0], { name: 'draft_complete', params: {
        format: 'standard', band: 'aqus,brewus,caballus', opponent_band: 'mortum,saxum,tempus', bans_mine: '', bans_theirs: '',
        band_top_percent: 12.5, score_label: 'Band: Top 13%', roles_covered: 3, duration_sec: 95 } });
    assert.deepStrictEqual(events.slice(1).map(e => [e.params.hero, e.params.side, e.params.pick_number]), [
        ['aqus', 'mine', 1], ['brewus', 'mine', 2], ['caballus', 'mine', 3],
        ['saxum', 'opponent', 1], ['mortum', 'opponent', 2], ['tempus', 'opponent', 3]]);
    events.forEach(e => assert.doesNotThrow(() => A.payload(e.name, e.params)));
});

test('completion follows whose band is "mine" (Player 2 seat)', () => {
    const s = { ...two('standard'), me: 2 };
    const bands = { 1: ['aqus'], 2: ['saxum'] };
    const [complete] = A.completionEvents(s, { bands, bans: { 1: ['x'], 2: ['y'] } });
    assert.strictEqual(complete.params.band, 'saxum');
    assert.strictEqual(complete.params.bans_mine, 'y');
});

test('completionKey identifies a band so a solo band re-completed the same way is not sent twice', () => {
    const s = Draft.createDraft('solo');
    const a = A.completionKey(s, { 1: ['brewus', 'aqus', 'saxum'], 2: [] });
    const b = A.completionKey(s, { 1: ['aqus', 'saxum', 'brewus'], 2: [] });
    const c = A.completionKey(s, { 1: ['aqus', 'saxum', 'brewus'], 2: ['mortum'] });
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
});

test('slug turns a section heading into a GA-friendly value', () => {
    assert.strictEqual(A.slug('Card Traits 4'), 'card_traits');
    assert.strictEqual(A.slug('  Works well with  '), 'works_well_with');
    assert.strictEqual(A.slug(''), null);
});

test('the page tracker is one shared instance, off outside the live site (Node has no location)', () => {
    assert.strictEqual(A.pageTracker(), A.pageTracker());
    let sent = 0;
    globalThis.gtag = () => { sent++; };
    A.pageTracker().track('names_toggle', { state: 'on' });
    delete globalThis.gtag;
    assert.strictEqual(sent, 0);
});

test('trackingMode: GA on the live site, the console with ?analytics_debug, otherwise off', () => {
    assert.strictEqual(A.trackingMode({ hostname: 'bos.nraw.eu', search: '' }), 'gtag');
    assert.strictEqual(A.trackingMode({ hostname: 'localhost', search: '' }), 'off');
    assert.strictEqual(A.trackingMode({ hostname: 'localhost', search: '?analytics_debug' }), 'console');
    assert.strictEqual(A.trackingMode({ hostname: 'bos.nraw.eu', search: '?hero=saxum&analytics_debug=1' }), 'console');
    assert.strictEqual(A.trackingMode({}), 'off');
});
