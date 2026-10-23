// Draft assistant engine (no DOM): draft formats and immutable draft state, battle roles,
// band scoring with reasons, pick / ban suggestions and the bands that beat a band.
// Loaded in the browser as window.Draft (after synergy.js) and in Node via require().
(function (root) {
    const Synergy = typeof module !== 'undefined' && module.exports ? require('./synergy.js') : root.Synergy;
    const { POSITIVE, NEGATIVE, titleCase } = Synergy;

    const BATTLE_ROLES = ['Controller', 'Attacker', 'Supporter'];
    const BAND_SIZE = 3;

    // ---- Draft formats ---------------------------------------------------------------------

    const step = (player, action) => ({ player, action });
    const repeat = (n, steps) => Array.from({ length: n }, () => steps).flat();
    const FORMATS = {
        standard: () => repeat(3, [step(1, 'pick'), step(2, 'pick')]),
        'ban-first': () => [...repeat(3, [step(1, 'ban'), step(2, 'ban')]), ...FORMATS.standard()],
        interleaved: () => repeat(3, [step(1, 'ban'), step(2, 'ban'), step(1, 'pick'), step(2, 'pick')])
    };
    const DRAFT_FORMATS = Object.keys(FORMATS);

    function draftSequence(format) {
        if (!FORMATS[format]) throw new Error(`Unknown draft format: ${format}`);
        return FORMATS[format]();
    }

    // ---- Draft state -----------------------------------------------------------------------
    // { format, me, carryOverBans, history: [{ player, action, hero }] }

    const other = player => (player === 1 ? 2 : 1);

    function createDraft(format, options = {}) {
        draftSequence(format);
        return { format, me: options.me === 2 ? 2 : 1, carryOverBans: [...(options.carryOverBans || [])], history: [] };
    }

    const historyOf = (state, action, player) => state.history
        .filter(h => h.action === action && h.player === player).map(h => h.hero);

    const bands = state => ({ 1: historyOf(state, 'pick', 1), 2: historyOf(state, 'pick', 2) });
    const bans = state => ({ 1: historyOf(state, 'ban', 1), 2: historyOf(state, 'ban', 2) });

    const bandOf = (state, player) => bands(state)[player];
    const myBand = state => bandOf(state, state.me);
    const opponentBand = state => bandOf(state, other(state.me));

    // Why a hero cannot be picked: picked (your band) | facing (the opponent's) | banned | null
    function unavailableReason(state, name) {
        if (myBand(state).includes(name)) return 'picked';
        if (opponentBand(state).includes(name)) return 'facing';
        if (state.carryOverBans.includes(name) || state.history.some(h => h.action === 'ban' && h.hero === name)) return 'banned';
        return null;
    }

    const isAvailable = (state, name) => unavailableReason(state, name) === null;
    const availableHeroes = (state, heroes) => heroes.filter(h => isAvailable(state, h.name));

    const currentStep = state => draftSequence(state.format)[state.history.length] || null;
    const isComplete = state => currentStep(state) === null;

    function applyAction(state, name) {
        const current = currentStep(state);
        if (!current) throw new Error('The draft is complete');
        if (!isAvailable(state, name)) throw new Error(`${name} is not available (${unavailableReason(state, name)})`);
        return { ...state, history: [...state.history, { ...current, hero: name }] };
    }

    // Clear the draft (keeping its format and carry-over bans) as a step that undo reverses
    function reset(state) {
        return { ...createDraft(state.format, { me: state.me, carryOverBans: state.carryOverBans }), resetFrom: state };
    }

    function undo(state) {
        if (!state.history.length) return state.resetFrom || state;
        return { ...state, history: state.history.slice(0, -1) };
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
    // Evidence: { links, abilities (card indices), notes } showing why the hero plays `role`, or null.
    const evidence = (links = [], abilities = [], notes = []) => ({ links, abilities, notes });
    const hasEvidence = e => Boolean(e) && (e.links.length + e.abilities.length + e.notes.length) > 0;

    function derivedRoleEvidence(hero, role) {
        const links = hero.trait_links;
        const abilities = [hero.core_ability, ...hero.support_abilities];
        const isLong = source => {
            const ability = abilities.find(a => a.name === source);
            return Boolean(ability) && !SHORT_RANGES.includes(ability.range);
        };
        const where = (label, roles) => links.filter(l => l.label === label && (!roles || roles.includes(l.role)));
        if (role === 'Controller') {
            const found = [...where('Displacement'), ...where('Stun', ['inflicts']), ...where('Swiftness', ['grants'])];
            return hero.vitality >= 3 && found.length ? evidence(found, [], [`Vitality ${hero.vitality}`]) : null;
        }
        if (role === 'Attacker') {
            const found = [...where('AoE'), ...where('Attack increase', ['gains'])];
            const scaling = SCALING_ATTACK.test(hero.core_ability.effect) ? [0] : [];
            return found.length || scaling.length ? evidence(found, scaling) : null;
        }
        const supports = l => l.role === 'grants'
            || (l.role === 'inflicts' && NEGATIVE.includes(l.label) && (l.on || 'enemy') === 'enemy')
            || (l.role === 'has' && l.label === 'Healing');
        const found = links.filter(l => supports(l) && l.sources.some(isLong));
        return found.length ? evidence(found) : null;
    }

    // Curated roles (battle_roles) win; a curated role the rules can't see is explained by its note
    function roleEvidence(hero, role) {
        if (hero.battle_roles && !hero.battle_roles.includes(role)) return null;
        const derived = derivedRoleEvidence(hero, role);
        if (derived || !hero.battle_roles) return derived;
        return evidence([], [], [hero.battle_roles_note].filter(Boolean));
    }

    const battleRoles = hero => BATTLE_ROLES.filter(role => roleEvidence(hero, role));

    // Roles the hero can fill, with vitality (a hardier hero holds a role longer) breaking ties
    const versatility = hero => battleRoles(hero).length + hero.vitality / 10;

    // ---- Context ---------------------------------------------------------------------------

    // Hand-tuned against the curated bands (tests/draft.test.js), keeping partner synergy the main signal
    const DEFAULT_WEIGHTS = {
        synergy: 3, effect: 1, enabler: 1.5, theme: 3,
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
            cache: { team: new Map(), distribution: new Map(), counters: new Map() }
        };
    }

    const display = name => titleCase(name);
    const heroList = list => list.map(display).join(', ');

    // ---- Role coverage ---------------------------------------------------------------------

    // Assign each hero at most one role so that as many distinct roles as possible are covered.
    // `fixed` pins a hero to some of its roles ({ [name]: [roles] }).
    function roleCoverage(band, ctx, fixed = {}) {
        let best = {};
        const assign = (i, used) => {
            if (Object.keys(used).length > Object.keys(best).length) best = { ...used };
            if (i === band.length) return;
            (fixed[band[i]] || ctx.roles.get(band[i])).forEach(role => {
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
    const supplyLinks = (hero, labels) => hero.trait_links.filter(l => SUPPLY_ROLES.includes(l.role)
        && labels.includes(l.label) && !(l.role === 'inflicts' && (l.on === 'self' || l.on === 'ally')));
    const supplied = (hero, labels) => [...new Set(supplyLinks(hero, labels).map(l => l.label))];
    const supplies = (hero, labels) => supplyLinks(hero, labels).length > 0;
    const grantLinks = (hero, labels) => hero.trait_links.filter(l => l.role === 'grants' && labels.includes(l.label));
    const grants = (hero, labels) => grantLinks(hero, labels).length > 0;
    const labelLinks = (hero, labels) => hero.trait_links.filter(l => labels.includes(l.label));
    // Repositions enemies (not only itself or its allies)
    const moveLinks = hero => hero.trait_links.filter(l => l.label === 'Displacement' && l.sources.some(src => {
        const ability = abilityByName(hero, src);
        return ability && /enemy|character|target/i.test(ability.target) && !/^any ally/i.test(ability.target);
    }));
    const movesEnemies = hero => moveLinks(hero).length > 0;

    // Several heroes pushing the same plan. Variety themes ("a wide range of buffs") count distinct effects
    // rather than heroes. Each theme is weighted by its rarity across the roster (createContext).
    const DEBUFFS = ['Attack decrease', 'Defense decrease', 'Control decrease', 'Slowness', 'Poison'];
    const themeOf = (name, links, extra = {}) => ({ name, links, test: h => links(h).length > 0, ...extra });
    const THEMES = [
        themeOf('Stun lock', h => supplyLinks(h, ['Stun'])),
        themeOf('Silence', h => supplyLinks(h, ['Silence'])),
        themeOf('Debuffs', h => supplyLinks(h, DEBUFFS), { variety: h => supplied(h, DEBUFFS) }),
        themeOf('Buffs', h => supplyLinks(h, POSITIVE), { variety: h => supplied(h, POSITIVE) }),
        themeOf('Attack boosts', h => supplyLinks(h, ['Attack increase'])),
        themeOf('Tower control', h => supplyLinks(h, ['Control increase', 'Control decrease'])),
        themeOf('Cooldowns', h => supplyLinks(h, ['Cooldown-Manipulation'])),
        themeOf('Mobility', h => labelLinks(h, ['Mobility'])),
        { name: 'Ranged', test: h => attackRange(h) === 'Ranged', evidence: h => evidence(labelLinks(h, ['Ranged']), [0]) },
        themeOf('Repositioning', moveLinks)
    ];
    const themeEvidence = (theme, hero) => (theme.evidence ? theme.evidence(hero) : evidence(theme.links(hero)));
    // Rare themes count for more: log(heroes / members) relative to a theme a quarter of the roster shares
    const themeRarity = (theme, heroes) => {
        const members = heroes.filter(theme.test).length || 1;
        return Math.min(2, Math.max(0.25, Math.log(heroes.length / members) / Math.log(4)));
    };

    // Enemy positions a hero's abilities care about, which an ally who moves enemies can set up
    const POSITIONAL = ['Distance', 'Open line', 'Isolated enemies', 'Unengaged enemies', 'Exposed enemies', 'Adjacent enemies', 'Enemies 1 hex away', 'Clustered enemies',
        'Terrain difference', 'Forest'];
    const TERRAIN = ['Mountain', 'Water', 'Forest'];
    
    // General team effects from the strategy guide and rulebook, beyond one hero's need meeting another's supply
    // Role evidence that says which role it proves ("Attacker" first in the notes)
    const asRole = (e, role) => (e ? { ...e, notes: [role, ...e.notes] } : null);
    const attackerEvidence = (h, roles) => (roles.includes('Attacker') ? asRole(roleEvidence(h, 'Attacker'), 'Attacker') : null);
    const benefitLinks = (h, label, on) => h.trait_links.filter(l => l.role === 'benefits_from' && l.label === label && (!on || l.on === on));
    const cooldownAbilities = h => [h.core_ability, ...h.support_abilities].map((a, i) => (a.cooldown ? i : -1)).filter(i => i >= 0);
    const enabler = (id, detail, supply, need, text) => ({ id, detail, supply, need, text,
        supplier: h => supply(h).length > 0, target: (h, roles) => hasEvidence(need(h, roles)) });
    const ENABLERS = [
        enabler('swiftness', 'Swiftness', h => grantLinks(h, ['Swiftness']), attackerEvidence,
            (s, t) => `${s}'s Swiftness lets ${t} move and still attack`),
        enabler('attack-boost', 'attack boost', h => grantLinks(h, ['Attack increase']), attackerEvidence,
            (s, t, v) => `${s} ${v('boosts', 'boost')} ${t}'s attack`),
        enabler('cooldowns', 'cooldowns', h => grantLinks(h, ['Cooldown-Manipulation']),
            h => evidence([], cooldownAbilities(h), [cooldownAbilities(h).length ? 'Abilities with a cooldown' : 'Every ability can be cooled down']),
            (s, t, v) => `${s} ${v('shortens', 'shorten')} ${t}'s cooldowns`),
        enabler('protection', 'protection',
            h => [...grantLinks(h, ['Defense increase', 'Resistance', 'Vampirism']), ...h.trait_links.filter(l => l.label === 'Healing' && l.role === 'has')],
            (h, roles) => {
                const attacker = attackerEvidence(h, roles);
                return attacker && h.vitality <= 3 ? { ...attacker, notes: [...attacker.notes, `Vitality ${h.vitality}`] } : null;
            },
            (s, t, v) => `${s} ${v('keeps', 'keep')} ${t} alive`),
        enabler('setup', 'positioning', moveLinks,
            h => evidence(h.trait_links.filter(l => l.role === 'benefits_from' && l.on === 'enemy' && POSITIONAL.includes(l.label))),
            (s, t, v) => `${s} ${v('moves', 'move')} enemies into position for ${t}`),
        enabler('injuries', 'injuries', h => labelLinks(h, ['AoE']), h => evidence(benefitLinks(h, 'Injury', 'enemy')),
            (s, t) => `${s}'s area attacks injure enemies for ${t}`),
        enabler('terrain', 'terrain', h => h.trait_links.filter(l => l.role === 'places' && TERRAIN.includes(l.label)),
            h => evidence(benefitLinks(h, 'Terrain difference')),
            (s, t) => `${s}'s terrain creates a terrain difference for ${t}`)
    ];

    // "A and B move enemies into position for C": `text(suppliers, targets, verb)`, the verb agreeing with the suppliers
    const andList = list => list.map(display).join(', ').replace(/, ([^,]*)$/, ' and $1');
    function enablerText(rule, suppliers, targets) {
        const e = ENABLERS.find(x => x.id === rule);
        return e.text(andList(suppliers), andList(targets), (one, many) => (suppliers.length > 1 ? many : one));
    }

    function computeTeam(band, ctx) {
        const w = ctx.weights;
        const reasons = [];
        const add = (factor, id, kind, delta, text, heroes, extra) => reasons.push({ id, factor, kind, delta, text, heroes, ...extra });
        // Synergy reasons also say who benefits, who supplies it and what (for grouping in the view)
        const helped = (beneficiary, suppliers, detail) => ({ beneficiary, suppliers, detail });

        // Complementary synergy: each need met once, however many teammates meet it,
        // except effect needs (Carnifex, Frigus, Ignifer, Aqus), where every supplier adds up
        const partners = new Map();
        ctx.relations.forEach(r => {
            if (r.type !== 'partner' || r.supplier === r.needer || !inBand(band, r.supplier, r.needer)) return;
            const key = r.rule === 'effects' ? `${needKey(r)}:${r.supplier}` : needKey(r);
            if (!partners.has(key)) partners.set(key, { r, suppliers: new Set(), relations: [] });
            partners.get(key).suppliers.add(r.supplier);
            partners.get(key).relations.push(r);
        });
        partners.forEach(({ r, suppliers, relations }, key) => {
            const list = [...suppliers];
            add('synergy', `synergy:${key}`, 'positive', r.rule === 'effects' ? w.effect : w.synergy,
                `Synergy: ${heroList(list)} → ${display(r.needer)} (${r.need.label})`, [...list, r.needer],
                { ...helped(r.needer, list, r.need.label), relations });
        });

        // Enablers: one bonus per (effect, ally helped), whoever supplies it
        ENABLERS.forEach(e => band.forEach(target => {
            const hero = ctx.byName.get(target);
            if (!e.target(hero, ctx.roles.get(target))) return;
            const suppliers = band.filter(n => n !== target && e.supplier(ctx.byName.get(n)));
            if (!suppliers.length) return;
            add('synergy', `enabler:${e.id}:${target}`, 'positive', w.enabler,
                enablerText(e.id, suppliers, [target]), [...suppliers, target], { ...helped(target, suppliers, e.detail), rule: e.id });
        }));

        // Theme: several heroes pushing the same plan
        THEMES.forEach(theme => {
            const members = band.filter(n => theme.test(ctx.byName.get(n)));
            if (members.length < 2) return;
            const effects = theme.variety ? new Set(members.flatMap(n => theme.variety(ctx.byName.get(n)))) : null;
            const strength = effects ? Math.max(members.length, effects.size) - 1 : members.length - 1;
            const detail = effects ? `${[...effects].join(', ')}` : heroList(members);
            add('theme', `theme:${theme.name}`, 'positive', w.theme * ctx.themeRarity.get(theme.name) * strength,
                `Theme: ${theme.name} (${detail})`, members, { theme: theme.name });
        });

        // Battle-role coverage
        const coverage = roleCoverage(band, ctx);
        if (coverage.covered.length) {
            add('coverage', 'coverage', 'positive', w.coverage * coverage.covered.length,
                `Covers ${coverage.covered.length} of 3 roles`, Object.values(coverage.assignment), { assignment: coverage.assignment });
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
        const conflicts = new Map();
        ctx.relations.forEach(r => {
            if (r.type !== 'conflict' || r.supplier === r.needer || !inBand(band, r.supplier, r.needer)) return;
            const id = `conflict:${r.supplier}>${r.needer}:${r.need.label}`;
            if (conflicts.has(id)) { conflicts.get(id).push(r); return; }
            conflicts.set(id, [r]);
            add('conflict', id, 'warning', -w.conflict,
                `Conflicts: ${display(r.supplier)}'s ${r.supply.label} hinders ${display(r.needer)}`, [r.supplier, r.needer],
                { relations: conflicts.get(id) });
        });
        if (band.length >= 2 && !conflicts.size) add('conflict', 'conflict:none', 'info', 0, 'No internal conflicts', []);

        return { total: reasons.reduce((t, r) => t + r.delta, 0), reasons };
    }

    // The card evidence behind a reason, per hero: [{ hero, links, abilities, notes }], the reason's heroes first
    function reasonEvidence(reason, ctx) {
        const found = new Map();
        const put = (hero, e) => {
            if (!hasEvidence(e)) return;
            if (!found.has(hero)) found.set(hero, { links: new Set(), abilities: new Set(), notes: new Set() });
            const f = found.get(hero);
            e.links.forEach(l => f.links.add(l));
            e.abilities.forEach(i => f.abilities.add(i));
            e.notes.forEach(n => f.notes.add(n));
        };
        const hero = name => ctx.byName.get(name);
        const roles = (name, list) => list.forEach(role => put(name, asRole(roleEvidence(hero(name), role), role)));
        if (reason.relations) {
            reason.relations.forEach(r => { put(r.supplier, evidence([r.supply])); put(r.needer, evidence([r.need])); });
        } else if (reason.rule && reason.beneficiary) {
            const e = ENABLERS.find(x => x.id === reason.rule);
            reason.suppliers.forEach(n => put(n, evidence(e.supply(hero(n)))));
            put(reason.beneficiary, e.need(hero(reason.beneficiary), ctx.roles.get(reason.beneficiary)));
        } else if (reason.theme) {
            const theme = THEMES.find(t => t.name === reason.theme);
            reason.heroes.forEach(n => put(n, themeEvidence(theme, hero(n))));
        } else if (reason.assignment) {
            Object.entries(reason.assignment).forEach(([role, n]) => roles(n, [role]));
        } else if (reason.factor === 'versatility' || reason.id === 'fills') {
            reason.heroes.forEach(n => roles(n, reason.roles || ctx.roles.get(n)));
        } else if (reason.factor === 'durability') {
            reason.heroes.forEach(n => put(n, evidence([], [], [`Vitality ${hero(n).vitality}`])));
        } else if (reason.band) {
            scoreTeam(reason.band, ctx).reasons.forEach(r => reasonEvidence(r, ctx).forEach(e => put(e.hero, e)));
        }
        const order = [...reason.heroes, ...[...found.keys()].filter(n => !reason.heroes.includes(n))];
        return order.filter(n => found.has(n)).map(n => {
            const f = found.get(n);
            return { hero: n, links: [...f.links], abilities: [...f.abilities].sort((a, b) => a - b), notes: [...f.notes] };
        });
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
            const relation = { attacker: r.supplier, victim: r.needer, supply: r.supply, need: r.need, rule: r.rule, relations: [r] };
            reasons.push(ours
                ? { id, factor: 'matchup', kind: 'counter', delta: w.counter,
                    text: `Counters ${display(r.needer)} (${r.supply.label})`, heroes: [r.supplier, r.needer], ...relation }
                : { id, factor: 'matchup', kind: 'warning', delta: -w.counter,
                    text: `Weak vs ${display(r.supplier)} (${r.supply.label})`, heroes: [r.needer, r.supplier], ...relation });
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

    const FACTORS = ['coverage', 'synergy', 'theme', 'durability', 'conflict', 'matchup'];

    // Each factor's lowest and highest points on its own, over every band the roster allows, with a band
    // reaching each end (not the best band overall). Matchup is the best and worst of any band against any
    // other: it adds up hero by hero, so a band's best (worst) opponents are its three best (worst) match-ups.
    function factorRanges(ctx) {
        if (ctx.cache.ranges) return ctx.cache.ranges;
        const names = ctx.heroes.map(h => h.name);
        const ranges = Object.fromEntries(FACTORS.map(f => [f, { min: Infinity, max: -Infinity }]));
        const reach = (f, value, band, opponents) => {
            const r = ranges[f];
            if (value < r.min) Object.assign(r, { min: value, minBand: band }, opponents && { minOpponents: opponents });
            if (value > r.max) Object.assign(r, { max: value, maxBand: band }, opponents && { maxOpponents: opponents });
        };
        const vs = new Map(names.map(a => [a, new Map(names.filter(b => b !== a).map(b => [b, scoreMatchup([a], [b], ctx).total]))]));
        allBands(names).forEach(band => {
            const points = Object.fromEntries(FACTORS.map(f => [f, 0]));
            scoreTeam(band, ctx).reasons.forEach(r => { points[r.factor] += r.delta; });
            FACTORS.filter(f => f !== 'matchup').forEach(f => reach(f, points[f], band));
            const against = names.filter(n => !band.includes(n))
                .map(n => ({ n, v: band.reduce((t, a) => t + vs.get(a).get(n), 0) })).sort((a, b) => b.v - a.v);
            const total = list => list.reduce((t, x) => t + x.v, 0);
            const best = against.slice(0, BAND_SIZE), worst = against.slice(-BAND_SIZE);
            reach('matchup', total(best), band, best.map(x => x.n));
            reach('matchup', total(worst), band, worst.map(x => x.n));
        });
        ctx.cache.ranges = ranges;
        return ranges;
    }

    // ---- Suggestions -----------------------------------------------------------------------

    function sides(state, player) {
        const p = player || (currentStep(state) || { player: state.me }).player;
        return { player: p, band: bandOf(state, p), opponents: bandOf(state, other(p)) };
    }

    const availableNames = (state, ctx) => ctx.heroes.map(h => h.name).filter(n => isAvailable(state, n));

    // A random available hero from the candidates for the current step (null when none or the draft is done)
    function randomHero(state, candidates, rng = Math.random) {
        if (!currentStep(state)) return null;
        const open = candidates.filter(n => isAvailable(state, n));
        return open.length ? open[Math.floor(rng() * open.length)] : null;
    }

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

    // Every role the hero could take that adds a role the band lacks (teammates may move to make room).
    // A flexible band leaves several roles open, so this is a set, not one arbitrary assignment.
    function fillableRoles(band, name, ctx) {
        const before = roleCoverage(band, ctx).covered.length;
        const team = [...band.filter(n => n !== name), name];
        return ctx.roles.get(name).filter(role => roleCoverage(team, ctx, { [name]: [role] }).covered.length > before);
    }

    const orList = list => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : list[0]);

    function fillsReasons(band, name, ctx) {
        const roles = fillableRoles(band, name, ctx);
        if (!roles.length) return [];
        return [{ id: 'fills', factor: 'coverage', kind: 'positive', delta: ctx.weights.coverage, roles,
            text: roles.length === 1 ? `Fills the ${roles[0]} role` : `Can fill ${orList(roles)}`, heroes: [name] }];
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

    // Ban what the other side would most like to pick next, saying which band the ban denies them
    function suggestBan(state, ctx, limit = 5, options = {}) {
        const player = options.player || (currentStep(state) || { player: state.me }).player;
        const rival = other(player);
        return suggestPick(state, ctx, limit, { player: rival }).map(s => ({
            ...s,
            reasons: [{ id: 'ban:denies', factor: 'ban', kind: 'positive', delta: s.score,
                text: `Denies Player ${rival}: ${s.bestBand.map(display).join(' + ')}`, heroes: [s.name], band: s.bestBand }, ...s.reasons]
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

    // ---- What beats a band -----------------------------------------------------------------

    // Heroes whose cards counter someone in the band, A–Z
    const counteredBy = (band, ctx) => [...new Set(ctx.relations
        .filter(r => r.type === 'counter' && band.includes(r.needer) && !band.includes(r.supplier))
        .map(r => r.supplier))].sort();

    // The strongest bands against `band` from every other hero, scored like any band (team plus matchup), best
    // first. Each shares at most `maxShared` heroes with a band above it, so the answers differ.
    function counterBands(band, ctx, { limit = 3, maxShared = 1 } = {}) {
        const key = bandKey(band);
        if (!ctx.cache.counters.has(key)) {
            const pool = ctx.heroes.map(h => h.name).filter(n => !band.includes(n));
            ctx.cache.counters.set(key, completions([], pool, band, ctx));
        }
        const chosen = [];
        for (const c of ctx.cache.counters.get(key)) {
            if (chosen.length >= limit) break;
            if (chosen.every(b => b.heroes.filter(n => c.heroes.includes(n)).length <= maxShared)) chosen.push(c);
        }
        return chosen.map(c => ({ heroes: c.heroes, score: c.score, reasons: reasonsFor(c.heroes, band, ctx) }));
    }

    const api = {
        BATTLE_ROLES, DRAFT_FORMATS, DEFAULT_WEIGHTS, THEMES,
        draftSequence, createDraft, applyAction, undo, reset, currentStep, isComplete,
        bands, bans, myBand, opponentBand, unavailableReason, isAvailable, availableHeroes, randomHero,
        size, attackRange, battleRoles, roleEvidence, reasonEvidence, enablerText, versatility,
        createContext, roleCoverage, fillableRoles, scoreTeam, scoreMatchup, allBands, topPercent, factorRanges, bestBand, bandPercent,
        suggestPick, suggestBan, suggestFor, counterBands, counteredBy
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.Draft = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
