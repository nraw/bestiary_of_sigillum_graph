// Run with: node --test tests/*.test.js
// First-visit intro (intro.js): shown once, never on top of a shared link
const test = require('node:test');
const assert = require('node:assert');
const I = require('../intro.js');

const memory = (initial = {}) => {
    const data = { ...initial };
    return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
};
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

test('a first plain visit shows the intro, on either tab', () => {
    for (const hash of ['', '#', '#graph', '#draft']) {
        assert.strictEqual(I.shouldShowIntro({ seen: false, hash }), true, hash);
    }
});

test('once seen, the intro stays closed', () => {
    assert.strictEqual(I.shouldShowIntro({ seen: true, hash: '' }), false);
});

test('a shared or deep link opens straight onto its content', () => {
    for (const hash of ['#draft/standard/1.2.3.4.5.6', '#graph/hero/AQUS', '#graph/band/AQUS+ARMUS/vs/FIDEA']) {
        assert.strictEqual(I.shouldShowIntro({ seen: false, hash }), false, hash);
    }
});

test('a ?hero= / ?trait= / ?band= link opens straight onto its selection; tracking parameters do not count', () => {
    for (const search of ['?hero=aqus', '?trait=stun', '?band=aqus,tempus']) {
        assert.strictEqual(I.shouldShowIntro({ seen: false, hash: '', search }), false, search);
    }
    assert.strictEqual(I.shouldShowIntro({ seen: false, hash: '', search: '?utm_source=bgg' }), true);
});

test('seen is remembered in storage under a versioned key', () => {
    const storage = memory();
    assert.strictEqual(I.introSeen(storage), false);
    I.markIntroSeen(storage);
    assert.strictEqual(I.introSeen(storage), true);
    assert.match(I.INTRO_KEY, /intro.*v\d+$/);
});

test('without usable storage the intro neither crashes nor nags', () => {
    assert.strictEqual(I.introSeen(broken), true);
    assert.doesNotThrow(() => I.markIntroSeen(broken));
    assert.strictEqual(I.introSeen(undefined), true);
});
