// Draft view model (no DOM): turns draft state + engine output into exactly what the draft UI renders.
// draft-ui.js only draws this object. Loaded in the browser as window.DraftView (after draft.js)
// and in Node via require().
(function (root) {
    const Draft = typeof module !== 'undefined' && module.exports ? require('./draft.js') : root.Draft;
    const { titleCase } = typeof module !== 'undefined' && module.exports ? require('./synergy.js') : root.Synergy;

    const MAX_CHIPS = 2;
    const SHORT_MAX = 32;
    const INTRO = 'Start with a versatile hero — one that can fill several roles.';

    // pct is the share of bands scoring at least as well; past the middle, say how few score worse
    const roundUp = x => Math.min(100, Math.max(1, Math.ceil(x - 1e-9)));
    const percentLabel = pct => (pct <= 50 ? `Top ${roundUp(pct)}%` : `Bottom ${roundUp(100 - pct + 1)}%`);
    const CHIP_KIND = { positive: 'synergy', counter: 'counter', warning: 'warning' };
    const chipKind = reason => CHIP_KIND[reason.kind];

    const names = list => list.map(titleCase).join(', ');

    // Compact chip text for a reason, seen from the tile's hero (`name`); the full text stays in the popover
    function shortReason(r, name) {
        if (r.beneficiary) {
            const by = r.suppliers.length > 1 && names(r.suppliers).length > 20
                ? `${titleCase(r.suppliers[0])} +${r.suppliers.length - 1}` : names(r.suppliers);
            const full = r.beneficiary === name ? `Helped by ${by}` : `Helps ${titleCase(r.beneficiary)}`;
            return `${full} (${r.detail})`.length <= SHORT_MAX ? `${full} (${r.detail})` : full;
        }
        if (r.attacker) return r.kind === 'counter' ? `Counters ${titleCase(r.victim)}` : `Weak vs ${titleCase(r.attacker)}`;
        const [prefix, ...rest] = r.id.split(':');
        if (prefix === 'fills') return r.roles.length === 3 ? 'Fills any role' : `Fills ${r.roles.join(' or ')}`;
        if (prefix === 'versatility') {
            const roles = r.text.split(': ')[1] || '';
            return rest.length ? `Only a ${roles.replace(/^only a /, '')}` : `Versatile (${roles.split(', ').length} roles)`;
        }
        if (prefix === 'theme') return `Theme: ${rest[0]}`;
        if (prefix === 'coverage' && rest[0] === 'missing') return `No ${rest[1]}`;
        if (prefix === 'durability') return rest[0] === 'fragile' ? 'Fragile band' : 'Frontline';
        if (prefix === 'conflict' && r.heroes.length) return `Clashes with ${titleCase(r.heroes.find(h => h !== name) || r.heroes[1])}`;
        if (prefix === 'ban') return `${r.text.split(':')[0]} this band`;
        return r.text;
    }

    // Up to MAX_CHIPS chips: good news first (biggest first), then warnings. A warning is never cut.
    function chipsFor(reasons, name = null) {
        // The ban line says the same for every tile, so it lives in the popover only
        const shown = reasons.filter(r => r.kind !== 'info' && r.factor !== 'ban');
        const good = shown.filter(r => r.kind !== 'warning').sort((a, b) => b.delta - a.delta);
        const bad = shown.filter(r => r.kind === 'warning').sort((a, b) => a.delta - b.delta);
        const goodCount = Math.min(good.length, MAX_CHIPS - Math.min(bad.length, 1));
        const picked = [...good.slice(0, goodCount), ...bad.slice(0, MAX_CHIPS - goodCount)];
        return {
            chips: picked.map(r => ({ kind: chipKind(r), text: r.text, short: shortReason(r, name), reasonId: r.id })),
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

    // `band`: the picks of whoever would play this hero (the rival, on a ban step)
    function suggestionItem(s, band) {
        return { name: s.name, display: titleCase(s.name), image: image(s.name), score: s.score,
            topPercent: s.topPercent, percentLabel: percentLabel(s.topPercent), bestBand: s.bestBand,
            bestWith: s.bestBand.filter(n => n !== s.name && !band.includes(n)),
            reasons: s.reasons, ...chipsFor(s.reasons, s.name) };
    }

    // Every available hero ranked for whoever acts now, with the same verbs for both players
    function suggestions(state, ctx) {
        const step = Draft.currentStep(state);
        if (!step) return { action: null, player: null, items: [] };
        const ban = step.action === 'ban';
        const list = ban
            ? Draft.suggestBan(state, ctx, Infinity, { player: step.player })
            : Draft.suggestPick(state, ctx, Infinity, { player: step.player });
        const band = Draft.bands(state)[ban ? (step.player === 1 ? 2 : 1) : step.player];
        return { action: ban ? 'ban' : 'select', player: step.player, items: list.map(s => suggestionItem(s, band)) };
    }

    // Synergy grouped by the hero who benefits: { hero, from: [{ heroes, details }] }. Suppliers giving the
    // same help share an entry, and the same help told twice (partner + enabler wording) is listed once.
    function synergyGroups(reasons) {
        const groups = new Map();
        reasons.filter(r => r.beneficiary).forEach(r => {
            if (!groups.has(r.beneficiary)) {
                groups.set(r.beneficiary, { hero: r.beneficiary, display: titleCase(r.beneficiary), suppliers: new Map(), ids: [], delta: 0, preview: false });
            }
            const g = groups.get(r.beneficiary);
            g.ids.push(r.id);
            g.delta += r.delta;
            g.preview = g.preview || Boolean(r.preview);
            r.suppliers.forEach(supplier => {
                if (!g.suppliers.has(supplier)) g.suppliers.set(supplier, []);
                const details = g.suppliers.get(supplier);
                if (!details.some(d => d.toLowerCase() === r.detail.toLowerCase())) details.push(r.detail);
            });
        });
        return [...groups.values()].map(({ suppliers, ...g }) => {
            const from = [];
            suppliers.forEach((details, supplier) => {
                const same = from.find(f => f.details.join('|') === details.join('|'));
                if (same) same.heroes.push(supplier); else from.push({ heroes: [supplier], details });
            });
            return { ...g, from };
        }).sort((a, b) => b.delta - a.delta);
    }

    // Popover reasons by type; each type has its own marker colour in the UI
    const REASON_TYPES = [
        { type: 'ban', label: 'Ban', test: r => r.factor === 'ban' },
        { type: 'roles', label: 'Roles', test: r => r.factor === 'coverage' || r.factor === 'versatility' },
        { type: 'synergy', label: 'Synergy', test: r => r.id.startsWith('synergy:') },
        { type: 'support', label: 'Support', test: r => r.id.startsWith('enabler:') },
        { type: 'theme', label: 'Themes', test: r => r.factor === 'theme' },
        { type: 'matchup', label: 'Matchup', test: r => r.factor === 'matchup' },
        { type: 'durability', label: 'Durability', test: r => r.factor === 'durability' },
        { type: 'conflict', label: 'Conflicts', test: r => r.factor === 'conflict' },
        { type: 'other', label: 'Other', test: () => true }
    ];

    function reasonGroups(reasons) {
        const typeOf = r => REASON_TYPES.find(t => t.test(r)).type;
        return REASON_TYPES.map(({ type, label }) => ({ type, label, reasons: reasons.filter(r => typeOf(r) === type) }))
            .filter(g => g.reasons.length);
    }

    const groupText = g => g.from.map(f => `${names(f.heroes)} (${f.details.join(', ')})`).join(', ');

    // The first `limit` items unless expanded, and exactly how many are hidden
    const collapse = (list, limit, expanded) =>
        ({ items: expanded ? [...list] : list.slice(0, limit), hidden: Math.max(0, list.length - limit), expanded });

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

    const withGroups = a => ({ ...a, synergyGroups: synergyGroups(a.synergy) });

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
        return { index, hero: shown[index] || null, preview: index >= band.length && Boolean(shown[index]) };
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
            const suggestion = rankOf.get(h.name) || null;
            const entry = poolEntry(h, state);
            // Roles this hero would add to the picking band; the others are dimmed (nothing dimmed otherwise)
            const fills = reason === null && step && step.action === 'pick' && bands[acting].length
                ? Draft.fillableRoles(bands[acting], h.name, ctx) : entry.battleRoles;
            return { ...entry, available: reason === null, unavailableReason: reason, suggestion, fills,
                counters: suggestion ? suggestion.reasons.filter(r => r.kind === 'counter').length : 0 };
        });
        const available = poolEntries.filter(p => p.available).length;

        // Analysis of the focus band against the other; a preview shows when it's the focus band's turn
        const base = withGroups(analysis(bands[focus], bands[other], pool, ctx));
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
            result = withGroups(result);
        }

        const picking = step && step.action === 'pick';
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
            analysis: result
        };
    }

    // ---- Reference cards: one tab per side ------------------------------------------------

    function referenceSides(state) {
        if (state.format === 'solo') {
            return [{ key: 'mine', label: 'Your band', heroes: [...state.band] },
                ...(state.enemies.length ? [{ key: 'against', label: 'Against', heroes: [...state.enemies] }] : [])];
        }
        const bands = Draft.bands(state);
        return [1, 2].map(p => ({ key: String(p), label: `Player ${p}`, heroes: bands[p] }));
    }

    // ---- Random hero roll -----------------------------------------------------------------

    // The highlight hops between candidates, slowing down (delay in ms before the next frame), and lands on the winner
    function rollFrames(candidates, winner, { steps = 12, rng = Math.random } = {}) {
        if (candidates.length < 2) return [{ name: winner, delay: 0 }];
        // Built backwards from the winner so neighbouring frames always differ
        const names = [winner];
        while (names.length < steps) {
            const options = candidates.filter(n => n !== names[0]);
            names.unshift(options[Math.floor(rng() * options.length)]);
        }
        return names.map((name, i) => ({ name, delay: Math.round(55 + 220 * (i / (steps - 1)) ** 2) }));
    }

    const api = { draftView, referenceSides, rollFrames, chipsFor, chipKind, shortReason, reasonGroups, REASON_TYPES, synergyGroups, groupText,
        collapse, percentLabel, MAX_CHIPS, INTRO };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.DraftView = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
