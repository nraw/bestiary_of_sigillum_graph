// Graph selection <-> URL hash: '#graph', '#graph/hero/<name>', '#graph/trait/<label>' and
// '#graph/band/<a+b+c>[/vs/<d+e+f>]'. Names are lowercased and URI-encoded; decoding matches them
// case-insensitively back to the canonical hero names / trait labels (null for anything else).
// Loaded in the browser as window.GraphRoute and in Node via require().
(function (root) {
    const PREFIX = '#graph';

    const slug = name => encodeURIComponent(name.toLowerCase());
    const list = names => names.map(slug).join('+');

    function encodeRoute(route) {
        if (route.type === 'hero' || route.type === 'trait') return `${PREFIX}/${route.type}/${slug(route.name)}`;
        if (route.type === 'band') {
            return `${PREFIX}/band/${list(route.mine)}${route.theirs.length ? `/vs/${list(route.theirs)}` : ''}`;
        }
        return PREFIX;
    }

    const isGraphRoute = hash => hash === PREFIX || hash.startsWith(`${PREFIX}/`);

    function decodeRoute(hash, { heroes, traits }) {
        if (!hash || hash === '#' || hash === PREFIX) return { type: 'none' };
        if (!isGraphRoute(hash)) return null;
        const find = (names, part) => {
            let text;
            try { text = decodeURIComponent(part).toLowerCase(); } catch (error) { return null; }
            return names.find(n => n.toLowerCase() === text) ?? null;
        };
        const findAll = part => {
            const names = part ? part.split('+').map(p => find(heroes, p)) : [];
            return names.length && names.every(Boolean) ? names : null;
        };
        const [type, ...rest] = hash.slice(PREFIX.length + 1).split('/');
        if ((type === 'hero' || type === 'trait') && rest.length === 1) {
            const name = find(type === 'hero' ? heroes : traits, rest[0]);
            return name ? { type, name } : null;
        }
        if (type === 'band' && (rest.length === 1 || (rest.length === 3 && rest[1] === 'vs'))) {
            const mine = findAll(rest[0]);
            const theirs = rest.length === 3 ? findAll(rest[2]) : [];
            return mine && theirs ? { type, mine, theirs } : null;
        }
        return null;
    }

    const api = { encodeRoute, decodeRoute, isGraphRoute };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.GraphRoute = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
