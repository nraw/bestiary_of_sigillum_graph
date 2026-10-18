// Pure graph logic (no DOM / D3): building the bipartite hero-label graph,
// highlight states, pathfinding, filtering and view fitting.
// Loaded in the browser as window.GraphLogic and in Node via require().
(function (root) {
    const PRIMARY_TYPES = ['AoE', 'Ranged', 'Melee', 'Support'];

    const OFFICIAL_EFFECTS = [
        'Attack increase', 'Attack decrease', 'Defense increase', 'Defense decrease',
        'Control increase', 'Control decrease', 'Swiftness', 'Slowness', 'Flying',
        'Place obstacle', 'Resistance', 'Vampirism', 'Stun', 'Silence', 'Poison', 'Web'
    ];
    const LABEL_GROUPS = {
        Combat: ['Melee', 'Ranged', 'AoE', 'Line-Attack', 'Anti-Large', 'Anti-Group'],
        Magic: ['Support', 'Healing', 'Effect-Copy', 'Effect-Manipulation', 'Teleport'],
        Movement: ['Mobility', 'Displacement', 'Speed-Buff', 'Speed-Debuff', 'Conditional-Mobility'],
        Structure: ['Structure-Dependent', 'Structure-Counter', 'Terrain-Control', 'Castle-Defender']
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

    function getPrimaryType(labels) {
        return PRIMARY_TYPES.find(type => labels.includes(type)) || 'Other';
    }

    function getLabelCategory(label) {
        if (OFFICIAL_EFFECTS.includes(label)) return 'Effect';
        const group = Object.keys(LABEL_GROUPS).find(g => LABEL_GROUPS[g].includes(label));
        return group || 'Trait';
    }

    // Vitality in the data ranges 2-5; map to a radius in px
    function vitalityRadius(vitality) {
        const v = Math.min(5, Math.max(2, vitality));
        return 20 + (v - 2) * 4;
    }

    function labelRadius(degree) {
        return 5 + Math.min(10, Math.sqrt(degree) * 2.5);
    }

    function buildGraph(heroes) {
        const heroNodes = heroes.map(hero => ({
            id: `hero_${hero.id}`,
            originalId: hero.id,
            name: hero.name,
            type: 'hero',
            vitality: hero.vitality,
            labels: hero.labels,
            core_ability: hero.core_ability,
            support_abilities: hero.support_abilities,
            features: hero.features || [],
            sync_note: hero.sync_note || null,
            image: `hero_images/${hero.name.toLowerCase()}.png`,
            primaryType: getPrimaryType(hero.labels),
            radius: vitalityRadius(hero.vitality)
        }));

        const degree = new Map();
        const links = [];
        heroNodes.forEach(hero => {
            hero.labels.forEach(label => {
                degree.set(label, (degree.get(label) || 0) + 1);
                links.push({ source: hero.id, target: `label_${label}` });
            });
        });

        const labelNodes = Array.from(degree.keys()).map(label => ({
            id: `label_${label}`,
            name: label,
            type: 'label',
            category: getLabelCategory(label),
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

    function linkState(link, highlight) {
        const s = highlight.get(endId(link.source));
        const t = highlight.get(endId(link.target));
        if (s === 'selected' || t === 'selected') return 'direct';
        const pair = [s, t];
        if (pair.includes('connected') && pair.includes('secondary')) return 'secondary';
        return 'dim';
    }

    function relatedHeroes(hero, heroes) {
        return heroes
            .filter(other => other.id !== hero.id)
            .map(other => ({
                hero: other,
                shared: hero.labels.filter(label => other.labels.includes(label))
            }))
            .filter(entry => entry.shared.length > 0)
            .sort((a, b) => b.shared.length - a.shared.length || a.hero.name.localeCompare(b.hero.name));
    }

    // Breadth-first search; neighbours are visited in sorted order so the
    // result is deterministic
    function findPath(adjacency, startId, targetId) {
        if (!adjacency.has(startId) || !adjacency.has(targetId)) return null;
        const previous = new Map([[startId, null]]);
        const queue = [startId];
        while (queue.length) {
            const current = queue.shift();
            if (current === targetId) {
                const path = [];
                for (let id = targetId; id !== null; id = previous.get(id)) path.unshift(id);
                return path;
            }
            [...adjacency.get(current)].sort().forEach(next => {
                if (!previous.has(next)) {
                    previous.set(next, current);
                    queue.push(next);
                }
            });
        }
        return null;
    }

    // Returns a Set of matching node ids, or null when no filter is active
    function filterNodes(nodes, { term = '', category = null, labelCategory = null } = {}) {
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
        'Place obstacle', 'Resistance', 'Vampirism', 'Stun', 'Poison'
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
        PRIMARY_TYPES, getPrimaryType, getLabelCategory, vitalityRadius, labelRadius,
        buildGraph, buildAdjacency, computeHighlight, linkState, relatedHeroes,
        findPath, filterNodes, fitTransform, effectIcon, nearestInDirection, escapeHtml, abilityRange
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.GraphLogic = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
