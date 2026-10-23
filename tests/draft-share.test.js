// Run with: node --test tests/*.test.js
// Shareable draft links (draft-share.js): hero ids in sequence order, replayed through the engine
const test = require('node:test');
const assert = require('node:assert');
const D = require('../draft.js');
const S = require('../draft-share.js');

const heroes = require('../bestiary_reference_cards.json').bestiary_of_sigillum.characters;
const id = name => heroes.find(h => h.name === name).id;
const pickAll = (state, names) => names.reduce((s, n) => D.applyAction(s, n), state);
const FINISHED = ['TOXICUM', 'SAXUM', 'TEMPUS', 'MALLEUS', 'EQUITA', 'FERRARIUS'];

test('a two-player draft encodes its format and the hero ids in sequence order', () => {
    const s = pickAll(D.createDraft('standard'), FINISHED);
    assert.strictEqual(S.encodeDraft(s, heroes), `draft/standard/${FINISHED.map(id).join('.')}`);
});

test('carry-over bans follow as ~ids; bans are part of the sequence', () => {
    const s = pickAll(D.createDraft('ban-first', { carryOverBans: ['MAGNUS', 'AQUS'] }),
        ['FIDEA', 'GOETIUM', 'MESSUM', 'ARMUS', 'VINCTUM', 'ERESIDA', ...FINISHED]);
    const code = S.encodeDraft(s, heroes);
    assert.match(code, new RegExp(`^draft/ban-first/[\\d.]+/~${id('MAGNUS')}\\.${id('AQUS')}$`));
    assert.deepStrictEqual(S.decodeDraft(code, heroes), { state: s });
});

test('round trip for every format, with or without a leading #', () => {
    const two = pickAll(D.createDraft('interleaved'), ['FIDEA', 'GOETIUM', ...FINISHED.slice(0, 2), 'MESSUM', 'ARMUS', ...FINISHED.slice(2, 4),
        'VINCTUM', 'ERESIDA', ...FINISHED.slice(4)]);
    assert.deepStrictEqual(S.decodeDraft(`#${S.encodeDraft(two, heroes)}`, heroes), { state: two });
    const standard = pickAll(D.createDraft('standard'), FINISHED);
    assert.deepStrictEqual(S.decodeDraft(S.encodeDraft(standard, heroes), heroes), { state: standard });
});

test('links to an old "Build my band" band say that mode is gone', () => {
    const old = `draft/solo/${['FERRARIUS', 'TEMPUS', 'FIDEA'].map(id).join('.')}/vs${id('SAXUM')}/ex${id('LIBRORUM')}`;
    assert.deepStrictEqual(S.decodeDraft(old, heroes), { error: 'Links to a single band from "Build my band" no longer open.' });
    assert.match(S.decodeDraft(`draft/standard/${FINISHED.map(id).join('.')}/vs${id('AQUS')}`, heroes).error, /Unknown part "vs/);
});

test('bad links are rejected with a message', () => {
    const bad = code => S.decodeDraft(code, heroes).error;
    assert.match(bad('draft/standard/999.1.2.3.4.5'), /Unknown hero #999/);
    assert.match(bad('draft/blitz/1.2.3.4.5.6'), /Unknown draft format/);
    assert.match(bad('draft/standard/1.1.2.3.4.5'), /not available/);
    assert.match(bad('draft/standard/1.2.3.4.5.6.7'), /too many/i);
    assert.match(bad('draft/standard/1.2.x.4'), /hero id/i);
    assert.match(bad('graph'), /not a draft link/i);
    assert.strictEqual(S.isDraftLink('#draft/standard/1.2'), true);
    assert.strictEqual(S.isDraftLink('#draft'), false);
});

test('an unfinished draft decodes (the UI decides what to show)', () => {
    const s = pickAll(D.createDraft('standard'), FINISHED.slice(0, 3));
    const { state } = S.decodeDraft(S.encodeDraft(s, heroes), heroes);
    assert.deepStrictEqual(state, s);
    assert.strictEqual(D.isComplete(state), false);
});
