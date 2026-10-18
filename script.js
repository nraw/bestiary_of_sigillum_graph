// Bestiary of Sigillum - interactive hero network
// Pure logic lives in graph-logic.js (GraphLogic) and search.js; this file owns
// the DOM, D3 rendering and interaction state.
const {
    buildGraph, buildAdjacency, computeHighlight, linkState, relatedHeroes,
    findPath, filterNodes, fitTransform, effectIcon, nearestInDirection, escapeHtml
} = window.GraphLogic;

let heroesData = [];
let nodesData = [];
let linksData = [];
let nodesById = new Map();
let adjacency = new Map();
let simulation;
let svg;
let viewport;
let zoom;
let nodeElements;
let linkElements;

const state = {
    selectedId: null,
    term: '',
    category: 'All',
    labelCategory: null,
    path: null,
    showAllNames: false
};

const CATEGORY_CHIPS = ['All', 'Melee', 'Ranged', 'Support', 'AoE', 'Displacement'];

// Hero ring colour = primary type (validated for CVD separation on the dark
// surface); every type also has its own glyph so colour is never the only cue
const HERO_TYPES = {
    Melee:   { color: '#E0566B', symbol: 'times',    label: 'Melee' },
    Ranged:  { color: '#BF8530', symbol: 'triangle', label: 'Ranged' },
    AoE:     { color: '#9A7BDB', symbol: 'star',     label: 'Area of effect' },
    Support: { color: '#3FA68C', symbol: 'plus',     label: 'Support' },
    Other:   { color: '#8C7A66', symbol: 'circle',   label: 'Other' }
};

// Trait nodes share one neutral colour; shape carries the category
const LABEL_SHAPES = {
    Combat:    { symbol: 'diamond',  label: 'Combat' },
    Magic:     { symbol: 'wye',      label: 'Magic & support' },
    Movement:  { symbol: 'triangle', label: 'Movement' },
    Effect:    { symbol: 'circle',   label: 'Official effect' },
    Structure: { symbol: 'square',   label: 'Structure & terrain' },
    Trait:     { symbol: 'circle',   label: 'Other trait' }
};

const SYMBOLS = {
    times: d3.symbolTimes,
    triangle: d3.symbolTriangle,
    star: d3.symbolStar,
    plus: d3.symbolPlus,
    circle: d3.symbolCircle,
    diamond: d3.symbolDiamond,
    wye: d3.symbolWye,
    square: d3.symbolSquare
};

function symbolPath(name, size) {
    return d3.symbol().type(SYMBOLS[name]).size(size)();
}

// Google Analytics helper function
function trackEvent(action, category = 'Bestiary', label = null, value = null) {
    if (typeof gtag !== 'undefined') {
        gtag('event', action, { event_category: category, event_label: label, value });
    }
}

async function init() {
    try {
        const response = await fetch('bestiary_reference_cards.json');
        const data = await response.json();
        heroesData = data.bestiary_of_sigillum.characters;

        ({ nodes: nodesData, links: linksData } = buildGraph(heroesData));
        nodesById = new Map(nodesData.map(n => [n.id, n]));
        adjacency = buildAdjacency(linksData);

        setupGraph();
        setupToolbar();
        setupSearch();
        setupChips();
        renderLegend();
        setupPathfinder();
        setupPanels();
        setupKeyboard();
        render();

        trackEvent('app_loaded', 'Application', `${heroesData.length} heroes loaded`);
    } catch (error) {
        console.error('Error initializing application:', error);
        trackEvent('app_error', 'Application', error.message);
    }
}

// ---------------------------------------------------------------------------
// Graph rendering
// ---------------------------------------------------------------------------

function graphSize() {
    const rect = svg.node().getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 600 };
}

function setupGraph() {
    svg = d3.select('#graph');
    const { width, height } = graphSize();

    const defs = svg.append('defs');
    nodesData.filter(n => n.type === 'hero').forEach(n => {
        defs.append('clipPath').attr('id', `clip-${n.id}`)
            .append('circle').attr('r', n.radius - 1.5);
    });

    viewport = svg.append('g').attr('class', 'viewport');

    zoom = d3.zoom()
        .scaleExtent([0.25, 4])
        .on('zoom', event => {
            viewport.attr('transform', event.transform);
            svg.classed('zoomed-out', event.transform.k < 0.6);
            hideTooltip();
        });
    svg.call(zoom).on('dblclick.zoom', null);

    svg.on('click', event => {
        if (event.target === svg.node()) {
            clearSelection();
        }
    });

    // Hub traits (Melee, Displacement…) get longer links so their heroes fan out;
    // one-off traits sit close to their hero
    const linkDistance = l => 40 + Math.sqrt(l.target.degree) * 22;
    simulation = d3.forceSimulation(nodesData)
        .force('link', d3.forceLink(linksData).id(d => d.id).distance(linkDistance).strength(0.6))
        .force('charge', d3.forceManyBody().strength(d => d.type === 'hero' ? -650 : -90 - d.degree * 12))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => d.type === 'hero' ? d.radius + 22 : d.radius + 8))
        // Squeeze along the container's short side so the layout matches its shape
        .force('x', d3.forceX(width / 2).strength(0.04 * Math.max(1, (height / width) * 2)))
        .force('y', d3.forceY(height / 2).strength(0.06 * Math.max(1, width / height)))
        .stop();

    // Settle the layout before the first paint so the graph doesn't jitter in
    simulation.tick(320);

    linkElements = viewport.append('g').attr('class', 'links')
        .selectAll('line')
        .data(linksData)
        .join('line')
        .attr('class', 'link');

    nodeElements = viewport.append('g').attr('class', 'nodes')
        .selectAll('g')
        .data(nodesData)
        .join('g')
        .attr('class', d => `node node--${d.type}`)
        .attr('tabindex', -1)
        .attr('role', 'button')
        .attr('aria-label', nodeAriaLabel)
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

    const heroes = nodeElements.filter(d => d.type === 'hero');
    heroes.append('circle').attr('class', 'halo').attr('r', d => d.radius + 7);
    heroes.append('circle').attr('class', 'focus-ring').attr('r', d => d.radius + 11);
    heroes.append('circle').attr('class', 'hero-bg').attr('r', d => d.radius);
    heroes.append('image')
        .attr('href', d => d.image)
        .attr('x', d => -d.radius)
        .attr('y', d => -d.radius)
        .attr('width', d => d.radius * 2)
        .attr('height', d => d.radius * 2)
        .attr('preserveAspectRatio', 'xMidYMin slice')
        .attr('clip-path', d => `url(#clip-${d.id})`);
    heroes.append('circle')
        .attr('class', 'hero-ring')
        .attr('r', d => d.radius)
        .attr('stroke', d => HERO_TYPES[d.primaryType].color);
    const badge = heroes.append('g')
        .attr('class', 'type-badge')
        .attr('transform', d => `translate(${d.radius * 0.72},${d.radius * 0.72})`);
    badge.append('circle').attr('r', 7).attr('fill', d => HERO_TYPES[d.primaryType].color);
    badge.append('path').attr('d', d => symbolPath(HERO_TYPES[d.primaryType].symbol, 40));

    const labels = nodeElements.filter(d => d.type === 'label');
    labels.append('circle').attr('class', 'halo').attr('r', d => d.radius + 6);
    labels.append('circle').attr('class', 'focus-ring').attr('r', d => d.radius + 9);
    labels.each(function (d) {
        const g = d3.select(this);
        const icon = effectIcon(d.name);
        if (icon) {
            const r = d.radius + 2;
            g.append('image')
                .attr('class', 'effect-token')
                .attr('href', icon)
                .attr('x', -r).attr('y', -r)
                .attr('width', r * 2).attr('height', r * 2);
            g.append('circle').attr('class', 'label-shape effect-ring').attr('r', r);
        } else {
            const symbol = LABEL_SHAPES[d.category].symbol;
            g.append('path')
                .attr('class', 'label-shape')
                .attr('d', symbolPath(symbol, Math.PI * d.radius * d.radius * 1.2));
        }
    });

    nodeElements.append('text')
        .attr('class', 'node-name')
        .attr('dy', d => d.type === 'hero' ? d.radius + 17 : d.radius + 14)
        .text(d => d.type === 'hero' ? d.name : d.name.replace(/-/g, ' '));

    nodeElements
        .on('click', (event, d) => {
            event.stopPropagation();
            selectNode(d.id, { source: 'graph' });
        })
        .on('mouseenter', (event, d) => showTooltip(d))
        .on('mouseleave', hideTooltip)
        .on('focus', function (event, d) {
            setRovingFocus(d.id);
            showTooltip(d);
        })
        .on('blur', hideTooltip)
        .on('keydown', handleNodeKeydown);

    nodeElements.filter((d, i) => i === 0).attr('tabindex', 0);

    simulation.on('tick', ticked);
    ticked();
    fitView(nodesData, 0);
}

function nodeAriaLabel(d) {
    if (d.type === 'hero') {
        return `${d.name}, ${HERO_TYPES[d.primaryType].label} hero, vitality ${d.vitality}`;
    }
    return `${d.name} trait, ${LABEL_SHAPES[d.category].label}, ${d.degree} heroes`;
}

function ticked() {
    linkElements
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
    nodeElements.attr('transform', d => `translate(${d.x},${d.y})`);
}

function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.2).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
    hideTooltip();
}

function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

// ---------------------------------------------------------------------------
// View controls
// ---------------------------------------------------------------------------

function applyTransform(t, duration = 450) {
    const transform = d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
    (duration ? svg.transition().duration(duration) : svg).call(zoom.transform, transform);
}

function fitView(nodes, duration = 450) {
    if (!nodes.length) return;
    const pad = 30;
    const bounds = {
        x0: d3.min(nodes, n => n.x - n.radius) - pad,
        y0: d3.min(nodes, n => n.y - n.radius) - pad - 50, // room for the toolbar
        x1: d3.max(nodes, n => n.x + n.radius) + pad,
        y1: d3.max(nodes, n => n.y + n.radius) + pad
    };
    const { width, height } = graphSize();
    applyTransform(fitTransform(bounds, width, height, 20, 1.6), duration);
}

function fitToFilter() {
    const ids = filterNodes(nodesData, {
        term: state.term, category: state.category, labelCategory: state.labelCategory
    });
    fitView(ids ? nodesData.filter(n => ids.has(n.id)) : nodesData);
}

function centerOn(node, duration = 450) {
    const { width, height } = graphSize();
    const k = Math.max(d3.zoomTransform(svg.node()).k, 1.2);
    applyTransform({ k, x: width / 2 - node.x * k, y: height / 2 - node.y * k }, duration);
}

function setupToolbar() {
    document.querySelector('.graph-toolbar').addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (button) runAction(button.dataset.action);
    });
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('namesToggle').addEventListener('click', () => {
        state.showAllNames = !state.showAllNames;
        render();
    });
}

function runAction(action) {
    const selected = nodesById.get(state.selectedId);
    switch (action) {
        case 'zoom-in': svg.transition().duration(250).call(zoom.scaleBy, 1.35); break;
        case 'zoom-out': svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.35); break;
        case 'fit': fitView(state.path ? state.path.map(id => nodesById.get(id)) : nodesData); break;
        case 'center': if (selected) centerOn(selected); break;
        case 'reset': fitView(nodesData); break;
    }
    trackEvent('graph_control', 'View', action);
}

// ---------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------

function selectNode(id, { source = 'graph', center = source !== 'graph' } = {}) {
    const node = nodesById.get(id);
    if (!node) return;
    state.selectedId = id;
    state.path = null;
    trackEvent('node_selected', 'Interaction', `${source}: ${node.name}`);
    render();
    if (center) centerOn(node);
}

function clearSelection() {
    state.selectedId = null;
    state.path = null;
    render();
}

function clearAll() {
    Object.assign(state, { selectedId: null, term: '', category: 'All', labelCategory: null, path: null });
    document.getElementById('searchInput').value = '';
    closeSuggestions();
    trackEvent('filter_cleared', 'Filter', 'Clear All');
    render();
}

// One function maps state -> visuals so every interaction stays consistent
function render() {
    const filterSet = filterNodes(nodesData, {
        term: state.term, category: state.category, labelCategory: state.labelCategory
    });

    let highlight = null;
    let pathLinks = null;
    if (state.path) {
        highlight = new Map(nodesData.map(n => [n.id, 'dim']));
        state.path.forEach((id, i) => highlight.set(id, i === 0 || i === state.path.length - 1 ? 'selected' : 'connected'));
        pathLinks = new Set(state.path.slice(1).map((id, i) => [state.path[i], id].sort().join('|')));
    } else if (state.selectedId) {
        highlight = computeHighlight(state.selectedId, adjacency, nodesById);
    }

    nodeElements
        .classed('is-selected', d => highlight?.get(d.id) === 'selected')
        .classed('is-connected', d => highlight?.get(d.id) === 'connected')
        .classed('is-secondary', d => highlight?.get(d.id) === 'secondary')
        .classed('is-dim', d => highlight ? highlight.get(d.id) === 'dim' : (filterSet ? !filterSet.has(d.id) : false))
        .classed('is-match', d => !highlight && filterSet ? filterSet.has(d.id) : false)
        .attr('aria-pressed', d => String(d.id === state.selectedId));

    linkElements.attr('class', d => {
        if (pathLinks) {
            return pathLinks.has([d.source.id, d.target.id].sort().join('|')) ? 'link link--path' : 'link link--dim';
        }
        if (highlight) return `link link--${linkState(d, highlight)}`;
        if (filterSet) return filterSet.has(d.source.id) && filterSet.has(d.target.id) ? 'link' : 'link link--dim';
        return 'link';
    });

    // Raise highlighted nodes so they draw above the dimmed crowd
    nodeElements.filter(d => highlight && highlight.get(d.id) !== 'dim' && d.type === 'hero').raise();
    nodeElements.filter(d => highlight && highlight.get(d.id) !== 'dim' && d.type === 'label').raise();
    linkElements.filter(function () { return /--(direct|path)/.test(this.getAttribute('class')); }).raise();

    svg.classed('has-highlight', Boolean(highlight || filterSet));
    svg.classed('show-all-names', state.showAllNames);

    updateHeaderState(filterSet);
    renderDetails();
    renderPathResult();
}

function updateHeaderState(filterSet) {
    const heroCount = filterSet
        ? [...filterSet].filter(id => nodesById.get(id).type === 'hero').length
        : heroesData.length;
    const active = [];
    if (state.category !== 'All') active.push(state.category);
    if (state.labelCategory) active.push(`${LABEL_SHAPES[state.labelCategory].label} traits`);
    if (state.term.trim()) active.push(`“${state.term.trim()}”`);

    document.getElementById('matchCount').textContent = state.labelCategory
        ? `${filterSet.size} matching trait${filterSet.size === 1 ? '' : 's'}`
        : `${heroCount} ${filterSet ? 'matching ' : ''}hero${heroCount === 1 ? '' : 'es'}`;
    document.getElementById('activeFilters').textContent = active.join(' · ') || 'None';

    const selected = nodesById.get(state.selectedId);
    let title = 'Hero Network';
    if (state.path) title = `Path: ${nodesById.get(state.path[0]).name} → ${nodesById.get(state.path.at(-1)).name}`;
    else if (selected) title = selected.name;
    else if (active.length) title = `Filtered: ${active.join(' · ')}`;
    document.getElementById('graphTitle').textContent = title;

    document.getElementById('clearAllBtn').disabled =
        !(state.selectedId || state.path || active.length);
    document.querySelector('[data-action="center"]').disabled = !selected;

    const names = document.getElementById('namesToggle');
    names.setAttribute('aria-pressed', String(state.showAllNames));

    document.querySelectorAll('#categoryChips .chip').forEach(chip => {
        chip.setAttribute('aria-pressed', String(chip.dataset.category === state.category));
    });
    document.querySelectorAll('.legend-filter').forEach(item => {
        item.setAttribute('aria-pressed', String(item.dataset.labelCategory === state.labelCategory));
    });
}

// ---------------------------------------------------------------------------
// Details panel
// ---------------------------------------------------------------------------

function heroGlyph(type, size = 16) {
    const t = HERO_TYPES[type];
    return `<svg class="glyph" width="${size}" height="${size}" viewBox="-8 -8 16 16" aria-hidden="true">
        <circle r="7.5" fill="${t.color}"/><path d="${symbolPath(t.symbol, 40)}"/></svg>`;
}

function labelGlyph(category, size = 16, name = null) {
    const icon = name && effectIcon(name);
    if (icon) return `<img class="glyph glyph-img" src="${icon}" width="${size}" height="${size}" alt="">`;
    return `<svg class="glyph glyph-trait" width="${size}" height="${size}" viewBox="-8 -8 16 16" aria-hidden="true">
        <path d="${symbolPath(LABEL_SHAPES[category].symbol, 70)}"/></svg>`;
}

function heroButton(hero, extra = '') {
    const node = nodesById.get(`hero_${hero.id}`);
    return `<button type="button" class="hero-link" data-node="${node.id}">
        <img src="${node.image}" alt="" width="28" height="28">
        <span>${escapeHtml(node.name)}</span>${extra}</button>`;
}

// Many targets in the data repeat the word ("Target any enemy…") after our own label
function tidyTarget(text) {
    const trimmed = text.replace(/^target\s+/i, '');
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function renderDetails() {
    const panel = document.getElementById('heroInfo');
    const node = nodesById.get(state.selectedId);

    if (!node) {
        panel.innerHTML = `
            <div class="empty-state">
                <svg class="empty-sigil" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><path d="M20 3 L24 20 L20 37 L16 20 Z M3 20 L20 16 L37 20 L20 24 Z"/></svg>
                <p>Select a hero or trait in the network, or search above, to read its card.</p>
                <dl class="shortcuts">
                    <dt><kbd>/</kbd></dt><dd>Search</dd>
                    <dt><kbd>Tab</kbd> <kbd>←↑→↓</kbd></dt><dd>Move between nodes</dd>
                    <dt><kbd>Enter</kbd></dt><dd>Select node</dd>
                    <dt><kbd>+</kbd> <kbd>−</kbd> <kbd>F</kbd> <kbd>0</kbd></dt><dd>Zoom, fit, reset</dd>
                    <dt><kbd>Esc</kbd></dt><dd>Clear selection</dd>
                </dl>
            </div>`;
        return;
    }

    if (node.type === 'hero') {
        const type = HERO_TYPES[node.primaryType];
        const related = relatedHeroes(node, heroesData);
        const ability = (a, title) => `
            <article class="ability-card">
                ${title ? `<h4>${title}</h4>` : ''}
                <p><span class="ability-key">Target</span> ${escapeHtml(tidyTarget(a.target))}</p>
                <p><span class="ability-key">Effect</span> ${escapeHtml(a.effect)}</p>
            </article>`;

        panel.innerHTML = `
            <header class="hero-header">
                <img class="hero-portrait" src="${node.image}" alt="Portrait of ${escapeHtml(node.name)}"
                     style="--ring:${type.color}">
                <div>
                    <h3 class="hero-name">${escapeHtml(node.name)}</h3>
                    <div class="hero-id">Hero #${node.originalId}</div>
                    <div class="badges">
                        <span class="badge badge-vitality" title="Vitality">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6.3 5.3 5.3 0 0 1 21.3 12C19 16.4 12 21 12 21z"/></svg>
                            Vitality ${node.vitality}
                        </span>
                        <span class="badge">${heroGlyph(node.primaryType, 14)} ${type.label}</span>
                    </div>
                </div>
            </header>

            <section class="detail-section">
                <h4 class="section-title">Core Ability</h4>
                ${ability(node.core_ability)}
            </section>

            <section class="detail-section">
                <h4 class="section-title">Support Abilities <span class="count">${node.support_abilities.length}</span></h4>
                ${node.support_abilities.map((a, i) => ability(a, `Support ${i + 1}`)).join('')}
            </section>

            <section class="detail-section">
                <h4 class="section-title">Traits <span class="count">${node.labels.length}</span></h4>
                <div class="trait-chips">
                    ${node.labels.map(label => {
                        const l = nodesById.get(`label_${label}`);
                        return `<button type="button" class="trait-chip" data-node="${l.id}"
                                    title="${escapeHtml(LABEL_SHAPES[l.category].label)} · ${l.degree} heroes">
                                    ${labelGlyph(l.category, 14, l.name)} ${escapeHtml(label)}</button>`;
                    }).join('')}
                </div>
            </section>

            <section class="detail-section">
                <h4 class="section-title">Related Heroes <span class="count">${related.length}</span></h4>
                <div class="hero-list">
                    ${related.map(r => heroButton(r.hero,
                        `<span class="shared" title="${escapeHtml(r.shared.join(', '))}">${r.shared.length} shared</span>`)).join('')}
                </div>
                <div class="detail-actions">
                    <button type="button" class="btn btn-ghost" data-path-from="${node.id}">Find path from ${escapeHtml(node.name)}</button>
                </div>
            </section>`;
    } else {
        const heroes = heroesData.filter(h => h.labels.includes(node.name));
        panel.innerHTML = `
            <header class="hero-header">
                <div class="trait-emblem">${labelGlyph(node.category, 44, node.name)}</div>
                <div>
                    <h3 class="hero-name">${escapeHtml(node.name)}</h3>
                    <div class="hero-id">${escapeHtml(LABEL_SHAPES[node.category].label)}</div>
                    <div class="badges"><span class="badge">${heroes.length} hero${heroes.length === 1 ? '' : 'es'}</span></div>
                </div>
            </header>
            <section class="detail-section">
                <h4 class="section-title">Heroes with this trait</h4>
                <div class="hero-list">${heroes.map(h => heroButton(h)).join('')}</div>
            </section>`;
    }
}

// Delegated clicks for everything rendered inside the details panel
document.addEventListener('click', event => {
    const nodeButton = event.target.closest('.details-body [data-node], .path-result [data-node]');
    if (nodeButton) {
        selectNode(nodeButton.dataset.node, { source: 'panel' });
        return;
    }
    const pathFrom = event.target.closest('[data-path-from]');
    if (pathFrom) {
        const start = document.getElementById('pathStart');
        start.value = pathFrom.dataset.pathFrom;
        expandPanel(document.getElementById('pathBody'));
        document.getElementById('pathEnd').focus();
    }
});

// ---------------------------------------------------------------------------
// Tooltip (hover / focus preview)
// ---------------------------------------------------------------------------

function showTooltip(d) {
    const tooltip = document.getElementById('tooltip');
    if (d.type === 'hero') {
        const [closest] = relatedHeroes(d, heroesData);
        tooltip.innerHTML = `
            <div class="tt-head">
                <img src="${d.image}" alt="" width="40" height="40">
                <div><strong>${escapeHtml(d.name)}</strong>
                <div class="tt-sub">${heroGlyph(d.primaryType, 12)} ${HERO_TYPES[d.primaryType].label} · Vitality ${d.vitality}</div></div>
            </div>
            <p class="tt-core"><span class="ability-key">Core</span> ${escapeHtml(d.core_ability.effect)}</p>
            <div class="tt-meta">${d.support_abilities.length} support abilities · ${d.labels.length} traits${closest
                ? `<br>Most alike: <strong>${escapeHtml(closest.hero.name)}</strong> (${closest.shared.length} shared)` : ''}</div>`;
    } else {
        tooltip.innerHTML = `
            <div class="tt-head">${labelGlyph(d.category, 24, d.name)}
                <div><strong>${escapeHtml(d.name)}</strong>
                <div class="tt-sub">${escapeHtml(LABEL_SHAPES[d.category].label)}</div></div>
            </div>
            <div class="tt-meta">Shared by ${d.degree} hero${d.degree === 1 ? '' : 'es'}</div>`;
    }

    const container = document.querySelector('.graph-panel').getBoundingClientRect();
    const t = d3.zoomTransform(svg.node());
    const svgRect = svg.node().getBoundingClientRect();
    const x = svgRect.left - container.left + t.applyX(d.x);
    const y = svgRect.top - container.top + t.applyY(d.y);
    tooltip.hidden = false;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const offset = d.radius * t.k + 14;
    const left = x + offset + tw > container.width ? x - offset - tw : x + offset;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.min(Math.max(8, y - th / 2), container.height - th - 8)}px`;
}

function hideTooltip() {
    document.getElementById('tooltip').hidden = true;
}

// ---------------------------------------------------------------------------
// Search with autocomplete + live filtering
// ---------------------------------------------------------------------------

let activeSuggestion = -1;
let currentSuggestions = [];

function setupSearch() {
    const input = document.getElementById('searchInput');
    const list = document.getElementById('searchSuggestions');

    input.addEventListener('input', () => {
        state.term = input.value;
        state.selectedId = null;
        state.path = null;
        updateSuggestions();
        render();
        if (input.value.trim().length >= 3) trackEvent('search_used', 'Search', input.value.trim());
    });

    input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (list.hidden) updateSuggestions();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const count = currentSuggestions.length;
            if (count) setActiveSuggestion((activeSuggestion + step + count) % count);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const pick = currentSuggestions[activeSuggestion] || (currentSuggestions.length === 1 && currentSuggestions[0]);
            if (pick) chooseSuggestion(pick);
        } else if (event.key === 'Escape') {
            if (!list.hidden) {
                event.stopPropagation();
                closeSuggestions();
            } else if (input.value) {
                event.stopPropagation();
                input.value = '';
                state.term = '';
                render();
            }
        }
    });

    input.addEventListener('focus', () => { if (input.value.trim()) updateSuggestions(); });
    input.addEventListener('blur', () => setTimeout(closeSuggestions, 120));

    list.addEventListener('mousedown', event => {
        const item = event.target.closest('[data-index]');
        if (item) {
            event.preventDefault();
            chooseSuggestion(currentSuggestions[Number(item.dataset.index)]);
        }
    });
}

function updateSuggestions() {
    const input = document.getElementById('searchInput');
    const list = document.getElementById('searchSuggestions');
    currentSuggestions = getSuggestions(nodesData, input.value, 8);
    activeSuggestion = -1;

    if (!input.value.trim()) {
        closeSuggestions();
        return;
    }
    list.innerHTML = currentSuggestions.length
        ? currentSuggestions.map((n, i) => `
            <li role="option" id="suggestion-${i}" data-index="${i}" aria-selected="false">
                ${n.type === 'hero'
                    ? `<img src="${n.image}" alt="" width="28" height="28">`
                    : `<span class="sugg-glyph">${labelGlyph(n.category, 20, n.name)}</span>`}
                <span class="sugg-name">${highlightMatch(n.name, input.value.trim())}</span>
                <span class="sugg-type">${n.type === 'hero' ? `#${n.originalId}` : 'trait'}</span>
            </li>`).join('')
        : '<li class="no-results" role="option" aria-disabled="true">No heroes or traits match</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
}

function highlightMatch(name, term) {
    const index = name.toLowerCase().indexOf(term.toLowerCase());
    if (index < 0 || /^#?\d+$/.test(term)) return escapeHtml(name);
    return `${escapeHtml(name.slice(0, index))}<mark>${escapeHtml(name.slice(index, index + term.length))}</mark>${escapeHtml(name.slice(index + term.length))}`;
}

function setActiveSuggestion(index) {
    const input = document.getElementById('searchInput');
    activeSuggestion = index;
    document.querySelectorAll('#searchSuggestions [role="option"]').forEach((li, i) => {
        li.setAttribute('aria-selected', String(i === index));
        if (i === index) li.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', `suggestion-${index}`);
}

function chooseSuggestion(node) {
    const input = document.getElementById('searchInput');
    input.value = '';
    state.term = '';
    closeSuggestions();
    selectNode(node.id, { source: 'search' });
}

function closeSuggestions() {
    const input = document.getElementById('searchInput');
    document.getElementById('searchSuggestions').hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeSuggestion = -1;
}

function setupChips() {
    const container = document.getElementById('categoryChips');
    container.innerHTML = CATEGORY_CHIPS.map(c =>
        `<button type="button" class="chip" data-category="${c}" aria-pressed="${c === 'All'}">${c}</button>`).join('');
    container.addEventListener('click', event => {
        const chip = event.target.closest('.chip');
        if (!chip) return;
        state.category = chip.dataset.category;
        state.labelCategory = null;
        state.selectedId = null;
        state.path = null;
        trackEvent('category_filter', 'Filter', state.category);
        render();
        fitToFilter();
    });
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function renderLegend() {
    const stateSwatch = cls => `<svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true" class="legend-state ${cls}">
        <circle r="7" class="ls-fill"/><circle r="9.5" class="ls-ring"/></svg>`;
    const edgeSwatch = cls => `<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="1" y1="6" x2="33" y2="6" class="link ${cls}"/></svg>`;

    document.getElementById('legendBody').innerHTML = `
        <h3 class="legend-title">Hero type <small>ring colour + glyph</small></h3>
        <ul class="legend-list legend-cols">
            ${Object.entries(HERO_TYPES).map(([key, t]) => `<li>${heroGlyph(key, 18)} ${t.label}</li>`).join('')}
        </ul>

        <h3 class="legend-title">Trait group <small>shape · click to filter</small></h3>
        <ul class="legend-list">
            ${Object.entries(LABEL_SHAPES).map(([key, s]) => `
                <li><button type="button" class="legend-filter" data-label-category="${key}" aria-pressed="false">
                    ${key === 'Effect' ? labelGlyph(key, 18, 'Stun') : labelGlyph(key, 18)} ${s.label}</button></li>`).join('')}
        </ul>

        <h3 class="legend-title">Highlight</h3>
        <ul class="legend-list legend-cols">
            <li>${stateSwatch('st-selected')} Selected</li>
            <li>${stateSwatch('st-connected')} Connected</li>
            <li>${stateSwatch('st-secondary')} Shares a trait</li>
            <li>${stateSwatch('st-dim')} Unrelated</li>
        </ul>

        <h3 class="legend-title">Edges</h3>
        <ul class="legend-list legend-cols">
            <li>${edgeSwatch('link--direct')} Direct</li>
            <li>${edgeSwatch('link--secondary')} Secondary</li>
            <li>${edgeSwatch('link--path')} Path</li>
            <li>${edgeSwatch('link--dim')} Unrelated</li>
        </ul>

        <h3 class="legend-title">Size</h3>
        <ul class="legend-list legend-sizes">
            <li><svg width="56" height="26" viewBox="0 0 56 26" aria-hidden="true">
                <circle cx="8" cy="13" r="5" /><circle cx="24" cy="13" r="7.5"/><circle cx="45" cy="13" r="10.5"/></svg>
                Hero: vitality 2 → 5</li>
            <li><svg width="56" height="26" viewBox="0 0 56 26" aria-hidden="true" class="trait-sizes">
                <path transform="translate(10 13)" d="${symbolPath('diamond', 40)}"/><path transform="translate(30 13)" d="${symbolPath('diamond', 120)}"/></svg>
                Trait: heroes sharing it</li>
        </ul>`;

    document.getElementById('legendBody').addEventListener('click', event => {
        const item = event.target.closest('.legend-filter');
        if (!item) return;
        const category = item.dataset.labelCategory;
        state.labelCategory = state.labelCategory === category ? null : category;
        state.category = 'All';
        state.selectedId = null;
        state.path = null;
        trackEvent('legend_filter', 'Filter', category);
        render();
        fitToFilter();
    });
}

// ---------------------------------------------------------------------------
// Pathfinding
// ---------------------------------------------------------------------------

function setupPathfinder() {
    const start = document.getElementById('pathStart');
    const end = document.getElementById('pathEnd');
    const options = nodesData
        .filter(n => n.type === 'hero')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(n => `<option value="${n.id}">${escapeHtml(n.name)}</option>`).join('');
    start.insertAdjacentHTML('beforeend', options);
    end.insertAdjacentHTML('beforeend', options);

    document.getElementById('pathBody').addEventListener('submit', event => {
        event.preventDefault();
        const path = findPath(adjacency, start.value, end.value);
        state.path = path && path.length > 1 ? path : null;
        state.selectedId = null;
        state.pathMiss = !path || path.length <= 1 ? [start.value, end.value] : null;
        trackEvent('path_found', 'Interaction', `${start.value} -> ${end.value}`);
        render();
        if (state.path) fitView(state.path.map(id => nodesById.get(id)));
    });

    document.getElementById('pathSwap').addEventListener('click', () => {
        [start.value, end.value] = [end.value, start.value];
    });
    document.getElementById('pathClear').addEventListener('click', () => {
        state.path = null;
        state.pathMiss = null;
        render();
    });
}

function renderPathResult() {
    const result = document.getElementById('pathResult');
    document.getElementById('pathClear').hidden = !state.path;
    if (state.pathMiss) {
        const [a, b] = state.pathMiss;
        result.innerHTML = a === b
            ? '<li class="path-note">Pick two different heroes.</li>'
            : '<li class="path-note">These heroes share no chain of traits.</li>';
        state.pathMiss = null;
        return;
    }
    if (!state.path) {
        result.innerHTML = '';
        return;
    }
    const hops = (state.path.length - 1) / 2;
    result.innerHTML = `<li class="path-note">${hops} hop${hops === 1 ? '' : 's'} through shared traits</li>` +
        state.path.map(id => {
            const n = nodesById.get(id);
            return n.type === 'hero'
                ? `<li class="path-step">${heroButton(heroesData.find(h => h.id === n.originalId))}</li>`
                : `<li class="path-via"><button type="button" class="trait-chip" data-node="${n.id}">${labelGlyph(n.category, 14, n.name)} via ${escapeHtml(n.name)}</button></li>`;
        }).join('');
}

// ---------------------------------------------------------------------------
// Collapsible panels & responsive behaviour
// ---------------------------------------------------------------------------

function expandPanel(body, expanded = true) {
    const toggle = document.querySelector(`[aria-controls="${body.id}"]`);
    toggle.setAttribute('aria-expanded', String(expanded));
    body.hidden = !expanded;
}

function setupPanels() {
    document.querySelectorAll('.collapse-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const body = document.getElementById(toggle.getAttribute('aria-controls'));
            expandPanel(body, toggle.getAttribute('aria-expanded') !== 'true');
        });
    });

    // On narrow screens the legend starts collapsed to keep the graph in view
    if (window.matchMedia('(max-width: 800px)').matches) {
        expandPanel(document.getElementById('legendBody'), false);
    }

    const sidePanel = document.getElementById('sidePanel');
    const legendToggle = document.getElementById('legendToggle');
    legendToggle.addEventListener('click', () => {
        const open = !sidePanel.classList.contains('open');
        sidePanel.classList.toggle('open', open);
        legendToggle.setAttribute('aria-expanded', String(open));
    });
}

let resizeTimer;
function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const selected = nodesById.get(state.selectedId);
        if (selected) centerOn(selected, 0);
        else fitView(state.path ? state.path.map(id => nodesById.get(id)) : nodesData, 0);
    }, 150);
}

// ---------------------------------------------------------------------------
// Keyboard navigation
// ---------------------------------------------------------------------------

function setRovingFocus(id) {
    nodeElements.attr('tabindex', d => (d.id === id ? 0 : -1));
}

function focusNode(node) {
    setRovingFocus(node.id);
    const el = nodeElements.filter(d => d.id === node.id).node();
    el.focus({ preventScroll: true });

    // Keep the focused node inside the viewport
    const t = d3.zoomTransform(svg.node());
    const { width, height } = graphSize();
    const x = t.applyX(node.x);
    const y = t.applyY(node.y);
    if (x < 40 || y < 70 || x > width - 40 || y > height - 40) centerOn(node, 250);
}

function handleNodeKeydown(event, d) {
    const arrows = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };
    if (arrows[event.key]) {
        event.preventDefault();
        // Within a highlight, prefer moving among the highlighted nodes
        const pool = svg.classed('has-highlight')
            ? nodesData.filter(n => !nodeElements.filter(e => e.id === n.id).classed('is-dim'))
            : nodesData;
        const next = nearestInDirection(d, pool.length > 1 ? pool : nodesData, arrows[event.key]);
        if (next) focusNode(next);
    } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectNode(d.id, { source: 'keyboard', center: false });
    }
}

function setupKeyboard() {
    document.addEventListener('keydown', event => {
        const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
        if (event.key === 'Escape') {
            hideTooltip();
            if (state.selectedId || state.path) clearSelection();
            else clearAll();
            return;
        }
        if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

        if (event.key === '/') {
            event.preventDefault();
            document.getElementById('searchInput').focus();
        } else if (event.key === '+' || event.key === '=') {
            runAction('zoom-in');
        } else if (event.key === '-' || event.key === '_') {
            runAction('zoom-out');
        } else if (event.key === '0') {
            runAction('reset');
        } else if (event.key.toLowerCase() === 'f') {
            runAction('fit');
        } else if (event.key.toLowerCase() === 'c') {
            runAction('center');
        }
    });
}

window.addEventListener('resize', handleResize);

// Wait for both DOM and D3 to be ready
function waitForD3AndInit() {
    if (typeof d3 !== 'undefined') {
        init();
    } else {
        setTimeout(waitForD3AndInit, 100);
    }
}

document.addEventListener('DOMContentLoaded', waitForD3AndInit);

// Export for debugging
window.BestiaryGraph = { state, get nodesData() { return nodesData; }, get linksData() { return linksData; } };
