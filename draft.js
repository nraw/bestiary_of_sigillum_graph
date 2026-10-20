// Draft assistant engine (no DOM): draft formats and immutable draft state, battle roles,
// band scoring with reasons, and pick / band / ban / swap suggestions.
// Loaded in the browser as window.Draft (after synergy.js) and in Node via require().
(function (root) {
    const Synergy = typeof module !== 'undefined' && module.exports ? require('./synergy.js') : root.Synergy;
    const { POSITIVE, NEGATIVE, titleCase } = Synergy;

    const BATTLE_ROLES = ['Controller', 'Attacker', 'Supporter'];
    const BAND_SIZE = 3;
    const MAX_ENEMIES = 3;

    // ---- Draft formats ---------------------------------------------------------------------

    const step = (player, action) => ({ player, action });
    const repeat = (n, steps) => Array.from({ length: n }, () => steps).flat();
    const FORMATS = {
        standard: () => repeat(3, [step(1, 'pick'), step(2, 'pick')]),
        'ban-first': () => [...repeat(3, [step(1, 'ban'), step(2, 'ban')]), ...FORMATS.standard()],
        interleaved: () => repeat(3, [step(1, 'ban'), step(2, 'ban'), step(1, 'pick'), step(2, 'pick')]),
        solo: () => repeat(3, [step(1, 'pick')])
    };
    const DRAFT_FORMATS = Object.keys(FORMATS);

    function draftSequence(format) {
        if (!FORMATS[format]) throw new Error(`Unknown draft format: ${format}`);
        return FORMATS[format]();
    }

    // ---- Draft state -----------------------------------------------------------------------
    // Two-player: { format, me, carryOverBans, history: [{ player, action, hero }] }
    // Solo:       { format: 'solo', me: 1, band, excluded, enemies, past: [snapshots for undo] }

    const isSolo = state => state.format === 'solo';
    const other = player => (player === 1 ? 2 : 1);

    function createDraft(format, options = {}) {
        draftSequence(format);
        if (format === 'solo') {
            return { format, me: 1, band: [], excluded: [...(options.excluded || [])], enemies: [...(options.enemies || [])], past: [] };
        }
        return { format, me: options.me === 2 ? 2 : 1, carryOverBans: [...(options.carryOverBans || [])], history: [] };
    }

    const historyOf = (state, action, player) => state.history
        .filter(h => h.action === action && h.player === player).map(h => h.hero);

    function bands(state) {
        if (isSolo(state)) return { 1: [...state.band], 2: [...state.enemies] };
        return { 1: historyOf(state, 'pick', 1), 2: historyOf(state, 'pick', 2) };
    }

    function bans(state) {
        if (isSolo(state)) return { 1: [], 2: [] };
        return { 1: historyOf(state, 'ban', 1), 2: historyOf(state, 'ban', 2) };
    }

    const bandOf = (state, player) => bands(state)[player];
    const myBand = state => bandOf(state, state.me);
    const opponentBand = state => bandOf(state, other(state.me));

    // Why a hero cannot be picked: picked (your band) | facing (opponent / enemies) | excluded | banned | null
    function unavailableReason(state, name) {
        if (isSolo(state)) {
            if (state.band.includes(name)) return 'picked';
            if (state.enemies.includes(name)) return 'facing';
            if (state.excluded.includes(name)) return 'excluded';
            return null;
        }
        if (myBand(state).includes(name)) return 'picked';
        if (opponentBand(state).includes(name)) return 'facing';
        if (state.carryOverBans.includes(name) || state.history.some(h => h.action === 'ban' && h.hero === name)) return 'banned';
        return null;
    }

    const isAvailable = (state, name) => unavailableReason(state, name) === null;
    const availableHeroes = (state, heroes) => heroes.filter(h => isAvailable(state, h.name));

    function currentStep(state) {
        if (isSolo(state)) return state.band.length < BAND_SIZE ? step(1, 'pick') : null;
        return draftSequence(state.format)[state.history.length] || null;
    }

    const isComplete = state => currentStep(state) === null;

    const snapshot = state => ({ band: [...state.band], excluded: [...state.excluded], enemies: [...state.enemies] });
    const soloChange = (state, changes) => ({ ...state, ...changes, past: [...state.past, snapshot(state)] });

    function requireSolo(state, what) {
        if (!isSolo(state)) throw new Error(`${what} is only available when building a band (solo)`);
    }

    function applyAction(state, name) {
        const current = currentStep(state);
        if (!current) throw new Error('The draft is complete');
        if (!isAvailable(state, name)) throw new Error(`${name} is not available (${unavailableReason(state, name)})`);
        if (isSolo(state)) return soloChange(state, { band: [...state.band, name] });
        return { ...state, history: [...state.history, { ...current, hero: name }] };
    }

    function undo(state) {
        if (isSolo(state)) {
            if (!state.past.length) return state;
            return { ...state, ...state.past[state.past.length - 1], past: state.past.slice(0, -1) };
        }
        if (!state.history.length) return state;
        return { ...state, history: state.history.slice(0, -1) };
    }

    function uniqueList(names, what) {
        if (new Set(names).size !== names.length) throw new Error(`${what} lists a hero twice`);
        return [...names];
    }

    function setEnemies(state, names) {
        requireSolo(state, 'Setting enemies');
        const enemies = uniqueList(names, 'Facing');
        if (enemies.length > MAX_ENEMIES) throw new Error(`At most ${MAX_ENEMIES} enemies`);
        enemies.forEach(n => {
            if (state.band.includes(n)) throw new Error(`${n} is in your band`);
            if (state.excluded.includes(n)) throw new Error(`${n} is excluded`);
        });
        return soloChange(state, { enemies });
    }

    function setExcluded(state, names) {
        requireSolo(state, 'Excluding heroes');
        const excluded = uniqueList(names, 'Excluded');
        excluded.forEach(n => {
            if (state.band.includes(n)) throw new Error(`${n} is in your band`);
            if (state.enemies.includes(n)) throw new Error(`${n} is an enemy`);
        });
        return soloChange(state, { excluded });
    }

    function removePick(state, name) {
        requireSolo(state, 'Removing a pick');
        if (!state.band.includes(name)) throw new Error(`${name} is not in your band`);
        return soloChange(state, { band: state.band.filter(n => n !== name) });
    }

    function replacePick(state, out, name) {
        requireSolo(state, 'Swapping a hero');
        if (!state.band.includes(out)) throw new Error(`${out} is not in your band`);
        if (!isAvailable(state, name)) throw new Error(`${name} is not available (${unavailableReason(state, name)})`);
        return soloChange(state, { band: state.band.map(n => (n === out ? name : n)) });
    }

    function fillBand(state, names) {
        requireSolo(state, 'Filling the band');
        uniqueList(names, 'The band');
        if (state.band.length + names.length > BAND_SIZE) throw new Error(`A band has ${BAND_SIZE} heroes`);
        names.forEach(n => { if (!isAvailable(state, n)) throw new Error(`${n} is not available (${unavailableReason(state, n)})`); });
        return soloChange(state, { band: [...state.band, ...names] });
    }

    function movePick(state, from, to) {
        requireSolo(state, 'Reordering the band');
        const band = [...state.band];
        if (from < 0 || from >= band.length || to < 0 || to >= band.length) throw new Error('No hero in that slot');
        band.splice(to, 0, band.splice(from, 1)[0]);
        return soloChange(state, { band });
    }

    // ---- Hero facts and battle roles -------------------------------------------------------

    function size(hero) {
        if (hero.vitality >= 5) return 'Big';
        return hero.vitality >= 3 ? 'Medium' : 'Small';
    }

    const SHORT_RANGES = ['adjacent', 'self', 'adjacent_or_self'];
    const FAR_RANGES = ['any_hex', 'any_hex_in_line', 'all_hexes_in_line', 'one_hex_gap_line'];

    // Melee / Ranged from the card labels, else from where the core attack reaches (null when unclear)
    function attackRange(hero) {
        if (hero.labels.includes('Ranged')) return 'Ranged';
        if (hero.labels.includes('Melee')) return 'Melee';
        if (FAR_RANGES.includes(hero.core_ability.range)) return 'Ranged';
        return hero.core_ability.range === 'adjacent' ? 'Melee' : null;
    }

        // Attacks that grow with a condition: "0+1 per ...", "1 (2 if ...)", "1 (medium), 2 (big)"
    const SCALING_ATTACK = /\bper\b|\(\d+ if|\d+ if\b|\d+ \(big\)/i;

    // Strategy guide roles: Controller (holds and manipulates position, ≥ 3 Hit Points), Attacker (damage,
    // ideally several targets) and Supporter (buffs, heals or debuffs from range). A hero may have several.
    function battleRoles(hero) {
        if (hero.battle_roles) return BATTLE_ROLES.filter(r => hero.battle_roles.includes(r));
        const links = hero.trait_links;
        const has = (label, roles) => links.some(l => l.label === label && (!roles || roles.includes(l.role)));
        const abilities = [hero.core_ability, ...hero.support_abilities];
        const isLong = source => {
            const ability = abilities.find(a => a.name === source);
            return Boolean(ability) && !SHORT_RANGES.includes(ability.range);
        };
        const supports = l => l.role === 'grants'
            || (l.role === 'inflicts' && NEGATIVE.includes(l.label) && (l.on || 'enemy') === 'enemy')
            || (l.role === 'has' && l.label === 'Healing');

        const roles = {
            Controller: hero.vitality >= 3
                && (has('Displacement') || has('Stun', ['inflicts']) || has('Swiftness', ['grants'])),
            Attacker: SCALING_ATTACK.test(hero.core_ability.effect) || has('AoE')
                || has('Attack increase', ['gains']),
            Supporter: links.some(l => supports(l) && l.sources.some(isLong))
        };
        return BATTLE_ROLES.filter(r => roles[r]);
    }

    // Roles the hero can fill, with vitality (a hardier hero holds a role longer) breaking ties
    const versatility = hero => battleRoles(hero).length + hero.vitality / 10;

    // ---- Context ---------------------------------------------------------------------------

    // Hand-tuned against the curated bands (tests/draft.test.js), keeping partner synergy the main signal
    const DEFAULT_WEIGHTS = {
        synergy: 3, broad: 0.5, enabler: 1.5, theme: 3,
        coverage: 1.5, missingRole: 0.5, frontline: 0.5, fragile: 3, conflict: 4, counter: 2,
        versatility: [5, 1, 0],   // by number of heroes already in the band
        lookahead: 10             // completions averaged when judging an early pick
    };

    function createContext(heroes, weights = {}) {
        const byName = new Map(heroes.map(h => [h.name, h]));
        const roles = new Map(heroes.map(h => [h.name, battleRoles(h)]));
        return {
            heroes, byName, roles,
            relations: Synergy.computeSynergies(heroes),
            themeRarity: new Map(THEMES.map(t => [t.name, themeRarity(t, heroes)])),
            weights: { ...DEFAULT_WEIGHTS, ...weights },
            cache: { team: new Map(), distribution: new Map() }
        };
    }

    const display = name => titleCase(name);
    const heroList = list => list.map(display).join(', ');

    // ---- Role coverage ---------------------------------------------------------------------

    // Assign each hero at most one role so that as many distinct roles as possible are covered
    function roleCoverage(band, ctx) {
        let best = {};
        const assign = (i, used) => {
            if (Object.keys(used).length > Object.keys(best).length) best = { ...used };
            if (i === band.length) return;
            ctx.roles.get(band[i]).forEach(role => {
                if (!used[role]) assign(i + 1, { ...used, [role]: band[i] });
            });
            assign(i + 1, used);
        };
        assign(0, {});
        const assignment = Object.fromEntries(BATTLE_ROLES.filter(r => best[r]).map(r => [r, best[r]]));
        return {
            assignment,
            covered: BATTLE_ROLES.filter(r => assignment[r]),
            missing: BATTLE_ROLES.filter(r => !assignment[r])
        };
    }

    // ---- Team score ------------------------------------------------------------------------

    const SUPPLY_ROLES = ['inflicts', 'grants', 'gains'];
    const needKey = r => `${r.needer}:${r.need.label}:${r.need.sources.join('/')}`;
    const inBand = (band, ...names) => names.every(n => band.includes(n));
    const abilityByName = (hero, name) => [hero.core_ability, ...hero.support_abilities].find(a => a.name === name);

    // Labels from `labels` the hero puts on the battlefield (self-harm does not count)
    const supplied = (hero, labels) => [...new Set(hero.trait_links.filter(l => SUPPLY_ROLES.includes(l.role)
        && labels.includes(l.label) && !(l.role === 'inflicts' && (l.on === 'self' || l.on === 'ally'))).map(l => l.label))];
    const supplies = (hero, labels) => supplied(hero, labels).length > 0;
    const grants = (hero, labels) => hero.trait_links.some(l => l.role === 'grants' && labels.includes(l.label));
    // Repositions enemies (not only itself or its allies)
    const movesEnemies = hero => hero.trait_links.some(l => l.label === 'Displacement' && l.sources.some(src => {
        const ability = abilityByName(hero, src);
        return ability && /enemy|character|target/i.test(ability.target) && !/^any ally/i.test(ability.target);
    }));

    // Several heroes pushing the same plan. Variety themes ("a wide range of buffs") count distinct effects
    // rather than heroes. Each theme is weighted by its rarity across the roster (createContext).
    const DEBUFFS = ['Attack decrease', 'Defense decrease', 'Control decrease', 'Slowness', 'Poison'];
    const THEMES = [
        { name: 'Stun lock', test: h => supplies(h, ['Stun']) },
        { name: 'Silence', test: h => supplies(h, ['Silence']) },
        { name: 'Debuffs', test: h => supplies(h, DEBUFFS), variety: h => supplied(h, DEBUFFS) },
        { name: 'Buffs', test: h => supplies(h, POSITIVE), variety: h => supplied(h, POSITIVE) },
        { name: 'Attack boosts', test: h => supplies(h, ['Attack increase']) },
        { name: 'Tower control', test: h => supplies(h, ['Control increase', 'Control decrease']) },
        { name: 'Cooldowns', test: h => supplies(h, ['Cooldown-Manipulation']) },
        { name: 'Mobility', test: h => h.labels.includes('Mobility') },
        { name: 'Ranged', test: h => attackRange(h) === 'Ranged' },
        { name: 'Repositioning', test: movesEnemies }
    ];
    // Rare themes count for more: log(heroes / members) relative to a theme a quarter of the roster shares
    const themeRarity = (theme, heroes) => {
        const members = heroes.filter(theme.test).length || 1;
        return Math.min(2, Math.max(0.25, Math.log(heroes.length / members) / Math.log(4)));
    };

    // Enemy positions a hero's abilities care about, which an ally who moves enemies can set up
    const POSITIONAL = ['Distance', 'Open line', 'Isolated enemies', 'Unengaged enemies', 'Exposed enemies', 'Adjacent enemies', 'Enemies 1 hex away', 'Clustered enemies',
        'Terrain difference', 'Forest'];
    const TERRAIN = ['Mountain', 'Water', 'Forest'];
    const wantsPosition = hero => hero.trait_links.some(l => l.role === 'benefits_from' && l.on === 'enemy' && POSITIONAL.includes(l.label));

    // General team effects from the strategy guide and rulebook, beyond one hero's need meeting another's supply
    const ENABLERS = [
        { id: 'swiftness', supplier: h => grants(h, ['Swiftness']), target: (h, roles) => roles.includes('Attacker'),
            text: (s, t) => `${s}'s Swiftness lets ${t} move and still attack` },
        { id: 'attack-boost', supplier: h => grants(h, ['Attack increase']), target: (h, roles) => roles.includes('Attacker'),
            text: (s, t) => `${s} boosts ${t}'s attack` },
        { id: 'cooldowns', supplier: h => grants(h, ['Cooldown-Manipulation']), target: () => true,
            text: (s, t) => `${s} shortens ${t}'s cooldowns` },
        { id: 'protection', supplier: h => grants(h, ['Defense increase', 'Resistance', 'Vampirism']) || h.labels.includes('Healing'),
            target: (h, roles) => roles.includes('Attacker') && h.vitality <= 3,
            text: (s, t) => `${s} keeps ${t} alive` },
        { id: 'setup', supplier: movesEnemies, target: wantsPosition,
            text: (s, t) => `${s} moves enemies into position for ${t}` },
        { id: 'injuries', supplier: h => h.labels.includes('AoE'),
            target: h => h.trait_links.some(l => l.role === 'benefits_from' && l.label === 'Injury' && l.on === 'enemy'),
            text: (s, t) => `${s}'s area attacks injure enemies for ${t}` },
        { id: 'terrain', supplier: h => h.trait_links.some(l => l.role === 'places' && TERRAIN.includes(l.label)),
            target: h => h.trait_links.some(l => l.role === 'benefits_from' && l.label === 'Terrain difference'),
            text: (s, t) => `${s}'s terrain creates a terrain difference for ${t}` }
    ];

    function computeTeam(band, ctx) {
        const w = ctx.weights;
        const reasons = [];
        const add = (factor, id, kind, delta, text, heroes) => reasons.push({ id, factor, kind, delta, text, heroes });

        // Complementary synergy: each need met once, however many teammates meet it
        const partners = new Map();
        ctx.relations.forEach(r => {
            if (r.type !== 'partner' || r.supplier === r.needer || !inBand(band, r.supplier, r.needer)) return;
            if (!partners.has(needKey(r))) partners.set(needKey(r), { r, suppliers: new Set() });
            partners.get(needKey(r)).suppliers.add(r.supplier);
        });
        partners.forEach(({ r, suppliers }, key) => {
            const list = [...suppliers];
            add('synergy', `synergy:${key}`, 'positive', w.synergy,
                `Synergy: ${heroList(list)} → ${display(r.needer)} (${r.need.label})`, [...list, r.needer]);
        });

        ctx.relations.forEach(r => {
            if (r.type !== 'broad' || !band.includes(r.needer)) return;
            const helpers = r.suppliers.filter(s => s !== r.needer && band.includes(s));
            if (!helpers.length) return;
            const kind = r.need.label === 'Negative effect' ? 'debuffs' : 'buffs';
            add('synergy', `broad:${r.needer}:${r.need.label}`, 'positive', w.broad,
                `Synergy: ${heroList(helpers)}'s ${kind} power ${display(r.needer)}`, [...helpers, r.needer]);
        });

        // Enablers: one bonus per (effect, ally helped), whoever supplies it
        ENABLERS.forEach(e => band.forEach(target => {
            const hero = ctx.byName.get(target);
            if (!e.target(hero, ctx.roles.get(target))) return;
            const suppliers = band.filter(n => n !== target && e.supplier(ctx.byName.get(n)));
            if (!suppliers.length) return;
            add('synergy', `enabler:${e.id}:${target}`, 'positive', w.enabler,
                e.text(heroList(suppliers), display(target)), [...suppliers, target]);
        }));

        // Theme: several heroes pushing the same plan
        THEMES.forEach(theme => {
            const members = band.filter(n => theme.test(ctx.byName.get(n)));
            if (members.length < 2) return;
            const effects = theme.variety ? new Set(members.flatMap(n => theme.variety(ctx.byName.get(n)))) : null;
            const strength = effects ? Math.max(members.length, effects.size) - 1 : members.length - 1;
            const detail = effects ? `${[...effects].join(', ')}` : heroList(members);
            add('theme', `theme:${theme.name}`, 'positive', w.theme * ctx.themeRarity.get(theme.name) * strength,
                `Theme: ${theme.name} (${detail})`, members);
        });

        // Battle-role coverage
        const coverage = roleCoverage(band, ctx);
        if (coverage.covered.length) {
            add('coverage', 'coverage', 'positive', w.coverage * coverage.covered.length,
                `Covers ${coverage.covered.length} of 3 roles`, Object.values(coverage.assignment));
        }
        if (band.length === BAND_SIZE) {
            coverage.missing.forEach(role => add('coverage', `coverage:missing:${role}`, 'warning', -w.missingRole,
                `No ${role}`, []));
        }

        // Durability
        const frontline = band.filter(n => ctx.byName.get(n).vitality >= 4);
        if (frontline.length) {
            add('durability', 'durability:frontline', 'positive', w.frontline, `Frontline: ${heroList(frontline)}`, frontline);
        }
        if (band.length === BAND_SIZE && band.every(n => size(ctx.byName.get(n)) === 'Small')) {
            add('durability', 'durability:fragile', 'warning', -w.fragile, 'Fragile: every hero is Small', [...band]);
        }

        // Internal conflicts
        const conflicts = new Set();
        ctx.relations.forEach(r => {
            if (r.type !== 'conflict' || r.supplier === r.needer || !inBand(band, r.supplier, r.needer)) return;
            const id = `conflict:${r.supplier}>${r.needer}:${r.need.label}`;
            if (conflicts.has(id)) return;
            conflicts.add(id);
            add('conflict', id, 'warning', -w.conflict,
                `Conflicts: ${display(r.supplier)}'s ${r.supply.label} hinders ${display(r.needer)}`, [r.supplier, r.needer]);
        });
        if (band.length >= 2 && !conflicts.size) add('conflict', 'conflict:none', 'info', 0, 'No internal conflicts', []);

        return { total: reasons.reduce((t, r) => t + r.delta, 0), reasons };
    }

    const bandKey = band => [...band].sort().join('|');

    function scoreTeam(band, ctx) {
        const key = bandKey(band);
        if (!ctx.cache.team.has(key)) ctx.cache.team.set(key, computeTeam([...band], ctx));
        return ctx.cache.team.get(key);
    }

    // ---- Matchup ---------------------------------------------------------------------------

    function scoreMatchup(band, opponents, ctx) {
        const w = ctx.weights;
        const reasons = [];
        const seen = new Set();
        ctx.relations.forEach(r => {
            if (r.type !== 'counter') return;
            const ours = band.includes(r.supplier) && opponents.includes(r.needer);
            const theirs = opponents.includes(r.supplier) && band.includes(r.needer);
            if (!ours && !theirs) return;
            const id = `${ours ? 'counter' : 'countered'}:${r.supplier}>${r.needer}:${r.need.label}`;
            if (seen.has(id)) return;
            seen.add(id);
            reasons.push(ours
                ? { id, factor: 'matchup', kind: 'counter', delta: w.counter,
                    text: `Counters ${display(r.needer)} (${r.supply.label})`, heroes: [r.supplier, r.needer] }
                : { id, factor: 'matchup', kind: 'warning', delta: -w.counter,
                    text: `Weak vs ${display(r.supplier)} (${r.supply.label})`, heroes: [r.needer, r.supplier] });
        });
        return { total: reasons.reduce((t, r) => t + r.delta, 0), reasons };
    }

    // ---- Band enumeration and percentiles --------------------------------------------------

    function combinations(list, k) {
        if (k === 0) return [[]];
        const out = [];
        list.forEach((item, i) => combinations(list.slice(i + 1), k - 1).forEach(rest => out.push([item, ...rest])));
        return out;
    }

    const allBands = names => combinations(names, BAND_SIZE);

    const bandValue = (band, opponents, ctx) => scoreTeam(band, ctx).total
        + (opponents.length ? scoreMatchup(band, opponents, ctx).total : 0);

    // Scores of every band the roster allows against these opponents, best first
    function distribution(opponents, ctx) {
        const key = bandKey(opponents);
        if (!ctx.cache.distribution.has(key)) {
            const pool = ctx.heroes.map(h => h.name).filter(n => !opponents.includes(n));
            ctx.cache.distribution.set(key, allBands(pool).map(b => bandValue(b, opponents, ctx)).sort((a, b) => b - a));
        }
        return ctx.cache.distribution.get(key);
    }

    // "Top X%": share of all possible bands scoring at least as well as this one
    function topPercent(value, opponents, ctx) {
        const scores = distribution(opponents, ctx);
        let better = 0;
        while (better < scores.length && scores[better] > value + 1e-9) better++;
        return (better + 1) / scores.length * 100;
    }

    // ---- Suggestions -----------------------------------------------------------------------

    function sides(state, player) {
        const p = player || (currentStep(state) || { player: state.me }).player;
        return { player: p, band: bandOf(state, p), opponents: bandOf(state, other(p)) };
    }

    const availableNames = (state, ctx) => ctx.heroes.map(h => h.name).filter(n => isAvailable(state, n));

    // Every way to fill the band's empty slots, scored best first
    function completions(band, pool, opponents, ctx) {
        return combinations(pool, BAND_SIZE - band.length)
            .map(extra => ({ heroes: [...band, ...extra], extra, score: bandValue([...band, ...extra], opponents, ctx) }))
            .sort((a, b) => b.score - a.score || a.extra.join('|').localeCompare(b.extra.join('|')));
    }

    const reasonsFor = (band, opponents, ctx) => [
        ...scoreTeam(band, ctx).reasons,
        ...(opponents.length ? scoreMatchup(band, opponents, ctx).reasons : [])
    ];

    function suggestBands(state, ctx, limit = 5, options = {}) {
        const { band, opponents } = sides(state, options.player);
        const pool = availableNames(state, ctx);
        if (band.length >= BAND_SIZE) {
            const score = bandValue(band, opponents, ctx);
            return [{ heroes: [...band], score, topPercent: topPercent(score, opponents, ctx), reasons: reasonsFor(band, opponents, ctx) }];
        }
        return completions(band, pool, opponents, ctx).slice(0, limit).map(c => ({
            heroes: c.heroes, score: c.score, topPercent: topPercent(c.score, opponents, ctx),
            reasons: reasonsFor(c.heroes, opponents, ctx)
        }));
    }

    // Best finished band reachable from `band` using heroes in `pool` (null if the pool is too small)
    function bestBand(band, pool, opponents, ctx) {
        const best = completions(band, pool.filter(n => !band.includes(n)), opponents, ctx)[0];
        return best ? { heroes: best.heroes, score: best.score, topPercent: topPercent(best.score, opponents, ctx) } : null;
    }

    const bandPercent = (band, opponents, ctx) => topPercent(bandValue(band, opponents, ctx), opponents, ctx);

    function versatilityReasons(name, picked, ctx) {
        if (picked > 0) return [];
        const roles = ctx.roles.get(name);
        if (roles.length >= 2) {
            return [{ id: 'versatility', factor: 'versatility', kind: 'positive', delta: ctx.weights.versatility[0] * roles.length,
                text: `Versatile: ${roles.join(', ')}`, heroes: [name] }];
        }
        return [{ id: 'versatility:poor-first-pick', factor: 'versatility', kind: 'warning', delta: -ctx.weights.versatility[0],
            text: `Poor first pick: only a ${roles[0]}`, heroes: [name] }];
    }

    // Roles the band covers only once this hero joins (possibly by freeing a teammate for it)
    function fillsReasons(band, name, ctx) {
        const before = roleCoverage(band, ctx).covered;
        const after = roleCoverage([...band, name], ctx);
        return after.covered.filter(role => !before.includes(role)).map(role => {
            const holder = after.assignment[role];
            return { id: `fills:${role}`, factor: 'coverage', kind: 'positive', delta: ctx.weights.coverage,
                text: holder === name ? `Fills ${role} role` : `Frees ${display(holder)} to play ${role}`,
                heroes: holder === name ? [name] : [name, holder] };
        });
    }

    // Rank every available hero for the next pick. Early picks value flexibility (the average of the
    // best bands still reachable, plus versatility); the last pick is just the best finished band.
    function suggestPick(state, ctx, limit = 5, options = {}) {
        const { band, opponents } = sides(state, options.player);
        if (band.length >= BAND_SIZE) return [];
        const w = ctx.weights;
        const pool = availableNames(state, ctx);
        const before = new Set(reasonsFor(band, opponents, ctx).map(r => r.id));
        return pool.map(name => {
            const withHero = [...band, name];
            const options_ = completions(withHero, pool.filter(n => n !== name), opponents, ctx);
            const best = options_[0];
            const top = options_.slice(0, w.lookahead);
            const lookahead = top.reduce((t, c) => t + c.score, 0) / top.length;
            const score = lookahead + (w.versatility[band.length] || 0) * versatility(ctx.byName.get(name));
            // New reasons this hero brings; role coverage is told by fills / versatility reasons instead
            const gained = reasonsFor(withHero, opponents, ctx)
                .filter(r => !before.has(r.id) && r.id !== 'coverage' && (r.heroes.includes(name) || r.factor === 'coverage'));
            return {
                name, score, topPercent: topPercent(best.score, opponents, ctx), bestBand: best.heroes,
                reasons: [...versatilityReasons(name, band.length, ctx), ...(band.length ? fillsReasons(band, name, ctx) : []), ...gained]
            };
        }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
    }

    // Ban what the other side would most like to pick next
    function suggestBan(state, ctx, limit = 5, options = {}) {
        const player = options.player || (currentStep(state) || { player: state.me }).player;
        return suggestPick(state, ctx, limit, { player: other(player) }).map(s => ({
            ...s,
            reasons: [{ id: 'ban:opponent-wants', factor: 'ban', kind: 'positive', delta: s.score,
                text: `Strong pick for Player ${other(player)}`, heroes: [s.name] }, ...s.reasons]
        }));
    }

    function suggestFor(state, ctx, limit = 5) {
        const current = currentStep(state);
        if (!current) return { action: null, player: null, items: [] };
        const items = current.action === 'ban'
            ? suggestBan(state, ctx, limit, { player: current.player })
            : suggestPick(state, ctx, limit, { player: current.player });
        return { ...current, items };
    }

    // For a full band: the best replacement for each slot that improves the band
    function suggestSwaps(state, ctx, options = {}) {
        const { band, opponents } = sides(state, options.player || state.me);
        if (band.length < BAND_SIZE) return [];
        const current = bandValue(band, opponents, ctx);
        const pool = availableNames(state, ctx);
        return band.map((out, i) => {
            const best = pool.map(name => {
                const swapped = band.map((n, j) => (j === i ? name : n));
                return { out, in: name, heroes: swapped, score: bandValue(swapped, opponents, ctx) };
            }).sort((a, b) => b.score - a.score || a.in.localeCompare(b.in))[0];
            return best && best.score > current ? { ...best, topPercent: topPercent(best.score, opponents, ctx) } : null;
        }).filter(Boolean).sort((a, b) => b.score - a.score);
    }

    const api = {
        BATTLE_ROLES, DRAFT_FORMATS, DEFAULT_WEIGHTS, THEMES,
        draftSequence, createDraft, applyAction, undo, currentStep, isComplete,
        bands, bans, myBand, opponentBand, unavailableReason, isAvailable, availableHeroes,
        setEnemies, setExcluded, removePick, movePick, replacePick, fillBand,
        size, attackRange, battleRoles, versatility,
        createContext, roleCoverage, scoreTeam, scoreMatchup, allBands, topPercent, bestBand, bandPercent,
        suggestPick, suggestBands, suggestBan, suggestFor, suggestSwaps
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.Draft = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
