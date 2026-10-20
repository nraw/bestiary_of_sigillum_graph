// Draft tab: DOM rendering and interaction for the draft assistant.
// All draft rules and scoring live in draft.js; draft-view.js turns them into the view object
// this file draws (both unit tested). Only DOM, events and persistence live here.
(function () {
    const Draft = window.Draft;
    const { draftView, percentLabel } = window.DraftView;
    const { escapeHtml, vitalityTokensSvg } = window.GraphLogic;
    const { titleCase } = window.Synergy;

    const STORAGE_KEY = 'bestiary-draft-v1';
    const ATTRIBUTES = ['Strength', 'Agility', 'Intelligence'];
    const FORMAT_INFO = {
        standard: { label: 'Standard', hint: 'Alternate picks until each player has 3' },
        'ban-first': { label: 'Ban phase first', hint: 'Each player bans 3, alternating, then picks' },
        interleaved: { label: 'Interleaved', hint: 'Ban 1 each, pick 1 each, three times' }
    };
    const REASON_BADGE = { picked: 'Picked', facing: 'Facing', excluded: 'Excluded', banned: 'Banned', player1: 'Player 1', player2: 'Player 2' };

    const ICON = {
        Strength: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 8v8M8.5 12h7"/>',
        Agility: '<path d="M12 3 21 20H3z"/><path d="M12 8.5v8M10 14.5h4"/>',
        Intelligence: '<path d="M3 6c3-1 6-1 9 1 3-2 6-2 9-1v13c-3-1-6-1-9 1-3-2-6-2-9-1z"/><path d="M12 7v13"/>',
        Controller: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
        Attacker: '<path d="M5 5l11 11M19 5 8 16"/><path d="M14 18l4-4M6 14l4 4"/>',
        Supporter: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v9M7.5 12h9"/>'
    };
    const icon = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

    let ctx = null;
    let view = null;
    let lastReset = null;
    const ui = {
        tab: 'graph',
        mode: 'two-player',
        states: { solo: Draft.createDraft('solo'), 'two-player': Draft.createDraft('standard') },
        filters: { term: '', attribute: 'All', roles: [], fills: false, showUnavailable: false }, // roles combine with OR
        sort: 'recommended',
        focus: null, // two-player analysis: null follows whoever acts, or a chosen player
        picker: null
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
    const rolePills = roles => `<span class="role-pills">${roles.map(r =>
        `<span class="role-pill role--${r}" title="${r}">${icon(r)}<span class="sr-only">${r}</span></span>`).join('')}</span>`;
    const banner = attribute =>
        `<span class="attr-banner attr--${attribute}" title="${attribute}">${icon(attribute)}<span class="sr-only">${attribute}</span></span>`;

    // ---- Setup ---------------------------------------------------------------------------

    async function init() {
        try {
            const response = await fetch('bestiary_reference_cards.json');
            const data = await response.json();
            ctx = Draft.createContext(data.bestiary_of_sigillum.characters);
            restore();
            setupTabs();
            setupStatic();
            render();
            setTab(location.hash === '#draft' ? 'draft' : 'graph', { focus: false });
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
        history.replaceState(null, '', tab === 'draft' ? '#draft' : location.pathname + location.search);
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

        setupPool();
        setupSlots();
        setupAgainst();
        setupCompletions();
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

    function doReset() {
        // No confirmation: the toast offers Undo instead
        lastReset = { mode: ui.mode, state: state() };
        const fresh = solo() ? Draft.createDraft('solo')
            : Draft.createDraft(state().format, { carryOverBans: state().carryOverBans });
        commit(fresh, 'Cleared.');
        toast('Cleared.', { label: 'Undo', run: () => {
            if (!lastReset) return;
            ui.mode = lastReset.mode;
            commit(lastReset.state, 'Restored.');
            lastReset = null;
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
        renderMode();
        renderSetup();
        renderSequence();
        renderPool();
        renderExcluded();
        renderSlots(view);
        renderAgainst();
        renderStep();
        showWhy(null);
        renderCompletions();
        renderAnalysis(view);
        $('undoBtn').disabled = Draft.undo(state()) === state();
        persist();
    }

    // Hover / focus preview: only the band slots and the analysis change
    let previewKey = null;
    function preview(heroes) {
        const key = heroes ? [].concat(heroes).join('|') : null;
        if (key === previewKey) return;
        previewKey = key;
        const v = heroes ? draftView(state(), ctx, { preview: heroes, player: ui.focus }) : view;
        renderSlots(v);
        renderAnalysis(v);
    }

    function hasProgress(s) {
        return s.format === 'solo' ? Boolean(s.band.length || s.enemies.length || s.excluded.length) : s.history.length > 0;
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
    }

    // ---- Pool ----------------------------------------------------------------------------

    function poolFilter(entry) {
        const f = ui.filters;
        if (!entry.available && !f.showUnavailable) return false;
        if (f.attribute !== 'All' && entry.attribute !== f.attribute) return false;
        if (f.roles.length && !f.roles.some(r => entry.battleRoles.includes(r))) return false;
        if (f.fills) {
            const missing = view.analysis.roles.filter(r => !r.coveredBy).map(r => r.role);
            if (!entry.battleRoles.some(r => missing.includes(r))) return false;
        }
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

    function sortPool(entries) {
        if (ui.sort !== 'recommended' || !view.suggestions.items.length) return entries;
        const rank = e => (e.suggestion ? e.suggestion.rank : Infinity);
        return [...entries].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
    }

    function tileRank(entry) {
        const s = entry.suggestion;
        if (!s || ui.sort !== 'recommended') return '';
        return `<span class="tile-rank${s.rank <= 3 ? ' is-top' : ''}" title="Rank ${s.rank}; best band with this hero: ${s.percentLabel}">
            #${s.rank} · ${s.percentLabel}</span>`;
    }

    function renderPool() {
        document.querySelectorAll('#attributeFilter .chip').forEach(c =>
            c.setAttribute('aria-pressed', String(c.dataset.attribute === ui.filters.attribute)));
        document.querySelectorAll('#roleFilter .chip').forEach(c =>
            c.setAttribute('aria-pressed', String(ui.filters.roles.includes(c.dataset.role))));
        const entries = sortPool(view.pool.filter(poolFilter));
        $('poolCount').textContent = `${view.counts.available} available · ${view.counts.unavailable} unavailable`
            + (entries.length < (ui.filters.showUnavailable ? 36 : view.counts.available) ? ` · ${entries.length} shown` : '');
        if (!entries.length) {
            $('poolGrid').innerHTML = `<p class="empty-note">No heroes match these filters.
                <button class="link-btn" type="button" data-act="clear-filters">Clear filters</button></p>`;
            return;
        }
        $('poolGrid').innerHTML = entries.map(e => `
            <div class="hero-tile attr--${e.attribute}${e.available ? '' : ` is-unavailable is-${e.unavailableReason}`}${e.suggestion && e.suggestion.rank <= 3 && ui.sort === 'recommended' ? ' is-top' : ''}"
                 role="listitem" data-hero="${e.name}" ${e.available ? 'draggable="true"' : ''}>
                <button class="tile-main" type="button" data-act="primary" aria-label="${escapeHtml(primaryLabel(e))}"
                        ${e.available && view.step.action ? '' : 'aria-disabled="true"'}>
                    ${banner(e.attribute)}
                    ${tokenPortrait(e.name, 'tile-portrait')}
                    <span class="tile-name">${escapeHtml(e.display)}</span>
                    ${rolePills(e.battleRoles)}
                    ${tileRank(e)}
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
            if (act === 'menu') openMenu(tile.dataset.hero, event.target.closest('button'));
            else if (act === 'primary' && Draft.isAvailable(state(), tile.dataset.hero)) primaryAction(tile.dataset.hero);
        });
        grid.addEventListener('contextmenu', event => {
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            event.preventDefault();
            openMenu(tile.dataset.hero, tile.querySelector('.tile-menu-btn'));
        });
        const hover = event => {
            const tile = event.target.closest('[data-hero]');
            const pickable = tile && view.step.action === 'pick' && Draft.isAvailable(state(), tile.dataset.hero);
            preview(pickable ? tile.dataset.hero : null);
            showWhy(tile ? tile.dataset.hero : null);
        };
        const leave = () => { preview(null); showWhy(null); };
        grid.addEventListener('mouseover', hover);
        grid.addEventListener('focusin', hover);
        grid.addEventListener('mouseleave', leave);
        grid.addEventListener('focusout', event => { if (!grid.contains(event.relatedTarget)) leave(); });
        grid.addEventListener('dragstart', event => {
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            event.dataTransfer.setData('text/hero', tile.dataset.hero);
            event.dataTransfer.effectAllowed = 'copy';
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

    function slotHtml(slot, { editable, choosable, count }) {
        if (!slot.hero) {
            return `<div class="slot is-empty" data-slot="${slot.index}" data-drop="slot">
                <span class="slot-num">${slot.index + 1}</span>
                <button class="slot-add" type="button" data-act="choose" ${choosable ? '' : 'disabled'}>
                    <span class="slot-plus" aria-hidden="true">+</span>Choose ${['1st', '2nd', '3rd'][slot.index]} hero</button>
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
    function renderSlots(v) {
        const picking = v.step.action === 'pick';
        if (v.mode === 'solo') {
            const count = v.slots.filter(x => x.hero && !x.preview).length;
            $('bandSlots').innerHTML = v.slots.map(x => slotHtml(x, { editable: true, choosable: picking, count })).join('');
            return;
        }
        const row = p => p.slots.map(x => slotHtml(x, { editable: false, choosable: picking && p.acting })).join('');
        $('bandSlots').innerHTML = row(v.players[0]);
        $('againstRow').innerHTML = row(v.players[1]);
        [['bandSection', 'bandTurn', v.players[0]], ['againstSection', 'againstTurn', v.players[1]]].forEach(([section, tag, p]) => {
            $(section).classList.toggle('is-acting', p.acting);
            $(section).classList.toggle('is-p2', p.player === 2);
            $(tag).hidden = !p.acting;
            $(tag).textContent = p.acting ? (v.step.action === 'ban' ? 'Banning now' : 'Picking now') : '';
        });
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
            else if (act === 'choose') {
                const first = document.querySelector('#poolGrid .hero-tile:not(.is-unavailable) .tile-main');
                if (first) first.focus(); else openPicker('pick');
            }
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
            if (event.target.closest('[data-act="choose"]')) {
                document.querySelector('#poolGrid .hero-tile:not(.is-unavailable) .tile-main')?.focus();
                return;
            }
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
        $('draftIntro').hidden = !view.intro;
        $('draftIntro').textContent = view.intro || '';
        const ranked = view.suggestions.items.length > 0;
        document.querySelector('.sort-switch').hidden = !ranked;
        document.querySelectorAll('.sort-switch [data-sort]').forEach(b =>
            b.setAttribute('aria-checked', String(b.dataset.sort === ui.sort)));
    }

    // ---- Why a hero (analysis column, on hover / focus) -----------------------------------

    function showWhy(name) {
        const entry = name && view.pool.find(p => p.name === name);
        const s = entry && entry.suggestion;
        $('whyBlock').hidden = !s;
        if (!s) return;
        const p = view.suggestions.player;
        $('whyHeading').textContent = `#${s.rank} ${entry.display}${solo() ? '' : ` for Player ${p}`}`;
        $('whySummary').textContent = view.suggestions.action === 'ban'
            ? `Player ${p === 1 ? 2 : 1}'s best band with ${entry.display}: ${s.percentLabel}`
            : `Best band with ${entry.display}: ${s.percentLabel}${s.bestBand ? ` (${s.bestBand.map(display).join(', ')})` : ''}`;
        $('whyList').innerHTML = s.reasons.map(r =>
            `<li class="reason reason--${r.kind}">${escapeHtml(r.text)}</li>`).join('') || '<li class="muted">No specific reasons.</li>';
    }

    function setupCompletions() {
        const completions = $('completionList');
        completions.addEventListener('click', event => {
            const swap = event.target.closest('[data-swap-in]');
            if (swap) {
                const { swapOut, swapIn } = swap.dataset;
                attempt(s => Draft.replacePick(s, swapOut, swapIn), () => `Swapped ${display(swapOut)} for ${display(swapIn)}. ${summary()}`);
                return;
            }
            const card = event.target.closest('[data-band]');
            if (card) fillFromBand(card.dataset.band.split(','));
            if (event.target.closest('[data-act="copy"]')) copyBand();
        });
        const hover = event => {
            const card = event.target.closest('[data-band]');
            preview(card ? card.dataset.band.split(',') : null);
        };
        completions.addEventListener('mouseover', hover);
        completions.addEventListener('focusin', hover);
        completions.addEventListener('mouseleave', () => preview(null));
    }

    function fillFromBand(heroes) {
        const missing = heroes.filter(n => !Draft.bands(state())[view.step.player].includes(n));
        if (solo()) attempt(s => Draft.fillBand(s, missing), () => `Band filled: ${heroes.map(display).join(', ')}. ${summary()}`);
        else if (missing.length) primaryAction(missing[0]); // later picks are future turns
    }

    function renderCompletions() {
        const section = $('completionSection');
        if (view.completions) {
            section.hidden = false;
            $('completionHeading').textContent = solo() ? 'Complete Your Band' : `Complete Player ${view.step.player}'s Band`;
            $('completionHint').textContent = solo() ? 'Full 3-hero bands built on your current picks'
                : `Full bands built on Player ${view.step.player}'s picks; choosing one selects its next hero`;
            $('completionList').innerHTML = view.completions.map(c => `
                <button class="band-card" type="button" data-band="${c.heroes.join(',')}"
                        aria-label="${solo() ? 'Use' : 'Aim for'} ${c.heroes.map(display).join(', ')}: ${c.percentLabel}">
                    <span class="band-faces">${c.heroes.map((n, i) => `<span class="band-face${c.inBand[i] ? ' is-in-band' : ''} attr--${heroOf(n).attribute}">
                        ${portrait(n, 'face-portrait')}<span class="face-name">${escapeHtml(display(n))}</span></span>`).join('')}</span>
                    <span class="band-pct">${c.percentLabel}</span>
                </button>`).join('');
        } else if (view.complete && solo()) {
            section.hidden = false;
            $('completionHeading').textContent = 'Band Summary';
            $('completionHint').textContent = '';
            const a = view.analysis;
            const swaps = view.swaps.length
                ? `<p class="mini-heading">Swaps that improve it</p><ul class="swap-list">${view.swaps.map(sw => `
                    <li><button class="swap-btn" type="button" data-swap-out="${sw.out}" data-swap-in="${sw.in}">
                        ${portrait(sw.in, 'face-portrait')}<span>Replace ${escapeHtml(sw.display.out)} with ${escapeHtml(sw.display.in)}</span>
                        <span class="band-pct">${sw.percentLabel}</span></button></li>`).join('')}</ul>`
                : '<p class="muted">No single swap improves this band.</p>';
            $('completionList').innerHTML = `<div class="summary-card">
                <p><strong>${Draft.myBand(state()).map(display).map(escapeHtml).join(', ')}</strong> · ${a.score.label}</p>
                <p>Covers ${a.coveredCount} of 3 roles · ${escapeHtml(display(Draft.myBand(state())[0]))} starts on the Castle.</p>
                <button class="btn btn-ghost" type="button" data-act="copy">Copy band</button>
                ${swaps}
            </div>`;
        } else {
            section.hidden = true;
        }
    }

    function copyBand() {
        const text = `${Draft.myBand(state()).map(display).join(', ')} (${view.analysis.score.label})`;
        navigator.clipboard?.writeText(text).then(() => toast('Band copied.'), () => toast(text));
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
        $('threatList').innerHTML = a.threats.map(t =>
            `<li class="reason reason--warning${t.preview ? ' is-changed' : ''}">${escapeHtml(t.text)}${t.preview ? ' (preview)' : ''}</li>`).join('');
        $('synergyBlock').hidden = !a.synergy.length;
        $('synergyList').innerHTML = a.synergy.map(s =>
            `<li class="reason reason--positive${s.preview ? ' is-changed' : ''}">${escapeHtml(s.text)}${s.preview ? ' (preview)' : ''}</li>`).join('');
        $('viewInGraph').disabled = !Draft.bands(state())[v.focus].length;
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
                return;
            }
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
