// Draft view model (no DOM): turns draft state + engine output into exactly what the draft UI renders.
// draft-ui.js only draws this object. Loaded in the browser as window.DraftView (after draft.js)
// and in Node via require().
(function (root) {
    const Draft = typeof module !== 'undefined' && module.exports ? require('./draft.js') : root.Draft;
    const Synergy = typeof module !== 'undefined' && module.exports ? require('./synergy.js') : root.Synergy;
    const { titleCase, describeRelation, heroAbilities } = Synergy;

    const MAX_CHIPS = 2;
    const SHORT_MAX = 32;

    // pct is the share of bands scoring at least as well; past the middle, say how few score worse
    const roundUp = x => Math.min(100, Math.max(1, Math.ceil(x - 1e-9)));
    const percentLabel = pct => (pct <= 50 ? `Top ${roundUp(pct)}%` : `Bottom ${roundUp(100 - pct + 1)}%`);
    // What "Top N%" is a share of, with the same rounded number as the label
    function percentExplain(pct, { facing = false } = {}) {
        if (pct === null || pct === undefined) return '';
        const against = facing ? ' against this opponent' : '';
        return pct <= 50
            ? `${percentLabel(pct)}: at most ${roundUp(pct)}% of all possible 3-hero bands score as well or better${against}.`
            : `${percentLabel(pct)}: only about ${roundUp(100 - pct + 1)}% of all possible 3-hero bands score this low or lower${against}.`;
    }

    // Battle roles from the strategy guide (Basic Principles of Army Composition); a band wants one of each
    const ROLE_INFO = {
        Controller: 'Holds and shapes the battlefield: pushes or pulls enemies, stuns them or speeds allies. Tough enough (3+ hit points) to stand in front.',
        Attacker: 'Deals the damage: attacks that grow, hit several enemies at once, or gain attack.',
        Supporter: 'Helps from range: buffs or heals allies, or weakens enemies with conditions.'
    };
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

    // `band`: the picks of whoever would play this hero (the rival, on a ban step), called `own`; `vs`: who they face
    function suggestionItem(s, band, own, vs) {
        return { name: s.name, display: titleCase(s.name), image: image(s.name), score: s.score,
            topPercent: s.topPercent, percentLabel: percentLabel(s.topPercent), bestBand: s.bestBand,
            bestWith: s.bestBand.filter(n => n !== s.name && !band.includes(n)),
            reasons: s.reasons, sections: popoverSections(s.reasons, s.name, { band, own, vs }), ...chipsFor(s.reasons, s.name) };
    }

    // Every available hero ranked for whoever acts now, with the same verbs for both players
    function suggestions(state, ctx) {
        const step = Draft.currentStep(state);
        if (!step) return { action: null, player: null, items: [] };
        const ban = step.action === 'ban';
        const list = ban
            ? Draft.suggestBan(state, ctx, Infinity, { player: step.player })
            : Draft.suggestPick(state, ctx, Infinity, { player: step.player });
        const plays = ban ? (step.player === 1 ? 2 : 1) : step.player;
        const band = Draft.bands(state)[plays];
        const vs = state.format === 'solo' ? 'Against' : `Player ${plays === 1 ? 2 : 1}`;
        const own = ban ? `Player ${plays}'s band` : 'your band';
        return { action: ban ? 'ban' : 'select', player: step.player, items: list.map(s => suggestionItem(s, band, own, vs)) };
    }

    // How much a group of reasons weighs: one dot per DOT_POINTS (the smallest bonus), at most 5
    const DOT_POINTS = 1.5;
    const strength = delta => ({ dots: delta > 0 ? Math.min(5, Math.max(1, Math.round(delta / DOT_POINTS))) : 0, warning: delta < 0 });

    const sum = reasons => reasons.reduce((t, r) => t + r.delta, 0);
    const andList = list => list.map(titleCase).join(', ').replace(/, ([^,]*)$/, ' and $1');

    // One line for some reasons: a single relation names the abilities on both sides
    function line(reasons, text) {
        const r = reasons[0];
        const rel = r.relations && r.relations[0];
        const own = !rel ? r.text
            : r.relations.length === 1 || !r.beneficiary ? describeRelation(rel)
            : `${andList(r.suppliers)} each supply ${rel.need.label} for ${titleCase(rel.needer)}'s ${Synergy.abilityList(rel.need.sources)}`;
        return { ids: reasons.map(x => x.id), reasons, text: text || own, kind: r.kind, delta: sum(reasons) };
    }
    const byWeight = (a, b) => (b.delta >= 0) - (a.delta >= 0) || Math.abs(b.delta) - Math.abs(a.delta);

    // The same help from the same heroes to several teammates is one line ("Arborus keeps Toxicum and Magnus alive")
    function mergedLines(reasons) {
        const merged = new Map();
        const lines = [];
        reasons.forEach(r => {
            if (!r.rule || !r.beneficiary) { lines.push(line([r])); return; }
            const key = `${r.rule}|${r.suppliers.join('|')}`;
            if (!merged.has(key)) { merged.set(key, []); lines.push(key); }
            merged.get(key).push(r);
        });
        return lines.map(l => (typeof l === 'string'
            ? line(merged.get(l), Draft.enablerText(merged.get(l)[0].rule, merged.get(l)[0].suppliers, merged.get(l).map(r => r.beneficiary)))
            : l));
    }

    // The tile popover's reasons by who they are with: the ban (ban steps), the hero with its teammates
    // (synergy, support, conflicts), the band as a whole (roles, themes, durability), then the matchup.
    // `band`: the picks of whoever would play `name`; `own`: what to call that band; `vs`: who they face.
    // Info lines are left out.
    function popoverSections(reasons, name, { band = [], own = 'your band', vs = 'Against' } = {}) {
        const sections = new Map();
        const put = (key, reason, make) => {
            if (!sections.has(key)) sections.set(key, { key, reasons: [], ...make() });
            sections.get(key).reasons.push(reason);
        };
        const kept = reasons.filter(r => r.kind !== 'info');
        const isTeam = r => (r.factor === 'synergy' || r.factor === 'conflict') && r.heroes.some(h => h !== name && band.includes(h));
        const teammates = band.filter(h => h !== name && kept.some(r => isTeam(r) && r.heroes.includes(h)));
        kept.forEach(r => {
            if (r.factor === 'ban') put('ban', r, () => ({ kind: 'ban', label: 'Ban', title: r.text }));
            else if (r.factor === 'matchup') put('matchup', r, () => ({ kind: 'matchup', label: `vs ${vs}`, title: `${titleCase(name)} vs ${vs}` }));
            else if (isTeam(r)) put('team', r, () => ({ kind: 'team', label: `With ${own}`, title: `${titleCase(name)} with ${andList(teammates)}`, heroes: teammates }));
            else put('band', r, () => ({ kind: 'band', label: 'Band', title: `${titleCase(name)} in the band` }));
        });
        const ORDER = ['ban', 'team', 'band', 'matchup'];
        return [...sections.values()].map(x => {
            const delta = sum(x.reasons);
            const lines = x.key === 'team' ? mergedLines(x.reasons) : x.reasons.map(r => line([r]));
            return { ...x, delta, strength: strength(delta), lines: lines.sort(byWeight) };
        }).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
    }

    // ---- Band analysis rows --------------------------------------------------------------------

    const ANALYSIS_SECTIONS = [
        { key: 'synergy', label: 'Synergy in band', test: r => r.factor === 'synergy' },
        { key: 'conflict', label: 'Careful with', test: r => r.factor === 'conflict' && r.kind === 'warning' },
        { key: 'theme', label: 'Themes', test: r => r.factor === 'theme' },
        { key: 'matchup', label: 'Matchup', test: r => r.factor === 'matchup' },
        { key: 'durability', label: 'Durability', test: r => r.factor === 'durability' }
    ];

    // Rows of one analysis section: { key, label, text, title, kind, strength, preview, reasons }. Synergy and
    // conflicts are one sentence per fact (no label); matchup rows are per pair, themes and durability per reason.
    function rowsFor(key, reasons, opponents) {
        const finish = row => {
            const delta = sum(row.reasons);
            return { ...row, title: row.title || row.label, delta, strength: strength(delta), preview: row.reasons.some(r => r.preview), opponents };
        };
        if (key === 'synergy' || key === 'conflict') {
            return mergedLines(reasons).map(l => finish({
                key: l.ids.join('+'), label: '', text: l.text, kind: l.kind, reasons: l.reasons,
                title: andList([...new Set(l.reasons.flatMap(r => r.heroes))])
            })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        }
        const rows = new Map();
        const put = (rowKey, r, make) => {
            if (!rows.has(rowKey)) rows.set(rowKey, { key: rowKey, reasons: [], ...make() });
            rows.get(rowKey).reasons.push(r);
        };
        reasons.forEach(r => {
            if (key === 'matchup') {
                const ours = r.kind === 'counter' ? r.attacker : r.victim;
                const theirs = r.kind === 'counter' ? r.victim : r.attacker;
                put(`${r.kind}:${ours}|${theirs}`, r, () => ({ kind: r.kind,
                    label: r.kind === 'counter' ? `${titleCase(ours)} counters ${titleCase(theirs)}` : `${titleCase(theirs)} threatens ${titleCase(ours)}` }));
            } else {
                put(r.id, r, () => ({ kind: r.kind,
                    label: key === 'theme' ? r.theme : r.id === 'durability:fragile' ? 'Fragile' : 'Frontline' }));
            }
        });
        return [...rows.values()].map(row => {
            const rs = row.reasons;
            const text = key === 'matchup' ? [...new Set(rs.map(r => r.supply.label))].join(', ')
                : key === 'theme' ? rs[0].text.replace(/^Theme: [^(]*\(/, '').replace(/\)$/, '')
                : rs[0].text.replace(/^(Frontline|Fragile): /, '');
            return finish({ ...row, text });
        }).sort((a, b) => b.delta - a.delta);
    }

    function analysisSections(reasons, { vs = 'Against', opponents = [] } = {}) {
        return ANALYSIS_SECTIONS.map(({ key, label, test }) => ({
            key, label: key === 'matchup' ? `${label} vs ${vs}` : label,
            rows: rowsFor(key, reasons.filter(test), opponents)
        })).filter(x => x.rows.length);
    }

    // Points per scoring factor (they add up to the band's value)
    const FACTORS = [['coverage', 'Roles'], ['synergy', 'Synergy'], ['theme', 'Themes'], ['durability', 'Durability'], ['conflict', 'Conflicts'], ['matchup', 'Matchup']];
    const breakdown = reasons => FACTORS
        .map(([factor, label]) => ({ factor, label, delta: sum(reasons.filter(r => r.factor === factor)) }))
        .filter(f => f.delta !== 0);

    // ---- Inspector: the reasons in words and the card text behind them ------------------------------

    // A single relation reads as its sentence, several as one sentence each; enablers merge as in the popover
    const inspectLines = reasons => mergedLines(reasons).flatMap(l => (l.reasons.length === 1 && l.reasons[0].relations
        ? l.reasons[0].relations.map(rel => ({ text: describeRelation(rel), kind: l.kind }))
        : [{ text: l.text, kind: l.kind }]));

    // `reasons`: a popover section or analysis row. Sides: one per hero in card order of appearance,
    // with the abilities to mark ({ ability, index, links }), card-level links and notes (Vitality, curated roles)
    function inspectView(reasons, ctx, { title = '', opponents = [] } = {}) {
        const all = reasons.flatMap(r => (r.band ? [r, ...Draft.scoreTeam(r.band, ctx).reasons.filter(x => x.kind !== 'info')] : [r]));
        const lines = [];
        inspectLines(all).forEach(l => { if (!lines.some(x => x.text === l.text)) lines.push(l); });
        const merged = new Map();
        reasons.forEach(r => Draft.reasonEvidence(r, ctx).forEach(e => {
            if (!merged.has(e.hero)) merged.set(e.hero, { links: [], abilities: [], notes: [] });
            const m = merged.get(e.hero);
            e.links.forEach(l => { if (!m.links.includes(l)) m.links.push(l); });
            e.abilities.forEach(i => { if (!m.abilities.includes(i)) m.abilities.push(i); });
            e.notes.forEach(n => { if (!m.notes.includes(n)) m.notes.push(n); });
        }));
        const sides = [...merged.entries()].map(([hero, m]) => ({
            ...heroAbilities(ctx.byName.get(hero), m.links, { abilities: m.abilities }),
            display: titleCase(hero), image: image(hero), theirs: opponents.includes(hero), notes: m.notes
        }));
        return { title, lines, sides };
    }

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


    // Results for a (possibly previewed) band: roles, score and every reason (team and matchup)
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
            reasons: [...Draft.scoreTeam(band, ctx).reasons, ...(opponents.length ? Draft.scoreMatchup(band, opponents, ctx).reasons : [])]
        };
    }

    // Rows and breakdown, once the reasons carry their preview flags
    const withSections = (a, options) => ({ ...a, sections: analysisSections(a.reasons, options), breakdown: breakdown(a.reasons) });

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
        const rowOptions = { vs: solo ? 'Against' : `Player ${other}`, opponents: bands[other] };
        const base = withSections(analysis(bands[focus], bands[other], pool, ctx), rowOptions);
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
            result.reasons = flag(result.reasons, base.reasons);
            result = withSections(result, rowOptions);
        }

        const banLists = Draft.bans(state);

        return {
            mode: solo ? 'solo' : 'two-player',
            format: state.format,
            complete: Draft.isComplete(state),
            step: { ...(step || { player: null, action: null }), label: stepLabel(state) },
            sequence: sequence(state),
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

    // `hero`: just that hero's card (opened from the pool)
    function referenceSides(state, { hero = null } = {}) {
        if (hero) return [{ key: 'hero', label: titleCase(hero), heroes: [hero] }];
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

    // The graph's draft button for a selected hero: what the current step would do with it
    const TAKEN = { picked: 'Already picked', facing: 'Already picked', banned: 'Banned', excluded: 'Excluded' };
    const TAKEN_SOLO = { picked: 'In your band', facing: 'Facing it', excluded: 'Excluded' };
    function graphAction(state, name) {
        const solo = state.format === 'solo';
        const reason = Draft.unavailableReason(state, name);
        if (reason) return { label: (solo ? TAKEN_SOLO : TAKEN)[reason], enabled: false };
        const step = Draft.currentStep(state);
        if (!step) return { label: solo ? 'Band is full' : 'Draft complete', enabled: false };
        if (solo) return { label: 'Add to band', enabled: true };
        return { label: `${step.action === 'ban' ? 'Ban' : 'Pick'} for Player ${step.player}`, enabled: true };
    }

    const api = { draftView, referenceSides, graphAction, rollFrames, chipsFor, chipKind, shortReason, strength, popoverSections, inspectView,
        collapse, percentLabel, percentExplain, ROLE_INFO, MAX_CHIPS };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.DraftView = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
