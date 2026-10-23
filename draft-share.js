// Shareable draft links (no DOM): `draft/<format>/<hero ids in sequence order>` plus `~<carry-over bans>`.
// Decoding replays the picks through the engine, so an illegal sequence is rejected with the engine's message.
// Loaded in the browser as window.DraftShare (after draft.js) and in Node via require().
(function (root) {
    const Draft = typeof module !== 'undefined' && module.exports ? require('./draft.js') : root.Draft;

    const PREFIX = 'draft/';
    const strip = text => String(text || '').replace(/^#/, '');
    const isDraftLink = text => strip(text).startsWith(PREFIX);

    function encodeDraft(state, heroes) {
        const idOf = new Map(heroes.map(h => [h.name, h.id]));
        const ids = names => names.map(n => idOf.get(n)).join('.');
        const parts = [`${PREFIX}${state.format}`, ids(state.history.map(h => h.hero))];
        if (state.carryOverBans.length) parts.push(`~${ids(state.carryOverBans)}`);
        return parts.join('/');
    }

    // { state } or { error }
    function decodeDraft(text, heroes) {
        const code = strip(text);
        if (!isDraftLink(code)) return { error: 'This is not a draft link' };
        const byId = new Map(heroes.map(h => [String(h.id), h.name]));
        const names = list => {
            if (!list) return [];
            return list.split('.').map(part => {
                if (!/^\d+$/.test(part)) throw new Error(`"${part}" is not a hero id`);
                if (!byId.has(part)) throw new Error(`Unknown hero #${part}`);
                return byId.get(part);
            });
        };
        try {
            const [format, picks = '', ...extras] = code.slice(PREFIX.length).split('/');
            if (format === 'solo') throw new Error('Links to a single band from "Build my band" no longer open.');
            const unknown = extras.find(e => !e.startsWith('~'));
            if (unknown) throw new Error(`Unknown part "${unknown}"`);
            const sequence = names(picks);
            const carry = extras.find(e => e.startsWith('~'))?.slice(1);
            const state = Draft.createDraft(format, { carryOverBans: names(carry) });
            if (sequence.length > Draft.draftSequence(format).length) throw new Error('The link has too many picks for this format');
            return { state: sequence.reduce((s, name) => Draft.applyAction(s, name), state) };
        } catch (error) {
            return { error: error.message };
        }
    }

    const api = { encodeDraft, decodeDraft, isDraftLink };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.DraftShare = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
