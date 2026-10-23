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

    // What the pool search finds a hero by (search.js poolMatches), each term once
    function searchTerms(hero) {
        const terms = [];
        const add = (text, kind) => {
            if (text && !terms.some(t => t.text.toLowerCase() === text.toLowerCase())) terms.push({ text, kind });
        };
        add(hero.attribute, 'attribute');
        add(Draft.size(hero), 'size');
        add(Draft.attackRange(hero), 'range');
        Draft.battleRoles(hero).forEach(r => add(r, 'role'));
        hero.labels.forEach(l => add(l, 'trait'));
        return terms;
    }

    function poolEntry(hero, state) {
        const reason = Draft.unavailableReason(state, hero.name);
        return {
            terms: searchTerms(hero),
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
        const vs = `Player ${plays === 1 ? 2 : 1}`;
        const own = ban ? `Player ${plays}'s band` : 'your band';
        return { action: ban ? 'ban' : 'select', player: step.player, items: list.map(s => suggestionItem(s, band, own, vs)) };
    }

    // How much a group of reasons weighs: one dot per DOT_POINTS (the smallest bonus), at most 5
    const DOT_POINTS = 1.5;
    const strength = delta => ({ dots: delta > 0 ? Math.min(5, Math.max(1, Math.round(delta / DOT_POINTS))) : 0, warning: delta < 0 });

    const sum = reasons => reasons.reduce((t, r) => t + r.delta, 0);
    const andList = list => list.map(titleCase).join(', ').replace(/, ([^,]*)$/, ' and $1');

    // What a line is about; each topic has its own bullet colour in the UI
    const TOPICS = {
        synergy: { label: 'Synergy' }, support: { label: 'Support' }, conflict: { label: 'Conflict' }, matchup: { label: 'Matchup' },
        roles: { label: 'Roles' }, theme: { label: 'Theme' }, durability: { label: 'Durability' }, ban: { label: 'Ban' }
    };
    const FACTOR_TOPIC = { coverage: 'roles', versatility: 'roles', theme: 'theme', durability: 'durability', conflict: 'conflict', matchup: 'matchup', ban: 'ban' };
    const topicOf = r => (r.factor === 'synergy' ? (r.id.startsWith('enabler:') ? 'support' : 'synergy') : FACTOR_TOPIC[r.factor] || 'roles');

    // "Cooldowns: Toxicum and Tempus" (a plan the heroes share) or "Debuffs: Poison, Slowness" (a variety of effects)
    function themeText(r) {
        const variety = Draft.THEMES.find(t => t.name === r.theme).variety;
        return `${r.theme}: ${variety ? r.text.replace(/^[^(]*\(/, '').replace(/\)$/, '') : andList(r.heroes)}`;
    }

    // One line for some reasons: a single relation names the abilities on both sides
    function line(reasons, text) {
        const r = reasons[0];
        const rel = r.relations && r.relations[0];
        const own = r.theme ? themeText(r)
            : !rel ? r.text
            : r.relations.length === 1 || !r.beneficiary ? describeRelation(rel)
            : `${andList(r.suppliers)} each supply ${rel.need.label} for ${titleCase(rel.needer)}'s ${Synergy.abilityList(rel.need.sources)}`;
        return { ids: reasons.map(x => x.id), reasons, text: text || own, kind: r.kind, topic: topicOf(r), delta: sum(reasons),
            preview: reasons.some(x => x.preview) };
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

    // Reasons in sections, for a tile popover (`name`: the hero) or the band analysis (`name` null): the ban
    // (ban steps), then interactions, where an ability or trait meets another hero's (within the band: synergy,
    // support, conflicts; vs the opponent: the matchup), then what the hero or band brings in general (roles,
    // themes, durability). `group`: 'interaction' | 'general' | 'ban'. `band`: the picks of whoever would play
    // `name`; `own`: what to call that band; `vs`: who they face; `opponents`: their heroes. Info lines are left out.
    function popoverSections(reasons, name, { band = [], own = 'your band', vs = 'the opponent', opponents = [] } = {}) {
        const sections = new Map();
        const put = (key, reason, make) => {
            if (!sections.has(key)) sections.set(key, { key, reasons: [], ...make() });
            sections.get(key).reasons.push(reason);
        };
        const kept = reasons.filter(r => r.kind !== 'info');
        const interacts = r => r.factor === 'synergy' || r.factor === 'conflict';
        const isTeam = r => interacts(r) && (!name || r.heroes.some(h => h !== name && band.includes(h)));
        const teammates = band.filter(h => h !== name && kept.some(r => isTeam(r) && r.heroes.includes(h)));
        const who = name ? titleCase(name) : own.charAt(0).toUpperCase() + own.slice(1);
        kept.forEach(r => {
            if (r.factor === 'ban') put('ban', r, () => ({ kind: 'ban', group: 'ban', label: 'Ban', title: r.text }));
            else if (r.factor === 'matchup') put('matchup', r, () => ({ kind: 'matchup', group: 'interaction', label: `Interactions vs ${vs}`, title: `${who} vs ${vs}` }));
            else if (isTeam(r)) {
                put('team', r, () => ({ kind: 'team', group: 'interaction', label: name ? `Interactions with ${own}` : `Interactions within ${own}`,
                    title: name ? `${who} with ${andList(teammates)}` : who, heroes: teammates }));
            } else put('general', r, () => ({ kind: 'general', group: 'general', label: 'General', title: `${who} in general` }));
        });
        const ORDER = ['ban', 'team', 'matchup', 'general'];
        return [...sections.values()].map(x => {
            const delta = sum(x.reasons);
            const lines = x.key === 'team' ? mergedLines(x.reasons) : x.reasons.map(r => line([r]));
            return { ...x, delta, strength: strength(delta), opponents, lines: lines.sort(byWeight) };
        }).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
    }

    // ---- Band analysis --------------------------------------------------------------------------

    // Points per scoring factor (they add up to the band's value)
    const FACTORS = [['coverage', 'Roles'], ['synergy', 'Synergy'], ['theme', 'Themes'], ['durability', 'Durability'], ['conflict', 'Conflicts'], ['matchup', 'Matchup']];
    // Every factor, even at zero, with the reasons behind it (for the inspector); none for an empty band
    const breakdown = (reasons, band) => (band.length ? FACTORS.map(([factor, label]) => {
        const own = reasons.filter(r => r.factor === factor);
        return { factor, label, delta: sum(own), reasons: own.filter(r => r.kind !== 'info') };
    }) : []);

    // The pool's order: recommended (by suggestion rank), counters first, A–Z, or the card id. Unranked
    // heroes (or every hero, once the draft is over) follow in card id order.
    const SORTS = {
        recommended: () => 0,
        counters: (a, b) => b.counters - a.counters,
        name: (a, b) => a.display.localeCompare(b.display),
        id: (a, b) => a.id - b.id
    };
    function sortPool(entries, sort) {
        const rank = e => (e.suggestion ? e.suggestion.rank : Infinity);
        const byRank = sort === 'recommended' || sort === 'counters';
        return [...entries].sort((a, b) => (SORTS[sort] || SORTS.recommended)(a, b) || (byRank ? rank(a) - rank(b) : 0) || a.id - b.id);
    }

    // ---- Inspector: the reasons in words and the card text behind them ------------------------------

    const VERB = { has: 'has', inflicts: 'inflicts', grants: 'grants', gains: 'gains', places: 'places', benefits_from: 'benefits from', hindered_by: 'hindered by' };
    const tagOf = l => `${VERB[l.role] || l.role} ${l.label}`;
    const abilityName = (g, hero) => (g.ability.name ? titleCase(g.ability.name) : g.index === 0 ? 'Core ability' : `Support ability ${g.index}`);

    // One hero's side of some reasons: the abilities to mark ({ ability, index, links }), card-level links, notes
    // (role, Vitality) and an overview naming each ability with what it does here
    function sidesFor(reasons, ctx, opponents) {
        const merged = new Map();
        reasons.forEach(r => Draft.reasonEvidence(r, ctx).forEach(e => {
            if (!merged.has(e.hero)) merged.set(e.hero, { links: [], abilities: [], notes: [] });
            const m = merged.get(e.hero);
            e.links.forEach(l => { if (!m.links.includes(l)) m.links.push(l); });
            e.abilities.forEach(i => { if (!m.abilities.includes(i)) m.abilities.push(i); });
            e.notes.forEach(n => { if (!m.notes.includes(n)) m.notes.push(n); });
        }));
        return [...merged.entries()].map(([hero, m]) => {
            const side = heroAbilities(ctx.byName.get(hero), m.links, { abilities: m.abilities });
            return { ...side, display: titleCase(hero), image: image(hero), theirs: opponents.includes(hero), notes: m.notes,
                overview: [...side.abilities.map(g => ({ name: abilityName(g, hero), tags: [...new Set(g.links.map(tagOf))] })),
                    ...(side.cardLevel.length ? [{ name: 'Card trait', tags: [...new Set(side.cardLevel.map(tagOf))] }] : [])] };
        });
    }

    // The inspector for a popover section, one of its lines, or an analysis row: one item per line (the same
    // lines as the popover), each with only its own heroes and abilities. A ban lists the band it denies, line by line.
    function inspectView(reasons, ctx, { title = '', opponents = [] } = {}) {
        const item = l => ({ text: l.text, kind: l.kind, topic: l.topic, delta: l.delta, strength: strength(l.delta), sides: sidesFor(l.reasons, ctx, opponents) });
        const items = [];
        reasons.filter(r => r.band).forEach(ban => {
            items.push({ text: ban.text, kind: ban.kind, topic: 'ban', delta: ban.delta, strength: strength(0), sides: [] });
            mergedLines(Draft.scoreTeam(ban.band, ctx).reasons.filter(r => r.kind !== 'info')).sort(byWeight).forEach(l => items.push(item(l)));
        });
        mergedLines(reasons.filter(r => !r.band)).sort(byWeight).forEach(l => items.push(item(l)));
        return { title, items };
    }

    // The first `limit` items unless expanded, and exactly how many are hidden
    const collapse = (list, limit, expanded) =>
        ({ items: expanded ? [...list] : list.slice(0, limit), hidden: Math.max(0, list.length - limit), expanded });

    function stepLabel(state) {
        const step = Draft.currentStep(state);
        if (!step) return 'Draft complete';
        const done = state.history.filter(h => h.player === step.player && h.action === step.action).length;
        return `Player ${step.player} ${step.action} ${done + 1} of 3`;
    }

    function sequence(state) {
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

    // The popover's sections for the whole band (role coverage is Team balance's) and the score breakdown,
    // once the reasons carry their preview flags
    const withSections = (a, band, options) => ({ ...a, breakdown: breakdown(a.reasons, band),
        sections: popoverSections(a.reasons.filter(r => r.factor !== 'coverage'), null, options) });

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

    // A taken hero belongs to Player 1 or Player 2 (there is no "you")
    function unavailable(state, name, bands) {
        if (bands[1].includes(name)) return 'player1';
        if (bands[2].includes(name)) return 'player2';
        return Draft.unavailableReason(state, name);
    }

    // The end of the band analysis once the draft is complete: the strongest bands against the analysed band,
    // each with how it fares against it (its matchup lines, counters first) and every reason for the inspector
    function beatsView(target, player, ctx) {
        const vs = `Player ${player}`;
        const bands = Draft.counterBands(target, ctx).map(b => {
            const matchup = popoverSections(b.reasons, null, { band: b.heroes, own: 'this band', vs, opponents: target })
                .find(x => x.key === 'matchup');
            return { heroes: b.heroes, label: b.heroes.map(titleCase).join(' + '), images: b.heroes.map(image), score: b.score,
                counters: b.reasons.filter(r => r.kind === 'counter').length, lines: matchup ? matchup.lines : [], reasons: b.reasons };
        });
        return { title: `What beats ${vs}'s band`, target: [...target], vs, counteredBy: Draft.counteredBy(target, ctx).map(titleCase), bands };
    }

    function draftView(state, ctx, options = {}) {
        const step = Draft.currentStep(state);
        const acting = step ? step.player : null;
        const bands = Draft.bands(state);
        const focus = options.player || acting || 1;
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
        const rowOptions = { own: `Player ${focus}'s band`, vs: `Player ${other}`, opponents: bands[other] };
        const base = withSections(analysis(bands[focus], bands[other], pool, ctx), bands[focus], rowOptions);
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
            result = withSections(result, [...bands[focus], ...added[focus]], rowOptions);
        }

        const banLists = Draft.bans(state);
        const complete = Draft.isComplete(state);
        result = { ...result, beats: complete ? beatsView(bands[focus], focus, ctx) : null };

        return {
            format: state.format,
            complete,
            step: { ...(step || { player: null, action: null }), label: stepLabel(state) },
            sequence: sequence(state),
            pool: poolEntries,
            counts: { available, unavailable: poolEntries.length - available },
            focus,
            players: [1, 2].map(player => ({
                player, label: `Player ${player}`, acting: player === acting,
                slots: slotsFor(bands[player], added[player]), bans: banLists[player]
            })),
            carryOverBans: [...state.carryOverBans],
            suggestions: ranked,
            analysis: result
        };
    }

    // ---- Reference cards: one tab per side ------------------------------------------------

    // `hero`: just that hero's card (opened from the pool)
    function referenceSides(state, { hero = null } = {}) {
        if (hero) return [{ key: 'hero', label: titleCase(hero), heroes: [hero] }];
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
    const TAKEN = { picked: 'Already picked', facing: 'Already picked', banned: 'Banned' };
    function graphAction(state, name) {
        const reason = Draft.unavailableReason(state, name);
        if (reason) return { label: TAKEN[reason], enabled: false };
        const step = Draft.currentStep(state);
        if (!step) return { label: 'Draft complete', enabled: false };
        return { label: `${step.action === 'ban' ? 'Ban' : 'Pick'} for Player ${step.player}`, enabled: true };
    }

    const api = { draftView, referenceSides, graphAction, rollFrames, chipsFor, chipKind, shortReason, strength, popoverSections, inspectView, topicOf, TOPICS,
        collapse, sortPool, percentLabel, percentExplain, ROLE_INFO, MAX_CHIPS };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.DraftView = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
