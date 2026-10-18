// Pure synergy deduction (no DOM): matches what heroes need (benefits_from / hindered_by
// trait links) against what other heroes supply (inflicts / grants / gains / places).
// Loaded in the browser as window.Synergy and in Node via require().
(function (root) {
    const POSITIVE = ['Attack increase', 'Defense increase', 'Control increase', 'Swiftness', 'Flying', 'Resistance', 'Vampirism'];
    const NEGATIVE = ['Attack decrease', 'Defense decrease', 'Control decrease', 'Slowness', 'Stun', 'Silence', 'Poison'];
    const TERRAIN = ['Mountain', 'Water', 'Forest'];

    // Needs that are met by a different trait than their own name
    const BRIDGES = {
        'Abilities on cooldown': { labels: ['Cooldown-Manipulation'], rule: 'cooldowns' },
        'Tower control': { labels: ['Control increase'], rule: 'tower control' }
    };
    // Needs so widely supplied that we report the pool size rather than partners
    const BROAD = { 'Positive effect': POSITIVE, 'Negative effect': NEGATIVE };
    const OPPOSITE = {
        'Attack increase': 'Attack decrease', 'Defense increase': 'Defense decrease',
        'Control increase': 'Control decrease', Swiftness: 'Slowness'
    };
    const SUPPLY_ROLES = ['inflicts', 'grants', 'gains', 'places'];

    // Who a supply link lands on: null = anyone (e.g. "any enemy or ally")
    function supplySubject(link) {
        if (link.role === 'inflicts') return link.on || 'enemy';
        if (link.role === 'grants') return 'ally';
        if (link.role === 'gains') return 'self';
        return link.on; // places
    }

    // Can a supply landing on `subject` meet a need on `needOn` (self/ally/enemy/null)?
    // "ally" means the needer's own side, so a teammate's self-buff counts.
    function reaches(needOn, subject, sameHero) {
        if (needOn === null || subject === null) return true;
        if (needOn === 'enemy') return subject === 'enemy';
        if (needOn === 'self') return sameHero ? subject === 'self' || subject === 'ally' : subject === 'ally';
        return subject === 'ally' || subject === 'self'; // ally
    }

    function suppliedLabels(label) {
        if (BROAD[label]) return BROAD[label];
        return BRIDGES[label] ? BRIDGES[label].labels : [label];
    }

    function ruleFor(label) {
        if (BRIDGES[label]) return BRIDGES[label].rule;
        if (TERRAIN.includes(label)) return 'terrain';
        if (label === 'Wound') return 'wounds';
        return 'direct';
    }

    const supplies = heroes => heroes.flatMap(h => h.trait_links
        .filter(l => SUPPLY_ROLES.includes(l.role))
        .map(link => ({ hero: h.name, link })));

    const sharesAbility = (a, b) => a.sources.some(s => b.sources.includes(s));

    // Every relation as { type, needer, supplier, need, supply, rule }.
    // type: partner | self | conflict | counter | broad | flag
    function computeSynergies(heroes) {
        const pool = supplies(heroes);
        const out = [];

        heroes.forEach(h => h.trait_links.forEach(need => {
            if (need.role !== 'benefits_from' && need.role !== 'hindered_by') return;
            const labels = suppliedLabels(need.label);
            const matches = pool.filter(s => labels.includes(s.link.label)
                && reaches(need.on, supplySubject(s.link), s.hero === h.name));

            if (need.role === 'benefits_from' && BROAD[need.label]) {
                const suppliers = [...new Set(matches.filter(s => s.hero !== h.name).map(s => s.hero))];
                out.push({ type: 'broad', needer: h.name, need, suppliers });
                return;
            }
            matches.forEach(s => {
                const same = s.hero === h.name;
                if (same && (need.role === 'hindered_by' || sharesAbility(need, s.link))) return;
                out.push({
                    type: need.role === 'hindered_by' ? 'conflict' : same ? 'self' : 'partner',
                    needer: h.name, supplier: s.hero, need, supply: s.link, rule: ruleFor(need.label)
                });
            });
        }));

        // Wound flags come from the hero's own links, whether or not anyone supplies Wounds
        heroes.forEach(h => {
            const own = role => h.trait_links.some(l => l.label === 'Wound' && l.role === role && l.on === 'self');
            if (own('benefits_from')) out.push({ type: 'flag', needer: h.name, flag: 'dontFeed' });
            if (own('hindered_by')) out.push({ type: 'flag', needer: h.name, flag: 'punishWithDamage' });
        });

        // Opponents: they inflict (or push you onto) what hinders you, or the opposite of what you rely on
        heroes.forEach(h => h.trait_links.forEach(need => {
            if (need.on !== 'self') return;
            const target = need.role === 'hindered_by' ? need.label
                : need.role === 'benefits_from' ? OPPOSITE[need.label] : null;
            if (!target) return;
            pool.filter(s => s.hero !== h.name && s.link.label === target && s.link.role !== 'grants'
                    && s.link.role !== 'gains' && [null, 'enemy'].includes(supplySubject(s.link)))
                .forEach(s => out.push({
                    type: 'counter', needer: h.name, supplier: s.hero, need, supply: s.link,
                    rule: need.role === 'hindered_by' ? 'hindrance' : 'opposite'
                }));
        }));
        return out;
    }

    const entry = (r, hero) => ({ hero, label: r.need.label, need: r.need, supply: r.supply, rule: r.rule });

    // Counter entries merge per opponent, keeping every reason
    function byOpponent(list, key) {
        const merged = new Map();
        list.forEach(r => {
            const hero = r[key];
            if (!merged.has(hero)) merged.set(hero, { hero, reasons: [] });
            merged.get(hero).reasons.push({ need: r.need, supply: r.supply, rule: r.rule });
        });
        return [...merged.values()];
    }

    function heroSynergies(name, relations) {
        const of = (type, key) => relations.filter(r => r.type === type && r[key] === name);
        const flag = f => relations.some(r => r.type === 'flag' && r.needer === name && r.flag === f);
        return {
            helpedBy: of('partner', 'needer').map(r => entry(r, r.supplier)),
            helps: of('partner', 'supplier').map(r => entry(r, r.needer)),
            selfCombos: of('self', 'needer').map(r => ({ label: r.need.label, need: r.need, supply: r.supply, rule: r.rule })),
            conflicts: [
                ...of('conflict', 'needer').map(r => ({ ...entry(r, r.supplier), direction: 'hurt-by' })),
                ...of('conflict', 'supplier').map(r => ({ ...entry(r, r.needer), direction: 'hurts' }))
            ],
            counteredBy: byOpponent(of('counter', 'needer'), 'supplier'),
            counters: byOpponent(of('counter', 'supplier'), 'needer'),
            broad: of('broad', 'needer').map(r => ({ label: r.need.label, need: r.need, count: r.suppliers.length })),
            flags: { dontFeed: flag('dontFeed'), punishWithDamage: flag('punishWithDamage') }
        };
    }

    const SMALL_WORDS = ['of', 'the', 'to', 'a', 'an', 'in', 'and'];
    const titleCase = text => text.toLowerCase().split(' ')
        .map((w, i) => (i && SMALL_WORDS.includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
    const abilityList = sources => sources.map(titleCase).join(' / ');
    const VERB = { inflicts: 'inflicts', grants: 'grants', gains: 'gains', places: 'places' };

    // One sentence for a partner / conflict / counter relation (arc tooltips)
    function describeRelation(r) {
        const supplier = `${titleCase(r.supplier)} ${VERB[r.supply.role]} ${r.supply.label} (${abilityList(r.supply.sources)})`;
        const target = `${titleCase(r.needer)}'s ${abilityList(r.need.sources)}`;
        if (r.type === 'partner') return `${supplier} for ${target}`;
        if (r.type === 'counter' && r.rule === 'opposite') return `${supplier}, which undoes ${r.need.label} for ${target}`;
        return `${supplier}, which hinders ${target}`;
    }

    const ARC_CATEGORIES = ['partner', 'conflict', 'counter'];

    // Hero-to-hero lines: one per (pair, category) with sorted ends a < b; aToB means
    // a helps/hurts b (supplier -> needer). Optionally only arcs touching `focus`.
    function synergyArcs(relations, focus = null) {
        const arcs = new Map();
        relations.forEach(r => {
            if (!ARC_CATEGORIES.includes(r.type)) return;
            if (focus && r.needer !== focus && r.supplier !== focus) return;
            const [a, b] = [r.supplier, r.needer].sort();
            const key = `${r.type}|${a}|${b}`;
            if (!arcs.has(key)) arcs.set(key, { a, b, category: r.type, aToB: false, bToA: false, relations: [] });
            const arc = arcs.get(key);
            if (r.supplier === a) arc.aToB = true; else arc.bToA = true;
            arc.relations.push(r);
        });
        return [...arcs.values()];
    }

    const api = { computeSynergies, heroSynergies, synergyArcs, describeRelation, titleCase, abilityList, POSITIVE, NEGATIVE };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.Synergy = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
