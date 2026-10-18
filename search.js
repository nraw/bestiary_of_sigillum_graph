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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { nodeMatchesSearch, getSuggestions };
}
