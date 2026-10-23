// Graph selection <-> URL query: '?hero=<name>', '?trait=<label>' and '?band=<a,b,c>[&vs=<d,e,f>]'; no
// selection is no query. Real query addresses (not '#…') so search engines index each hero as its own page;
// `routeMeta` gives each one its title, description and canonical address. Names are lowercased and
// URI-encoded; decoding matches them case-insensitively back to the canonical hero names / trait labels
// (null for anything else). Old '#graph/…' links still decode, for the app to rewrite them as a query.
// Loaded in the browser as window.GraphRoute and in Node via require().
(function (root) {
    const LEGACY = '#graph';
    const KEYS = ['hero', 'trait', 'band'];

    const slug = name => encodeURIComponent(name.toLowerCase());

    function encodeRoute(route) {
        if (route.type === 'hero' || route.type === 'trait') return `?${route.type}=${slug(route.name)}`;
        if (route.type === 'band') {
            return `?band=${route.mine.map(slug).join(',')}${route.theirs.length ? `&vs=${route.theirs.map(slug).join(',')}` : ''}`;
        }
        return '';
    }

    const isLegacyRoute = hash => hash === LEGACY || hash.startsWith(`${LEGACY}/`);

    function matcher({ heroes, traits }) {
        const find = (names, text) => names.find(n => n.toLowerCase() === text.toLowerCase()) ?? null;
        const findAll = parts => {
            const names = parts.map(p => find(heroes, p));
            return names.length && names.every(Boolean) ? names : null;
        };
        return { find, findAll, heroes, traits };
    }

    const route = (type, value, m) => {
        const name = m.find(type === 'hero' ? m.heroes : m.traits, value);
        return name ? { type, name } : null;
    };

    function decodeLegacy(hash, m) {
        if (hash === LEGACY) return { type: 'none' };
        let parts;
        try { parts = hash.slice(LEGACY.length + 1).split('/').map(decodeURIComponent); } catch (error) { return null; }
        const [type, ...rest] = parts;
        if ((type === 'hero' || type === 'trait') && rest.length === 1) return route(type, rest[0], m);
        if (type === 'band' && (rest.length === 1 || (rest.length === 3 && rest[1] === 'vs'))) {
            const mine = rest[0] ? m.findAll(rest[0].split('+')) : null;
            const theirs = rest.length === 3 ? (rest[2] ? m.findAll(rest[2].split('+')) : null) : [];
            return mine && theirs ? { type, mine, theirs } : null;
        }
        return null;
    }

    // { search, hash } (a location) -> route, or null for a selection that does not exist
    function decodeRoute({ search = '', hash = '' }, names) {
        const m = matcher(names);
        if (isLegacyRoute(hash)) return decodeLegacy(hash, m);
        const params = new URLSearchParams(search); // malformed escapes decode to U+FFFD and match nothing
        const present = KEYS.filter(k => params.has(k));
        if (!present.length) return params.has('vs') ? null : { type: 'none' };
        if (present.length > 1) return null;
        const [key] = present;
        if (key === 'band') {
            const mine = params.get('band') ? m.findAll(params.get('band').split(',')) : null;
            const theirs = params.get('vs') ? m.findAll(params.get('vs').split(',')) : [];
            return mine && theirs ? { type: 'band', mine, theirs } : null;
        }
        return route(key, params.get(key), m);
    }

    // How the address follows a render: 'push' a history step, 'replace' it, 'defer' (typing a search: the
    // address keeps the last selection until a result is picked) or 'none'
    function historyStep({ url, current, typing, term }) {
        if (typing && term) return 'defer';
        if (url === current) return 'none';
        return typing ? 'replace' : 'push';
    }

    // ---- Page metadata per selection ------------------------------------------------------------

    const SITE_NAME = 'Bestiary of Sigillum';
    const display = name => name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    // synergy.js titleCase (loaded after this file): small words stay lower-case after the first
    const SMALL_WORDS = ['of', 'the', 'to', 'a', 'an', 'in', 'and'];
    const titleCase = text => text.toLowerCase().split(' ')
        .map((w, i) => (i && SMALL_WORDS.includes(w) ? w : display(w))).join(' ');

    // Whole sentences while they fit in `max` characters
    function fitSentences(parts, max) {
        return parts.filter(Boolean).reduce((out, part) => {
            const next = out ? `${out} ${part}` : part;
            return next.length <= max ? next : out;
        }, '');
    }

    // { title, description, canonical } for a hero or trait; null keeps the page's own (no selection, bands)
    function routeMeta(selection, { heroes, traitDescriptions }, base) {
        const canonical = `${base}${encodeRoute(selection)}`;
        if (selection.type === 'hero') {
            const hero = heroes.find(h => h.name === selection.name);
            if (!hero) return null;
            const name = display(hero.name);
            const reach = hero.labels.includes('Melee') ? 'melee' : 'ranged';
            const abilities = [hero.core_ability, ...hero.support_abilities].map(a => a.name).filter(Boolean).map(titleCase);
            return {
                title: `${name} – ${SITE_NAME} Hero Synergies & Counters`,
                description: fitSentences([
                    `${name}: ${hero.attribute} ${reach} hero (Vitality ${hero.vitality}) in ${SITE_NAME}.`,
                    abilities.length && `Abilities: ${abilities.join(', ')}.`,
                    hero.features.join(' '),
                    'Card, synergies and counters.'
                ], 160),
                canonical
            };
        }
        if (selection.type === 'trait') {
            const text = traitDescriptions[selection.name]?.text || '';
            const users = heroes.filter(h => h.labels.includes(selection.name)).map(h => display(h.name));
            const firstSentence = text.match(/^[^.]*\./)?.[0] || text;
            return {
                title: `${selection.name} – ${SITE_NAME} Trait & Heroes`,
                description: fitSentences([
                    firstSentence && firstSentence.length <= 120 ? `${selection.name}: ${firstSentence}` : `${selection.name}, a ${SITE_NAME} trait.`,
                    users.length && `Heroes with it: ${users.slice(0, 6).join(', ')}${users.length > 6 ? ' and more' : ''}.`,
                    'See who combines with it.'
                ], 160),
                canonical
            };
        }
        return null;
    }

    const api = { encodeRoute, decodeRoute, isLegacyRoute, routeMeta, historyStep };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.GraphRoute = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
