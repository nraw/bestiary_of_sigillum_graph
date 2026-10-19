// Draft tab: DOM rendering and interaction for the draft assistant.
// All draft rules and scoring live in draft.js; draft-view.js turns them into the view object
// this file draws (both unit tested). Only DOM, events and persistence live here.
(function () {
    const Draft = window.Draft;
    const { draftView, percentLabel } = window.DraftView;
    const { escapeHtml } = window.GraphLogic;
    const { titleCase } = window.Synergy;

    const STORAGE_KEY = 'bestiary-draft-v1';
    const ATTRIBUTES = ['Strength', 'Agility', 'Intelligence'];
    const FORMAT_INFO = {
        standard: { label: 'Standard', hint: 'Alternate picks until each player has 3' },
        'ban-first': { label: 'Ban phase first', hint: 'Each player bans 3, alternating, then picks' },
        interleaved: { label: 'Interleaved', hint: 'Ban 1 each, pick 1 each, three times' }
    };
    const REASON_BADGE = { picked: 'Picked', facing: 'Facing', excluded: 'Excluded', banned: 'Banned' };

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
        mode: 'solo',
        states: { solo: Draft.createDraft('solo'), 'two-player': Draft.createDraft('standard') },
        filters: { term: '', attribute: 'All', role: null, fills: false, showUnavailable: false },
        showAll: false,
        showOpponent: false,
        expanded: null,
        picker: null
    };

    const $ = id => document.getElementById(id);
    const state = () => ui.states[ui.mode];
    const solo = () => ui.mode === 'solo';
    const display = name => titleCase(name);
    const portrait = (name, cls = 'portrait') =>
        `<img class="${cls}" src="hero_images/${name.toLowerCase()}.png" alt="" loading="lazy" draggable="false">`;
    const heroOf = name => ctx.byName.get(name);
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
            if (saved.mode === 'two-player') ui.mode = 'two-player';
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
            ui.filters.role = ui.filters.role === chip.dataset.role ? null : chip.dataset.role;
            renderPool();
        });
        $('poolSearch').addEventListener('input', event => { ui.filters.term = event.target.value; renderPool(); });
        $('fillsToggle').addEventListener('change', event => { ui.filters.fills = event.target.checked; renderPool(); });
        $('unavailableToggle').addEventListener('change', event => { ui.filters.showUnavailable = event.target.checked; renderPool(); });

        document.querySelector('.mode-switch').addEventListener('click', event => {
            const button = event.target.closest('[data-mode]');
            if (button && button.dataset.mode !== ui.mode) {
                ui.mode = button.dataset.mode;
                ui.expanded = null;
                render();
            }
        });

        $('undoBtn').addEventListener('click', doUndo);
        $('resetBtn').addEventListener('click', doReset);
        $('addEnemy').addEventListener('click', () => openPicker('enemy'));
        $('addExcluded').addEventListener('click', () => openPicker(solo() ? 'exclude' : 'carry'));
        $('allSuggestions').addEventListener('click', () => { ui.showAll = !ui.showAll; render(); });
        $('opponentToggle').addEventListener('change', event => { ui.showOpponent = event.target.checked; render(); });
        $('viewInGraph').addEventListener('click', () => {
            setTab('graph');
            window.BestiaryGraph?.showBand(Draft.myBand(state()), Draft.opponentBand(state()));
        });

        setupPool();
        setupSlots();
        setupAgainst();
        setupSuggestions();
        setupPicker();
        setupMenu();
        setupKeys();
    }

    // ---- Actions -------------------------------------------------------------------------

    function commit(next, message) {
        ui.states[ui.mode] = next;
        ui.expanded = null;
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
        const verb = step.player !== state().me ? `Opponent ${step.action === 'ban' ? 'banned' : 'picked'}`
            : step.action === 'ban' ? 'Banned' : 'Added';
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
        const what = solo() ? 'Clear band, enemies and exclusions?' : 'Start a new two-player draft?';
        if (!window.confirm(what)) return;
        lastReset = { mode: ui.mode, state: state() };
        const fresh = solo() ? Draft.createDraft('solo')
            : Draft.createDraft(state().format, { me: state().me, carryOverBans: state().carryOverBans });
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
        view = draftView(state(), ctx, { limit: ui.showAll ? Infinity : 3, showOpponent: ui.showOpponent });
        renderMode();
        renderSetup();
        renderSequence();
        renderPool();
        renderExcluded();
        renderSlots(view);
        renderAgainst();
        renderSuggestions();
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
        const v = heroes ? draftView(state(), ctx, { preview: heroes, limit: 1 }) : view;
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
            el.innerHTML = `<p class="setup-summary">${FORMAT_INFO[s.format].label} · You are the
                ${s.me === 1 ? 'First' : 'Second'} player${s.carryOverBans.length ? ` · ${s.carryOverBans.length} carried-over ban${s.carryOverBans.length > 1 ? 's' : ''}` : ''}</p>`;
            return;
        }
        el.innerHTML = `
            <fieldset class="setup-group"><legend>Format</legend>
                ${Object.entries(FORMAT_INFO).map(([id, f]) => `
                    <label class="radio-card"><input type="radio" name="format" value="${id}" ${s.format === id ? 'checked' : ''}>
                        <span><strong>${f.label}</strong><small>${f.hint}</small></span></label>`).join('')}
            </fieldset>
            <fieldset class="setup-group setup-group--seat"><legend>I am the</legend>
                ${[1, 2].map(p => `<label class="radio-pill"><input type="radio" name="seat" value="${p}" ${s.me === p ? 'checked' : ''}>
                    ${p === 1 ? 'First' : 'Second'} player</label>`).join('')}
            </fieldset>`;
        el.onchange = event => {
            const format = el.querySelector('[name=format]:checked').value;
            const me = Number(el.querySelector('[name=seat]:checked').value);
            commit(Draft.createDraft(format, { me, carryOverBans: state().carryOverBans }));
            if (event.target.name) el.querySelector(`[name=${event.target.name}]:checked`).focus();
        };
    }

    function renderSequence() {
        const el = $('sequence');
        el.hidden = !view.sequence;
        if (!view.sequence) return;
        el.innerHTML = view.sequence.map(s => `
            <li class="seq-step seq--${s.status} ${s.mine ? 'seq--mine' : 'seq--theirs'} seq--${s.action}"
                ${s.status === 'current' ? 'aria-current="step"' : ''}
                title="${s.mine ? 'You' : 'Opponent'}: ${s.action}${s.hero ? ` · ${display(s.hero)}` : ''}">
                <span class="seq-action">${s.action === 'ban' ? 'Ban' : 'Pick'}</span>
                <span class="seq-who">${s.hero ? escapeHtml(display(s.hero)) : s.mine ? 'You' : 'Opp.'}</span>
            </li>`).join('');
    }

    // ---- Pool ----------------------------------------------------------------------------

    function poolFilter(entry) {
        const f = ui.filters;
        if (!entry.available && !f.showUnavailable) return false;
        if (f.attribute !== 'All' && entry.attribute !== f.attribute) return false;
        if (f.role && !entry.battleRoles.includes(f.role)) return false;
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

    function poolCorner(entry) {
        if (!entry.available || !view.step.action) return '';
        if (!view.step.mine) return '<span class="tile-corner tile-corner--record" aria-hidden="true">●</span>';
        return `<span class="tile-corner" aria-hidden="true">${view.step.action === 'ban' ? '⊘' : '+'}</span>`;
    }

    function primaryLabel(entry) {
        if (!entry.available) return `${entry.display}: ${REASON_BADGE[entry.unavailableReason]}`;
        if (!view.step.action) return entry.display;
        if (!view.step.mine) return `Record ${entry.display} as the opponent's ${view.step.action}`;
        return view.step.action === 'ban' ? `Ban ${entry.display}` : `Add ${entry.display} to your band`;
    }

    function renderPool() {
        document.querySelectorAll('#attributeFilter .chip').forEach(c =>
            c.setAttribute('aria-pressed', String(c.dataset.attribute === ui.filters.attribute)));
        document.querySelectorAll('#roleFilter .chip').forEach(c =>
            c.setAttribute('aria-pressed', String(c.dataset.role === ui.filters.role)));
        const entries = view.pool.filter(poolFilter);
        $('poolCount').textContent = `${view.counts.available} available · ${view.counts.unavailable} unavailable`
            + (entries.length < (ui.filters.showUnavailable ? 36 : view.counts.available) ? ` · ${entries.length} shown` : '');
        if (!entries.length) {
            $('poolGrid').innerHTML = `<p class="empty-note">No heroes match these filters.
                <button class="link-btn" type="button" data-act="clear-filters">Clear filters</button></p>`;
            return;
        }
        $('poolGrid').innerHTML = entries.map(e => `
            <div class="hero-tile attr--${e.attribute}${e.available ? '' : ` is-unavailable is-${e.unavailableReason}`}${view.step.mine ? '' : ' is-recording'}"
                 role="listitem" data-hero="${e.name}" ${e.available ? 'draggable="true"' : ''}>
                <button class="tile-main" type="button" data-act="primary" aria-label="${escapeHtml(primaryLabel(e))}"
                        ${e.available && view.step.action ? '' : 'aria-disabled="true"'}>
                    ${banner(e.attribute)}
                    ${portrait(e.name, 'tile-portrait')}
                    <span class="tile-name">${escapeHtml(e.display)}</span>
                    ${rolePills(e.battleRoles)}
                    <span class="tile-size">${e.size}</span>
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
                Object.assign(ui.filters, { term: '', attribute: 'All', role: null, fills: false });
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
            const pickable = tile && view.step.mine && view.step.action === 'pick' && Draft.isAvailable(state(), tile.dataset.hero);
            preview(pickable ? tile.dataset.hero : null);
        };
        grid.addEventListener('mouseover', hover);
        grid.addEventListener('focusin', hover);
        grid.addEventListener('mouseleave', () => preview(null));
        grid.addEventListener('focusout', event => { if (!grid.contains(event.relatedTarget)) preview(null); });
        grid.addEventListener('dragstart', event => {
            const tile = event.target.closest('[data-hero]');
            if (!tile) return;
            event.dataTransfer.setData('text/hero', tile.dataset.hero);
            event.dataTransfer.effectAllowed = 'copy';
        });
    }

    function renderExcluded() {
        const list = view.excluded;
        const editable = solo() || !state().history.length;
        $('excludedBox').hidden = !solo() && !editable && !list.length;
        $('excludedTitle').textContent = solo() ? 'Excluded' : 'Carry-over bans';
        $('addExcluded').hidden = !editable;
        $('addExcluded').textContent = solo() ? '+ Exclude hero' : '+ Add ban';
        $('excludedChips').innerHTML = list.length
            ? list.map(n => `<span class="ex-chip">${escapeHtml(display(n))}${editable
                ? `<button type="button" data-remove="${n}" aria-label="Remove ${escapeHtml(display(n))} from ${solo() ? 'excluded' : 'carry-over bans'}">✕</button>` : ''}</span>`).join('')
            : `<span class="muted">${solo() ? 'None. Exclude heroes you cannot use.' : 'None. Add heroes banned last game.'}</span>`;
    }

    // ---- Band slots ----------------------------------------------------------------------

    function renderSlots(v) {
        const editable = solo();
        $('bandSlots').innerHTML = v.slots.map(slot => {
            if (!slot.hero) {
                return `<div class="slot is-empty" data-slot="${slot.index}" data-drop="slot">
                    <span class="slot-num">${slot.index + 1}</span>
                    <button class="slot-add" type="button" data-act="choose" ${v.step.mine && v.step.action === 'pick' ? '' : 'disabled'}>
                        <span class="slot-plus" aria-hidden="true">+</span>Choose ${['1st', '2nd', '3rd'][slot.index]} hero</button>
                </div>`;
            }
            const hero = heroOf(slot.hero);
            const roles = Draft.battleRoles(hero);
            const canEdit = editable && !slot.preview;
            return `<div class="slot attr--${hero.attribute}${slot.preview ? ' is-preview' : ''}" data-slot="${slot.index}"
                        data-hero="${slot.hero}" data-drop="slot" ${canEdit ? 'draggable="true" tabindex="0"' : ''}
                        aria-label="${slot.index + 1}. ${escapeHtml(display(slot.hero))}${slot.preview ? ' (preview)' : ''}">
                <span class="slot-num">${slot.index + 1}</span>
                ${banner(hero.attribute)}
                ${slot.preview ? '<span class="slot-ribbon">Preview</span>' : ''}
                ${canEdit ? `<button class="slot-remove" type="button" data-act="remove" aria-label="Remove ${escapeHtml(display(slot.hero))}">✕</button>` : ''}
                ${portrait(slot.hero, 'slot-portrait')}
                <span class="slot-name">${escapeHtml(display(slot.hero))}</span>
                ${rolePills(roles)}
                ${slot.startsOnCastle ? '<span class="slot-castle">1st pick · Starts on Castle</span>' : ''}
                ${canEdit ? `<span class="slot-move">
                    <button type="button" data-act="left" aria-label="Move ${escapeHtml(display(slot.hero))} earlier" ${slot.index === 0 ? 'disabled' : ''}>◀</button>
                    <button type="button" data-act="right" aria-label="Move ${escapeHtml(display(slot.hero))} later" ${slot.index >= Draft.myBand(state()).length - 1 ? 'disabled' : ''}>▶</button>
                </span>` : ''}
            </div>`;
        }).join('');
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
                const first = document.querySelector('#suggestionList [data-act="add"]');
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
                if (to >= 0 && to < Draft.myBand(state()).length) moveSlot(index, to - index);
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
            } else if (data.hero && view.step.mine && view.step.action === 'pick') {
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
        const list = view.against;
        $('againstHeading').textContent = solo() ? 'Against' : 'Opponent';
        $('againstHint').textContent = solo() ? 'Heroes you expect to face' : 'Their band, in pick order';
        $('addEnemy').hidden = !solo() || list.length >= 3;
        $('againstRow').innerHTML = list.length
            ? list.map((n, i) => {
                const hero = heroOf(n);
                return `<div class="enemy-card attr--${hero.attribute}">
                    ${banner(hero.attribute)}
                    ${solo() ? `<button class="slot-remove" type="button" data-remove="${n}" aria-label="Stop facing ${escapeHtml(display(n))}">✕</button>`
                        : `<span class="slot-num">${i + 1}</span>`}
                    ${portrait(n, 'enemy-portrait')}
                    <span class="enemy-name"><span class="enemy-mark" aria-hidden="true">⚔</span> ${escapeHtml(display(n))}</span>
                    ${rolePills(Draft.battleRoles(hero))}
                </div>`;
            }).join('')
            : `<p class="empty-note">${solo() ? 'Add heroes you expect to face to get counter-picks.' : 'The opponent has not picked yet.'}</p>`;

        const bansRow = $('bansRow');
        bansRow.hidden = solo() || !view.bans || !(view.bans.mine.length || view.bans.theirs.length);
        if (!bansRow.hidden) {
            const chips = list => list.map(n => `<span class="ex-chip is-banned">${escapeHtml(display(n))}</span>`).join('') || '<span class="muted">—</span>';
            bansRow.innerHTML = `<div><span class="mini-heading">Your bans</span>${chips(view.bans.mine)}</div>
                <div><span class="mini-heading">Their bans</span>${chips(view.bans.theirs)}</div>`;
        }
    }

    function setupAgainst() {
        $('againstRow').addEventListener('click', event => {
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
            if (data.hero && solo()) attempt(s => Draft.setEnemies(s, [...s.enemies, data.hero]), `Facing ${display(data.hero)}.`);
        });
        setupDrop($('excludedChips'), (event, data) => {
            if (data.hero && solo()) attempt(s => Draft.setExcluded(s, [...s.excluded, data.hero]), `Excluded ${display(data.hero)}.`);
        });
    }

    function setCarryOver(names) {
        const s = state();
        commit(Draft.createDraft(s.format, { me: s.me, carryOverBans: names }));
    }

    // ---- Suggestions ---------------------------------------------------------------------

    const ACTION_BUTTON = { add: 'Add', ban: 'Ban', record: 'Record' };

    function suggestionRow(item, index, action) {
        const expanded = ui.expanded === item.name;
        const reasons = item.reasons.map(r =>
            `<li class="reason reason--${r.kind}" data-reason-id="${escapeHtml(r.id)}">${escapeHtml(r.text)}</li>`).join('');
        const best = item.bestBand && action !== 'ban'
            ? `<p class="best-band">Best band with ${escapeHtml(item.display)}: ${item.bestBand.map(display).map(escapeHtml).join(', ')} (${item.percentLabel})</p>` : '';
        return `<li class="sugg${expanded ? ' is-expanded' : ''}" data-hero="${item.name}">
            <span class="sugg-rank">${index + 1}</span>
            ${portrait(item.name, 'sugg-portrait')}
            <div class="sugg-who">
                <span class="sugg-name">${escapeHtml(item.display)}</span>
                ${rolePills(Draft.battleRoles(heroOf(item.name)))}
            </div>
            <div class="sugg-score" title="Best band with this hero, among all possible bands">
                <span class="sugg-pct">${item.percentLabel}</span>
                <span class="meter"><span style="width:${Math.max(4, 100 - item.topPercent)}%"></span></span>
            </div>
            <ul class="sugg-chips">
                ${item.chips.map(c => `<li class="chip-r chip-r--${c.kind}" data-reason="${c.reasonId}">${escapeHtml(c.text)}</li>`).join('')}
                ${item.moreChips ? `<li class="chip-r chip-r--more">+${item.moreChips} more</li>` : ''}
            </ul>
            <button class="btn btn-gold sugg-add" type="button" data-act="add">${ACTION_BUTTON[action]}</button>
            <button class="icon-btn sugg-expand" type="button" data-act="expand" aria-expanded="${expanded}"
                    aria-label="${expanded ? 'Hide' : 'Show'} all reasons for ${escapeHtml(item.display)}">›</button>
            <div class="sugg-detail" ${expanded ? '' : 'hidden'}><ul class="reason-list">${reasons}</ul>${best}</div>
        </li>`;
    }

    function swapRow(sw, index) {
        return `<li class="sugg sugg--swap" data-swap-out="${sw.out}" data-swap-in="${sw.in}">
            <span class="sugg-rank">${index + 1}</span>
            ${portrait(sw.in, 'sugg-portrait')}
            <div class="sugg-who"><span class="sugg-name">Replace ${escapeHtml(sw.display.out)} with ${escapeHtml(sw.display.in)}</span></div>
            <div class="sugg-score"><span class="sugg-pct">${sw.percentLabel}</span>
                <span class="meter"><span style="width:${Math.max(4, 100 - sw.topPercent)}%"></span></span></div>
            <ul class="sugg-chips"></ul>
            <button class="btn btn-gold sugg-add" type="button" data-act="swap">Swap</button>
        </li>`;
    }

    function renderSuggestions() {
        const { action, items, total } = view.suggestions;
        const heading = { add: 'Next Pick', ban: 'Ban Suggestions', record: "Opponent's Turn" }[action]
            || (view.swaps ? 'Swap Suggestions' : 'Draft Complete');
        $('suggestHeading').textContent = heading;
        $('stepLabel').textContent = view.step.label;
        $('opponentToggleWrap').hidden = action !== 'record';
        $('opponentToggle').checked = ui.showOpponent;
        $('allSuggestions').hidden = !action || (action === 'record' && !ui.showOpponent) || total <= 3;
        $('allSuggestions').textContent = ui.showAll ? 'Show top 3' : `All ${total} →`;
        $('draftIntro').hidden = !view.intro;
        $('draftIntro').textContent = view.intro || '';

        const list = $('suggestionList');
        if (action === 'record' && !items.length) {
            list.innerHTML = `<li class="empty-note">Click the hero your opponent ${view.step.action === 'ban' ? 'banned' : 'chose'} in the pool.</li>`;
        } else if (!action && view.swaps) {
            list.innerHTML = view.swaps.length ? view.swaps.map(swapRow).join('')
                : '<li class="empty-note">No single swap improves this band.</li>';
        } else if (!action) {
            list.innerHTML = '<li class="empty-note">Both bands are complete.</li>';
        } else {
            list.innerHTML = items.map((item, i) => suggestionRow(item, i, action)).join('');
        }
    }

    function setupSuggestions() {
        const list = $('suggestionList');
        list.addEventListener('click', event => {
            const act = event.target.closest('[data-act]')?.dataset.act;
            const row = event.target.closest('.sugg');
            if (!row) return;
            if (act === 'swap') {
                const { swapOut, swapIn } = row.dataset;
                attempt(s => Draft.replacePick(s, swapOut, swapIn), () => `Swapped ${display(swapOut)} for ${display(swapIn)}. ${summary()}`);
            } else if (act === 'add') {
                primaryAction(row.dataset.hero);
            } else if (act === 'expand' || event.target.closest('.sugg-chips')) {
                ui.expanded = ui.expanded === row.dataset.hero ? null : row.dataset.hero;
                renderSuggestions();
                // Clicking a chip opens the row with that reason highlighted
                const reasonId = event.target.closest('[data-reason]')?.dataset.reason;
                if (reasonId) list.querySelector(`[data-hero="${row.dataset.hero}"] [data-reason-id="${CSS.escape(reasonId)}"]`)
                    ?.classList.add('is-highlight');
                list.querySelector(`[data-hero="${row.dataset.hero}"] .sugg-expand`)?.focus();
            }
        });
        const hover = event => {
            const row = event.target.closest('.sugg');
            if (!row) return preview(null);
            if (row.dataset.swapIn) return preview(null);
            preview(view.suggestions.action === 'add' ? row.dataset.hero : null);
        };
        list.addEventListener('mouseover', hover);
        list.addEventListener('focusin', hover);
        list.addEventListener('mouseleave', () => preview(null));
        list.addEventListener('focusout', event => { if (!list.contains(event.relatedTarget)) preview(null); });

        const completions = $('completionList');
        completions.addEventListener('click', event => {
            const card = event.target.closest('[data-band]');
            if (card) fillFromBand(card.dataset.band.split(','));
            if (event.target.closest('[data-act="copy"]')) copyBand();
        });
        completions.addEventListener('mouseover', event => {
            const card = event.target.closest('[data-band]');
            preview(card ? card.dataset.band.split(',') : null);
        });
        completions.addEventListener('focusin', event => {
            const card = event.target.closest('[data-band]');
            preview(card ? card.dataset.band.split(',') : null);
        });
        completions.addEventListener('mouseleave', () => preview(null));
    }

    function fillFromBand(heroes) {
        const missing = heroes.filter(n => !Draft.myBand(state()).includes(n));
        if (solo()) attempt(s => Draft.fillBand(s, missing), () => `Band filled: ${heroes.map(display).join(', ')}. ${summary()}`);
        else if (missing.length) primaryAction(missing[0]); // later picks are future turns
    }

    function renderCompletions() {
        const section = $('completionSection');
        if (view.completions) {
            section.hidden = false;
            $('completionHeading').textContent = 'Complete Your Band';
            $('completionHint').textContent = 'Full 3-hero bands built on your current picks';
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
            $('completionList').innerHTML = `<div class="summary-card">
                <p><strong>${Draft.myBand(state()).map(display).map(escapeHtml).join(', ')}</strong> · ${a.score.label}</p>
                <p>Covers ${a.coveredCount} of 3 roles · ${escapeHtml(display(Draft.myBand(state())[0]))} starts on the Castle.</p>
                <button class="btn btn-ghost" type="button" data-act="copy">Copy band</button>
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
        $('balanceSummary').textContent = `Your band covers ${a.coveredCount} of 3 roles`;
        $('roleList').innerHTML = a.roles.map(r => `
            <li class="role-row${r.coveredBy ? ' is-covered' : ''}${r.change ? ' is-changed' : ''}">
                ${icon(r.role, 'ico role-ico')}<span class="role-name">${r.role}</span>
                <span class="role-status">${r.coveredBy ? `✓ ${escapeHtml(display(r.coveredBy))}` : '○ Missing'}</span>
            </li>`).join('');
        $('scoreCaption').textContent = a.score.complete ? 'Your band' : 'Best band you can still reach';
        $('bandScore').textContent = a.score.percent === null ? '—' : percentLabel(a.score.percent);
        $('scoreBar').style.width = a.score.percent === null ? '0%' : `${Math.max(3, 100 - a.score.percent)}%`;
        $('scoreDetail').textContent = a.score.change
            ? `Preview: ${a.score.change.from === null ? '—' : percentLabel(a.score.change.from)} → ${percentLabel(a.score.change.to)}`
            : 'Share of all possible 3-hero bands that score at least as well.';
        $('scoreDetail').classList.toggle('is-changed', Boolean(a.score.change));

        $('threatBlock').hidden = !a.threats.length;
        $('threatList').innerHTML = a.threats.map(t =>
            `<li class="reason reason--warning${t.preview ? ' is-changed' : ''}">${escapeHtml(t.text)}${t.preview ? ' (preview)' : ''}</li>`).join('');
        $('synergyBlock').hidden = !a.synergy.length;
        $('synergyList').innerHTML = a.synergy.map(s =>
            `<li class="reason reason--positive${s.preview ? ' is-changed' : ''}">${escapeHtml(s.text)}${s.preview ? ' (preview)' : ''}</li>`).join('');
        $('viewInGraph').disabled = !Draft.myBand(state()).length;
    }

    // ---- Hero picker dialog (Against, Excluded, carry-over bans) --------------------------

    const PICKER = {
        enemy: { title: 'Add an enemy to face', can: n => Draft.isAvailable(state(), n),
            run: n => attempt(s => Draft.setEnemies(s, [...s.enemies, n]), `Facing ${display(n)}.`) },
        exclude: { title: 'Exclude a hero', can: n => Draft.isAvailable(state(), n),
            run: n => attempt(s => Draft.setExcluded(s, [...s.excluded, n]), `Excluded ${display(n)}.`) },
        carry: { title: 'Ban from the previous game', can: n => !state().carryOverBans.includes(n),
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
            items.push(['primary', !step.player || step.player === s.me ? (step.action === 'ban' ? 'Ban' : 'Pick')
                : `Record opponent's ${step.action}`]);
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
                if (!$('cardMenu').hidden) { closeMenu(); return; }
                if (ui.expanded) { ui.expanded = null; renderSuggestions(); }
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
