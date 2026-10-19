// Draft view model (no DOM): turns draft state + engine output into exactly what the draft UI renders.
// draft-ui.js only draws this object. Loaded in the browser as window.DraftView (after draft.js)
// and in Node via require().
(function (root) {
    const Draft = typeof module !== 'undefined' && module.exports ? require('./draft.js') : root.Draft;
    const { titleCase } = typeof module !== 'undefined' && module.exports ? require('./synergy.js') : root.Synergy;

    const MAX_CHIPS = 3;
    const COMPLETION_LIMIT = 3;
    const INTRO = 'Start with a versatile hero — one that can fill several roles.';

    // pct is the share of bands scoring at least as well; past the middle, say how few score worse
    const roundUp = x => Math.min(100, Math.max(1, Math.ceil(x - 1e-9)));
    const percentLabel = pct => (pct <= 50 ? `Top ${roundUp(pct)}%` : `Bottom ${roundUp(100 - pct + 1)}%`);
    const CHIP_KIND = { positive: 'synergy', counter: 'counter', warning: 'warning' };
    const chipKind = reason => CHIP_KIND[reason.kind];

    // Up to MAX_CHIPS chips: good news first (biggest first), then warnings. A warning is never cut.
    function chipsFor(reasons) {
        const shown = reasons.filter(r => r.kind !== 'info');
        const good = shown.filter(r => r.kind !== 'warning').sort((a, b) => b.delta - a.delta);
        const bad = shown.filter(r => r.kind === 'warning').sort((a, b) => a.delta - b.delta);
        const goodCount = Math.min(good.length, MAX_CHIPS - Math.min(bad.length, 1));
        const picked = [...good.slice(0, goodCount), ...bad.slice(0, MAX_CHIPS - goodCount)];
        return {
            chips: picked.map(r => ({ kind: chipKind(r), text: r.text, reasonId: r.id })),
            moreChips: shown.length - picked.length
        };
    }

    const image = name => `hero_images/${name.toLowerCase()}.png`;

    function poolEntry(hero, state) {
        const reason = Draft.unavailableReason(state, hero.name);
        return {
            name: hero.name, display: titleCase(hero.name), id: hero.id, image: image(hero.name),
            attribute: hero.attribute, size: Draft.size(hero), attackRange: Draft.attackRange(hero),
            battleRoles: Draft.battleRoles(hero), vitality: hero.vitality,
            available: reason === null, unavailableReason: reason
        };
    }

    function suggestionItem(s) {
        return { name: s.name, display: titleCase(s.name), image: image(s.name), score: s.score,
            topPercent: s.topPercent, percentLabel: percentLabel(s.topPercent), bestBand: s.bestBand,
            reasons: s.reasons, ...chipsFor(s.reasons) };
    }

    // Every available hero ranked for whoever acts now, with the same verbs for both players
    function suggestions(state, ctx) {
        const step = Draft.currentStep(state);
        if (!step) return { action: null, player: null, items: [] };
        const list = step.action === 'ban'
            ? Draft.suggestBan(state, ctx, Infinity, { player: step.player })
            : Draft.suggestPick(state, ctx, Infinity, { player: step.player });
        return { action: step.action === 'ban' ? 'ban' : 'select', player: step.player, items: list.map(suggestionItem) };
    }

    function stepLabel(state) {
        const step = Draft.currentStep(state);
        if (!step) return state.format === 'solo' ? 'Band complete' : 'Draft complete';
        if (state.format === 'solo') return `Your pick ${state.band.length + 1} of 3`;
        const done = state.history.filter(h => h.player === step.player && h.action === step.action).length;
        return `Player ${step.player} ${step.action} ${done + 1} of 3`;
    }

    function sequence(state) {
        if (state.format === 'solo') return null;
        return Draft.draftSequence(state.format).map((s, index) => ({
            index, player: s.player, action: s.action,
            hero: index < state.history.length ? state.history[index].hero : null,
            status: index < state.history.length ? 'done' : index === state.history.length ? 'current' : 'upcoming'
        }));
    }

    function bandCard(b, band) {
        return { heroes: b.heroes, inBand: b.heroes.map(n => band.includes(n)), score: b.score,
            topPercent: b.topPercent, percentLabel: percentLabel(b.topPercent), reasons: b.reasons };
    }

    // Results for a (possibly previewed) band: roles, score, threats, synergy
    function analysis(band, opponents, pool, ctx) {
        const coverage = Draft.roleCoverage(band, ctx);
        const roles = Draft.BATTLE_ROLES.map(role => ({ role, coveredBy: coverage.assignment[role] || null, change: null }));
        let score;
        if (band.length >= 3) {
            const percent = Draft.bandPercent(band, opponents, ctx);
            score = { complete: true, percent, label: `Band: ${percentLabel(percent)}`, change: null };
        } else {
            const best = Draft.bestBand(band, pool, opponents, ctx);
            const percent = best ? best.topPercent : null;
            score = { complete: false, percent, label: best ? `Best reachable: ${percentLabel(percent)}` : 'No band reachable', change: null };
        }
        return {
            roles, coveredCount: coverage.covered.length, score,
            threats: opponents.length ? Draft.scoreMatchup(band, opponents, ctx).reasons.filter(r => r.kind === 'warning') : [],
            synergy: Draft.scoreTeam(band, ctx).reasons.filter(r => r.factor === 'synergy')
        };
    }

    // Heroes a preview adds to the acting player's band (one candidate, or a whole suggested band)
    function previewHeroes(state, band, preview) {
        const step = Draft.currentStep(state);
        if (!preview || !step || step.action !== 'pick') return [];
        const wanted = (Array.isArray(preview) ? preview : [preview]).filter(n => !band.includes(n));
        if (wanted.some(n => !Draft.isAvailable(state, n))) return [];
        return wanted.slice(0, 3 - band.length);
    }

    const slotsFor = (band, added) => [0, 1, 2].map(index => {
        const shown = [...band, ...added];
        return { index, hero: shown[index] || null, preview: index >= band.length && Boolean(shown[index]), startsOnCastle: index === 0 };
    });

    // In two-player mode a taken hero belongs to Player 1 or Player 2 (there is no "you")
    function unavailable(state, name, bands) {
        if (state.format !== 'solo') {
            if (bands[1].includes(name)) return 'player1';
            if (bands[2].includes(name)) return 'player2';
        }
        return Draft.unavailableReason(state, name);
    }

    function draftView(state, ctx, options = {}) {
        const solo = state.format === 'solo';
        const step = Draft.currentStep(state);
        const acting = step ? step.player : null;
        const bands = Draft.bands(state);
        const focus = solo ? 1 : options.player || acting || 1;
        const other = focus === 1 ? 2 : 1;
        const pool = ctx.heroes.map(h => h.name).filter(n => Draft.isAvailable(state, n));
        const added = { 1: [], 2: [] };
        if (acting) added[acting] = previewHeroes(state, bands[acting], options.preview);

        const ranked = suggestions(state, ctx);
        const rankOf = new Map(ranked.items.map((item, i) => [item.name, { rank: i + 1, ...item }]));
        const poolEntries = ctx.heroes.map(h => {
            const reason = unavailable(state, h.name, bands);
            return { ...poolEntry(h, state), available: reason === null, unavailableReason: reason, suggestion: rankOf.get(h.name) || null };
        });
        const available = poolEntries.filter(p => p.available).length;

        // Analysis of the focus band against the other; a preview shows when it's the focus band's turn
        const base = analysis(bands[focus], bands[other], pool, ctx);
        let result = base;
        if (added[focus].length) {
            result = analysis([...bands[focus], ...added[focus]], bands[other], pool.filter(n => !added[focus].includes(n)), ctx);
            result.roles.forEach((r, i) => { if (r.coveredBy && !base.roles[i].coveredBy) r.change = 'added'; });
            result.score.change = { from: base.score.percent, to: result.score.percent };
            // Mark what only the previewed heroes bring
            const flag = (list, baseList) => {
                const known = new Set(baseList.map(r => r.id));
                return list.map(r => ({ ...r, preview: !known.has(r.id) }));
            };
            result.threats = flag(result.threats, base.threats);
            result.synergy = flag(result.synergy, base.synergy);
        }

        const picking = step && step.action === 'pick';
        const completions = picking && bands[acting].length < 3
            ? Draft.suggestBands(state, ctx, options.completionLimit || COMPLETION_LIMIT, { player: acting }).map(b => bandCard(b, bands[acting]))
            : null;
        const swaps = solo && bands[1].length >= 3
            ? Draft.suggestSwaps(state, ctx).map(s => ({ ...s, display: { out: titleCase(s.out), in: titleCase(s.in) }, percentLabel: percentLabel(s.topPercent) }))
            : null;
        const banLists = Draft.bans(state);

        return {
            mode: solo ? 'solo' : 'two-player',
            format: state.format,
            complete: Draft.isComplete(state),
            step: { ...(step || { player: null, action: null }), label: stepLabel(state) },
            sequence: sequence(state),
            intro: picking && bands[acting].length === 0 ? INTRO : null,
            pool: poolEntries,
            counts: { available, unavailable: poolEntries.length - available },
            focus,
            slots: solo ? slotsFor(bands[1], added[1]) : null,
            against: solo ? [...state.enemies] : null,
            players: solo ? null : [1, 2].map(player => ({
                player, label: `Player ${player}`, acting: player === acting,
                slots: slotsFor(bands[player], added[player]), bans: banLists[player]
            })),
            excluded: solo ? [...state.excluded] : [...state.carryOverBans],
            suggestions: ranked,
            completions,
            swaps,
            analysis: result
        };
    }

    const api = { draftView, chipsFor, chipKind, percentLabel, MAX_CHIPS, INTRO };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.DraftView = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
