// Draft tab: DOM rendering and interaction for the draft assistant.
// All draft rules and scoring live in draft.js; draft-view.js turns them into the view object
// this file draws (both unit tested). Only DOM, events and persistence live here.
(function () {
    const Draft = window.Draft;
    const { draftView, referenceSides, graphAction, rollFrames, reasonGroups, percentLabel, groupText, collapse } = window.DraftView;
    const { encodeDraft, decodeDraft, isDraftLink } = window.DraftShare;
    const { escapeHtml, vitalityTokensSvg } = window.GraphLogic;
    const { titleCase } = window.Synergy;
    const { isGraphRoute } = window.GraphRoute;

    const STORAGE_KEY = 'bestiary-draft-v1';
    const ATTRIBUTES = ['Strength', 'Agility', 'Intelligence'];
    const FORMAT_INFO = {
        standard: { label: 'Standard', hint: 'Alternate picks until each player has 3' },
        'ban-first': { label: 'Ban phase first', hint: 'Each player bans 3, alternating, then picks' },
        interleaved: { label: 'Interleaved', hint: 'Ban 1 each, pick 1 each, three times' }
    };
    const LIST_LIMIT = 3; // grouped lists show this many before "Show N more"
    const CHIP_ICON = { synergy: '✦', counter: '⚔', warning: '⚠' };
    const REASON_BADGE = { picked: 'Picked', facing: 'Facing', excluded: 'Excluded', banned: 'Banned', player1: 'Player 1', player2: 'Player 2' };

    const ICON = {
        Strength: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 8v8M8.5 12h7"/>',
        Agility: '<path d="M12 3 21 20H3z"/><path d="M12 8.5v8M10 14.5h4"/>',
        Intelligence: '<path d="M3 6c3-1 6-1 9 1 3-2 6-2 9-1v13c-3-1-6-1-9 1-3-2-6-2-9-1z"/><path d="M12 7v13"/>',
        Controller: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
        Attacker: '<path d="M5 5l11 11M19 5 8 16"/><path d="M14 18l4-4M6 14l4 4"/>',
        Supporter: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M7.5 12h9"/>',
        Dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><g fill="currentColor" stroke="none"><circle cx="8.3" cy="8.3" r="1.5"/><circle cx="15.7" cy="8.3" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="8.3" cy="15.7" r="1.5"/><circle cx="15.7" cy="15.7" r="1.5"/></g>'
    };
    const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

    let ctx = null;
    let view = null;
    let shown = null; // the view on screen (a hover preview or `view`)
    const ui = {
        tab: 'graph',
        mode: 'two-player',
        states: { solo: Draft.createDraft('solo'), 'two-player': Draft.createDraft('standard') },
        filters: { term: '', attribute: 'All', roles: [], fills: false, showUnavailable: false }, // roles combine with OR
        sort: 'recommended',
        focus: null, // two-player analysis: null follows whoever acts, or a chosen player
        picker: null,
        expanded: {}, // "Show N more" lists that are open; reset when the band changes
        expandKey: null,
        shared: null, // { state, code }: a draft opened from a shared link (read-only, shown in the cards modal)
        cardSide: { solo: 'mine', 'two-player': '1' }, // reference cards: whose cards are shown
        pop: null // hero shown in the tile popover
    };

    const $ = id => document.getElementById(id);
    const state = () => ui.states[ui.mode];
    const solo = () => ui.mode === 'solo';
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
        const label = adds ? r : `${r} (already covered in this band)`;
        return `<span class="role-pill role--${r}${adds ? '' : ' is-covered'}" title="${label}">${icon(r)}<span class="sr-only">${label}</span></span>`;
    }).join('')}</span>`;
    const narrow = () => window.matchMedia('(max-width: 600px), (hover: none)').matches;
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
            setTab(shared || hash === '#draft' ? 'draft' : 'graph', { focus: false });
            if (shared) openSharedLink(hash);
            window.addEventListener('hashchange', () => {
                const link = location.hash;
                if (!isDraftLink(link)) return;
                setTab('draft', { focus: false });
                openSharedLink(link);
            });
            // Back / forward onto a graph selection shows the graph (script.js applies the selection)
            window.addEventListener('popstate', () => {
                if (ui.tab === 'draft' && (!location.hash || isGraphRoute(location.hash))) setTab('graph', { focus: false });
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
        }
    }

    function restore() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (!saved) return;
            if (saved.states?.solo?.format === 'solo') ui.states.solo = saved.states.solo;
            const two = saved.states?.['two-player'];
            if (two && Draft.DRAFT_FORMATS.includes(two.format) && two.format !== 'solo') ui.states['two-player'] = two;
            if (saved.mode === 'solo' || saved.mode === 'two-player') ui.mode = saved.mode;
        } catch (error) {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    function persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: ui.mode, states: ui.states }));
        } catch (error) { /* storage full or disabled: drafting still works */ }
    }

    // A shared link opens its reference cards read-only and never overwrites the visitor's own draft
    function openSharedLink(hash) {
        const { state: shared, error } = decodeDraft(hash, ctx.heroes);
        const problem = error || (Draft.isComplete(shared) ? null : 'This shared draft is not finished yet.');
        if (problem) {
            history.replaceState(history.state, '', '#draft');
            toast(`Could not open the shared draft: ${problem}`);
            return;
        }
        ui.shared = { state: shared, code: hash.replace(/^#/, '') };
        history.replaceState(history.state, '', `#${ui.shared.code}`);
        openCards();
    }

    // ---- Tabs ----------------------------------------------------------------------------

    function setTab(tab, { focus = true } = {}) {
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
        const draftHash = ui.shared ? `#${ui.shared.code}` : '#draft';
        // The graph tab shows its selection's link (before the graph has loaded: the link it was opened with)
        const graph = window.BestiaryGraph;
        const graphUrl = graph?.ready ? graph.routeUrl()
            : isGraphRoute(location.hash) ? location.hash : location.pathname + location.search;
        history.replaceState(history.state, '', tab === 'draft' ? draftHash : graphUrl);
        if (tab === 'graph') window.BestiaryGraph?.refit();
        if (focus) $(tab === 'graph' ? 'tabGraph' : 'tabDraft').focus();
    }

    function setupTabs() {
        $('tabGraph').addEventListener('click', () => setTab('graph'));
        $('tabDraft').addEventListener('click', () => setTab('draft'));
        document.querySelector('.tabs').addEventListener('keydown', event => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            setTab(ui.tab === 'graph' ? 'draft' : 'graph');
        });
        $('addToDraft').addEventListener('click', addFromGraph);
        $('backToDraft').addEventListener('click', () => {
            window.BestiaryGraph?.clearBand();
            setTab('draft');
        });
    }

    // ---- Static controls -----------------------------------------------------------------

    function setupStatic() {
        $('attributeFilter').innerHTML = ['All', ...ATTRIBUTES].map(a =>
            `<button class="chip${a === 'All' ? '' : ` chip--${a}`}" type="button" data-attribute="${a}" aria-pressed="${a === 'All'}">
                ${a === 'All' ? '' : icon(a)}${a}</button>`).join('');
        $('roleFilter').innerHTML = Draft.BATTLE_ROLES.map(r =>
            `<button class="chip" type="button" data-role="${r}" aria-pressed="false">${icon(r)}${r}</button>`).join('');

        $('attributeFilter').addEventListener('click', event => {
            const chip = event.target.closest('[data-attribute]');
            if (!chip) return;
            ui.filters.attribute = chip.dataset.attribute;
            renderPool();
        });
        $('roleFilter').addEventListener('click', event => {
            const chip = event.target.closest('[data-role]');
            if (!chip) return;
            const role = chip.dataset.role;
            const roles = ui.filters.roles;
            ui.filters.roles = roles.includes(role) ? roles.filter(r => r !== role) : [...roles, role];
            renderPool();
        });
        $('poolSearch').addEventListener('input', event => { ui.filters.term = event.target.value; renderPool(); });
        $('filtersToggle').addEventListener('click', () => {
            const open = $('poolFilters').classList.toggle('is-open');
            $('filtersToggle').setAttribute('aria-expanded', String(open));
        });
        $('randomHero').innerHTML = icon('Dice');
        $('randomHero').addEventListener('click', rollRandom);
        $('fillsToggle').addEventListener('change', event => { ui.filters.fills = event.target.checked; renderPool(); });
        $('unavailableToggle').addEventListener('change', event => { ui.filters.showUnavailable = event.target.checked; renderPool(); });

        document.querySelector('.mode-switch').addEventListener('click', event => {
            const button = event.target.closest('[data-mode]');
            if (button && button.dataset.mode !== ui.mode) {
                ui.mode = button.dataset.mode;
                render();
            }
        });

        $('undoBtn').addEventListener('click', doUndo);
        $('resetBtn').addEventListener('click', doReset);
        $('addEnemy').addEventListener('click', () => openPicker('enemy'));
        $('addExcluded').addEventListener('click', () => openPicker('exclude'));
        $('sequence').addEventListener('click', event => {
            if (event.target.closest('[data-act="add-extra"]')) openPicker('carry');
            const name = event.target.closest('[data-remove-extra]')?.dataset.removeExtra;
            if (name) setCarryOver(state().carryOverBans.filter(n => n !== name));
        });
        document.querySelector('.sort-switch').addEventListener('click', event => {
            const button = event.target.closest('[data-sort]');
            if (button) { ui.sort = button.dataset.sort; renderStep(); renderPool(); }
        });
        $('focusSwitch').addEventListener('click', event => {
            const button = event.target.closest('[data-focus]');
            if (button) { ui.focus = Number(button.dataset.focus); render(); }
        });
        $('viewInGraph').addEventListener('click', () => {
            setTab('graph');
            const bands = Draft.bands(state());
            window.BestiaryGraph?.showBand(bands[view.focus], bands[view.focus === 1 ? 2 : 1]);
        });

        $('draftBar').addEventListener('click', () => setSheet(!$('analysisPanel').classList.contains('is-open')));
        $('analysisClose').addEventListener('click', () => setSheet(false));
        $('openMatch').addEventListener('click', () => openCards());
        $('draftView').addEventListener('click', event => {
            const more = event.target.closest('[data-more]');
            if (!more) return;
            ui.expanded[more.dataset.more] = !ui.expanded[more.dataset.more];
            renderAnalysis(shown);
            document.querySelector(`[data-more="${more.dataset.more}"]`)?.focus();
        });

        setupPool();
        setupPopover();
        setupSlots();
        setupAgainst();
        setupCards();
        setupPicker();
        setupMenu();
        setupKeys();
    }

    // ---- Actions -------------------------------------------------------------------------

    function commit(next, message) {
        ui.states[ui.mode] = next;
        ui.focus = null;
        render();
        if (message) announce(message);
    }

    // Run an engine transition; a rule violation (e.g. a hero already taken) is reported, not thrown
    function attempt(fn, message) {
        try {
            commit(fn(state()), typeof message === 'function' ? message() : message);
        } catch (error) {
            announce(error.message);
            toast(error.message);
        }
    }

    function primaryAction(name) {
        const step = Draft.currentStep(state());
        if (!step) return;
        const done = step.action === 'ban' ? 'banned' : 'selected';
        const verb = solo() ? done[0].toUpperCase() + done.slice(1) : `Player ${step.player} ${done}`;
        attempt(s => Draft.applyAction(s, name), () => `${verb} ${display(name)}. ${summary()}`);
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
        primaryAction(name);
        if (!Draft.isAvailable(state(), name)) setTab('draft'); // otherwise refused: primaryAction reported why
    }

    function summary() {
        const v = draftView(state(), ctx);
        return `Band covers ${v.analysis.coveredCount} of 3 roles, ${v.analysis.score.label}.`;
    }

    function doUndo() {
        const before = state();
        const after = Draft.undo(before);
        if (after === before) return;
        commit(after, 'Undone.');
    }

    // No confirmation: reset is an undo step, so Undo and Ctrl/⌘+Z bring the draft back
    function doReset() {
        const cleared = Draft.reset(state());
        commit(cleared, 'Cleared. Undo restores it.');
        toast('Cleared. Undo (Ctrl/⌘+Z) restores it.', { label: 'Undo', run: () => {
            if (state() === cleared) doUndo();
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
        const key = `${ui.mode}:${bands[view.focus].join('|')}:${bands[view.focus === 1 ? 2 : 1].join('|')}`;
        if (key !== ui.expandKey) { ui.expandKey = key; ui.expanded = {}; }
        hidePopover();
        renderMode();
        renderSetup();
        renderSequence();
        renderPool();
        renderExcluded();
        renderSlots(view);
        renderAgainst();
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

    function hasProgress(s) {
        return s.format === 'solo' ? Boolean(s.band.length || s.enemies.length || s.excluded.length) : s.history.length > 0;
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
            <span class="bar-score">${a.score.percent === null ? '—' : percentLabel(a.score.percent)}</span>
            <span class="sr-only">Open band analysis</span>`;
    }

    function setSheet(open) {
        $('analysisPanel').classList.toggle('is-open', open);
        $('draftBar').setAttribute('aria-expanded', String(open));
        if (open) $('analysisClose').focus();
    }

    function renderMode() {
        document.querySelectorAll('.mode-btn').forEach(button => {
            const mode = button.dataset.mode;
            button.setAttribute('aria-checked', String(mode === ui.mode));
            button.querySelector('.mode-dot').hidden = mode === ui.mode || !hasProgress(ui.states[mode]);
        });
    }

    function renderSetup() {
        const el = $('twoPlayerSetup');
        el.hidden = solo();
        if (solo()) return;
        const s = state();
        $('draftMain').classList.toggle('is-started', hasProgress(s));
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
        const extras = view.excluded.map(n => `
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

    function poolFilter(entry) {
        const f = ui.filters;
        if (!entry.available && !f.showUnavailable) return false;
        if (f.attribute !== 'All' && entry.attribute !== f.attribute) return false;
        if (f.roles.length && !f.roles.some(r => entry.battleRoles.includes(r))) return false;
        if (f.fills && !entry.fills.length) return false; // adds no role the band lacks
        const term = f.term.trim().toLowerCase();
        if (!term) return true;
        const hero = heroOf(entry.name);
        return [entry.display, entry.attribute, entry.size, entry.attackRange || '', ...entry.battleRoles, ...hero.labels]
            .some(text => text.toLowerCase().includes(term));
    }

    // Same verbs for both players: Select (pick) and Ban; Player 2's turn is marked in crimson
    const p2Turn = () => !solo() && view.step.player === 2;
    function poolCorner(entry) {
        if (!entry.available || !view.step.action) return '';
        return `<span class="tile-corner${p2Turn() ? ' tile-corner--p2' : ''}" aria-hidden="true">${view.step.action === 'ban' ? '⊘' : '+'}</span>`;
    }

    function primaryLabel(entry) {
        if (!entry.available) return `${entry.display}: ${REASON_BADGE[entry.unavailableReason]}`;
        if (!view.step.action) return entry.display;
        const verb = view.step.action === 'ban' ? 'Ban' : 'Select';
        return `${verb} ${entry.display}${solo() ? '' : ` for Player ${view.step.player}`}`;
    }

    const ranked = () => ui.sort !== 'name' && view.suggestions.items.length > 0;
    const anyCounters = () => view.pool.some(e => e.counters > 0);

    function sortPool(entries) {
        if (!ranked()) return entries;
        const rank = e => (e.suggestion ? e.suggestion.rank : Infinity);
        const counters = ui.sort === 'counters' ? e => -e.counters : () => 0;
        return [...entries].sort((a, b) => counters(a) - counters(b) || rank(a) - rank(b) || a.id - b.id);
    }

    function tileChips(entry) {
        const s = entry.suggestion;
        if (!s || !s.chips.length) return '';
        return `<span class="tile-chips">${s.chips.map(c =>
            `<span class="tile-chip tile-chip--${c.kind}" title="${escapeHtml(c.text)}"><span aria-hidden="true">${CHIP_ICON[c.kind]}</span> ${escapeHtml(c.short)}</span>`).join('')}${
            s.moreChips ? `<span class="tile-chip tile-chip--more" title="${s.moreChips} more in the details">+${s.moreChips}</span>` : ''}</span>`;
    }

    function renderPool() {
        document.querySelectorAll('#attributeFilter .chip').forEach(c =>
            c.setAttribute('aria-pressed', String(c.dataset.attribute === ui.filters.attribute)));
        document.querySelectorAll('#roleFilter .chip').forEach(c =>
            c.setAttribute('aria-pressed', String(ui.filters.roles.includes(c.dataset.role))));
        const entries = sortPool(view.pool.filter(poolFilter));
        const active = (ui.filters.attribute !== 'All') + ui.filters.roles.length + ui.filters.fills + ui.filters.showUnavailable;
        $('filtersToggle').textContent = active ? `Filters (${active})` : 'Filters';
        $('poolCount').textContent = `${view.counts.available} available · ${view.counts.unavailable} unavailable`
            + (entries.length < (ui.filters.showUnavailable ? 36 : view.counts.available) ? ` · ${entries.length} shown` : '');
        // Random respects the filters: it picks (or bans) among the available heroes shown
        const action = view.step.action;
        const randomBtn = $('randomHero');
        const randomLabel = action ? `${action === 'ban' ? 'Ban' : 'Select'} a random hero${solo() ? '' : ` for Player ${view.step.player}`}` : 'Random hero';
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
                Object.assign(ui.filters, { term: '', attribute: 'All', roles: [], fills: false });
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
            if (act === 'menu') openMenu(name, event.target.closest('button'));
            else if (act === 'primary' && narrow()) {
                // Touch / small screens: the first tap explains the hero, the sheet's button acts
                if (view.pool.find(p => p.name === name)?.suggestion) showPopover(name, tile, { sheet: true });
                else openMenu(name, tile.querySelector('.tile-menu-btn'));
            } else if (act === 'primary' && Draft.isAvailable(state(), name)) primaryAction(name);
        });
        // Long-press opens the ⋯ menu
        let pressTimer = null;
        let suppressClick = false;
        grid.addEventListener('touchstart', event => {
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            pressTimer = setTimeout(() => { suppressClick = true; openMenu(tile.dataset.hero, tile.querySelector('.tile-menu-btn')); }, 550);
        }, { passive: true });
        ['touchend', 'touchmove', 'touchcancel'].forEach(type => grid.addEventListener(type, () => clearTimeout(pressTimer), { passive: true }));
        grid.addEventListener('contextmenu', event => {
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            event.preventDefault();
            openMenu(tile.dataset.hero, tile.querySelector('.tile-menu-btn'));
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
            if (narrow()) return;
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
        if ($('tilePopover').classList.contains('is-sheet')) return;
        preview(null);
        hidePopover();
    }

    // ---- Tile popover (desktop: next to the tile; phones: a bottom sheet with the action) ---

    // `side`: where to put the desktop popover beside the tile ('left' | 'right'), if there is room
    function showPopover(name, tile, { sheet = false, side = 'right' } = {}) {
        const entry = view.pool.find(p => p.name === name);
        const s = entry && entry.suggestion;
        const pop = $('tilePopover');
        if (!s) return hidePopover();
        ui.pop = name;
        const p = view.suggestions.player;
        const ban = view.suggestions.action === 'ban';
        const rival = p === 1 ? 2 : 1;
        const forWhom = solo() ? '' : ` for Player ${p}`;
        const verb = ban ? 'Ban' : 'Select';
        // The desktop popover can't be clicked: Fill band lives in the ⋯ menu there, and in the phone sheet
        const canFill = sheet && solo() && !ban && s.bestWith.length > 0;
        pop.innerHTML = `
            <div class="pop-head">
                <span class="pop-rank">#${s.rank}</span>
                <h3 class="pop-name" id="popHeading">${escapeHtml(entry.display)}<small>${escapeHtml(forWhom)}</small></h3>
                <button class="icon-btn pop-close" type="button" data-pop="close" aria-label="Close">✕</button>
            </div>
            <p class="pop-score">${ban ? `Player ${rival}'s best band with ${escapeHtml(entry.display)}` : 'Best band with this hero'}:
                <strong>${s.percentLabel}</strong></p>
            ${s.bestWith.length ? `<p class="pop-best">Best with: <strong>${s.bestWith.map(display).map(escapeHtml).join(' + ')}</strong></p>` : ''}
            ${reasonGroups(s.reasons).map(g => `<section class="reason-group">
                <h4 class="mini-heading">${g.label}</h4>
                <ul class="reason-list">${g.reasons.map(r =>
                    `<li class="reason reason--${r.kind} rtype--${g.type}">${escapeHtml(r.text)}</li>`).join('')}</ul>
            </section>`).join('') || '<p class="muted">No specific reasons.</p>'}
            <div class="pop-actions">
                ${entry.available && view.step.action ? `<button class="btn ${ban ? 'btn-crimson' : 'btn-gold'} pop-primary" type="button" data-pop="primary">${verb}${escapeHtml(forWhom)}</button>` : ''}
                ${canFill ? `<button class="btn btn-ghost" type="button" data-pop="fill">Fill band</button>` : ''}
            </div>`;
        pop.dataset.hero = name;
        pop.hidden = false;
        pop.classList.toggle('is-sheet', sheet);
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
    }

    function hidePopover() {
        const pop = $('tilePopover');
        if (pop.hidden) return;
        pop.hidden = true;
        pop.classList.remove('is-sheet');
        ui.pop = null;
        document.querySelectorAll('#poolGrid .is-popped').forEach(t => t.classList.remove('is-popped'));
    }

    function fillBand(name) {
        const s = view.pool.find(p => p.name === name)?.suggestion;
        if (!s) return;
        const missing = s.bestBand.filter(n => !state().band.includes(n));
        attempt(st => Draft.fillBand(st, missing), () => `Band filled: ${s.bestBand.map(display).join(', ')}. ${summary()}`);
    }

    function setupPopover() {
        const pop = $('tilePopover');
        pop.addEventListener('click', event => {
            const act = event.target.closest('[data-pop]')?.dataset.pop;
            const name = pop.dataset.hero;
            if (!act) return;
            const tile = document.querySelector(`#poolGrid [data-hero="${name}"] .tile-main`);
            hidePopover();
            if (act === 'primary') primaryAction(name);
            else if (act === 'fill') fillBand(name);
            else tile?.focus();
        });
        document.addEventListener('click', event => {
            if (!pop.hidden && pop.classList.contains('is-sheet') && !pop.contains(event.target) && !event.target.closest('#poolGrid')) {
                hidePopover();
                preview(null);
            }
        });
    }

    function renderExcluded() {
        const list = view.excluded;
        const editable = solo();
        $('excludedBox').hidden = !solo(); // two-player extra bans live in the turn tracker
        $('excludedTitle').textContent = solo() ? 'Excluded' : 'Carry-over bans';
        $('addExcluded').hidden = !editable;
        $('addExcluded').textContent = solo() ? '+ Exclude hero' : '+ Add ban';
        $('excludedChips').innerHTML = list.length
            ? list.map(n => `<span class="ex-chip">${escapeHtml(display(n))}${editable
                ? `<button type="button" data-remove="${n}" aria-label="Remove ${escapeHtml(display(n))} from ${solo() ? 'excluded' : 'carry-over bans'}">✕</button>` : ''}</span>`).join('')
            : `<span class="muted">${solo() ? 'None. Exclude heroes you cannot use.' : 'None. Add heroes banned last game.'}</span>`;
    }

    // ---- Band slots ----------------------------------------------------------------------

    function slotHtml(slot, { editable, choosable, count, fate }) {
        if (!slot.hero) {
            return `<div class="slot is-empty" data-slot="${slot.index}" data-drop="slot">
                <span class="slot-num">${slot.index + 1}</span>
                <button class="slot-add" type="button" data-act="choose" ${choosable ? '' : 'disabled'}>
                    <span class="slot-plus" aria-hidden="true">+</span>Choose ${['1st', '2nd', '3rd'][slot.index]} hero</button>
                ${choosable && fate ? `<button class="slot-fate" type="button" data-act="random"
                    title="A random hero from those shown in the pool">${icon('Dice')}or let fate decide</button>` : ''}
            </div>`;
        }
        const hero = heroOf(slot.hero);
        const canEdit = editable && !slot.preview;
        return `<div class="slot attr--${hero.attribute}${slot.preview ? ' is-preview' : ''}" data-slot="${slot.index}"
                    data-hero="${slot.hero}" data-drop="slot" ${canEdit ? 'draggable="true" tabindex="0"' : ''}
                    aria-label="${slot.index + 1}. ${escapeHtml(display(slot.hero))}${slot.preview ? ' (preview)' : ''}">
            <span class="slot-num slot-num--id" title="Card number">#${hero.id}</span>
            ${banner(hero.attribute)}
            ${slot.preview ? '<span class="slot-ribbon">Preview</span>' : ''}
            ${canEdit ? `<button class="slot-remove" type="button" data-act="remove" aria-label="Remove ${escapeHtml(display(slot.hero))}">✕</button>` : ''}
            ${tokenPortrait(slot.hero, 'slot-portrait')}
            <span class="slot-name">${escapeHtml(display(slot.hero))}</span>
            ${rolePills(Draft.battleRoles(hero))}
            ${canEdit ? `<span class="slot-move">
                <button type="button" data-act="left" aria-label="Move ${escapeHtml(display(slot.hero))} earlier" ${slot.index === 0 ? 'disabled' : ''}>◀</button>
                <button type="button" data-act="right" aria-label="Move ${escapeHtml(display(slot.hero))} later" ${slot.index >= count - 1 ? 'disabled' : ''}>▶</button>
            </span>` : ''}
        </div>`;
    }

    // Solo: your band (editable). Two-player: Player 1 here and Player 2 in the second section.
    // Only the next empty slot offers a random hero
    const fateIndex = slots => slots.findIndex(x => !x.hero);
    function renderSlots(v) {
        const picking = v.step.action === 'pick';
        if (v.mode === 'solo') {
            const count = v.slots.filter(x => x.hero && !x.preview).length;
            const fate = fateIndex(v.slots);
            $('bandSlots').innerHTML = v.slots.map(x => slotHtml(x, { editable: true, choosable: picking, count, fate: x.index === fate })).join('');
            return;
        }
        const row = p => p.slots.map(x => slotHtml(x, { editable: false, choosable: picking && p.acting, fate: x.index === fateIndex(p.slots) })).join('');
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
    function rollRandom() {
        if (rolling) return;
        const candidates = view.pool.filter(e => e.available && poolFilter(e)).map(e => e.name);
        const name = Draft.randomHero(state(), candidates);
        if (!name) { announce('No available hero matches these filters.'); return; }
        const start = state();
        const tileOf = n => document.querySelector(`#poolGrid [data-hero="${n}"]`);
        const light = n => document.querySelectorAll('#poolGrid .is-rolled, #poolGrid .is-fated')
            .forEach(t => { if (t.dataset.hero !== n) t.classList.remove('is-rolled', 'is-fated'); });
        const land = () => {
            rolling = false;
            light(null);
            $('poolGrid').classList.remove('is-rolling');
            if (state() !== start) return;
            primaryAction(name);
            document.querySelector(`.slot[data-hero="${name}"]`)?.classList.add('is-arrived');
        };
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { land(); return; }
        rolling = true;
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

    function moveSlot(index, delta) {
        const to = index + delta;
        attempt(s => Draft.movePick(s, index, to), 'Band reordered.');
        requestAnimationFrame(() => document.querySelector(`#bandSlots [data-slot="${to}"]`)?.focus());
    }

    function setupSlots() {
        const slots = $('bandSlots');
        slots.addEventListener('click', event => {
            const slot = event.target.closest('[data-slot]');
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (!slot || !act) return;
            const index = Number(slot.dataset.slot);
            if (act === 'remove') attempt(s => Draft.removePick(s, slot.dataset.hero), `Removed ${display(slot.dataset.hero)}.`);
            else if (act === 'left') moveSlot(index, -1);
            else if (act === 'right') moveSlot(index, 1);
            else if (act === 'choose') choosePrompt();
            else if (act === 'random') rollRandom();
        });
        slots.addEventListener('keydown', event => {
            const slot = event.target.closest('[data-slot][data-hero]');
            if (!slot || !solo() || !event.altKey) return;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                const index = Number(slot.dataset.slot);
                const to = index + (event.key === 'ArrowLeft' ? -1 : 1);
                if (to >= 0 && to < state().band.length) moveSlot(index, to - index);
            }
        });
        slots.addEventListener('dragstart', event => {
            const slot = event.target.closest('[data-slot][data-hero]');
            if (slot) event.dataTransfer.setData('text/slot', slot.dataset.slot);
        });
        setupDrop(slots, (event, data) => {
            const target = event.target.closest('[data-slot]');
            if (data.slot !== undefined && target && target.dataset.hero) {
                const to = Number(target.dataset.slot);
                if (to !== Number(data.slot)) attempt(s => Draft.movePick(s, Number(data.slot), to), 'Band reordered.');
            } else if (data.hero && view.step.action === 'pick') {
                primaryAction(data.hero);
            }
        });
    }

    // Drop zones accept pool heroes (text/hero) and band slots (text/slot)
    function setupDrop(el, onDrop) {
        el.addEventListener('dragover', event => {
            const types = [...event.dataTransfer.types];
            if (types.includes('text/hero') || types.includes('text/slot')) {
                event.preventDefault();
                el.classList.add('is-drop-target');
            }
        });
        el.addEventListener('dragleave', event => { if (!el.contains(event.relatedTarget)) el.classList.remove('is-drop-target'); });
        el.addEventListener('drop', event => {
            event.preventDefault();
            el.classList.remove('is-drop-target');
            const hero = event.dataTransfer.getData('text/hero');
            const slot = event.dataTransfer.getData('text/slot');
            onDrop(event, { hero: hero || null, slot: slot === '' ? undefined : slot });
        });
    }

    // ---- Against row and bans ------------------------------------------------------------

    function renderAgainst() {
        $('bandHeading').textContent = solo() ? 'Your Band' : 'Player 1';
        $('againstHeading').textContent = solo() ? 'Against' : 'Player 2';
        $('againstHeading').classList.toggle('draft-heading--enemy', solo());
        $('againstHint').textContent = solo() ? 'Heroes you expect to face' : '';
        $('againstRow').classList.toggle('slots', !solo());
        $('addEnemy').hidden = !solo() || view.against.length >= 3;
        if (!solo()) return; // Player 2's band is drawn by renderSlots
        ['bandSection', 'againstSection'].forEach(id => $(id).classList.remove('is-acting', 'is-p2'));
        ['bandTurn', 'againstTurn'].forEach(id => { $(id).hidden = true; });
        $('againstRow').innerHTML = view.against.length
            ? view.against.map(n => {
                const hero = heroOf(n);
                return `<div class="enemy-card attr--${hero.attribute}">
                    ${banner(hero.attribute)}
                    <button class="slot-remove" type="button" data-remove="${n}" aria-label="Stop facing ${escapeHtml(display(n))}">✕</button>
                    ${portrait(n, 'enemy-portrait')}
                    <span class="enemy-name">${icon('Attacker', 'ico enemy-mark')} ${escapeHtml(display(n))}</span>
                    ${rolePills(Draft.battleRoles(hero))}
                </div>`;
            }).join('')
            : '<p class="empty-note">Add heroes you expect to face to get counter-picks.</p>';
    }

    function setupAgainst() {
        $('againstRow').addEventListener('click', event => {
            if (event.target.closest('[data-act="choose"]')) { choosePrompt(); return; }
            if (event.target.closest('[data-act="random"]')) { rollRandom(); return; }
            const name = event.target.closest('[data-remove]')?.dataset.remove;
            if (name) attempt(s => Draft.setEnemies(s, s.enemies.filter(n => n !== name)), `No longer facing ${display(name)}.`);
        });
        $('excludedChips').addEventListener('click', event => {
            const name = event.target.closest('[data-remove]')?.dataset.remove;
            if (!name) return;
            if (solo()) attempt(s => Draft.setExcluded(s, s.excluded.filter(n => n !== name)), `${display(name)} is available again.`);
            else setCarryOver(state().carryOverBans.filter(n => n !== name));
        });
        setupDrop($('againstRow'), (event, data) => {
            if (!data.hero) return;
            if (solo()) attempt(s => Draft.setEnemies(s, [...s.enemies, data.hero]), `Facing ${display(data.hero)}.`);
            else if (view.step.player === 2 && view.step.action === 'pick') primaryAction(data.hero);
        });
        setupDrop($('excludedChips'), (event, data) => {
            if (data.hero && solo()) attempt(s => Draft.setExcluded(s, [...s.excluded, data.hero]), `Excluded ${display(data.hero)}.`);
        });
    }

    function setCarryOver(names) {
        const s = state();
        commit(Draft.createDraft(s.format, { carryOverBans: names }));
    }

    // ---- Step header (pool) --------------------------------------------------------------

    function renderStep() {
        const { action } = view.suggestions;
        $('stepLabel').textContent = action ? `${view.step.label} · ${action} a hero` : view.step.label;
        $('stepLabel').className = `step-badge${p2Turn() ? ' step-badge--p2' : ''}${action ? '' : ' step-badge--done'}`;
        const hasRanks = view.suggestions.items.length > 0;
        document.querySelector('.sort-switch').hidden = !hasRanks;
        const counters = anyCounters();
        if (!counters && ui.sort === 'counters') ui.sort = 'recommended';
        document.querySelector('.sort-switch [data-sort="counters"]').hidden = !counters;
        document.querySelectorAll('.sort-switch [data-sort]').forEach(b =>
            b.setAttribute('aria-checked', String(b.dataset.sort === ui.sort)));
        $('completeNote').hidden = !view.complete;
        $('completeText').textContent = solo() ? 'Band complete.' : 'Draft complete.';
    }

    // ---- Analysis ------------------------------------------------------------------------

    function renderAnalysis(v) {
        const a = v.analysis;
        const whose = solo() ? 'Your band' : `Player ${v.focus}'s band`;
        $('focusSwitch').hidden = solo();
        document.querySelectorAll('#focusSwitch [data-focus]').forEach(b =>
            b.setAttribute('aria-checked', String(Number(b.dataset.focus) === v.focus)));
        $('balanceSummary').textContent = `${whose} covers ${a.coveredCount} of 3 roles`;
        $('roleList').innerHTML = a.roles.map(r => `
            <li class="role-row${r.coveredBy ? ' is-covered' : ''}${r.change ? ' is-changed' : ''}">
                ${icon(r.role, 'ico role-ico')}<span class="role-name">${r.role}</span>
                <span class="role-status">${r.coveredBy ? `✓ ${escapeHtml(display(r.coveredBy))}` : '○ Missing'}</span>
            </li>`).join('');
        $('scoreCaption').textContent = a.score.complete ? whose : 'Best band still reachable';
        $('bandScore').textContent = a.score.percent === null ? '—' : percentLabel(a.score.percent);
        $('scoreBar').style.width = a.score.percent === null ? '0%' : `${Math.max(3, 100 - a.score.percent)}%`;
        $('scoreDetail').textContent = a.score.change
            ? `Preview: ${a.score.change.from === null ? '—' : percentLabel(a.score.change.from)} → ${percentLabel(a.score.change.to)}`
            : 'Share of all possible 3-hero bands that score at least as well.';
        $('scoreDetail').classList.toggle('is-changed', Boolean(a.score.change));

        $('threatHeading').textContent = solo() ? 'Threats from Against' : `Threats from Player ${v.focus === 1 ? 2 : 1}`;
        $('threatBlock').hidden = !a.threats.length;
        $('threatList').innerHTML = moreList('threats', a.threats, t =>
            `<li class="reason reason--warning${t.preview ? ' is-changed' : ''}">${escapeHtml(t.text)}${t.preview ? ' (preview)' : ''}</li>`);
        $('synergyBlock').hidden = !a.synergyGroups.length;
        $('synergyList').innerHTML = moreList('synergy', a.synergyGroups, synergyRow);
        $('viewInGraph').disabled = !Draft.bands(state())[v.focus].length;
    }

    // "Toxicum ← Equita (Poison), Tempus (Swiftness, cooldowns)"
    const synergyRow = g => `<li class="syn-group${g.preview ? ' is-changed' : ''}">
        <strong class="syn-hero">${escapeHtml(g.display)}</strong> <span class="syn-arrow" aria-label="helped by">←</span>
        <span>${escapeHtml(groupText(g))}</span>${g.preview ? ' <span class="syn-new">(preview)</span>' : ''}</li>`;

    // A list showing LIST_LIMIT items, then one "Show N more" button that expands in place
    function moreList(key, items, row) {
        const c = collapse(items, LIST_LIMIT, Boolean(ui.expanded[key]));
        const id = `more-${key}`;
        return `<ul class="reason-list" id="${id}">${c.items.map(row).join('')}</ul>${c.hidden
            ? `<button class="link-btn more-btn" type="button" data-more="${key}" aria-controls="${id}" aria-expanded="${c.expanded}">
                ${c.expanded ? 'Show fewer' : `Show ${c.hidden} more`}</button>` : ''}`;
    }

    // ---- Reference cards modal (finished draft, or a shared link) ---------------------------

    const cardsState = () => (ui.shared ? ui.shared.state : state());
    const cardsMode = () => (cardsState().format === 'solo' ? 'solo' : 'two-player');

    function openCards() {
        renderCards();
        if (!$('cardsDialog').open) $('cardsDialog').showModal();
        $('cardsSwitch').querySelector('[aria-checked="true"]')?.focus();
    }

    function renderCards() {
        const sides = referenceSides(cardsState());
        const mode = cardsMode();
        if (!sides.some(x => x.key === ui.cardSide[mode])) ui.cardSide[mode] = sides[0].key;
        const side = sides.find(x => x.key === ui.cardSide[mode]);
        $('cardsTitle').textContent = ui.shared ? 'Shared draft · reference cards' : 'Reference cards';
        $('cardsSwitch').hidden = sides.length < 2;
        $('cardsSwitch').innerHTML = sides.map(x =>
            `<button type="button" role="radio" data-side="${x.key}" aria-checked="${x === side}">${escapeHtml(x.label)}</button>`).join('');
        const ready = window.BestiaryGraph && window.BestiaryGraph.ready;
        $('cardTrack').innerHTML = side.heroes.map(name => `
            <article class="ref-card" aria-label="${escapeHtml(display(name))} reference card">
                ${ready ? window.BestiaryGraph.heroCard(name) : '<p class="muted">Loading the card…</p>'}
            </article>`).join('');
    }

    function shareUrl(s) {
        return `${location.href.split('#')[0]}#${encodeDraft(s, ctx.heroes)}`;
    }

    function setupCards() {
        const dialog = $('cardsDialog');
        $('cardsSwitch').addEventListener('click', event => {
            const button = event.target.closest('[data-side]');
            if (!button) return;
            ui.cardSide[cardsMode()] = button.dataset.side;
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
            if (navigator.share && narrow()) navigator.share({ title: 'Bestiary of Sigillum draft', url }).catch(() => {});
            else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link copied. Opening it shows these cards.'), () => toast(url));
            else toast(url);
        });
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
        // Closing a shared draft's cards returns to your own draft
        dialog.addEventListener('close', () => {
            if (!ui.shared) return;
            ui.shared = null;
            if (ui.tab === 'draft') history.replaceState(history.state, '', '#draft');
        });
    }

    // ---- Hero picker dialog (Against, Excluded, carry-over bans) --------------------------

    const PICKER = {
        enemy: { title: 'Add an enemy to face', can: n => Draft.isAvailable(state(), n),
            run: n => attempt(s => Draft.setEnemies(s, [...s.enemies, n]), `Facing ${display(n)}.`) },
        exclude: { title: 'Exclude a hero', can: n => Draft.isAvailable(state(), n),
            run: n => attempt(s => Draft.setExcluded(s, [...s.excluded, n]), `Excluded ${display(n)}.`) },
        carry: { title: 'Add an extra ban', can: n => !state().carryOverBans.includes(n),
            run: n => setCarryOver([...state().carryOverBans, n]) },
        pick: { title: 'Choose a hero', can: n => Draft.isAvailable(state(), n), run: n => primaryAction(n) }
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
    function openMenu(name, anchor) {
        const s = state();
        const available = Draft.isAvailable(s, name);
        const step = Draft.currentStep(s);
        const items = [];
        if (available && step) {
            const verb = step.action === 'ban' ? 'Ban' : 'Select';
            items.push(['primary', solo() ? verb : `${verb} for Player ${step.player}`]);
        }
        const suggestion = view.pool.find(p => p.name === name)?.suggestion;
        if (solo() && available && step && suggestion && suggestion.bestWith.length) {
            items.push(['fill', `Fill band: + ${suggestion.bestWith.map(display).join(' + ')}`]);
        }
        if (solo() && available && s.enemies.length < 3) items.push(['enemy', 'Add to Against']);
        if (solo() && available) items.push(['exclude', 'Exclude']);
        if (solo() && s.enemies.includes(name)) items.push(['unface', 'Stop facing']);
        if (solo() && s.excluded.includes(name)) items.push(['unexclude', 'Make available']);
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
            closeMenu(false);
            if (act === 'primary') primaryAction(name);
            else if (act === 'fill') fillBand(name);
            else if (act === 'enemy') attempt(s => Draft.setEnemies(s, [...s.enemies, name]), `Facing ${display(name)}.`);
            else if (act === 'exclude') attempt(s => Draft.setExcluded(s, [...s.excluded, name]), `Excluded ${display(name)}.`);
            else if (act === 'unface') attempt(s => Draft.setEnemies(s, s.enemies.filter(n => n !== name)), `No longer facing ${display(name)}.`);
            else if (act === 'unexclude') attempt(s => Draft.setExcluded(s, s.excluded.filter(n => n !== name)), `${display(name)} is available again.`);
            else if (act === 'graph') { setTab('graph'); window.BestiaryGraph?.selectHero(name); }
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
            if (ui.tab !== 'draft') return;
            const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
            if (event.key === 'Escape') {
                if (!$('cardMenu').hidden) closeMenu();
                else if (!$('tilePopover').hidden) { hidePopover(); preview(null); }
                else if ($('analysisPanel').classList.contains('is-open')) setSheet(false);
                return;
            }
            if ($('cardsDialog').open || $('heroPicker').open) return;
            if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                doUndo();
            } else if (!typing && event.key === '/') {
                event.preventDefault();
                $('poolSearch').focus();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
