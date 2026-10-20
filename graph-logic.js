// Pure graph logic (no DOM / D3): building the bipartite hero-label graph,
// highlight states, filtering and view fitting.
// Loaded in the browser as window.GraphLogic and in Node via require().
(function (root) {
    // Card banner attributes, in card order; hero colour and glyph follow the attribute
    const ATTRIBUTES = ['Strength', 'Agility', 'Intelligence'];

    const OFFICIAL_EFFECTS = [
        'Attack increase', 'Attack decrease', 'Defense increase', 'Defense decrease',
        'Control increase', 'Control decrease', 'Swiftness', 'Slowness', 'Flying',
        'Place obstacle', 'Resistance', 'Vampirism', 'Stun', 'Silence', 'Poison', 'Web'
    ];
    const LABEL_GROUPS = {
        Combat: ['Melee', 'Ranged', 'AoE'],
        Magic: ['Healing', 'Effect-Copy', 'Effect-Manipulation', 'Teleport'],
        Movement: ['Mobility', 'Displacement', 'Conditional-Mobility'],
        Structure: ['Tower control', 'Castle-Defender',
            'Mountain', 'Water', 'Forest']
    };

    // Ability range symbols (ability_images/<key>.png), worded as on the rulebook sheet
    const ABILITY_RANGES = {
        self: 'The target is the Ability bearer',
        adjacent: 'The target is in an adjacent hex',
        adjacent_or_self: 'The target is in an adjacent hex or the target is the Ability bearer',
        all_hexes_in_line: 'The targets are in any hexes in a straight line',
        any_hex: 'The target is in any hex on the field',
        any_hex_or_self: 'The target is in any hex on the field or the target is the Ability bearer',
        one_hex_gap_line: 'The target is in any hex 1 unoccupied hex away in a straight line',
        any_hex_in_line: 'The target is in any hex in a straight line'
    };

    function abilityRange(key) {
        if (!Object.prototype.hasOwnProperty.call(ABILITY_RANGES, key)) return null;
        return { src: `ability_images/${key}.png`, label: ABILITY_RANGES[key] };
    }

    // Ability artwork from bestiary.online, by card position (0 = core, 1-2 = support)
    function abilityImage(heroName, index) {
        return `hero_ability_images/${heroName.toLowerCase()}/${index + 1}.png`;
    }

    // Edge roles: what a hero does with a trait. Giving roles (incl. places: moves units onto terrain) point hero -> trait,
    // conditions point trait -> hero; "has" is an undirected trait
    const ROLES = ['inflicts', 'grants', 'gains', 'places', 'benefits_from', 'hindered_by', 'has'];
    const ROLE_INFO = {
        inflicts:      { label: 'Inflicts',      verb: 'inflicts',      direction: 'out' },
        grants:        { label: 'Grants',        verb: 'grants',        direction: 'out' },
        gains:         { label: 'Gains',         verb: 'gains',         direction: 'out' },
        places:        { label: 'Places',        verb: 'places',        direction: 'out' },
        benefits_from: { label: 'Benefits from', verb: 'benefits from', direction: 'in' },
        hindered_by:   { label: 'Hindered by',   verb: 'is hindered by', direction: 'in' },
        has:           { label: 'Has',           verb: 'has',           direction: 'none' }
    };
    const SUBJECT_TEXT = { self: 'self', ally: 'allies', enemy: 'enemies' };

    // Colour/marker kind of a link: its one meaningful role, or 'mixed'
    function linkKind(roles) {
        const kinds = [...new Set(roles.map(r => r.role).filter(r => r !== 'has'))];
        if (!kinds.length) return 'has';
        return kinds.length === 1 ? kinds[0] : 'mixed';
    }

    function linkDirection(roles) {
        const dirs = roles.map(r => ROLE_INFO[r.role].direction);
        return { toTrait: dirs.includes('out'), toHero: dirs.includes('in') };
    }

    function linkSummary(heroName, label, roles) {
        return roles.map(r => {
            const on = SUBJECT_TEXT[r.on] ? ` on ${SUBJECT_TEXT[r.on]}` : '';
            const via = r.sources && r.sources.length ? `, via ${r.sources.join(' & ')}` : '';
            return `${heroName} ${ROLE_INFO[r.role].verb} ${label}${on}${via}`;
        });
    }

    // [{ ability, links }] for the core and support abilities in card order, then
    // { ability: null } for card-level traits (no single ability causes them)
    function abilityTraits(hero) {
        const abilities = [hero.core_ability, ...hero.support_abilities];
        const groups = abilities.map(ability => ({
            ability,
            links: hero.trait_links.filter(l => ability.name && l.sources.includes(ability.name))
        }));
        const named = new Set(abilities.map(a => a.name).filter(Boolean));
        groups.push({ ability: null, links: hero.trait_links.filter(l => !l.sources.some(s => named.has(s))) });
        return groups;
    }

    function traitHeroesByRole(label, nodes) {
        const heroes = nodes.filter(n => n.type === 'hero');
        return ROLES.map(role => ({
            role,
            entries: heroes.flatMap(hero => hero.trait_links
                .filter(l => l.label === label && l.role === role)
                .map(l => ({ hero, on: l.on, sources: l.sources })))
        })).filter(group => group.entries.length);
    }

    function filterByRole(links, role) {
        const kept = new Set(links.filter(l => l.roles.some(r => r.role === role)));
        const nodeIds = new Set();
        kept.forEach(l => { nodeIds.add(endId(l.source)); nodeIds.add(endId(l.target)); });
        return { nodeIds, links: kept };
    }

    // Line between two circles, trimmed to their rims so arrowheads stay visible
    function trimSegment(a, b, ra, rb) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len <= ra + rb) {
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return { x1: mx, y1: my, x2: mx, y2: my };
        }
        const ux = dx / len;
        const uy = dy / len;
        return { x1: a.x + ux * ra, y1: a.y + uy * ra, x2: b.x - ux * rb, y2: b.y - uy * rb };
    }

    // Quadratic curve from a to b bowed sideways by `bend` x length (sign picks the side),
    // ends pulled back to the node rims; (mx, my) is the curve's midpoint
    function arcPath(a, b, ra, rb, bend) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const cx = (a.x + b.x) / 2 - (dy / len) * bend * len;
        const cy = (a.y + b.y) / 2 + (dx / len) * bend * len;
        const toward = (p, r) => {
            const vx = cx - p.x;
            const vy = cy - p.y;
            const vl = Math.hypot(vx, vy) || 1;
            return { x: p.x + (vx / vl) * r, y: p.y + (vy / vl) * r };
        };
        const s = toward(a, ra);
        const e = toward(b, rb);
        return {
            x1: s.x, y1: s.y, cx, cy, x2: e.x, y2: e.y,
            mx: 0.25 * a.x + 0.5 * cx + 0.25 * b.x,
            my: 0.25 * a.y + 0.5 * cy + 0.25 * b.y,
            d: `M${s.x},${s.y}Q${cx},${cy} ${e.x},${e.y}`
        };
    }

    function getLabelCategory(label) {
        if (OFFICIAL_EFFECTS.includes(label)) return 'Effect';
        const group = Object.keys(LABEL_GROUPS).find(g => LABEL_GROUPS[g].includes(label));
        return group || 'Trait';
    }

    // All hero nodes share one size; vitality is shown in the tooltip and card instead
    const HERO_RADIUS = 26;

    function labelRadius(degree) {
        return 5 + Math.min(10, Math.sqrt(degree) * 2.5);
    }

    // descriptions: { [label]: { text, source? } } (bestiary_reference_cards.json "trait_descriptions")
    function buildGraph(heroes, descriptions = {}) {
        const heroNodes = heroes.map(hero => ({
            id: `hero_${hero.id}`,
            originalId: hero.id,
            name: hero.name,
            type: 'hero',
            vitality: hero.vitality,
            attribute: hero.attribute,
            labels: hero.labels,
            core_ability: hero.core_ability,
            support_abilities: hero.support_abilities,
            trait_links: hero.trait_links || hero.labels.map(label => ({ label, role: 'has', sources: [] })),
            features: hero.features || [],
            sync_note: hero.sync_note || null,
            image: `hero_images/${hero.name.toLowerCase()}.png`,
            radius: HERO_RADIUS
        }));

        const degree = new Map();
        const links = [];
        heroNodes.forEach(hero => {
            hero.labels.forEach(label => {
                degree.set(label, (degree.get(label) || 0) + 1);
                const roles = hero.trait_links.filter(l => l.label === label).map(({ label: _, ...role }) => role);
                links.push({ source: hero.id, target: `label_${label}`, roles, kind: linkKind(roles) });
            });
        });

        const labelNodes = Array.from(degree.keys()).map(label => ({
            id: `label_${label}`,
            name: label,
            type: 'label',
            category: getLabelCategory(label),
            description: descriptions[label] || null,
            degree: degree.get(label),
            radius: labelRadius(degree.get(label))
        }));

        return { nodes: [...heroNodes, ...labelNodes], links };
    }

    const endId = end => (typeof end === 'object' && end !== null ? end.id : end);

    function buildAdjacency(links) {
        const adjacency = new Map();
        const add = (a, b) => {
            if (!adjacency.has(a)) adjacency.set(a, new Set());
            adjacency.get(a).add(b);
        };
        links.forEach(link => {
            const s = endId(link.source);
            const t = endId(link.target);
            add(s, t);
            add(t, s);
        });
        return adjacency;
    }

    // Map every node id to 'selected' | 'connected' | 'secondary' | 'dim'.
    // Secondary = heroes two hops away (they share a label with a selected hero).
    function computeHighlight(selectedId, adjacency, nodesById) {
        const state = new Map();
        nodesById.forEach((_, id) => state.set(id, 'dim'));
        state.set(selectedId, 'selected');

        const direct = adjacency.get(selectedId) || new Set();
        direct.forEach(id => state.set(id, 'connected'));
        direct.forEach(id => {
            (adjacency.get(id) || new Set()).forEach(twoHop => {
                const node = nodesById.get(twoHop);
                if (state.get(twoHop) === 'dim' && node && node.type === 'hero') {
                    state.set(twoHop, 'secondary');
                }
            });
        });
        return state;
    }

    // The selection and its direct neighbours: what the view zooms to on select
    function focusIds(selectedId, adjacency) {
        return new Set([selectedId, ...(adjacency.get(selectedId) || [])]);
    }

    function linkState(link, highlight) {
        const s = highlight.get(endId(link.source));
        const t = highlight.get(endId(link.target));
        if (s === 'selected' || t === 'selected') return 'direct';
        const pair = [s, t];
        if (pair.includes('connected') && pair.includes('secondary')) return 'secondary';
        return 'dim';
    }


    // Returns a Set of matching node ids, or null when no filter is active
    function filterNodes(nodes, { term = '', category = null, labelCategory = null, attribute = null } = {}) {
        if (attribute) {
            return new Set(nodes
                .filter(node => node.type === 'hero' && node.attribute === attribute)
                .map(node => node.id));
        }
        if (labelCategory) {
            return new Set(nodes
                .filter(node => node.type === 'label' && node.category === labelCategory)
                .map(node => node.id));
        }
        const query = term.trim();
        const hasCategory = category && category !== 'All';
        if (!query && !hasCategory) return null;

        const matchesTerm = node => !query || nodeMatchesSearchFn(node, query);
        const ids = new Set();
        nodes.forEach(node => {
            if (hasCategory) {
                if (node.type === 'label' && node.name === category) ids.add(node.id);
                if (node.type === 'hero' && node.labels.includes(category) && matchesTerm(node)) ids.add(node.id);
            } else if (matchesTerm(node)) {
                ids.add(node.id);
            }
        });
        return ids;
    }

    // d3-style zoom transform {x, y, k} that fits bounds into width x height
    function fitTransform(bounds, width, height, padding = 40, maxScale = 2) {
        const w = Math.max(1, bounds.x1 - bounds.x0);
        const h = Math.max(1, bounds.y1 - bounds.y0);
        const k = Math.min(maxScale, (width - padding * 2) / w, (height - padding * 2) / h);
        const cx = (bounds.x0 + bounds.x1) / 2;
        const cy = (bounds.y0 + bounds.y1) / 2;
        return { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
    }

    const EFFECT_ARTWORK = [
        'Attack increase', 'Attack decrease', 'Defense increase', 'Defense decrease',
        'Control increase', 'Control decrease', 'Swiftness', 'Slowness', 'Flying',
        'Place obstacle', 'Resistance', 'Vampirism', 'Stun', 'Poison', 'Silence', 'Web'
    ];

    function effectIcon(label) {
        if (!EFFECT_ARTWORK.includes(label)) return null;
        return `effect_images/${label.toLowerCase().replace(/ /g, '_')}.png`;
    }

    // Keyboard spatial navigation: nearest node whose offset lies within a
    // 45-degree cone either side of the arrow direction
    function nearestInDirection(from, nodes, direction) {
        const axis = {
            right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1]
        }[direction];
        let best = null;
        let bestScore = Infinity;
        nodes.forEach(node => {
            if (node === from) return;
            const dx = node.x - from.x;
            const dy = node.y - from.y;
            const along = dx * axis[0] + dy * axis[1];
            const across = Math.abs(dx * axis[1] - dy * axis[0]);
            if (along <= 0 || across > along) return;
            const score = along + across * 2;
            if (score < bestScore) {
                bestScore = score;
                best = node;
            }
        });
        return best;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }

    const nodeMatchesSearchFn = (node, term) =>
        (root.nodeMatchesSearch || require('./search.js').nodeMatchesSearch)(node, term);

    const api = {
        ATTRIBUTES, getLabelCategory, HERO_RADIUS, labelRadius,
        buildGraph, buildAdjacency, computeHighlight, focusIds, linkState, arcPath,
        filterNodes, fitTransform, effectIcon, nearestInDirection, escapeHtml, abilityRange, abilityImage,
        ROLES, ROLE_INFO, linkKind, linkDirection, linkSummary, abilityTraits, traitHeroesByRole, filterByRole, trimSegment
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.GraphLogic = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
