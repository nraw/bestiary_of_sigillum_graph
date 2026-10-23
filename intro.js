// First-visit intro (no DOM): shown once per browser, and never over a shared or deep link
// (#draft/…, ?hero= / ?trait= / ?band=, old #graph/… links) so those open straight onto what was shared.
// Loaded in the browser as window.Intro and in Node via require().
(function (root) {
    const INTRO_KEY = 'bestiary-intro-v1';
    const PLAIN = new Set(['', '#', '#graph', '#draft']);

    const SELECTION = /[?&](hero|trait|band)=/;
    const shouldShowIntro = ({ seen, hash, search = '' }) => !seen && PLAIN.has(hash || '') && !SELECTION.test(search);

    // Unreadable storage counts as seen: better no intro than one on every visit
    function introSeen(storage) {
        try {
            return !storage || storage.getItem(INTRO_KEY) !== null;
        } catch (error) {
            return true;
        }
    }

    function markIntroSeen(storage) {
        try {
            storage?.setItem(INTRO_KEY, '1');
        } catch (error) { /* storage disabled */ }
    }

    const api = { INTRO_KEY, shouldShowIntro, introSeen, markIntroSeen };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.Intro = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
