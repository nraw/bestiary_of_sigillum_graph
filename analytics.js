// PostHog events (no DOM): the event catalogue, payload cleaning and the helpers behind
// hover dwell, settled search and draft pick / completion events. Plan: docs/analytics-tracking-plan.md.
// Loaded in the browser as window.Analytics and in Node via require().
(function (root) {
    // Every event and the params (PostHog event properties) it may carry
    const EVENTS = {
        app_loaded: ['entry', 'hero_count'],
        app_error: ['error'],
        draft_load_error: ['error'],

        // Graph
        node_select: ['node_type', 'node_name', 'source'],
        edge_click: ['hero', 'trait', 'edge_role'],
        arc_click: ['hero_a', 'hero_b', 'synergy_category', 'hero_selected'],
        node_tooltip_view: ['node_type', 'node_name'],
        edge_tooltip_view: ['hero', 'trait', 'edge_role'],
        arc_tooltip_view: ['hero_a', 'hero_b', 'synergy_category'],
        synergy_toggle: ['state', 'method', 'hero_selected'],
        names_toggle: ['state'],
        opponent_toggle: ['state'],
        graph_control: ['control', 'method'],
        legend_filter: ['filter_type', 'filter_value', 'state'],
        legend_panel_toggle: ['state', 'control'],
        category_filter: ['filter_value'],
        filter_clear: ['method'],
        search: ['search_term', 'result_count', 'surface'],
        panel_link_click: ['link_kind', 'from_node', 'target_type', 'target_name', 'panel_section'],
        graph_add_to_draft: ['hero', 'draft_action'],
        selection_clear: ['method'],
        node_drag: ['node_type'],
        graph_zoom_gesture: ['control', 'method'],
        history_nav: ['control', 'method'],
        search_suggestion_select: ['surface', 'search_term', 'target_type', 'node_type', 'node_name', 'position'],
        search_no_results: ['surface', 'search_term'],

        // Draft
        tab_view: ['tab', 'method'],
        draft_mode_change: ['mode'],
        draft_format_change: ['format'],
        draft_start: ['format'],
        draft_pick: ['hero', 'format', 'player', 'pick_number', 'method', 'pool_sort', 'pool_rank', 'top_suggestion', 'filters_active'],
        draft_ban: ['hero', 'format', 'player', 'pick_number', 'method', 'pool_sort', 'pool_rank', 'top_suggestion', 'filters_active'],
        draft_complete: ['format', 'band', 'opponent_band', 'bans_mine', 'bans_theirs', 'band_top_percent', 'score_label',
            'roles_covered', 'duration_sec'],
        draft_complete_hero: ['hero', 'side', 'format', 'pick_number'],
        hero_popover_view: ['hero', 'popover_mode', 'pool_rank'],
        analysis_inspect: ['section', 'line_index', 'source'],
        score_factor_open: ['factor'],
        view_in_graph: ['source'],
        cards_open: ['source', 'hero'],
        share: ['method', 'content_type', 'format', 'band'],
        shared_link_open: ['result', 'format', 'band', 'error'],
        draft_reset: ['format', 'picks_made'],
        draft_undo: ['method'],
        draft_fill_band: ['hero', 'band'],
        draft_random: ['surface', 'hero'],
        draft_remove: ['hero', 'format'],
        draft_reorder: ['method'],
        draft_side_change: ['control', 'hero', 'method'],
        draft_blocked: ['error'],
        pool_filter: ['filter_type', 'filter_value', 'state'],
        pool_sort: ['pool_sort'],
        pool_filters_toggle: ['state'],
        popover_action: ['control', 'hero'],
        card_menu_open: ['method', 'hero'],
        card_menu_action: ['control', 'hero'],
        score_info_open: [],
        role_help_open: [],
        analysis_more: ['section', 'state'],
        analysis_focus_switch: ['player'],
        analysis_sheet_toggle: ['state'],
        inspect_card_text: ['state'],
        cards_side_switch: ['side'],
        cards_only: [],

        // Whole site
        tutorial_begin: ['method'],
        intro_tab: ['tab'],
        tutorial_complete: ['open_sec']
    };

    // The properties PostHog receives: empty values dropped, everything else as it is
    function payload(name, params = {}) {
        const allowed = EVENTS[name];
        if (!allowed) throw new Error(`Unknown analytics event: ${name}`);
        const out = {};
        for (const [key, value] of Object.entries(params)) {
            if (!allowed.includes(key)) throw new Error(`${key} is not a param of ${name}`);
            if (value === null || value === undefined || value === '') continue;
            out[key] = value;
        }
        return out;
    }

    // `send(name, params)` is posthog.capture in the browser. A mistake in a tracking call is reported, never thrown at the UI.
    function createTracker({ send, enabled = true, onError = () => {} }) {
        const seen = new Set();
        return {
            track(name, params) {
                if (!enabled) return;
                try {
                    send(name, payload(name, params));
                } catch (error) {
                    onError(error);
                }
            },
            // True the first time `key` is seen in this page load (hover views, solo completions)
            once(key) {
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }
        };
    }

    // Your own testing on a local server stays out of the numbers
    const shouldTrack = hostname => !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])?$/.test(hostname || '');

    // One string per band whatever the pick order, so the same band always counts as the same row
    const bandKey = heroes => [...heroes].sort().join(',');

    const slug = text => String(text || '').toLowerCase().replace(/[0-9]+/g, '').trim()
        .replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '') || null;

    // How the visit started: a shared link, a deep link (search engine, someone's link) or a plain visit
    function entryOf({ search = '', hash = '' }) {
        if (/^#draft\//.test(hash)) return 'draft_share';
        if (hash === '#draft') return 'draft_tab';
        const legacy = /^#graph\/(hero|trait|band)/.exec(hash);
        if (legacy) return `${legacy[1]}_link`;
        const query = /[?&](hero|trait|band)=/.exec(search);
        return query ? `${query[1]}_link` : 'direct';
    }

    // Runs `fn` after `wait` ms unless cancelled; starting again replaces the pending run
    function createDelay({ wait, setTimer = setTimeout, clearTimer = clearTimeout }) {
        let timer = null;
        const cancel = () => {
            if (timer !== null) clearTimer(timer);
            timer = null;
        };
        return {
            start(fn) {
                cancel();
                timer = setTimer(() => { timer = null; fn(); }, wait);
            },
            cancel
        };
    }

    // Search terms are sent once the user stops typing (not per keystroke), never the same term twice in a row
    function createSettledSearch({ wait = 1000, send, setTimer = setTimeout, clearTimer = clearTimeout }) {
        let last = null;
        let pending = null;
        const delay = createDelay({ wait, setTimer, clearTimer });
        const fire = () => {
            const term = pending;
            pending = null;
            if (term && term !== last) {
                last = term;
                send(term);
            }
        };
        return {
            input(text) {
                const term = String(text || '').trim();
                pending = term || null;
                if (pending) delay.start(fire);
                else delay.cancel();
            },
            // The box lost focus: send what was typed now
            flush() {
                delay.cancel();
                fire();
            }
        };
    }

    const sameEntry = (a, b) => a.player === b.player && a.action === b.action && a.hero === b.hero;

    // The pick / ban events between two draft states (one user action). `extra` (method, pool rank…) is added to
    // each. Anything that isn't a step forward (undo, reset, a new format) gives no events.
    function draftEvents(before, after, extra = {}) {
        if (!before || !after || before.format !== after.format) return [];
        const events = [];
        if (after.format === 'solo') {
            if (!before.band.every(h => after.band.includes(h))) return [];
            const added = after.band.filter(h => !before.band.includes(h));
            if (!added.length) return [];
            if (!before.band.length) events.push({ name: 'draft_start', params: { format: after.format } });
            added.forEach(hero => events.push({ name: 'draft_pick', params: {
                hero, format: after.format, player: 1, pick_number: after.band.indexOf(hero) + 1, ...extra } }));
            return events;
        }
        const h = before.history;
        if (after.history.length !== h.length + 1 || !h.every((e, i) => sameEntry(e, after.history[i]))) return [];
        const step = after.history[h.length];
        if (!h.length) events.push({ name: 'draft_start', params: { format: after.format } });
        const count = after.history.filter(e => e.player === step.player && e.action === step.action).length;
        events.push({ name: step.action === 'ban' ? 'draft_ban' : 'draft_pick', params: {
            hero: step.hero, format: after.format, player: step.player, pick_number: count, ...extra } });
        return events;
    }

    const sides = (state, bands) => {
        const me = state.me === 2 ? 2 : 1;
        return { me, mine: bands[me] || [], theirs: bands[me === 1 ? 2 : 1] || [] };
    };

    // The same band (against the same opponents) completed again in one page load is one completion
    function completionKey(state, bands) {
        const { mine, theirs } = sides(state, bands);
        return `${state.format}|${bandKey(mine)}|${bandKey(theirs)}`;
    }

    // A finished draft: the band event, then one event per hero (a row per hero without splitting the band key)
    function completionEvents(state, { bands, bans = { 1: [], 2: [] }, topPercent, scoreLabel, rolesCovered, durationSec }) {
        const { me, mine, theirs } = sides(state, bands);
        const format = state.format;
        const hero = side => (name, i) => ({ name: 'draft_complete_hero', params: { hero: name, side, format, pick_number: i + 1 } });
        return [
            { name: 'draft_complete', params: {
                format, band: bandKey(mine), opponent_band: bandKey(theirs),
                bans_mine: bandKey(bans[me] || []), bans_theirs: bandKey(bans[me === 1 ? 2 : 1] || []),
                band_top_percent: topPercent, score_label: scoreLabel, roles_covered: rolesCovered, duration_sec: durationSec } },
            ...mine.map(hero('mine')),
            ...theirs.map(hero('opponent'))
        ];
    }

    // ?analytics_debug logs the events to the console instead of sending them (to check them on any server)
    const trackingMode = ({ hostname, search = '' }) => (/[?&]analytics_debug\b/.test(search) ? 'console'
        : shouldTrack(hostname) ? 'posthog' : 'off');

    // The page's tracker, shared by both tabs: events go to PostHog (index.html) on the live site only
    let page = null;
    function pageTracker() {
        const mode = trackingMode(root.location || {});
        page = page || createTracker({
            send: mode === 'console' ? (name, params) => console.info('[analytics]', name, JSON.stringify(params))
                : (name, params) => { if (root.posthog && typeof root.posthog.capture === 'function') root.posthog.capture(name, params); },
            enabled: mode !== 'off',
            onError: error => console.warn('Analytics:', error.message)
        });
        return page;
    }

    const added = (from, to) => to.filter(h => !from.includes(h));

    // Edits to a draft besides picks and bans (draftEvents): who you face or exclude, carried-over bans, and the
    // solo band losing a hero or changing order. `extra.method` says how (menu, picker, drag, chip, button, keyboard).
    function draftChanges(before, after, extra = {}) {
        if (!before || !after || before.format !== after.format) return [];
        const events = [];
        const side = (list, from = [], to = []) => {
            added(from, to).forEach(hero => events.push({ name: 'draft_side_change', params: { control: `${list}_add`, hero, ...extra } }));
            added(to, from).forEach(hero => events.push({ name: 'draft_side_change', params: { control: `${list}_remove`, hero, ...extra } }));
        };
        if (after.format !== 'solo') {
            side('carry_over', before.carryOverBans, after.carryOverBans);
            return events;
        }
        side('enemy', before.enemies, after.enemies);
        side('exclude', before.excluded, after.excluded);
        const gone = added(after.band, before.band);
        if (gone.length === 1 && after.band.length === before.band.length - 1) {
            events.push({ name: 'draft_remove', params: { hero: gone[0], format: after.format } });
        } else if (!gone.length && after.band.length === before.band.length && after.band.some((h, i) => h !== before.band[i])) {
            events.push({ name: 'draft_reorder', params: { ...extra } });
        }
        return events;
    }

    // Graph history: moving to a lower position is back
    const navDirection = (from, to) => (typeof from !== 'number' || typeof to !== 'number' || from === to ? null
        : to < from ? 'back' : 'forward');

    // A d3-zoom gesture from its source event (null for zooms the app makes itself: fit, centre, buttons)
    function gestureOf(event) {
        if (!event || !event.type) return null;
        if (event.type === 'wheel') return { control: 'zoom', method: 'wheel' };
        if (event.type.startsWith('touch')) return { control: event.touches && event.touches.length > 1 ? 'zoom' : 'pan', method: 'touch' };
        if (event.type.startsWith('mouse')) return { control: 'pan', method: 'mouse' };
        return null;
    }

    const api = {
        draftChanges, navDirection, gestureOf,
        EVENTS, payload, createTracker, pageTracker, trackingMode, shouldTrack, bandKey, slug, entryOf,
        createDelay, createSettledSearch, draftEvents, completionKey, completionEvents
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.Analytics = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
