// Search matching: by name (substring) or by hero id (exact, e.g. "26" or "#26")
function nodeMatchesSearch(node, searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return false;

    const idMatch = term.match(/^#?(\d+)$/);
    if (idMatch && node.originalId === Number(idMatch[1])) return true;

    return node.name.toLowerCase().includes(term);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { nodeMatchesSearch };
}
