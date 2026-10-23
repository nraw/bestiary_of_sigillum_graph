// Draft tab: DOM rendering and interaction for the draft assistant.
// All draft rules and scoring live in draft.js; draft-view.js turns them into the view object
// this file draws (both unit tested). Only DOM, events and persistence live here.
(function () {
    const Draft = window.Draft;
    const { draftView, referenceSides, graphAction, rollFrames, inspectView, sortPool, percentLabel, percentExplain, ROLE_INFO, TOPICS, collapse } = window.DraftView;
    const { encodeDraft, decodeDraft, isDraftLink } = window.DraftShare;
    const { escapeHtml, vitalityTokensSvg, ATTRIBUTES, attributeGlyph } = window.GraphLogic;
    const { titleCase } = window.Synergy;
    const { isLegacyRoute } = window.GraphRoute;
    const Intro = window.Intro;

    const STORAGE_KEY = 'bestiary-draft-v1';
    const FORMAT_INFO = {
        standard: { label: 'Standard', hint: 'Alternate picks until each player has 3' },
        'ban-first': { label: 'Ban phase first', hint: 'Each player bans 3, alternating, then picks' },
        interleaved: { label: 'Interleaved', hint: 'Ban 1 each, pick 1 each, three times' }
    };
    const LIST_LIMIT = 3; // grouped lists show this many before "Show N more"
    const HOVER_LINES = 2; // lines per section in the hover popover (the pinned one shows all)
    const CHIP_ICON = { synergy: '✦', counter: '⚔', warning: '⚠' };
    const REASON_BADGE = { banned: 'Banned', player1: 'Player 1', player2: 'Player 2' };

    const ICON = {
        Controller: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
        Attacker: '<path d="M5 5l11 11M19 5 8 16"/><path d="M14 18l4-4M6 14l4 4"/>',
        Supporter: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M7.5 12h9"/>',
        Dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><g fill="currentColor" stroke="none"><circle cx="8.3" cy="8.3" r="1.5"/><circle cx="15.7" cy="8.3" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="8.3" cy="15.7" r="1.5"/><circle cx="15.7" cy="15.7" r="1.5"/></g>'
    };
    // Attributes draw the official card-banner emblem (graph-logic.js), the rest come from ICON
    const icon = (name, cls = 'ico') => ATTRIBUTES.includes(name) ? attributeGlyph(name, cls)
        : `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

    let ctx = null;
    let view = null;
    let shown = null; // the view on screen (a hover preview or `view`)
    const ui = {
        tab: 'graph',
        draft: Draft.createDraft('standard'),
        // roles combine with OR; pills: terms chosen from the search dropdown, all required
        filters: { term: '', pills: [], attribute: 'All', roles: [], fills: false, showUnavailable: false },
        sort: 'recommended',
        focus: null, // two-player analysis: null follows whoever acts, or a chosen player
        picker: null,
        expanded: {}, // "Show N more" lists that are open; reset when the band changes
        expandKey: null,
        shared: null, // { state, code }: a draft opened from a shared link (read-only, shown in the cards modal)
        cardSide: '1', // reference cards: whose cards are shown
        cardHero: null, // reference cards: a single hero's card, opened from the pool
        pop: null, // hero shown in the tile popover
        pinned: false, // desktop: the popover was pinned (⋯ menu, right-click, I) and can be clicked
        inspect: null // the inspector's heroes for View in graph: { mine, theirs }
    };

    const $ = id => document.getElementById(id);
    // PostHog events (analytics.js, plan: docs/analytics-tracking-plan.md)
    const analytics = window.Analytics.pageTracker();
    const track = analytics.track;
    const popoverDelay = window.Analytics.createDelay({ wait: 700 });
    let startedAt = null; // when the current draft's first pick / ban was made
    const poolSearchTrack = window.Analytics.createSettledSearch({
        send: term => {
            const count = view.pool.filter(poolFilter).length;
            track('search', { search_term: term, result_count: count, surface: 'pool' });
            if (!count) track('search_no_results', { search_term: term, surface: 'pool' });
        }
    });
    const state = () => ui.draft;
    const display = name => titleCase(name);
    const portrait = (name, cls = 'portrait') =>
        `<img class="${cls}" src="hero_images/${name.toLowerCase()}.png" alt="" loading="lazy" draggable="false">`;
    const heroOf = name => ctx.byName.get(name);
    // Portrait with the hero's vitality as a stack of heart tokens, as on the graph
    const tokenPortrait = (name, cls) =>
        `<span class="portrait-wrap">${portrait(name, cls)}${vitalityTokensSvg(heroOf(name).vitality)}</span>`;
    // `fills`: roles this hero would add to the band; the others are dimmed (already covered)
    const rolePills = (roles, fills = roles) => `<span class="role-pills">${roles.map(r => {
        const adds = fills.includes(r);
        const label = `${adds ? r : `${r} (already covered in this band)`}: ${ROLE_INFO[r]}`;
        return `<span class="role-pill role--${r}${adds ? '' : ' is-covered'}" title="${label}">${icon(r)}<span class="sr-only">${label}</span></span>`;
    }).join('')}</span>`;
    const narrow = () => window.matchMedia('(max-width: 600px), (hover: none)').matches;
    // How much a section or row weighs: up to 5 dots (draft-view.js strength), or a warning
    const dots = st => (st.warning ? '<span class="dots dots--warning" title="Costs points">⚠</span>'
        : st.dots ? `<span class="dots" title="Weight ${st.dots} of 5" aria-label="Weight ${st.dots} of 5">${'●'.repeat(st.dots)}<span class="dots-off">${'●'.repeat(5 - st.dots)}</span></span>` : '');

    // One reason line; its bullet is coloured by topic (synergy, support, roles…)
    const lineItem = (l, inner) => `<li class="reason reason--${l.kind} topic--${l.topic}${l.preview ? ' is-changed' : ''}"
        title="${escapeHtml(TOPICS[l.topic].label)}">${inner}${l.preview ? ' <span class="syn-new">(preview)</span>' : ''}</li>`;

    // A section of reasons (draft-view.js popoverSections), drawn the same in the tile popover and the band analysis.
    // `interactive`: the heading and each line open the inspector; `limit`: lines shown before "+N more" (a "Show N more"
    // button when `moreKey` is set); `heading`: the heading element when not interactive
    function sectionHtml(x, { interactive, limit = Infinity, moreKey = null, heading = 'h4' }) {
        const c = collapse(x.lines, limit, Boolean(moreKey && ui.expanded[moreKey]));
        const head = `<span class="pop-sec-label">${escapeHtml(x.label)}</span>${dots(x.strength)}`;
        const id = moreKey ? ` id="more-${moreKey}"` : '';
        return `<section class="pop-section pop-section--${x.kind} pop-group--${x.group}">
            ${interactive ? `<button type="button" class="pop-sec-head" data-inspect="${escapeHtml(x.key)}"
                aria-label="Inspect: ${escapeHtml(x.title)}">${head}<span class="pop-inspect"><span class="pop-inspect-word">Inspect </span>›</span></button>`
                : `<${heading} class="pop-sec-head">${head}</${heading}>`}
            <ul class="reason-list"${id}>${c.items.map((l, i) => lineItem(l, interactive
                ? `<button type="button" class="pop-line" data-inspect="${escapeHtml(x.key)}" data-line="${i}">${escapeHtml(l.text)}</button>`
                : escapeHtml(l.text))).join('')}</ul>
            ${!c.hidden ? '' : moreKey
                ? `<button class="link-btn more-btn" type="button" data-more="${moreKey}" aria-controls="more-${moreKey}" aria-expanded="${c.expanded}">
                    ${c.expanded ? 'Show fewer' : `Show ${c.hidden} more`}</button>`
                : `<p class="pop-more">+${c.hidden} more</p>`}
        </section>`;
    }

    // Which bullet colours mean what, for the topics on screen
    const topicLegend = sections => {
        const topics = [...new Set(sections.flatMap(x => x.lines.filter(l => l.kind === 'positive').map(l => l.topic)))];
        return topics.length > 1 ? `<p class="topic-legend">${topics.map(t =>
            `<span class="topic--${t}"><span class="topic-dot" aria-hidden="true">✦</span>${escapeHtml(TOPICS[t].label)}</span>`).join('')}</p>` : '';
    };
    const banner = attribute =>
        `<span class="attr-banner attr--${attribute}" title="${attribute}">${icon(attribute)}<span class="sr-only">${attribute}</span></span>`;

    // ---- Setup ---------------------------------------------------------------------------

    async function init() {
        try {
            const response = await fetch('bestiary_reference_cards.json');
            const data = await response.json();
            ctx = Draft.createContext(data.bestiary_of_sigillum.characters);
            restore();
            const hash = location.hash;
            const shared = isDraftLink(hash);
            setupTabs();
            setupStatic();
            render();
            setTab(shared || hash === '#draft' ? 'draft' : 'graph', { focus: false, via: 'init' });
            if (shared) openSharedLink(hash);
            setupIntro(hash);
            window.addEventListener('hashchange', () => {
                const link = location.hash;
                if (!isDraftLink(link)) return;
                setTab('draft', { focus: false, via: 'link' });
                openSharedLink(link);
            });
            // Back / forward onto a graph selection shows the graph (script.js applies the selection)
            window.addEventListener('popstate', () => {
                if (ui.tab === 'draft' && (!location.hash || isLegacyRoute(location.hash))) setTab('graph', { focus: false, via: 'history' });
            });
            document.addEventListener('bestiary:selection', event => {
                ui.graphHero = event.detail.hero;
                renderGraphAction();
            });
            ui.graphHero = window.BestiaryGraph?.selectedHero ?? null; // the graph may have loaded first
            renderGraphAction();
            // Reference cards come from the graph's card renderer once its data has loaded
            document.addEventListener('bestiary:graph-ready', () => { if ($('cardsDialog').open) renderCards(); });
        } catch (error) {
            console.error('Draft assistant failed to load:', error);
            track('draft_load_error', { error: error.message });
        }
    }

    function restore() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            // Older saves kept a "Build my band" band next to the draft (`states`); only the draft carries over
            const draft = saved?.draft || saved?.states?.['two-player'];
            if (draft && Draft.DRAFT_FORMATS.includes(draft.format) && Array.isArray(draft.history)) ui.draft = draft;
        } catch (error) {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    function persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ draft: ui.draft }));
        } catch (error) { /* storage full or disabled: drafting still works */ }
    }

    // A shared link opens its reference cards read-only and never overwrites the visitor's own draft
    function openSharedLink(hash) {
        const { state: shared, error } = decodeDraft(hash, ctx.heroes);
        const problem = error || (Draft.isComplete(shared) ? null : 'This shared draft is not finished yet.');
        track('shared_link_open', problem ? { result: 'error', error: problem }
            : { result: 'ok', format: shared.format, band: window.Analytics.bandKey(Draft.myBand(shared)) });
        if (problem) {
            history.replaceState(history.state, '', `${location.pathname}#draft`);
            toast(`Could not open the shared draft: ${problem}`);
            return;
        }
        ui.shared = { state: shared, code: hash.replace(/^#/, '') };
        history.replaceState(history.state, '', `${location.pathname}#${ui.shared.code}`);
        openCards({ source: 'shared_link' });
    }

    // ---- Tabs ----------------------------------------------------------------------------

    // `via`: how the tab was reached, for analytics ('init' is the page opening, not a switch)
    function setTab(tab, { focus = true, via = 'other' } = {}) {
        if (ui.tab !== tab && via !== 'init') track('tab_view', { tab, method: via });
        ui.tab = tab;
        document.body.dataset.tab = tab;
        $('graphView').hidden = tab !== 'graph';
        $('draftView').hidden = tab !== 'draft';
        [['tabGraph', 'graph'], ['tabDraft', 'draft']].forEach(([id, name]) => {
            $(id).setAttribute('aria-selected', String(tab === name));
            $(id).tabIndex = tab === name ? 0 : -1;
        });
        const skip = document.querySelector('.skip-link'); // points at the visible view
        skip.href = tab === 'graph' ? '#graph' : '#bandHeading';
        skip.textContent = tab === 'graph' ? 'Skip to network graph' : 'Skip to your band';
        // The Draft tab's address drops the graph's ?hero= selection (the graph tab writes it back)
        const draftHash = `${location.pathname}${ui.shared ? `#${ui.shared.code}` : '#draft'}`;
        // The graph tab shows its selection's link (before the graph has loaded: the link it was opened with)
        const graph = window.BestiaryGraph;
        const graphUrl = graph?.ready ? graph.routeUrl()
            : isLegacyRoute(location.hash) ? location.hash : location.pathname + location.search;
        history.replaceState(history.state, '', tab === 'draft' ? draftHash : graphUrl);
        if (tab === 'graph') window.BestiaryGraph?.refit();
        if (focus) $(tab === 'graph' ? 'tabGraph' : 'tabDraft').focus();
    }

    function setupTabs() {
        $('tabGraph').addEventListener('click', () => setTab('graph', { via: 'click' }));
        $('tabDraft').addEventListener('click', () => setTab('draft', { via: 'click' }));
        document.querySelector('.tabs').addEventListener('keydown', event => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            setTab(ui.tab === 'graph' ? 'draft' : 'graph', { via: 'keyboard' });
        });
        $('addToDraft').addEventListener('click', addFromGraph);
        $('backToDraft').addEventListener('click', () => {
            window.BestiaryGraph?.clearBand();
            setTab('draft', { via: 'back_to_draft' });
        });
    }

    // ---- First-visit intro -----------------------------------------------------------------

    function setupIntro(hash) {
        const dialog = $('introDialog');
        const storage = (() => { try { return window.localStorage; } catch (error) { return null; } })();
        let openedAt = null;
        const open = method => {
            if (dialog.open) return;
            openedAt = Date.now();
            track('tutorial_begin', { method });
            dialog.showModal();
        };
        $('introOpen').addEventListener('click', () => open('help_button'));
        dialog.addEventListener('close', () => {
            Intro.markIntroSeen(storage);
            if (openedAt) track('tutorial_complete', { open_sec: Math.round((Date.now() - openedAt) / 1000) });
            openedAt = null;
        });
        dialog.addEventListener('click', event => {
            const tab = event.target.closest('[data-intro-tab]')?.dataset.introTab;
            const r = dialog.getBoundingClientRect();
            const outside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
            if (event.target === dialog && outside) dialog.close(); // backdrop click
            if (!tab) return;
            track('intro_tab', { tab });
            dialog.close();
            setTab(tab, { via: 'intro' });
        });
        if (Intro.shouldShowIntro({ seen: Intro.introSeen(storage), hash, search: location.search })) open('auto_first_visit');
    }

    // ---- Static controls -----------------------------------------------------------------

    function setupStatic() {
        $('attributeFilter').innerHTML = ['All', ...ATTRIBUTES].map(a =>
            `<button class="chip${a === 'All' ? '' : ` chip--${a}`}" type="button" data-attribute="${a}" aria-pressed="${a === 'All'}">
                ${a === 'All' ? '' : icon(a)}${a}</button>`).join('');
        $('roleFilter').innerHTML = Draft.BATTLE_ROLES.map(r =>
            `<button class="chip" type="button" data-role="${r}" aria-pressed="false" title="${escapeHtml(ROLE_INFO[r])}">${icon(r)}${r}</button>`).join('');

        $('roleDefs').innerHTML = Draft.BATTLE_ROLES.map(r =>
            `<dt>${icon(r, 'ico role-ico')}${r}</dt><dd>${escapeHtml(ROLE_INFO[r])}</dd>`).join('');

        $('attributeFilter').addEventListener('click', event => {
            const chip = event.target.closest('[data-attribute]');
            if (!chip) return;
            ui.filters.attribute = chip.dataset.attribute;
            track('pool_filter', { filter_type: 'attribute', filter_value: chip.dataset.attribute, state: 'on' });
            renderPool();
        });
        $('roleFilter').addEventListener('click', event => {
            const chip = event.target.closest('[data-role]');
            if (!chip) return;
            const role = chip.dataset.role;
            const roles = ui.filters.roles;
            ui.filters.roles = roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role];
            track('pool_filter', { filter_type: 'role', filter_value: role, state: roles.includes(role) ? 'off' : 'on' });
            renderPool();
        });
        setupPoolSearch();
        $('filtersToggle').addEventListener('click', () => {
            const open = $('poolFilters').classList.toggle('is-open');
            $('filtersToggle').setAttribute('aria-expanded', String(open));
            track('pool_filters_toggle', { state: open ? 'open' : 'closed' });
        });
        $('randomHero').innerHTML = icon('Dice');
        $('randomHero').addEventListener('click', () => rollRandom('pool'));
        const toggleFilter = (key, type) => event => {
            ui.filters[key] = event.target.checked;
            track('pool_filter', { filter_type: type, state: event.target.checked ? 'on' : 'off' });
            renderPool();
        };
        $('fillsToggle').addEventListener('change', toggleFilter('fills', 'fills_missing_role'));
        $('unavailableToggle').addEventListener('change', toggleFilter('showUnavailable', 'show_unavailable'));

        $('undoBtn').addEventListener('click', () => doUndo('button'));
        $('resetBtn').addEventListener('click', doReset);
        $('sequence').addEventListener('click', event => {
            if (event.target.closest('[data-act="add-extra"]')) openPicker('carry');
            const name = event.target.closest('[data-remove-extra]')?.dataset.removeExtra;
            if (name) setCarryOver(state().carryOverBans.filter(n => n !== name), 'chip');
        });
        document.querySelector('.sort-switch').addEventListener('click', event => {
            const button = event.target.closest('[data-sort]');
            if (button && button.dataset.sort !== ui.sort) track('pool_sort', { pool_sort: button.dataset.sort });
            if (button) { ui.sort = button.dataset.sort; renderStep(); renderPool(); }
        });
        $('focusSwitch').addEventListener('click', event => {
            const button = event.target.closest('[data-focus]');
            if (button) { ui.focus = Number(button.dataset.focus); track('analysis_focus_switch', { player: ui.focus }); render(); }
        });
        $('viewInGraph').addEventListener('click', () => {
            track('view_in_graph', { source: 'analysis' });
            setTab('graph', { via: 'view_in_graph' });
            const bands = Draft.bands(state());
            window.BestiaryGraph?.showBand(bands[view.focus], bands[view.focus === 1 ? 2 : 1]);
        });

        // A hero in a band opens its reference card; its own buttons keep their actions
        $('draftMain').addEventListener('click', event => {
            const card = event.target.closest('[data-card]');
            if (card && !event.target.closest('button')) openCards({ hero: card.dataset.card, source: 'band_slot' });
        });
        $('draftMain').addEventListener('keydown', event => {
            if ((event.key === 'Enter' || event.key === ' ') && event.target.dataset.card) {
                event.preventDefault();
                openCards({ hero: event.target.dataset.card, source: 'band_slot' });
            }
        });

        $('draftBar').addEventListener('click', () => setSheet(!$('analysisPanel').classList.contains('is-open')));
        $('analysisClose').addEventListener('click', () => setSheet(false));
        // A tap outside the sheet (and its bar) closes it
        document.addEventListener('click', event => {
            if ($('analysisPanel').classList.contains('is-open')
                && !event.target.closest('#analysisPanel, #draftBar, dialog')) setSheet(false);
        });
        $('openMatch').addEventListener('click', () => openCards({ source: 'complete_button' }));
        $('roleHelp').addEventListener('toggle', () => { if ($('roleHelp').open) track('role_help_open'); });
        $('draftView').addEventListener('click', event => {
            const more = event.target.closest('[data-more]');
            if (!more) return;
            ui.expanded[more.dataset.more] = !ui.expanded[more.dataset.more];
            track('analysis_more', { section: more.dataset.more, state: ui.expanded[more.dataset.more] ? 'open' : 'closed' });
            renderAnalysis(shown);
            document.querySelector(`[data-more="${more.dataset.more}"]`)?.focus();
        });

        setupPool();
        setupPopover();
        setupInspect();
        setupSlots();
        setupBeats();
        setupCards();
        setupPicker();
        setupMenu();
        setupKeys();
    }

    // ---- Actions -------------------------------------------------------------------------

    function commit(next, message) {
        ui.draft = next;
        ui.focus = null;
        render();
        if (message) announce(message);
    }

    // Run an engine transition; a rule violation (e.g. a hero already taken) is reported, not thrown.
    // `how.method` (menu, picker, drag, chip, button, keyboard) goes with the edit's analytics event.
    function attempt(fn, message, how = {}) {
        const before = state();
        try {
            commit(fn(before), typeof message === 'function' ? message() : message);
        } catch (error) {
            track('draft_blocked', { error: error.message });
            announce(error.message);
            toast(error.message);
            return;
        }
        window.Analytics.draftChanges(before, state(), how).forEach(e => track(e.name, e.params));
    }

    // `method`: what the user did to pick (tile, popover, menu, drag, random, graph, picker), for analytics
    function primaryAction(name, { method } = {}) {
        const step = Draft.currentStep(state());
        if (!step) return;
        const done = step.action === 'ban' ? 'banned' : 'selected';
        const verb = `Player ${step.player} ${done}`;
        const before = state();
        const extra = pickContext(name, method); // the pool as the user saw it when choosing
        attempt(s => Draft.applyAction(s, name), () => `${verb} ${display(name)}. ${summary()}`);
        trackDraft(before, extra);
    }

    function pickContext(name, method) {
        const rank = view.pool.find(p => p.name === name)?.suggestion?.rank;
        const f = ui.filters;
        return { method, pool_sort: ui.sort, pool_rank: rank, top_suggestion: rank === undefined ? undefined : rank === 1,
            filters_active: Boolean(f.term.trim() || f.pills.length || f.attribute !== 'All' || f.roles.length || f.fills) };
    }

    // Pick / ban / start events for one user action, and the finished band once the draft completes
    function trackDraft(before, extra) {
        const after = state();
        const events = window.Analytics.draftEvents(before, after, extra);
        events.forEach(e => {
            if (e.name === 'draft_start') startedAt = Date.now();
            track(e.name, e.params);
        });
        if (events.length && Draft.isComplete(after)) trackComplete(after);
    }

    function trackComplete(s) {
        const bands = Draft.bands(s);
        if (!analytics.once(`complete|${window.Analytics.completionKey(s, bands)}`)) return;
        const { analysis } = draftView(s, ctx, { player: s.me });
        const percent = analysis.score.percent;
        window.Analytics.completionEvents(s, {
            bands, bans: Draft.bans(s),
            topPercent: typeof percent === 'number' ? Math.round(percent * 100) / 100 : undefined,
            scoreLabel: analysis.score.label, rolesCovered: analysis.coveredCount,
            durationSec: startedAt ? Math.round((Date.now() - startedAt) / 1000) : undefined
        }).forEach(e => track(e.name, e.params));
    }

    // The graph's button for its selected hero: pick / ban it at the current step, then back to the draft
    function renderGraphAction() {
        const button = $('addToDraft');
        button.hidden = !ui.graphHero;
        if (!ui.graphHero) return;
        const { label, enabled } = graphAction(state(), ui.graphHero);
        button.textContent = enabled ? `+ ${label}` : label;
        button.disabled = !enabled;
        button.title = `${display(ui.graphHero)}: ${label}`;
    }

    function addFromGraph() {
        const name = ui.graphHero;
        if (!name || !Draft.currentStep(state())) return;
        track('graph_add_to_draft', { hero: name, draft_action: Draft.currentStep(state()).action });
        primaryAction(name, { method: 'graph' });
        if (!Draft.isAvailable(state(), name)) setTab('draft', { via: 'graph_add' }); // otherwise refused: primaryAction reported why
    }

    function summary() {
        const v = draftView(state(), ctx);
        return `Band covers ${v.analysis.coveredCount} of 3 roles, ${v.analysis.score.label}.`;
    }

    function doUndo(method) {
        const before = state();
        const after = Draft.undo(before);
        if (after === before) return;
        track('draft_undo', { method });
        commit(after, 'Undone.');
    }

    // No confirmation: reset is an undo step, so Undo and Ctrl/⌘+Z bring the draft back
    function doReset() {
        const s = state();
        track('draft_reset', { format: s.format, picks_made: s.history.length });
        const cleared = Draft.reset(s);
        commit(cleared, 'Cleared. Undo restores it.');
        toast('Cleared. Undo (Ctrl/⌘+Z) restores it.', { label: 'Undo', run: () => {
            if (state() === cleared) doUndo('toast');
        } });
    }

    function announce(text) {
        $('draftLive').textContent = '';
        requestAnimationFrame(() => { $('draftLive').textContent = text; });
    }

    let toastTimer;
    function toast(text, action) {
        const el = $('draftToast');
        el.innerHTML = `<span>${escapeHtml(text)}</span>${action ? `<button class="link-btn" type="button">${action.label}</button>` : ''}`;
        el.hidden = false;
        if (action) el.querySelector('button').addEventListener('click', () => { action.run(); el.hidden = true; });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
    }

    // ---- Render --------------------------------------------------------------------------

    function render() {
        view = draftView(state(), ctx, { player: ui.focus });
        shown = view;
        previewKey = null;
        const bands = Draft.bands(state());
        const key = `${bands[view.focus].join('|')}:${bands[view.focus === 1 ? 2 : 1].join('|')}`;
        if (key !== ui.expandKey) { ui.expandKey = key; ui.expanded = {}; }
        hidePopover();
        renderSetup();
        renderSequence();
        renderPool();
        renderSlots(view);
        renderStep();
        renderGraphAction();
        renderAnalysis(view);
        renderBar();
        $('undoBtn').disabled = Draft.undo(state()) === state();
        persist();
    }

    // Hover / focus preview: only the band slots and the analysis change
    let previewKey = null;
    function preview(heroes) {
        const key = heroes ? [].concat(heroes).join('|') : null;
        if (key === previewKey) return;
        previewKey = key;
        shown = heroes ? draftView(state(), ctx, { preview: heroes, player: ui.focus }) : view;
        renderSlots(shown);
        renderAnalysis(shown);
    }

    // Phones: the sticky bar shows the band at a glance and opens Band Analysis as a bottom sheet
    function renderBar() {
        const bands = Draft.bands(state());
        const band = bands[view.focus];
        const faces = [0, 1, 2].map(i => band[i]
            ? `<span class="bar-face attr--${heroOf(band[i]).attribute}">${portrait(band[i], 'bar-portrait')}</span>`
            : '<span class="bar-face is-empty"></span>').join('');
        const a = view.analysis;
        $('draftBar').innerHTML = `<span class="bar-step">${escapeHtml(view.step.label)}</span>
            <span class="bar-faces" aria-hidden="true">${faces}</span>
            <span class="bar-roles">${a.coveredCount}/3 roles</span>
            <span class="bar-score" title="${escapeHtml(percentExplain(a.score.percent))}">${a.score.percent === null ? '—' : percentLabel(a.score.percent)}</span>
            <span class="bar-open" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg></span>
            <span class="sr-only">Open band analysis</span>`;
    }

    function setSheet(open) {
        if (open !== $('analysisPanel').classList.contains('is-open')) track('analysis_sheet_toggle', { state: open ? 'open' : 'closed' });
        $('analysisPanel').classList.toggle('is-open', open);
        $('draftBar').setAttribute('aria-expanded', String(open));
        if (open) $('analysisClose').focus();
    }

    function renderSetup() {
        const el = $('twoPlayerSetup');
        const s = state();
        $('draftMain').classList.toggle('is-started', s.history.length > 0);
        if (s.history.length) {
            el.innerHTML = `<p class="setup-summary">${FORMAT_INFO[s.format].label} · Player 1 starts${s.carryOverBans.length
                ? ` · ${s.carryOverBans.length} carried-over ban${s.carryOverBans.length > 1 ? 's' : ''}` : ''}</p>`;
            return;
        }
        el.innerHTML = `
            <fieldset class="setup-group"><legend>Format</legend>
                ${Object.entries(FORMAT_INFO).map(([id, f]) => `
                    <label class="radio-card"><input type="radio" name="format" value="${id}" ${s.format === id ? 'checked' : ''}>
                        <span><strong>${f.label}</strong><small>${f.hint}</small></span></label>`).join('')}
            </fieldset>`;
        el.onchange = event => {
            const format = el.querySelector('[name=format]:checked').value;
            track('draft_format_change', { format });
            commit(Draft.createDraft(format, { carryOverBans: state().carryOverBans }));
            if (event.target.name) el.querySelector(`[name=${event.target.name}]:checked`).focus();
        };
    }

    function renderSequence() {
        const el = $('sequence');
        el.hidden = !view.sequence;
        if (!view.sequence) return;
        // Extra (carry-over) bans lead the row; they can be changed until the draft starts
        const editable = !state().history.length;
        const extras = view.carryOverBans.map(n => `
            <li class="seq-step seq--extra" title="Extra ban: ${escapeHtml(display(n))}">
                <span class="seq-action">Extra ban</span>
                <span class="seq-who">${escapeHtml(display(n))}${editable
                    ? ` <button type="button" class="seq-remove" data-remove-extra="${n}" aria-label="Remove extra ban ${escapeHtml(display(n))}">✕</button>` : ''}</span>
            </li>`).join('');
        const add = editable ? '<li class="seq-add-item"><button type="button" class="seq-add" data-act="add-extra">+ Add extra bans</button></li>' : '';
        el.innerHTML = extras + view.sequence.map(s => `
            <li class="seq-step seq--${s.status} seq--p${s.player} seq--${s.action}"
                ${s.status === 'current' ? 'aria-current="step"' : ''}
                title="Player ${s.player}: ${s.action}${s.hero ? ` · ${display(s.hero)}` : ''}">
                <span class="seq-action">P${s.player} ${s.action === 'ban' ? 'Ban' : 'Pick'}</span>
                <span class="seq-who">${s.hero ? escapeHtml(display(s.hero)) : '—'}</span>
            </li>`).join('') + add;
        // One scrolling row: keep the current step in view
        const current = el.querySelector('[aria-current="step"]');
        if (current) el.scrollLeft = current.offsetLeft - el.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
    }

    // ---- Pool ----------------------------------------------------------------------------

    // Every filter but the typed search term (pills included)
    function otherFilters(entry) {
        const f = ui.filters;
        if (!entry.available && !f.showUnavailable) return false;
        if (!window.poolHasPills(entry, f.pills)) return false;
        if (f.attribute !== 'All' && entry.attribute !== f.attribute) return false;
        if (f.roles.length && !f.roles.some(r => entry.battleRoles.includes(r))) return false;
        return !(f.fills && !entry.fills.length); // adds no role the band lacks
    }
    const poolFilter = entry => otherFilters(entry) && window.poolMatches(entry, ui.filters.term);

    // ---- Pool search: a dropdown like the graph's, showing what each term finds ----------------

    const poolSearch = { items: [], active: -1 };
    const KIND_LABEL = { attribute: 'attribute', size: 'size', range: 'attack', role: 'role', trait: 'trait' };

    function highlight(text, term) {
        const i = text.toLowerCase().indexOf(term.toLowerCase());
        if (i < 0 || /^#?\d+$/.test(term)) return escapeHtml(text);
        return `${escapeHtml(text.slice(0, i))}<mark>${escapeHtml(text.slice(i, i + term.length))}</mark>${escapeHtml(text.slice(i + term.length))}`;
    }

    function suggestionHtml(item, i, term) {
        const glyph = item.type === 'hero' ? portrait(item.name, '')
            : ICON[item.label] ? `<span class="sugg-glyph">${icon(item.label)}</span>` : '<span class="sugg-glyph" aria-hidden="true">✦</span>';
        const shown = item.type === 'term' ? item.heroes.slice(0, 4).map(display).join(', ') + (item.count > 4 ? ` +${item.count - 4}` : '') : '';
        return `<li role="option" id="pool-sugg-${i}" data-index="${i}" aria-selected="false">${glyph}
            <span class="sugg-name">${highlight(item.label, term)}${shown ? `<small class="sugg-heroes">${escapeHtml(shown)}</small>` : ''}</span>
            <span class="sugg-type">${item.type === 'hero' ? `#${item.id}` : `${KIND_LABEL[item.kind]} · ${item.count}`}</span></li>`;
    }

    function closePoolSuggestions() {
        $('poolSuggestions').hidden = true;
        $('poolSearch').setAttribute('aria-expanded', 'false');
        $('poolSearch').removeAttribute('aria-activedescendant');
        poolSearch.active = -1;
    }

    // Counts are of the heroes the other filters leave in the pool
    function updatePoolSuggestions() {
        const term = $('poolSearch').value.trim();
        if (!term) { closePoolSuggestions(); return; }
        poolSearch.items = window.poolSuggestions(view.pool.filter(otherFilters), term, 8, { exclude: ui.filters.pills });
        poolSearch.active = -1;
        $('poolSuggestions').innerHTML = poolSearch.items.length
            ? poolSearch.items.map((item, i) => suggestionHtml(item, i, term)).join('')
            : '<li class="no-results" role="option" aria-disabled="true">No heroes, traits or roles match</li>';
        $('poolSuggestions').hidden = false;
        $('poolSearch').setAttribute('aria-expanded', 'true');
    }

    function setPoolSuggestion(index) {
        poolSearch.active = index;
        document.querySelectorAll('#poolSuggestions [role="option"]').forEach((li, i) => {
            li.setAttribute('aria-selected', String(i === index));
            if (i === index) li.scrollIntoView({ block: 'nearest' });
        });
        $('poolSearch').setAttribute('aria-activedescendant', `pool-sugg-${index}`);
    }

    // A chosen hero is picked / banned (like clicking its tile) when the turn allows it, otherwise searched by
    // name; a chosen term becomes a pill. The box clears for the next search
    function choosePoolSuggestion(item) {
        track('search_suggestion_select', { surface: 'pool', search_term: $('poolSearch').value.trim(),
            target_type: item.type === 'hero' ? 'hero' : item.kind, node_name: item.type === 'hero' ? item.name : item.label,
            position: poolSearch.items.indexOf(item) + 1 || undefined });
        if (item.type === 'hero' && Draft.currentStep(state()) && Draft.isAvailable(state(), item.name)) {
            closePoolSuggestions();
            primaryAction(item.name, { method: 'search' }); // before clearing, so filters_active sees the search
            $('poolSearch').value = '';
            ui.filters.term = '';
            renderPool();
            return;
        }
        if (item.type === 'term') {
            ui.filters.pills = [...ui.filters.pills, item.label];
            announce(`Filter added: ${item.label}`);
        }
        $('poolSearch').value = item.type === 'term' ? '' : item.label;
        ui.filters.term = $('poolSearch').value;
        closePoolSuggestions();
        renderPool();
    }

    function removePill(label) {
        track('pool_filter', { filter_type: 'pill', filter_value: label, state: 'off' });
        ui.filters.pills = ui.filters.pills.filter(p => p !== label);
        announce(`Filter removed: ${label}`);
        renderPool();
    }

    function renderPills() {
        const kindOf = label => view.pool.flatMap(e => e.terms).find(t => t.text === label)?.kind;
        $('poolPills').hidden = !ui.filters.pills.length;
        $('poolPills').innerHTML = ui.filters.pills.map(label => `<button class="chip search-pill" type="button" data-pill="${escapeHtml(label)}"
            aria-label="Remove filter ${escapeHtml(label)}" title="Remove this filter">${ICON[label] ? icon(label) : ''}${escapeHtml(label)}
            <span class="search-pill-kind">${KIND_LABEL[kindOf(label)] || ''}</span><span class="search-pill-x" aria-hidden="true">✕</span></button>`).join('');
    }

    function setupPoolSearch() {
        const input = $('poolSearch');
        input.addEventListener('input', () => {
            ui.filters.term = input.value;
            renderPool();
            updatePoolSuggestions();
            poolSearchTrack.input(input.value);
        });
        input.addEventListener('keydown', event => {
            const count = poolSearch.items.length;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if ($('poolSuggestions').hidden) updatePoolSuggestions();
                if (count) setPoolSuggestion((poolSearch.active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
            } else if (event.key === 'Enter') {
                const pick = poolSearch.items[poolSearch.active] || (count === 1 && poolSearch.items[0]);
                if (pick && !$('poolSuggestions').hidden) { event.preventDefault(); choosePoolSuggestion(pick); }
            } else if (event.key === 'Escape' && !$('poolSuggestions').hidden) {
                event.stopPropagation();
                closePoolSuggestions();
            } else if (event.key === 'Backspace' && !input.value && ui.filters.pills.length) {
                removePill(ui.filters.pills[ui.filters.pills.length - 1]);
            }
        });
        $('poolPills').addEventListener('click', event => {
            const pill = event.target.closest('[data-pill]');
            if (!pill) return;
            removePill(pill.dataset.pill);
            // Keep keyboard focus nearby: the next pill, or the search box
            ($('poolPills').querySelector('[data-pill]') || input).focus();
        });
        input.addEventListener('focus', () => { if (input.value.trim()) updatePoolSuggestions(); });
        input.addEventListener('blur', () => {
            poolSearchTrack.flush();
            setTimeout(closePoolSuggestions, 120);
        });
        $('poolSuggestions').addEventListener('mousedown', event => {
            const li = event.target.closest('[data-index]');
            if (!li) return;
            event.preventDefault();
            choosePoolSuggestion(poolSearch.items[Number(li.dataset.index)]);
        });
    }

    // Same verbs for both players: Select (pick) and Ban; Player 2's turn is marked in crimson
    const p2Turn = () => view.step.player === 2;
    function poolCorner(entry) {
        if (!entry.available || !view.step.action) return '';
        return `<span class="tile-corner${p2Turn() ? ' tile-corner--p2' : ''}" aria-hidden="true">${view.step.action === 'ban' ? '⊘' : '+'}</span>`;
    }

    function primaryLabel(entry) {
        if (!entry.available) return `${entry.display}: ${REASON_BADGE[entry.unavailableReason]}`;
        if (!view.step.action) return entry.display;
        const verb = view.step.action === 'ban' ? 'Ban' : 'Select';
        return `${verb} ${entry.display} for Player ${view.step.player}`;
    }

    const hasRanks = () => view.suggestions.items.length > 0;
    // Without suggestions (draft complete) the ranked orders fall back to the card number
    const sortBy = () => (hasRanks() || ui.sort === 'name' ? ui.sort : 'id');
    const ranked = () => ['recommended', 'counters'].includes(sortBy());
    const anyCounters = () => view.pool.some(e => e.counters > 0);

    function tileChips(entry) {
        const s = entry.suggestion;
        if (!s || !s.chips.length) return '';
        return `<span class="tile-chips">${s.chips.map(c =>
            `<span class="tile-chip tile-chip--${c.kind}" title="${escapeHtml(c.text)}"><span aria-hidden="true">${CHIP_ICON[c.kind]}</span> ${escapeHtml(c.short)}</span>`).join('')}${
            s.moreChips ? `<span class="tile-chip tile-chip--more" title="${s.moreChips} more in the details">+${s.moreChips}</span>` : ''}</span>`;
    }

    function renderPool() {
        renderPills();
        document.querySelectorAll('#attributeFilter .chip').forEach(c =>
            c.setAttribute('aria-pressed', String(c.dataset.attribute === ui.filters.attribute)));
        document.querySelectorAll('#roleFilter .chip').forEach(c =>
            c.setAttribute('aria-pressed', String(ui.filters.roles.includes(c.dataset.role))));
        const entries = sortPool(view.pool.filter(poolFilter), sortBy());
        const active = (ui.filters.attribute !== 'All') + ui.filters.roles.length + ui.filters.fills + ui.filters.showUnavailable;
        $('filtersToggle').textContent = active ? `Filters (${active})` : 'Filters';
        $('poolCount').textContent = `${view.counts.available} available · ${view.counts.unavailable} unavailable`
            + (entries.length < (ui.filters.showUnavailable ? 36 : view.counts.available) ? ` · ${entries.length} shown` : '');
        // Random respects the filters: it picks (or bans) among the available heroes shown
        const action = view.step.action;
        const randomBtn = $('randomHero');
        const randomLabel = action ? `${action === 'ban' ? 'Ban' : 'Select'} a random hero for Player ${view.step.player}` : 'Random hero';
        randomBtn.disabled = !action || !entries.some(e => e.available);
        randomBtn.title = action ? `${randomLabel} from those shown` : 'The draft is complete';
        randomBtn.setAttribute('aria-label', randomLabel);
        if (!entries.length) {
            $('poolGrid').innerHTML = `<p class="empty-note">No heroes match these filters.
                <button class="link-btn" type="button" data-act="clear-filters">Clear filters</button></p>`;
            return;
        }
        // A finished draft greys the whole pool out so attention moves to the band and its cards
        $('poolGrid').classList.toggle('is-done', view.complete);
        $('poolGrid').innerHTML = entries.map(e => `
            <div class="hero-tile attr--${e.attribute}${e.available ? '' : ` is-unavailable is-${e.unavailableReason}`}${e.suggestion && e.suggestion.rank <= 3 && ranked() ? ' is-top' : ''}"
                 role="listitem" data-hero="${e.name}" ${e.available ? 'draggable="true"' : ''}>
                <button class="tile-main" type="button" data-act="primary" aria-label="${escapeHtml(primaryLabel(e))}"
                        ${e.suggestion ? 'aria-describedby="tilePopover"' : ''}
                        ${e.available && view.step.action ? '' : 'aria-disabled="true"'}>
                    ${banner(e.attribute)}
                    ${tokenPortrait(e.name, 'tile-portrait')}
                    <span class="tile-name">${escapeHtml(e.display)}</span>
                    ${rolePills(e.battleRoles, e.fills)}
                    ${tileChips(e)}
                    ${e.counters && e.available ? `<span class="tile-counter" title="Counters ${e.counters === 1 ? 'an opposing hero' : `${e.counters} times`}">⚔<span class="sr-only">Counters the opponent</span></span>` : ''}
                    ${e.available ? '' : `<span class="tile-badge">${REASON_BADGE[e.unavailableReason]}</span>`}
                </button>
                ${poolCorner(e)}
                <button class="tile-menu-btn" type="button" data-act="menu" aria-haspopup="menu"
                        aria-label="More actions for ${escapeHtml(e.display)}">⋯</button>
            </div>`).join('');
    }

    function setupPool() {
        const grid = $('poolGrid');
        grid.addEventListener('click', event => {
            if (event.target.closest('[data-act="clear-filters"]')) {
                track('pool_filter', { filter_type: 'clear_all', state: 'off' });
                Object.assign(ui.filters, { term: '', pills: [], attribute: 'All', roles: [], fills: false });
                $('poolSearch').value = '';
                $('fillsToggle').checked = false;
                renderPool();
                return;
            }
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            const act = event.target.closest('[data-act]')?.dataset.act;
            const name = tile.dataset.hero;
            if (suppressClick) { suppressClick = false; return; }
            if (act === 'menu') openMenu(name, event.target.closest('button'), 'button');
            else if (act === 'primary' && narrow()) {
                // Touch / small screens: the first tap explains the hero, the sheet's button acts
                if (view.pool.find(p => p.name === name)?.suggestion) showPopover(name, tile, { sheet: true });
                else openMenu(name, tile.querySelector('.tile-menu-btn'), 'tap');
            } else if (act === 'primary' && Draft.isAvailable(state(), name)) primaryAction(name, { method: 'tile' });
        });
        // Long-press opens the ⋯ menu
        let pressTimer = null;
        let suppressClick = false;
        grid.addEventListener('touchstart', event => {
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            pressTimer = setTimeout(() => { suppressClick = true; openMenu(tile.dataset.hero, tile.querySelector('.tile-menu-btn'), 'long_press'); }, 550);
        }, { passive: true });
        ['touchend', 'touchmove', 'touchcancel'].forEach(type => grid.addEventListener(type, () => clearTimeout(pressTimer), { passive: true }));
        grid.addEventListener('contextmenu', event => {
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            event.preventDefault();
            openMenu(tile.dataset.hero, tile.querySelector('.tile-menu-btn'), 'right_click');
        });
        // Hover / focus: the popover explains the hero and only that hero is previewed in the band
        // The desktop popover is a tooltip the mouse passes through. It opens after a short pause (so
        // sweeping across the pool stays calm), then follows from tile to tile at once, and sits on the
        // side the mouse came from so it never covers where the mouse is heading.
        let popTimer = null;
        let lastX = null;
        let heading = 'right';
        grid.addEventListener('mousemove', event => {
            if (lastX !== null && Math.abs(event.clientX - lastX) > 2) heading = event.clientX > lastX ? 'right' : 'left';
            lastX = event.clientX;
        });
        const hover = event => {
            if (narrow() || ui.pinned) return;
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            const entry = view.pool.find(p => p.name === tile.dataset.hero);
            const s = entry && entry.suggestion;
            preview(s && view.step.action === 'pick' ? entry.name : null);
            clearTimeout(popTimer);
            if (!s) { hidePopover(); return; }
            // Keyboard focus has no direction: show on the right straight away
            const side = event.type === 'focusin' ? 'right' : heading === 'right' ? 'left' : 'right';
            const show = () => showPopover(entry.name, tile, { side });
            if (event.type === 'focusin' || !$('tilePopover').hidden) show();
            else popTimer = setTimeout(show, 350);
        };
        grid.addEventListener('mouseover', hover);
        grid.addEventListener('focusin', hover);
        grid.addEventListener('mouseleave', () => { clearTimeout(popTimer); lastX = null; leavePool(); });
        grid.addEventListener('focusout', event => {
            if (!grid.contains(event.relatedTarget)) { clearTimeout(popTimer); leavePool(); }
        });
        grid.addEventListener('dragstart', event => {
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            event.dataTransfer.setData('text/hero', tile.dataset.hero);
            event.dataTransfer.effectAllowed = 'copy';
        });
    }

    function leavePool() {
        if ($('tilePopover').classList.contains('is-sheet') || ui.pinned) return;
        preview(null);
        hidePopover();
    }

    // ---- Tile popover (desktop: next to the tile; phones: a bottom sheet with the action) ---

    // `side`: where to put the desktop popover beside the tile ('left' | 'right'), if there is room.
    // `pinned`: the desktop popover stays put and can be clicked, like the phone sheet
    function showPopover(name, tile, { sheet = false, side = 'right', pinned = false } = {}) {
        const entry = view.pool.find(p => p.name === name);
        const s = entry && entry.suggestion;
        const pop = $('tilePopover');
        if (!s) return hidePopover();
        ui.pop = name;
        const p = view.suggestions.player;
        const ban = view.suggestions.action === 'ban';
        const rival = p === 1 ? 2 : 1;
        const forWhom = ` for Player ${p}`;
        const verb = ban ? 'Ban' : 'Select';
        // The hover popover can't be clicked; the phone sheet and the pinned popover can
        const interactive = sheet || pinned;
        ui.pinned = pinned;
        pop.innerHTML = `
            <div class="pop-head">
                <span class="pop-rank">#${s.rank}</span>
                <h3 class="pop-name" id="popHeading">${escapeHtml(entry.display)}<small>${escapeHtml(forWhom)}</small></h3>
                <button class="icon-btn pop-close" type="button" data-pop="close" aria-label="Close">✕</button>
            </div>
            <p class="pop-score">${ban ? `Player ${rival}'s best band with ${escapeHtml(entry.display)}` : 'Best band with this hero'}:
                <strong>${s.percentLabel}</strong>
                <small class="pop-explain">${escapeHtml(percentExplain(s.topPercent, { facing: Draft.bands(state())[ban ? p : rival].length > 0 }))}</small></p>
            ${s.bestWith.length ? `<p class="pop-best">Best with: <strong>${s.bestWith.map(display).map(escapeHtml).join(' + ')}</strong></p>` : ''}
            ${s.sections.map(x => sectionHtml(x, { interactive, limit: interactive ? Infinity : HOVER_LINES })).join('') || '<p class="muted">No specific reasons.</p>'}
            ${interactive ? topicLegend(s.sections) : ''}
            ${interactive ? '' : '<p class="pop-hint">Right-click or press <kbd>I</kbd> to inspect the card text behind these</p>'}
            <div class="pop-actions">
                ${entry.available && view.step.action ? `<button class="btn ${ban ? 'btn-crimson' : 'btn-gold'} pop-primary" type="button" data-pop="primary">${verb}${escapeHtml(forWhom)}</button>` : ''}
                ${interactive ? `<button class="btn btn-ghost" type="button" data-pop="card">View card</button>` : ''}
            </div>`;
        pop.dataset.hero = name;
        pop.hidden = false;
        const mode = sheet ? 'sheet' : pinned ? 'pinned' : 'hover';
        const seen = () => { if (analytics.once(`pop|${mode}|${name}`)) track('hero_popover_view', { hero: name, popover_mode: mode, pool_rank: s.rank }); };
        if (mode === 'hover') popoverDelay.start(seen); // a glance on the way across the pool doesn't count
        else { popoverDelay.cancel(); seen(); }
        pop.classList.toggle('is-sheet', sheet);
        pop.classList.toggle('is-pinned', pinned);
        document.querySelectorAll('#poolGrid .hero-tile').forEach(t => {
            t.classList.toggle('is-popped', t.dataset.hero === name);
        });
        if (sheet) {
            pop.querySelector('[data-pop="primary"], [data-pop="close"]').focus();
            return;
        }
        // Beside the tile, on whichever side has room, kept inside the draft view
        const host = $('draftView').getBoundingClientRect();
        const rect = tile.getBoundingClientRect();
        const width = pop.offsetWidth;
        const fitsRight = rect.right + 8 + width <= host.right;
        const fitsLeft = rect.left - 8 - width >= host.left;
        const right = side === 'right' ? fitsRight || !fitsLeft : !fitsLeft && fitsRight;
        pop.style.left = `${(right ? rect.right + 8 : Math.max(host.left, rect.left - 8 - width)) - host.left}px`;
        const top = Math.min(rect.top, window.innerHeight - pop.offsetHeight - 12);
        pop.style.top = `${Math.max(top, host.top) - host.top}px`;
        if (pinned) (pop.querySelector('[data-inspect]') || pop.querySelector('[data-pop="close"]')).focus();
    }

    // Keep the popover open to click into it: beside the tile on desktop, the bottom sheet on phones
    function pinPopover(name) {
        const tile = document.querySelector(`#poolGrid [data-hero="${name}"]`);
        if (!tile || !view.pool.find(p => p.name === name)?.suggestion) return;
        if (narrow()) showPopover(name, tile, { sheet: true });
        else showPopover(name, tile, { pinned: true });
    }

    function hidePopover() {
        const pop = $('tilePopover');
        popoverDelay.cancel();
        if (pop.hidden) return;
        pop.hidden = true;
        pop.classList.remove('is-sheet', 'is-pinned');
        ui.pop = null;
        ui.pinned = false;
        document.querySelectorAll('#poolGrid .is-popped').forEach(t => t.classList.remove('is-popped'));
    }

    function setupPopover() {
        const pop = $('tilePopover');
        pop.addEventListener('click', event => {
            const name = pop.dataset.hero;
            const target = event.target.closest('[data-inspect]');
            if (target) { inspectSection(name, target.dataset.inspect, target.dataset.line); return; }
            const act = event.target.closest('[data-pop]')?.dataset.pop;
            if (!act) return;
            const tile = document.querySelector(`#poolGrid [data-hero="${name}"] .tile-main`);
            track('popover_action', { control: act, hero: name });
            hidePopover();
            if (act === 'primary') primaryAction(name, { method: 'popover' });
            else if (act === 'card') openCards({ hero: name, source: 'popover' });
            else tile?.focus();
        });
        document.addEventListener('click', event => {
            if (pop.hidden || pop.contains(event.target) || event.target.closest('#cardMenu, dialog')) return;
            const sheet = pop.classList.contains('is-sheet') && !event.target.closest('#poolGrid');
            if (sheet || ui.pinned) {
                hidePopover();
                preview(null);
            }
        });
    }

    // ---- Band slots ----------------------------------------------------------------------

    function slotHtml(slot, { choosable, fate }) {
        if (!slot.hero) {
            return `<div class="slot is-empty" data-slot="${slot.index}" data-drop="slot">
                <span class="slot-num">${slot.index + 1}</span>
                <button class="slot-add" type="button" data-act="choose" ${choosable ? '' : 'disabled'}>
                    <span class="slot-plus" aria-hidden="true">+</span>Choose ${['1st', '2nd', '3rd'][slot.index]} hero</button>
                ${choosable && fate ? `<button class="slot-fate" type="button" data-act="random"
                    title="A random hero from those shown in the pool">${icon('Dice')}or let fate decide</button>`
                    : `<span class="slot-fate is-placeholder" aria-hidden="true">${icon('Dice')}or let fate decide</span>`}
            </div>`;
        }
        const hero = heroOf(slot.hero);
        return `<div class="slot attr--${hero.attribute}${slot.preview ? ' is-preview' : ''}" data-slot="${slot.index}"
                    data-hero="${slot.hero}" data-drop="slot"
                    ${slot.preview ? '' : `data-card="${slot.hero}" tabindex="0" title="View reference card"`}
                    aria-label="${slot.index + 1}. ${escapeHtml(display(slot.hero))}${slot.preview ? ' (preview)' : ', open reference card'}">
            <span class="slot-num slot-num--id" title="Card number">#${hero.id}</span>
            ${banner(hero.attribute)}
            ${slot.preview ? '<span class="slot-ribbon">Preview</span>' : ''}
            ${tokenPortrait(slot.hero, 'slot-portrait')}
            <span class="slot-name">${escapeHtml(display(slot.hero))}</span>
            ${rolePills(Draft.battleRoles(hero))}
        </div>`;
    }

    // Player 1 in the first section, Player 2 in the second. Only the next empty slot offers a random hero
    const fateIndex = slots => slots.findIndex(x => !x.hero);
    function renderSlots(v) {
        const picking = v.step.action === 'pick';
        const row = p => p.slots.map(x => slotHtml(x, { choosable: picking && p.acting, fate: x.index === fateIndex(p.slots) })).join('');
        $('bandSlots').innerHTML = row(v.players[0]);
        $('againstRow').innerHTML = row(v.players[1]);
        [['bandSection', 'bandTurn', v.players[0]], ['againstSection', 'againstTurn', v.players[1]]].forEach(([section, tag, p]) => {
            $(section).classList.toggle('is-acting', p.acting);
            $(section).classList.toggle('is-p2', p.player === 2);
            $(tag).hidden = !p.acting;
            $(tag).textContent = p.acting ? (v.step.action === 'ban' ? 'Banning now' : 'Picking now') : '';
        });
    }

    // Empty slot: bring the pool into view, light it up and focus the best hero
    function choosePrompt() {
        const first = document.querySelector('#poolGrid .hero-tile:not(.is-unavailable) .tile-main');
        if (!first) { openPicker('pick'); return; }
        const pool = document.querySelector('.draft-pool');
        pool.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        pool.classList.remove('is-flash');
        requestAnimationFrame(() => pool.classList.add('is-flash'));
        setTimeout(() => pool.classList.remove('is-flash'), 1400);
        first.focus({ preventScroll: true });
        announce(`Choose a hero from the pool. ${view.step.label}.`);
    }

    // Random hero (respects the pool filters): a highlight hops across the shown tiles, slows, settles with a
    // gold flash, then the hero is picked (or banned) and its slot glows. Any other draft change cancels the roll.
    let rolling = false;
    // `surface`: the dice that rolled (pool, slot, against), for analytics
    function rollRandom(surface) {
        if (rolling) return;
        const candidates = view.pool.filter(e => e.available && poolFilter(e)).map(e => e.name);
        const name = Draft.randomHero(state(), candidates);
        if (!name) { announce('No available hero matches these filters.'); return; }
        track('draft_random', { surface, hero: name });
        const start = state();
        const tileOf = n => document.querySelector(`#poolGrid [data-hero="${n}"]`);
        const light = n => document.querySelectorAll('#poolGrid .is-rolled, #poolGrid .is-fated')
            .forEach(t => { if (t.dataset.hero !== n) t.classList.remove('is-rolled', 'is-fated'); });
        const land = () => {
            rolling = false;
            light(null);
            $('poolGrid').classList.remove('is-rolling');
            if (state() !== start) return;
            primaryAction(name, { method: 'random' });
            document.querySelector(`.slot[data-hero="${name}"]`)?.classList.add('is-arrived');
        };
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { land(); return; }
        rolling = true;
        if (narrow()) { rollInPlace(candidates, name, start, land); return; }
        // Hop only across tiles on screen so the roll can be followed; the winner is drawn from all candidates
        const onScreen = candidates.filter(n => {
            const r = tileOf(n)?.getBoundingClientRect();
            return r && r.bottom > 0 && r.top < window.innerHeight;
        });
        const frames = rollFrames(onScreen.includes(name) ? onScreen : [...onScreen, name], name);
        $('poolGrid').classList.add('is-rolling');
        let i = 0;
        (function next() {
            if (state() !== start) { rolling = false; light(null); $('poolGrid').classList.remove('is-rolling'); return; }
            const frame = frames[i++];
            light(frame.name);
            tileOf(frame.name)?.classList.add('is-rolled');
            if (i < frames.length) { setTimeout(next, frame.delay); return; }
            const winner = tileOf(name);
            winner?.classList.add('is-fated');
            if (!onScreen.includes(name)) winner?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            setTimeout(land, onScreen.includes(name) ? 520 : 900);
        })();
    }

    // Phones: most of the pool is off screen, so the roll flicks through heroes in one place (no scrolling)
    function rollInPlace(candidates, name, start, land) {
        const box = $('fateRoll');
        const frames = rollFrames(candidates, name);
        const done = () => { box.hidden = true; box.classList.remove('is-fated'); };
        box.hidden = false;
        let i = 0;
        (function next() {
            if (state() !== start) { rolling = false; done(); return; }
            const frame = frames[i++];
            box.innerHTML = `<span class="fate-label">Fate decides…</span>${tokenPortrait(frame.name, 'fate-portrait')}
                <span class="fate-name">${escapeHtml(display(frame.name))}</span>`;
            if (i < frames.length) { setTimeout(next, frame.delay); return; }
            box.classList.add('is-fated');
            setTimeout(() => { done(); land(); }, 700);
        })();
    }

    // Each player's row: an empty slot points at the pool (or rolls a random hero); a pool hero dropped on the
    // acting player's row picks it
    function setupSlots() {
        [[$('bandSlots'), 1], [$('againstRow'), 2]].forEach(([row, player]) => {
            row.addEventListener('click', event => {
                const act = event.target.closest('[data-act]')?.dataset.act;
                if (act === 'choose') choosePrompt();
                else if (act === 'random') rollRandom(player === 1 ? 'slot' : 'against');
            });
            setupDrop(row, hero => {
                if (view.step.action === 'pick' && view.step.player === player) primaryAction(hero, { method: 'drag' });
            });
        });
    }

    // Drop zones accept pool heroes (text/hero)
    function setupDrop(el, onDrop) {
        el.addEventListener('dragover', event => {
            if ([...event.dataTransfer.types].includes('text/hero')) {
                event.preventDefault();
                el.classList.add('is-drop-target');
            }
        });
        el.addEventListener('dragleave', event => { if (!el.contains(event.relatedTarget)) el.classList.remove('is-drop-target'); });
        el.addEventListener('drop', event => {
            event.preventDefault();
            el.classList.remove('is-drop-target');
            const hero = event.dataTransfer.getData('text/hero');
            if (hero) onDrop(hero);
        });
    }

    // ---- Carry-over bans -------------------------------------------------------------------

    function setCarryOver(names, method) {
        const s = state();
        commit(Draft.createDraft(s.format, { carryOverBans: names }));
        window.Analytics.draftChanges(s, state(), { method }).forEach(e => track(e.name, e.params));
    }

    // ---- Step header (pool) --------------------------------------------------------------

    function renderStep() {
        const { action } = view.suggestions;
        $('stepLabel').textContent = action ? `${view.step.label} · ${action} a hero` : view.step.label;
        $('stepLabel').className = `step-badge${p2Turn() ? ' step-badge--p2' : ''}${action ? '' : ' step-badge--done'}`;
        const counters = anyCounters();
        if (!counters && ui.sort === 'counters') ui.sort = 'recommended';
        document.querySelector('.sort-switch [data-sort="recommended"]').hidden = !hasRanks();
        document.querySelector('.sort-switch [data-sort="counters"]').hidden = !counters;
        document.querySelectorAll('.sort-switch [data-sort]').forEach(b =>
            b.setAttribute('aria-checked', String(b.dataset.sort === sortBy())));
        $('completeNote').hidden = !view.complete;
    }

    // ---- Analysis ------------------------------------------------------------------------

    function renderAnalysis(v) {
        const a = v.analysis;
        const whose = `Player ${v.focus}'s band`;
        document.querySelectorAll('#focusSwitch [data-focus]').forEach(b =>
            b.setAttribute('aria-checked', String(Number(b.dataset.focus) === v.focus)));
        $('balanceSummary').textContent = `${whose} covers ${a.coveredCount} of 3 roles`;
        $('roleList').innerHTML = a.roles.map(r => `
            <li class="role-row${r.coveredBy ? ' is-covered' : ''}${r.change ? ' is-changed' : ''}">
                ${icon(r.role, 'ico role-ico')}<span class="role-name" title="${escapeHtml(ROLE_INFO[r.role])}">${r.role}</span>
                <span class="role-status">${r.coveredBy ? `✓ ${escapeHtml(display(r.coveredBy))}` : '○ Missing'}</span>
            </li>`).join('');
        $('scoreCaption').textContent = a.score.complete ? whose : 'Best band still reachable';
        $('bandScore').textContent = a.score.percent === null ? '—' : percentLabel(a.score.percent);
        $('scoreBar').style.width = a.score.percent === null ? '0%' : `${Math.max(3, 100 - a.score.percent)}%`;
        const facing = Draft.bands(state())[v.focus === 1 ? 2 : 1].length > 0;
        $('scoreExplain').textContent = a.score.percent === null ? ''
            : `${percentExplain(a.score.percent, { facing })} Scored on roles, synergy, themes, durability and conflicts${facing ? ', plus the matchup' : ''}.`;
        $('scoreInfo').hidden = a.score.percent === null;
        $('scoreDetail').hidden = !a.score.change;
        $('scoreDetail').textContent = a.score.change
            ? `Preview: ${a.score.change.from === null ? '—' : percentLabel(a.score.change.from)} → ${percentLabel(a.score.change.to)}` : '';
        $('scoreDetail').classList.toggle('is-changed', Boolean(a.score.change));

        // The same sections as the tile popover, for the whole band
        $('analysisSections').innerHTML = a.sections.length ? `<div class="analysis-block analysis-reasons">
            ${a.sections.map(x => sectionHtml(x, { interactive: true, limit: LIST_LIMIT, moreKey: x.key })).join('')}
            ${topicLegend(a.sections)}</div>` : '';
        // Every factor, zero included, on one scale with zero in the middle; ticks mark the lowest and highest
        // the factor reaches on its own (title: a band reaching it). Each row opens the inspector on what scores it
        const pts = x => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}`;
        const names = band => listText(band.map(titleCase));
        const reachedBy = (band, opponents) => (band ? ` (${names(band)}${opponents ? ` vs ${names(opponents)}` : ''})` : '');
        $('scoreBreakdown').innerHTML = a.breakdown.map(f => `
            <li class="${f.delta < 0 ? 'is-loss' : f.delta === 0 ? 'is-zero' : ''}"><button type="button" class="bd-row" data-factor="${f.factor}"
                    aria-label="${f.label}: ${f.delta === 0 ? 'no points' : `${f.delta > 0 ? 'plus' : 'minus'} ${Math.abs(f.delta).toFixed(1)}`}, range ${pts(f.min)} to ${pts(f.max)}. Inspect">
                <span class="bd-label">${f.label}</span>
                <span class="bd-bar" title="Range ${pts(f.min)}${reachedBy(f.minBand, f.minOpponents)} to ${pts(f.max)}${reachedBy(f.maxBand, f.maxOpponents)}">
                    <span class="bd-range" style="left:${f.ticks.min.toFixed(2)}%;width:${(f.ticks.max - f.ticks.min).toFixed(2)}%"></span>
                    <span class="bd-fill" style="left:${f.bar.left.toFixed(2)}%;width:${f.bar.width.toFixed(2)}%"></span>
                    <span class="bd-tick" style="left:${f.ticks.min.toFixed(2)}%"></span><span class="bd-tick" style="left:${f.ticks.max.toFixed(2)}%"></span></span>
                <span class="bd-val">${pts(f.delta)}</span>
                <span class="bd-go" aria-hidden="true">›</span></button></li>`).join('');
        $('viewInGraph').disabled = !Draft.bands(state())[v.focus].length;
        renderBeats(a.beats);
    }

    // Finished drafts end the analysis with the strongest bands against the analysed one (draft-view.js beatsView):
    // how each fares against it, opening the inspector, or the graph with both bands
    function renderBeats(beats) {
        $('beatsBlock').hidden = !beats;
        if (!beats) return;
        $('beatsHeading').textContent = beats.title;
        $('beatsSub').textContent = beats.counteredBy.length
            ? `Scored like any band, plus the matchup. On the cards, ${listText(beats.counteredBy)} counter${beats.counteredBy.length > 1 ? '' : 's'} it.`
            : 'No hero\'s card counters this band directly, so these are simply the strongest bands against it.';
        $('beatsList').innerHTML = beats.bands.map((b, i) => `
            <li class="beats-band">
                <button type="button" class="beats-open" data-beats="${i}" aria-label="Inspect ${escapeHtml(b.label)} against ${escapeHtml(beats.vs)}'s band">
                    <span class="beats-faces" aria-hidden="true">${b.heroes.map(n =>
                        `<span class="beats-face attr--${heroOf(n).attribute}">${portrait(n, 'beats-portrait')}</span>`).join('')}</span>
                    <span class="beats-name">${escapeHtml(b.label)}</span>
                    <span class="pop-inspect" aria-hidden="true">›</span>
                </button>
                <ul class="reason-list">${b.lines.slice(0, LIST_LIMIT - 1).map(l => lineItem(l, escapeHtml(l.text))).join('')
                    || '<li class="muted beats-none">No counters either way: strong on its own</li>'}</ul>
                ${b.lines.length > LIST_LIMIT - 1 ? `<p class="pop-more">+${b.lines.length - LIST_LIMIT + 1} more in the inspector</p>` : ''}
                <button class="link-btn beats-graph" type="button" data-beats-graph="${i}">View both bands in graph →</button>
            </li>`).join('');
    }

    const listText = list => list.join(', ').replace(/, ([^,]*)$/, ' and $1');

    function setupBeats() {
        $('beatsList').addEventListener('click', event => {
            const beats = (shown || view).analysis.beats;
            const open = event.target.closest('[data-beats]');
            const graph = event.target.closest('[data-beats-graph]');
            const index = Number(open ? open.dataset.beats : graph?.dataset.beatsGraph);
            const band = beats?.bands[index];
            if (!band) return;
            if (graph) {
                track('view_in_graph', { source: 'counter_band' });
                setTab('graph', { via: 'view_in_graph' });
                window.BestiaryGraph?.showBand(band.heroes, beats.target);
                return;
            }
            track('counter_band_open', { rank: index + 1, band: window.Analytics.bandKey(band.heroes), target_band: window.Analytics.bandKey(beats.target) });
            openInspect(band.reasons, { title: `${band.label} vs ${beats.vs}`, sub: `${beats.title} · #${index + 1}`, opponents: beats.target });
        });
    }

    // ---- Inspector: the card text behind a popover section or analysis row ---------------------

    // One hero's part in a line: who, its role or Vitality, and which abilities with what they do here
    const overviewSide = side => `<div class="ov-side${side.theirs ? ' is-theirs' : ''}">
        <button type="button" class="ov-hero" data-card="${side.hero}" title="Open ${escapeHtml(side.display)}'s card">
            <img src="${side.image}" alt="" width="24" height="24"><strong>${escapeHtml(side.display)}</strong></button>${
        side.theirs ? '<span class="side-tag">Opponent</span>' : ''}${
        side.notes.length ? `<span class="ov-notes">${side.notes.map(escapeHtml).join(' · ')}</span>` : ''}
        <ul class="ov-abilities">${side.overview.map(o => `<li><span class="ov-ability">${escapeHtml(o.name)}</span>${
            o.tags.length ? ` <span class="ov-tags">${o.tags.map(escapeHtml).join(', ')}</span>` : ''}</li>`).join('')}</ul></div>`;

    // Why a score factor is at zero
    const EMPTY_FACTOR = {
        coverage: 'No battle role is covered yet.',
        synergy: 'No hero in this band helps another one yet.',
        theme: 'The band shares no theme (such as Cooldowns or Debuffs) yet.',
        durability: 'Neither fragile nor a strong frontline: Vitality is neither a bonus nor a cost.',
        conflict: 'No hero in this band works against another one.',
        matchup: 'No counters either way against the opponent (or no opponent yet).'
    };

    function openInspect(reasons, { title, sub = '', opponents = [], empty = 'Nothing scores here.' }) {
        const v = inspectView(reasons, ctx, { title, opponents });
        const sides = v.items.flatMap(i => i.sides);
        ui.inspect = { mine: [...new Set(sides.filter(x => !x.theirs).map(x => x.hero))], theirs: [...new Set(sides.filter(x => x.theirs).map(x => x.hero))] };
        $('inspectTitle').textContent = title;
        $('inspectSub').textContent = sub;
        const ready = window.BestiaryGraph && window.BestiaryGraph.ready;
        const single = v.items.length === 1;
        $('inspectItems').innerHTML = !v.items.length ? `<p class="muted inspect-empty">${escapeHtml(empty)}</p>` : v.items.map(item => `
            <article class="inspect-item">
                <header class="inspect-item-head"><p class="reason reason--${item.kind} topic--${item.topic}" title="${escapeHtml(TOPICS[item.topic].label)}">${
                    escapeHtml(item.text)}</p>${dots(item.strength)}</header>
                ${item.sides.length ? `<div class="ov-sides">${item.sides.map(overviewSide).join('')}</div>
                <details class="inspect-cards"${single ? ' open' : ''}><summary>Card text</summary>
                    <div class="tt-sides inspect-sides">${ready ? window.BestiaryGraph.evidence(item.sides) : '<p class="muted">Loading the cards…</p>'}</div>
                </details>` : ''}
            </article>`).join('');
        $('inspectInGraph').hidden = !ui.inspect.mine.length;
        if (!$('inspectDialog').open) $('inspectDialog').showModal();
    }

    // A popover section (the hero with its teammates, the band, the matchup) or one of its lines
    function inspectSection(name, key, lineIndex) {
        const entry = view.pool.find(p => p.name === name);
        const x = entry?.suggestion?.sections.find(sec => sec.key === key);
        if (!x) return;
        const one = lineIndex === undefined ? null : x.lines[Number(lineIndex)];
        track('analysis_inspect', { section: key, line_index: lineIndex, source: 'popover' });
        const p = view.suggestions.player;
        const bands = Draft.bands(state());
        // On a ban step the hero would play for the rival, against the acting player
        const opponents = view.suggestions.action === 'ban' ? bands[p] : bands[p === 1 ? 2 : 1];
        openInspect(one ? one.reasons : x.reasons, { title: x.title, sub: one ? one.text : `${x.label} · ${entry.suggestion.percentLabel} best band`, opponents });
    }

    // `dismiss`: Escape hides it even while hovered or focused (until hovered or focused again)
    function setScoreInfo(open, { dismiss = false } = {}) {
        $('scoreInfo').classList.toggle('is-open', open);
        $('scoreInfo').classList.toggle('is-dismissed', dismiss);
        $('scoreInfoBtn').setAttribute('aria-expanded', String(open));
    }

    function setupInspect() {
        $('analysisSections').addEventListener('click', event => {
            const button = event.target.closest('[data-inspect]');
            if (!button) return;
            const x = (shown || view).analysis.sections.find(sec => sec.key === button.dataset.inspect);
            const one = button.dataset.line === undefined ? null : x?.lines[Number(button.dataset.line)];
            if (x) track('analysis_inspect', { section: x.key, line_index: button.dataset.line, source: 'analysis' });
            if (x) openInspect(one ? one.reasons : x.reasons, { title: x.title, sub: one ? one.text : x.label, opponents: x.opponents });
        });
        $('scoreBreakdown').addEventListener('click', event => {
            const factor = event.target.closest('[data-factor]')?.dataset.factor;
            const v = shown || view;
            const f = v.analysis.breakdown.find(x => x.factor === factor);
            if (!f) return;
            track('score_factor_open', { factor: f.factor });
            const whose = `Player ${v.focus}'s band`;
            const total = `${f.delta > 0 ? '+' : f.delta < 0 ? '−' : ''}${Math.abs(f.delta).toFixed(1)} points`;
            openInspect(f.reasons, { title: `${f.label}: ${whose}`, sub: `Band score · ${total}`,
                opponents: Draft.bands(state())[v.focus === 1 ? 2 : 1], empty: EMPTY_FACTOR[f.factor] });
        });
        // The score's (i): hover or focus shows it, a click pins it open until a click elsewhere or Escape
        $('scoreInfoBtn').addEventListener('click', () => {
            const open = !$('scoreInfo').classList.contains('is-open');
            if (open) track('score_info_open');
            setScoreInfo(open, { dismiss: !open }); // closing by click hides it even while hovered or focused
        });
        ['mouseenter', 'focusin'].forEach(type => $('scoreInfo').addEventListener(type, () => $('scoreInfo').classList.remove('is-dismissed')));
        document.addEventListener('click', event => {
            if (!event.target.closest('#scoreInfo')) setScoreInfo(false);
        });
        $('inspectItems').addEventListener('click', event => {
            const card = event.target.closest('[data-card]');
            if (card) openCards({ hero: card.dataset.card, source: 'inspect' });
            // Before the browser toggles it: open now means it is closing
            const details = event.target.closest('summary')?.parentElement;
            if (details?.matches('details.inspect-cards')) track('inspect_card_text', { state: details.open ? 'closed' : 'open' });
        });
        $('inspectInGraph').addEventListener('click', () => {
            $('inspectDialog').close();
            hidePopover();
            track('view_in_graph', { source: 'inspect' });
            setTab('graph', { via: 'view_in_graph' });
            window.BestiaryGraph?.showBand(ui.inspect.mine, ui.inspect.theirs);
        });
    }

    // ---- Reference cards modal (finished draft, or a shared link) ---------------------------

    const cardsState = () => (ui.shared ? ui.shared.state : state());

    // `source`: what opened the cards, for analytics
    function openCards({ hero = null, source } = {}) {
        track('cards_open', { source, hero });
        ui.cardHero = hero;
        renderCards();
        if (!$('cardsDialog').open) $('cardsDialog').showModal();
        $('cardsSwitch').querySelector('[aria-checked="true"]')?.focus();
    }

    function renderCards() {
        const hero = ui.cardHero;
        const sides = referenceSides(cardsState(), { hero });
        if (!hero && !sides.some(x => x.key === ui.cardSide)) ui.cardSide = sides[0].key;
        const side = hero ? sides[0] : sides.find(x => x.key === ui.cardSide);
        $('cardsTitle').textContent = hero ? `${display(hero)} · reference card`
            : ui.shared ? 'Shared draft · reference cards' : 'Reference cards';
        $('cardsSwitch').hidden = sides.length < 2;
        $('shareLink').hidden = Boolean(hero);
        $('cardInGraph').hidden = !hero;
        $('cardsDialog').classList.toggle('is-single', Boolean(hero));
        $('cardsSwitch').innerHTML = sides.map(x =>
            `<button type="button" role="radio" data-side="${x.key}" aria-checked="${x === side}">${escapeHtml(x.label)}</button>`).join('');
        const ready = window.BestiaryGraph && window.BestiaryGraph.ready;
        $('cardTrack').innerHTML = side.heroes.map(name => `
            <article class="ref-card" aria-label="${escapeHtml(display(name))} reference card">
                ${ready ? window.BestiaryGraph.heroCard(name) : '<p class="muted">Loading the card…</p>'}
            </article>`).join('');
    }

    // Cards only: no header, tabs or note, just the cards (browser full screen where it is supported)
    function setCardsOnly(on) {
        const dialog = $('cardsDialog');
        dialog.classList.toggle('is-cards-only', on);
        if (on) {
            dialog.requestFullscreen?.().catch(() => {});
            $('cardsExit').focus();
        } else {
            if (document.fullscreenElement === dialog) document.exitFullscreen().catch(() => {});
            if (dialog.open) $('cardsOnly').focus();
        }
    }

    function shareUrl(s) {
        return `${location.origin}${location.pathname}#${encodeDraft(s, ctx.heroes)}`;
    }

    function setupCards() {
        const dialog = $('cardsDialog');
        $('cardsSwitch').addEventListener('click', event => {
            const button = event.target.closest('[data-side]');
            if (!button) return;
            if (button.dataset.side !== ui.cardSide) track('cards_side_switch', { side: button.dataset.side });
            ui.cardSide = button.dataset.side;
            renderCards();
            $('cardsSwitch').querySelector(`[data-side="${button.dataset.side}"]`).focus();
        });
        $('cardsSwitch').addEventListener('keydown', event => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            const buttons = [...$('cardsSwitch').querySelectorAll('[data-side]')];
            const i = buttons.findIndex(b => b.getAttribute('aria-checked') === 'true');
            buttons[(i + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].click();
        });
        $('shareLink').addEventListener('click', () => {
            const url = shareUrl(cardsState());
            const method = navigator.share && narrow() ? 'native' : navigator.clipboard ? 'clipboard' : 'fallback';
            track('share', { method, content_type: 'draft', format: cardsState().format,
                band: window.Analytics.bandKey(Draft.myBand(cardsState())) });
            if (navigator.share && narrow()) navigator.share({ title: 'Bestiary of Sigillum draft', url }).catch(() => {});
            else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link copied. Opening it shows these cards.'), () => toast(url));
            else toast(url);
        });
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
        $('cardsOnly').addEventListener('click', () => { track('cards_only'); setCardsOnly(true); });
        $('cardInGraph').addEventListener('click', () => {
            const name = ui.cardHero; // closing the dialog forgets it
            dialog.close();
            track('view_in_graph', { source: 'cards' });
            setTab('graph', { via: 'view_in_graph' });
            window.BestiaryGraph?.selectHero(name);
        });
        $('cardsExit').addEventListener('click', () => setCardsOnly(false));
        // Esc leaves the browser's full screen first: drop the cards-only view with it
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && dialog.classList.contains('is-cards-only')) setCardsOnly(false);
        });
        // Closing a shared draft's cards returns to your own draft
        dialog.addEventListener('close', () => {
            setCardsOnly(false);
            ui.cardHero = null;
            if (!ui.shared) return;
            ui.shared = null;
            if (ui.tab === 'draft') history.replaceState(history.state, '', `${location.pathname}#draft`);
        });
    }

    // ---- Hero picker dialog (carry-over bans, or a pick when the pool shows no one) --------

    const PICKER = {
        carry: { title: 'Add an extra ban', can: n => !state().carryOverBans.includes(n),
            run: n => setCarryOver([...state().carryOverBans, n], 'picker') },
        pick: { title: 'Choose a hero', can: n => Draft.isAvailable(state(), n), run: n => primaryAction(n, { method: 'picker' }) }
    };

    function openPicker(mode) {
        ui.picker = mode;
        $('pickerTitle').textContent = PICKER[mode].title;
        $('pickerSearch').value = '';
        renderPicker();
        $('heroPicker').showModal();
        $('pickerSearch').focus();
    }

    function renderPicker() {
        const term = $('pickerSearch').value.trim().toLowerCase();
        const mode = PICKER[ui.picker];
        $('pickerGrid').innerHTML = ctx.heroes.filter(h => mode.can(h.name) && display(h.name).toLowerCase().includes(term))
            .map(h => `<button class="picker-hero attr--${h.attribute}" type="button" data-hero="${h.name}">
                ${portrait(h.name, 'picker-portrait')}<span>${escapeHtml(display(h.name))}</span></button>`).join('')
            || '<p class="empty-note">No heroes match.</p>';
    }

    function setupPicker() {
        $('pickerSearch').addEventListener('input', renderPicker);
        $('pickerSearch').addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                $('pickerGrid').querySelector('[data-hero]')?.click();
            }
        });
        $('pickerGrid').addEventListener('click', event => {
            const button = event.target.closest('[data-hero]');
            if (!button) return;
            $('heroPicker').close();
            PICKER[ui.picker].run(button.dataset.hero);
        });
        $('heroPicker').addEventListener('click', event => { if (event.target === $('heroPicker')) $('heroPicker').close(); });
    }

    // ---- Card menu (⋯) -------------------------------------------------------------------

    let menuReturn = null;
    function openMenu(name, anchor, method) {
        track('card_menu_open', { method, hero: name });
        const s = state();
        const available = Draft.isAvailable(s, name);
        const step = Draft.currentStep(s);
        const items = [];
        if (available && step) {
            const verb = step.action === 'ban' ? 'Ban' : 'Select';
            items.push(['primary', `${verb} for Player ${step.player}`]);
        }
        if (view.pool.find(p => p.name === name)?.suggestion) items.push(['inspect', 'Why? Inspect reasons']);
        items.push(['card', 'View reference card']);
        items.push(['graph', 'View in graph']);
        const menu = $('cardMenu');
        menu.innerHTML = items.map(([act, label]) => `<button type="button" role="menuitem" data-menu="${act}">${label}</button>`).join('');
        menu.dataset.hero = name;
        menu.hidden = false;
        const rect = anchor.getBoundingClientRect();
        const host = $('draftView').getBoundingClientRect();
        menu.style.left = `${Math.min(rect.left - host.left, host.width - 200)}px`;
        menu.style.top = `${rect.bottom - host.top + 4}px`;
        menuReturn = anchor;
        menu.querySelector('button').focus();
    }

    function closeMenu(restoreFocus = true) {
        const menu = $('cardMenu');
        if (menu.hidden) return;
        menu.hidden = true;
        if (restoreFocus) menuReturn?.focus();
    }

    function setupMenu() {
        const menu = $('cardMenu');
        menu.addEventListener('click', event => {
            const act = event.target.closest('[data-menu]')?.dataset.menu;
            const name = menu.dataset.hero;
            if (!act) return;
            track('card_menu_action', { control: act, hero: name });
            closeMenu(false);
            if (act === 'primary') primaryAction(name, { method: 'menu' });
            else if (act === 'inspect') pinPopover(name);
            else if (act === 'card') openCards({ hero: name, source: 'menu' });
            else if (act === 'graph') {
                track('view_in_graph', { source: 'card_menu' });
                setTab('graph', { via: 'card_menu' });
                window.BestiaryGraph?.selectHero(name);
            }
        });
        menu.addEventListener('keydown', event => {
            const buttons = [...menu.querySelectorAll('button')];
            const i = buttons.indexOf(document.activeElement);
            if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
            if (event.key === 'ArrowUp') { event.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
            if (event.key === 'Tab') closeMenu(false);
        });
        document.addEventListener('click', event => {
            if (!menu.hidden && !menu.contains(event.target) && !event.target.closest('[data-act="menu"]')) closeMenu(false);
        });
    }

    // ---- Keyboard ------------------------------------------------------------------------

    function setupKeys() {
        document.addEventListener('keydown', event => {
            if (ui.tab !== 'draft' || $('inspectDialog').open) return;
            const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
            if (event.key === 'Escape') {
                const tip = $('scoreInfo');
                if (tip.classList.contains('is-open') || tip.matches(':hover') || tip.contains(document.activeElement)) setScoreInfo(false, { dismiss: true });
                else if (!$('cardMenu').hidden) closeMenu();
                else if (!$('tilePopover').hidden) { hidePopover(); preview(null); }
                else if ($('analysisPanel').classList.contains('is-open')) setSheet(false);
                return;
            }
            if ($('cardsDialog').open || $('heroPicker').open) return;
            if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                doUndo('keyboard');
            } else if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'i') {
                // Pin the popover of the focused or hovered tile
                const name = event.target.closest?.('#poolGrid [data-hero]')?.dataset.hero || (!$('tilePopover').hidden && ui.pop);
                if (name && !ui.pinned) { event.preventDefault(); pinPopover(name); }
            } else if (!typing && event.key === '/') {
                event.preventDefault();
                $('poolSearch').focus();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
