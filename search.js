// Search matching: by name (substring) or by hero id (exact, e.g. "26" or "#26")
function nodeMatchesSearch(node, searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return false;

    const idMatch = term.match(/^#?(\d+)$/);
    if (idMatch && node.originalId === Number(idMatch[1])) return true;

    return node.name.toLowerCase().includes(term);
}

// Autocomplete: exact id first, then name prefix, then substring; heroes before
// labels within a rank, alphabetical within a type
function getSuggestions(nodes, searchTerm, limit = 8) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return [];

    const rank = node => {
        const idMatch = term.match(/^#?(\d+)$/);
        if (idMatch && node.originalId === Number(idMatch[1])) return 0;
        return node.name.toLowerCase().startsWith(term) ? 1 : 2;
    };

    return nodes
        .filter(node => nodeMatchesSearch(node, term))
        .map(node => ({ node, rank: rank(node) }))
        .sort((a, b) =>
            a.rank - b.rank ||
            (a.node.type === 'hero' ? 0 : 1) - (b.node.type === 'hero' ? 0 : 1) ||
            a.node.name.localeCompare(b.node.name))
        .slice(0, limit)
        .map(entry => entry.node);
}

// Draft pool entries: { name, display, id, terms: [{ text, kind }] } where kind is attribute / size / range / role / trait
const cardId = term => { const m = term.match(/^#?(\d+)$/); return m ? Number(m[1]) : null; };

// A pool hero matches by name (substring), card id (exact) or any term (substring); a blank term matches all
function poolMatches(entry, searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    if (cardId(term) !== null) return entry.id === cardId(term);
    return [entry.display, ...entry.terms.map(t => t.text)].some(text => text.toLowerCase().includes(term));
}

// The pool's autocomplete, ranked like the graph's: exact id, then prefix, then substring; heroes before
// terms within a rank, alphabetical. A term lists the heroes having it, so the dropdown shows what is found.
// `exclude`: terms already chosen as pills
function poolSuggestions(entries, searchTerm, limit = 8, { exclude = [] } = {}) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return [];
    const chosen = new Set(exclude.map(t => t.toLowerCase()));
    const id = cardId(term);
    const items = [];
    entries.forEach(e => {
        if (id !== null ? e.id === id : e.display.toLowerCase().includes(term)) {
            items.push({ type: 'hero', label: e.display, name: e.name, id: e.id, rank: id !== null ? 0 : e.display.toLowerCase().startsWith(term) ? 1 : 2 });
        }
    });
    if (id === null) {
        const terms = new Map();
        entries.forEach(e => e.terms.forEach(t => {
            const key = t.text.toLowerCase();
            if (!key.includes(term) || chosen.has(key)) return;
            if (!terms.has(key)) terms.set(key, { type: 'term', label: t.text, kind: t.kind, heroes: [], rank: key.startsWith(term) ? 1 : 2 });
            const found = terms.get(key);
            if (!found.heroes.includes(e.name)) found.heroes.push(e.name);
        }));
        terms.forEach(t => items.push({ ...t, count: t.heroes.length }));
    }
    return items
        .sort((a, b) => a.rank - b.rank || (a.type === 'hero' ? 0 : 1) - (b.type === 'hero' ? 0 : 1) || a.label.localeCompare(b.label))
        .slice(0, limit)
        .map(({ rank, ...item }) => item);
}

// Terms chosen from the dropdown become pills: a hero must have every one of them, exactly
function poolHasPills(entry, pills) {
    const terms = new Set(entry.terms.map(t => t.text.toLowerCase()));
    return pills.every(p => terms.has(p.toLowerCase()));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { nodeMatchesSearch, getSuggestions, poolMatches, poolSuggestions, poolHasPills };
}
