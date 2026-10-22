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

    // Official card art, traced from the V2 Character Reference PDF (24-unit box). The attribute emblems
    // (banner: shield with cross, dagger, open book) are stroked; the heart and ability-row markers are filled.
    // Every view draws these, so an attribute or marker looks the same everywhere.
    const ATTRIBUTE_GLYPHS = {
        Strength: 'M12 22.5C12 22.5 15 21 17.4 19.1C19.3 17.6 20.7 15.7 20.7 15.7L20.7 4.8L12 1.5L3.3 4.8L3.3 15.7C3.3 15.7 4.7 17.6 6.6 19.1C9 21 12 22.5 12 22.5ZM12 16.9L12 1.5M7.5 12L16.5 12M10.6 16.9L13.4 16.9M7.5 10.6L7.5 13.4M16.5 10.6L16.5 13.4',
        Agility: 'M12 1.5L12 20M13.2 21.3C13.2 20.6 12.7 20 12 20C11.3 20 10.8 20.6 10.8 21.3C10.8 22 11.3 22.5 12 22.5C12.7 22.5 13.2 22 13.2 21.3M6.9 14.6C6.9 14.6 10.1 14.4 12 14.4C13.9 14.4 17.1 14.6 17.1 14.6M12 1.5L9.5 14.5M12 1.5L14.5 14.5M6.9 13.6L6.9 15.6M17.1 13.6L17.1 15.6',
        Intelligence: 'M13.4 21.1C13.4 21.9 12.8 22.5 12 22.5C11.2 22.5 10.6 21.9 10.6 21.1C10.6 20.3 11.2 19.6 12 19.6C12.8 19.6 13.4 20.3 13.4 21.1M10.8 20.3L2.9 15.2L2.9 1.5L12 7.4L12 19.6M13.2 20.3L21.1 15.2L21.1 1.5L12 7.4'
    };
    const GLYPHS = {
        heart: 'M17.4 15.8C15.7 20.2 13.8 22.6 12.9 22.6C11.1 22.6 4.9 17.4 3.5 12.3C3.7 12.3 3.8 12.3 3.9 12.3C5.1 12.3 6.7 12.2 7.8 11.3C8.5 10.8 8.7 9.8 9.1 8.7C9.7 6.6 10.5 4 14 2.6C15.1 2.2 16.4 1.9 17.3 1.8C17.3 2 17.3 2.2 17.3 2.4C17.3 2.7 17.1 3.1 17 3.3C16.8 3.4 16.7 3.4 16.6 3.4C13.8 3.9 11.1 7 11 7.2L11.8 7.8C11.8 7.8 12.1 7.4 12.6 6.9C13 7.9 13.6 10.2 12.5 11.7C10.2 15.2 6.9 14.4 6.7 14.4L6.5 15.3C6.5 15.3 7 15.4 7.7 15.4C8.3 15.4 9.1 15.3 9.9 15C10.2 15.4 10.7 16.2 11.5 16.8C11.6 16.9 11.8 17 11.9 17.1C11.8 17.3 11.7 17.6 11.6 17.8C11.4 18.3 11 18.7 11 18.7L11.6 19.4C11.6 19.4 12.1 18.9 12.5 18.3C12.6 18.1 12.7 17.8 12.7 17.6C13.5 18 14.1 18.2 14.1 18.2L14.5 17.3C14.4 17.3 13 16.8 12.1 16.1C11.5 15.6 11.1 15 10.8 14.6C11.7 14.1 12.6 13.4 13.3 12.3C13.4 12.2 13.4 12.2 13.4 12.1C13.7 12.3 14 12.4 14.4 12.6C14.5 12.8 14.6 13.2 14.6 13.4C14.6 14 14.4 14.5 14.4 14.5L15.3 14.9C15.3 14.9 15.6 14.2 15.6 13.4C15.6 13.2 15.5 13 15.5 12.8C15.6 12.8 15.8 12.9 15.9 12.9C16.5 12.9 16.9 12.8 16.9 12.8L16.7 11.8C16.7 11.8 15.8 12 15.1 11.8C14.6 11.7 14.1 11.4 13.8 11.2C14.5 9.2 13.7 7 13.4 6.2C14.3 5.4 15.6 4.6 16.8 4.3C18.3 4.1 19.9 4.3 20.5 4.4C20.5 4.4 20.5 4.5 20.5 4.6C20.6 4.8 20.6 5 20.6 5.1C20.5 5.4 20.4 5.8 20.3 6C19.8 5.8 18.7 5.6 17.8 5.8C17.5 5.9 17.3 5.9 17 6.1C15.9 6.5 15.1 7.3 15.1 7.3L15.7 8C15.7 8 16.1 7.7 16.6 7.4C16.5 7.8 16.5 8.2 16.7 8.6C16.9 8.8 17.1 9 17.3 9C17.4 9 17.5 9.1 17.6 9.1C17.9 10 18.4 13.1 17.4 15.8ZM6.9 5.4C7.3 5.9 8 7.1 8.4 7.7C8.3 8 8.2 8.2 8.2 8.4C7.9 9.4 7.6 10.2 7.2 10.6C6.1 11.4 4.3 11.4 3.3 11.4C3 8.5 4.8 6 6.9 5.4ZM6.7 1.7C7.1 1.7 7.8 1.7 9.2 2.2C9.8 2.4 10.5 3 10.9 3.4C9.9 4.4 9.2 5.5 8.8 6.5C8.4 5.9 7.9 5 7.5 4.6C7 4.2 6.4 3.7 6.1 3.5C6.1 2.7 6.3 1.7 6.7 1.7ZM22.6 4.8C22.6 4.6 22.5 4.4 22.3 4.4L21.4 4.1C21.3 3.9 21.3 3.8 21.3 3.7C21.2 3.6 21.1 3.5 20.9 3.5C20.9 3.5 20.6 3.4 20.2 3.4C20.2 3 20.2 2.6 20 2.1C19.5 1.4 19.1 0.9 19 0.9C19 0.8 18.8 0.8 18.7 0.7C18.6 0.7 15.9 0.8 13.6 1.7C12.9 2 12.5 2.2 11.9 2.6C11.5 2.2 10.9 1.4 9.9 1C8.8 0.4 7.2 0 6.4 0.1C4.2 0.4 5.1 3.5 5.1 3.8C5.1 4 5.2 4.1 5.4 4.2C5.4 4.2 5.5 4.3 5.6 4.4C3.1 5.6 1.2 8.8 2 12.3C3.3 17.8 10 24 12.9 24C15.5 24 17.9 18.6 18.7 16.3C19.9 13.3 19.3 9.9 19 8.8C19.1 8.7 19.2 8.7 19.4 8.7C20.2 8.6 21.1 8.9 21.1 8.9C21.3 9 21.5 9 21.6 8.8C21.7 8.8 22.3 8 22.6 7C22.8 6 22.6 4.8 22.6 4.8Z',
        target: 'M12.8 20.5L12.7 19.8L13.1 18L13.1 17.5L11.6 17.5L11 17.7L11.6 19.6L11.6 20.5C7.3 20.4 3.8 17 3.5 12.8L4.2 12.7L6 13.1L6.5 13.1L6.5 11.6L6.3 11L4.4 11.6L3.5 11.6C3.8 7.4 7.1 4.1 11.2 3.8L11.3 4.2L10.9 6L10.9 6.5L12.4 6.5L13 6.3L12.4 4.4L12.4 3.8C16.5 4.1 19.7 7.2 20.2 11.2L19.8 11.3L18 10.9L17.5 10.9L17.5 12.4L17.7 13L19.6 12.4L20.2 12.4C20.1 16.6 16.9 20 12.8 20.5ZM23.9 10.3L23.4 10.4L22.6 11L22.2 11.1C21.7 6.1 17.6 2.2 12.6 1.8L13 0.4L12.5 0.1L11.5 0C11.5 0 10.6 0.2 10.3 0.1L10.4 0.6L11 1.4L11.1 1.8C6 2.2 1.9 6.2 1.5 11.3L0.4 11L0.1 11.5L0 12.5C0 12.5 0.2 13.4 0.1 13.7L0.6 13.6L1.4 13L1.5 13C1.9 18.1 6.1 22.2 11.3 22.5L11 23.6L11.5 23.9L12.5 24C12.5 24 13.4 23.8 13.7 23.9L13.6 23.4L13 22.6L13 22.5C18 21.9 22 17.8 22.2 12.6L23.6 13L23.9 12.5L24 11.5C24 11.5 23.8 10.6 23.9 10.3ZM11.8 13.5C11 13.5 10.3 12.8 10.3 12C10.3 11.2 11 10.5 11.8 10.5C12.7 10.5 13.4 11.2 13.4 12C13.4 12.8 12.7 13.5 11.8 13.5ZM11.8 9.1C10.2 9.1 8.9 10.4 8.9 12C8.9 13.6 10.2 14.9 11.8 14.9C13.4 14.9 14.7 13.6 14.7 12C14.7 10.4 13.4 9.1 11.8 9.1Z',
        effect: 'M22.3 11C21.3 11 18.4 10.8 17.7 10.6C17 10.4 16.1 10.3 16.2 9C16.2 7.7 17.2 6.5 17.4 5.9C17.6 5.3 17.1 4.5 16.4 5.2C15.8 5.8 14.3 7.1 13.8 7.4C13.4 7.7 12.7 7.6 12.7 6.8C12.6 6.1 11.4 1.5 11.3 1C11.2 0.5 10.6 0 10.6 0.7C10.6 2.7 10.3 7 10.1 7.4C9.9 7.9 9.6 8.3 9.1 8C8.7 7.7 5.4 5.3 5.1 5.1C4.7 4.9 4.7 5.1 4.9 5.5C5 6 7.1 10 7.2 10.4C7.4 10.7 7.4 11.1 7.1 11.1C6.7 11.1 1.7 11.4 1.3 11.6C1 11.7 0.7 12.1 1.2 12.3C1.6 12.6 6.5 13.2 6.9 13.4C7.4 13.6 7.5 13.9 7.2 14.2C7 14.5 5.4 18 5.4 18.3C5.3 18.6 5.6 18.8 6 18.6C6.5 18.3 9 16.6 9.3 16.4C9.5 16.3 9.7 16.1 9.8 16.7C9.9 17.3 11.8 23.2 11.8 23.6C11.8 24 12.4 23.7 12.4 23.4C12.5 23.1 13.4 17.3 13.5 17C13.7 16.6 14.4 16.2 14.8 16.4C15.2 16.7 17.8 18.5 18.1 18.7C18.4 18.9 18.8 18.9 18.7 18.3C18.5 17.8 16.8 14.6 16.7 14.2C16.6 13.9 17.4 13 18.1 12.7C18.9 12.4 21.8 11.8 22.1 11.7C22.5 11.6 23.3 11 22.3 11ZM11.6 14.5C10.5 14.5 9.6 13.6 9.6 12.5C9.6 11.4 10.5 10.5 11.6 10.5C12.8 10.5 13.7 11.4 13.7 12.5C13.7 13.6 12.8 14.5 11.6 14.5Z',
        cooldown: 'M23 15C23 13.4 21.7 12.1 20.1 12.1C18.5 12.1 17.2 13.4 17.2 15C17.2 16.1 17.8 17 18.7 17.5C17.3 20.2 14.5 22 11.3 22C6.7 22 3 18.3 3 13.7C3 9.1 6.7 5.4 11.3 5.4C12.5 5.4 13.7 5.7 14.7 6.2C13.1 6.5 11.3 7.1 10.7 7.8C10 8.6 10.4 8.7 11.5 8.5C12.6 8.2 17.2 7.6 19.8 9.5C20.5 10 21.1 9.8 20.3 8C19.6 6.1 18.8 3.4 14.6 1.1C14 0.9 13.2 0 13.2 1C13.2 1.6 14.9 3.1 15.7 4.4C14.4 3.8 12.9 3.4 11.3 3.4C5.6 3.4 1 8 1 13.7C1 19.4 5.6 24 11.3 24C15.6 24 19.2 21.4 20.8 17.8C22 17.5 23 16.3 23 15ZM20.1 16.5C19.3 16.5 18.6 15.8 18.6 15C18.6 14.2 19.3 13.5 20.1 13.5C20.9 13.5 21.6 14.2 21.6 15C21.6 15.8 20.9 16.5 20.1 16.5Z'
    };

    function attributeGlyph(attribute, cls = '') {
        return `<svg class="${cls ? `${cls} ` : ''}glyph-attr" viewBox="0 0 24 24" aria-hidden="true"><path d="${ATTRIBUTE_GLYPHS[attribute]}"/></svg>`;
    }

    // A reusable <symbol> (for <use href="#id">) of one of the filled GLYPHS
    function glyphSymbol(id, key) {
        return `<symbol id="${id}" viewBox="0 0 24 24"><path d="${GLYPHS[key]}"/></symbol>`;
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

    // The abilities behind one hero-trait edge: [{ ability, index, roles }] in card order (index 0 = core),
    // then { ability: null } for roles no ability on the card causes
    function linkAbilities(hero, roles) {
        const abilities = [hero.core_ability, ...hero.support_abilities];
        const groups = abilities
            .map((ability, index) => ({ ability, index, roles: roles.filter(r => ability.name && r.sources.includes(ability.name)) }))
            .filter(g => g.roles.length);
        const named = new Set(abilities.map(a => a.name).filter(Boolean));
        const cardLevel = roles.filter(r => !r.sources.some(s => named.has(s)));
        if (cardLevel.length) groups.push({ ability: null, index: null, roles: cardLevel });
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

    // A one-way edge fades in from its tail to its arrowhead: the gradient's start and end points
    // (`seg` is drawn from x1,y1 to x2,y2). Two-way or undirected edges keep a solid colour (null).
    function gradientVector(seg, dir) {
        if (dir.toTrait === dir.toHero) return null;
        return dir.toTrait ? { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 } : { x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1 };
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

    // All hero nodes share one size; vitality is shown as a stack of heart tokens instead
    const HERO_RADIUS = 26;
    const TOKEN_RADIUS = 5.5;

    // Heart token centres along the hero's bottom-left rim, ordered top to bottom so that, drawn in
    // order, each lower token overlaps the one above it like a stack on the game board
    function vitalityTokens(vitality, radius, { centre = 145, step = 7.5 } = {}) {
        const stepAngle = step / radius * 180 / Math.PI;
        const start = centre + stepAngle * (vitality - 1) / 2;
        return Array.from({ length: Math.max(0, vitality) }, (_, i) => {
            const a = (start - i * stepAngle) * Math.PI / 180;
            return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
        });
    }

    // The same stack as SVG markup for HTML portraits (draft cards); heart-glyph and the token
    // gradients are shared defs in index.html. Overlay it on a portrait and it scales with it.
    function vitalityTokensSvg(vitality) {
        const r = HERO_RADIUS, h = TOKEN_RADIUS * 1.55;
        const tokens = vitalityTokens(vitality, r).map(t =>
            `<g class="vitality-token" transform="translate(${t.x.toFixed(2)},${t.y.toFixed(2)})">`
            + `<circle class="token-rim" r="${TOKEN_RADIUS}"/><circle class="token-face" r="${TOKEN_RADIUS - 1.3}"/>`
            + `<use class="token-heart" href="#heart-glyph" x="${-h / 2}" y="${-h / 2}" width="${h}" height="${h}"/></g>`).join('');
        return `<svg class="vitality-stack" viewBox="${-r} ${-r} ${r * 2} ${r * 2}" aria-hidden="true">${tokens}</svg>`;
    }

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

    // A drafted band on the graph: its synergy arcs (within the band and to the pool) and
    // per-hero states 'selected' (mine) | 'connected' (pool hero linked to a band) | 'rival' | 'dim'.
    // With showOpponent the opposing band joins, but only through its counters, with my band and
    // with the pool (heroes it counters or that counter it: what matters for my next pick).
    function bandView(arcs, heroNames, { mine, theirs = [] }, { showOpponent = true } = {}) {
        const isMine = name => mine.includes(name);
        const isTheirs = name => theirs.includes(name);
        const shown = arcs.filter(a => {
            if (!isMine(a.a) && !isMine(a.b)) {
                const theirsToPool = isTheirs(a.a) !== isTheirs(a.b);
                return showOpponent && theirsToPool && a.category === 'counter';
            }
            const other = isMine(a.a) ? a.b : a.a;
            if (isMine(other)) return a.category !== 'counter';
            if (isTheirs(other)) return showOpponent && a.category === 'counter';
            return true;
        });
        const linked = new Set(shown.flatMap(a => [a.a, a.b]));
        const states = new Map(heroNames.map(name => [name,
            isMine(name) ? 'selected'
                : isTheirs(name) ? (showOpponent ? 'rival' : 'dim')
                : linked.has(name) ? 'connected' : 'dim']));
        return { arcs: shown, states };
    }

    // Layout springs for a band view: one per (band hero, linked pool hero) pair with a synergy line,
    // so pool heroes settle near the band member (mine or the opponent's) they relate to. The bands
    // themselves are anchored, so they get no springs between them.
    function bandSprings({ arcs, states }) {
        const springs = new Map();
        arcs.forEach(a => {
            const [member, other] = states.get(a.a) === 'connected' ? [a.b, a.a] : [a.a, a.b];
            if (states.get(other) !== 'connected') return;
            springs.set(`${member}|${other}`, { source: member, target: other });
        });
        return [...springs.values()];
    }

    // Layout targets for a band view: my band packed top-left and the opponent top-right (or my band
    // top-centre alone), two heroes per row, leaving the middle for counters; `pool` is where the
    // heroes linked to my band are drawn, just below the bands
    function bandAnchors({ mine, theirs = [] }, { showOpponent = true } = {}, width, height) {
        const split = showOpponent && theirs.length > 0;
        const gap = Math.min(width * 0.14, 115);
        const top = height * 0.12;
        const heroes = new Map();
        const pack = (names, cx) => names.forEach((name, i) => {
            const row = Math.floor(i / 2);
            const inRow = Math.min(2, names.length - row * 2);
            heroes.set(name, { x: cx + ((i % 2) - (inRow - 1) / 2) * gap, y: top + row * gap * 0.9 });
        });
        pack(mine, split ? width * 0.18 : width / 2);
        if (split) pack(theirs, width * 0.82);
        return { heroes, pool: { x: width / 2, y: top + gap * 2.6 } };
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
        ATTRIBUTES, ATTRIBUTE_GLYPHS, GLYPHS, attributeGlyph, glyphSymbol, getLabelCategory, HERO_RADIUS, TOKEN_RADIUS, vitalityTokens, vitalityTokensSvg, labelRadius,
        buildGraph, buildAdjacency, computeHighlight, focusIds, linkState, bandView, bandSprings, bandAnchors, arcPath,
        filterNodes, fitTransform, effectIcon, nearestInDirection, escapeHtml, abilityRange, abilityImage,
        ROLES, ROLE_INFO, linkKind, linkDirection, linkSummary, abilityTraits, linkAbilities, traitHeroesByRole, filterByRole, trimSegment, gradientVector
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.GraphLogic = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
