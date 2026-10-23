// Bestiary of Sigillum - interactive hero network
// Pure logic lives in graph-logic.js (GraphLogic) and search.js; this file owns
// the DOM, D3 rendering and interaction state.
const {
    buildGraph, buildAdjacency, computeHighlight, focusIds, linkState, bandView, bandSprings, bandAnchors, arcPath,
    filterNodes, fitTransform, effectIcon, nearestInDirection, escapeHtml, abilityRange, abilityImage,
    ROLES, ROLE_INFO, linkDirection, linkSummary, abilityTraits, linkAbilities, traitHeroesByRole, filterByRole, trimSegment, gradientVector,
    vitalityTokens, TOKEN_RADIUS, ATTRIBUTE_GLYPHS, GLYPHS, attributeGlyph, glyphSymbol
} = window.GraphLogic;
const { encodeRoute, decodeRoute, isLegacyRoute, routeMeta, historyStep } = window.GraphRoute;
const { computeSynergies, heroSynergies, synergySummary, synergyArcs, arcAbilities, describeRelation, titleCase, abilityList, formationVerb } = window.Synergy;

let heroesData = [];
let traitDescriptions = {};
let synergyRelations = [];
let layoutSize = null; // simulation coordinates: the graph size at setup
let baseForce = null; // base forceX / forceY strengths
const TRAIT_LINK_STRENGTH = 0.6;
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
let linkHitElements;
let synergyLayer;
let synergyArcData = [];

const state = {
    selectedId: null,
    term: '',
    category: 'All',
    labelCategory: null,
    attribute: null,
    role: null,
    showAllNames: false,
    showSynergies: false,
    synergyCategory: null, // legend filter: only this synergy line category (partner / conflict / counter)
    bandFocus: null, // { mine, theirs } hero names sent from the Draft tab
    fromDraft: false, // a hero opened from the Draft tab: show Back to draft
    showOpponent: true, // band view: the opposing band and its counters with mine
    // Clicked edge: { key, links } — the selected hero's trait links behind it are marked on its card.
    // Clicked synergy arc: { key, arc } — the details panel shows both heroes' abilities in it
    picked: null
};

// Hero-to-hero synergy lines reuse the role hues: help = partner, harm dashed = careful with
// (teammate), harm solid = counter (opponent). Each category bends its own way so a pair's lines don't overlap.
const SYNERGY_STYLE = {
    partner:  { hue: 'help',      label: 'Partners',     hint: 'helps the other', bend: 0.16 },
    conflict: { hue: 'harm',      label: 'Careful with', hint: 'works against',   bend: -0.16 },
    counter:  { hue: 'harm',      label: 'Counter',      hint: 'as opponents',    bend: 0.3 }
};

const CATEGORY_CHIPS = ['All', 'Melee', 'Ranged', 'AoE', 'Displacement'];

// Hero ring colour = card attribute: the card banner's red / green / blue, re-stepped so all
// pairs stay apart under colour-blind simulation on the dark surface (dataviz validator, all pairs
// ΔE ≥ 11). Every attribute also has its card-banner emblem (GraphLogic.ATTRIBUTE_GLYPHS) so colour is never the only cue.
const HERO_ATTRIBUTES = {
    Strength:     { color: '#D9483B', label: 'Strength' },
    Agility:      { color: '#2CAA95', label: 'Agility' },
    Intelligence: { color: '#5B7FE0', label: 'Intelligence' }
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

// Edge roles: hue = group (harm: inflicts on enemies or hinders the hero / help own side /
// condition the hero benefits from), dash = variant
// (self only / works against), arrow = direction. Three hues validated for CVD on --bg;
// colours live in styles.css (--role-*), this table drives legend and markers.
const ROLE_STYLE = {
    inflicts:      { hue: 'harm',      dashed: false, hint: 'on enemies' },
    grants:        { hue: 'help',      dashed: false, hint: 'to allies' },
    gains:         { hue: 'help',      dashed: true,  hint: 'on itself' },
    // Reuses the neutral highlight gold (not a 4th category hue); dotted line + arrow set it apart
    places:        { hue: 'place',     dashed: 'dotted', hint: 'onto terrain' },
    benefits_from: { hue: 'condition', dashed: false, hint: 'condition' },
    hindered_by:   { hue: 'harm',      dashed: true,  hint: 'works against' }
};
const SUBJECT_LABEL = { self: 'self', ally: 'allies', enemy: 'enemies' };

const SYMBOLS = {
    triangle: d3.symbolTriangle,
    circle: d3.symbolCircle,
    diamond: d3.symbolDiamond,
    wye: d3.symbolWye,
    square: d3.symbolSquare
};

function symbolPath(name, size) {
    return d3.symbol().type(SYMBOLS[name]).size(size)();
}

// Google Analytics events (analytics.js, plan: docs/analytics-tracking-plan.md)
const analytics = window.Analytics.pageTracker();
const track = analytics.track;
const ENTRY = window.Analytics.entryOf({ search: location.search, hash: location.hash }); // before routing rewrites it
// Tooltips count as seen once they stay open a moment, each target once per page load
const hoverDelay = window.Analytics.createDelay({ wait: 700 });
function trackHover(key, name, params) {
    hoverDelay.start(() => { if (analytics.once(key)) track(name, params); });
}
const graphSearch = window.Analytics.createSettledSearch({
    send: term => {
        const { nodeIds } = currentFilter();
        const count = nodeIds ? nodeIds.size : nodesData.length;
        track('search', { search_term: term, result_count: count, surface: 'graph' });
        if (!count) track('search_no_results', { search_term: term, surface: 'graph' });
    }
});

async function init() {
    try {
        const response = await fetch('bestiary_reference_cards.json');
        const data = await response.json();
        heroesData = data.bestiary_of_sigillum.characters;
        synergyRelations = computeSynergies(heroesData);

        traitDescriptions = data.bestiary_of_sigillum.trait_descriptions;
        ({ nodes: nodesData, links: linksData } = buildGraph(heroesData, traitDescriptions));
        nodesById = new Map(nodesData.map(n => [n.id, n]));
        adjacency = buildAdjacency(linksData);

        setupGraph();
        setupToolbar();
        setupSearch();
        setupChips();
        renderLegend();
        setupPanels();
        setupKeyboard();
        render();
        setupRouting();
        document.dispatchEvent(new Event('bestiary:graph-ready'));

        track('app_loaded', { entry: ENTRY, hero_count: heroesData.length });
    } catch (error) {
        console.error('Error initializing application:', error);
        track('app_error', { error: error.message });
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

    ['harm', 'help', 'condition', 'place', 'mixed'].forEach(hue => {
        defs.append('marker').attr('id', `arrow-${hue}`)
            .attr('viewBox', '0 -5 10 10').attr('refX', 9).attr('refY', 0)
            .attr('markerWidth', 4.5).attr('markerHeight', 4.5).attr('markerUnits', 'strokeWidth')
            .attr('orient', 'auto-start-reverse')
            .append('path').attr('class', `arrow arrow--${hue}`).attr('d', 'M0,-5L10,0L0,5Z');
    });

    gradientDefs = defs;
    viewport = svg.append('g').attr('class', 'viewport');

    zoom = d3.zoom()
        .scaleExtent([0.25, 4])
        .on('zoom', event => {
            viewport.attr('transform', event.transform);
            svg.classed('zoomed-out', event.transform.k < 0.6);
            hideTooltip();
            const gesture = window.Analytics.gestureOf(event.sourceEvent); // the user's, not fit / centre
            if (gesture && analytics.once(`zoom|${gesture.control}`)) track('graph_zoom_gesture', gesture);
        });
    svg.call(zoom).on('dblclick.zoom', null);

    svg.on('click', event => {
        if (event.target === svg.node()) {
            clearSelection('background_click');
        }
    });

    // Hub traits (Melee, Displacement…) get longer links so their heroes fan out;
    // one-off traits sit close to their hero
    const linkDistance = l => 40 + Math.sqrt(l.target.degree) * 22;
    layoutSize = { width, height };
    baseForce = { x: 0.04 * Math.max(1, (height / width) * 2), y: 0.06 * Math.max(1, width / height) };
    simulation = d3.forceSimulation(nodesData)
        .force('link', d3.forceLink(linksData).id(d => d.id).distance(linkDistance).strength(TRAIT_LINK_STRENGTH))
        .force('charge', d3.forceManyBody().strength(d => d.type === 'hero' ? -650 : -90 - d.degree * 12))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => d.type === 'hero' ? d.radius + 22 : d.radius + 8))
        // Squeeze along the container's short side so the layout matches its shape
        .force('x', d3.forceX(width / 2).strength(baseForce.x))
        .force('y', d3.forceY(height / 2).strength(baseForce.y))
        .stop();

    // Settle the layout before the first paint so the graph doesn't jitter in
    simulation.tick(320);

    linkElements = viewport.append('g').attr('class', 'links')
        .selectAll('line')
        .data(linksData)
        .join('line')
        .attr('class', 'link');

    // Wide invisible strokes under the nodes make thin edges hoverable
    linkHitElements = viewport.append('g').attr('class', 'link-hits')
        .selectAll('line')
        .data(linksData)
        .join('line')
        .attr('class', 'link-hit')
        .on('mouseenter', (event, d) => showLinkTooltip(d))
        .on('mouseleave', hideTooltip)
        .on('click', (event, d) => {
            event.stopPropagation();
            selectEdge(d);
        });

    synergyLayer = viewport.append('g').attr('class', 'synergy-links');

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
        .attr('stroke', d => HERO_ATTRIBUTES[d.attribute].color);
    const badge = heroes.append('g')
        .attr('class', 'type-badge')
        .attr('transform', d => `translate(${d.radius * 0.72},${d.radius * 0.72})`);
    badge.append('circle').attr('r', 7).attr('fill', d => HERO_ATTRIBUTES[d.attribute].color);
    badge.append('path').attr('transform', 'translate(-4.5 -4.5) scale(0.375)')
        .attr('d', d => ATTRIBUTE_GLYPHS[d.attribute]);
    const tokens = heroes.append('g').attr('class', 'vitality-tokens')
        .selectAll('g')
        .data(d => vitalityTokens(d.vitality, d.radius))
        .join('g')
        .attr('class', 'vitality-token')
        .attr('transform', t => `translate(${t.x},${t.y})`);
    tokens.append('circle').attr('class', 'token-rim').attr('r', TOKEN_RADIUS);
    tokens.append('circle').attr('class', 'token-face').attr('r', TOKEN_RADIUS - 1.3);
    const heart = TOKEN_RADIUS * 1.55;
    tokens.append('use').attr('class', 'token-heart').attr('href', '#heart-glyph')
        .attr('x', -heart / 2).attr('y', -heart / 2).attr('width', heart).attr('height', heart);

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
        return `${d.name}, ${HERO_ATTRIBUTES[d.attribute].label} hero, vitality ${d.vitality}`;
    }
    return `${d.name} trait, ${LABEL_SHAPES[d.category].label}, ${d.degree} heroes`;
}

// One-way edges fade in from tail to arrowhead so the direction reads along the whole line.
// Each edge has its own userSpaceOnUse gradient, moved with the edge on every tick.
let gradientDefs = null;
const GRADIENT_TAIL_OPACITY = 0.2;

function edgeGradient(id, hue) {
    let grad = gradientDefs.select(`#${id}`);
    if (grad.empty()) {
        grad = gradientDefs.append('linearGradient').attr('id', id).attr('gradientUnits', 'userSpaceOnUse');
        grad.append('stop').attr('offset', 0).attr('stop-opacity', GRADIENT_TAIL_OPACITY);
        grad.append('stop').attr('offset', 1).attr('stop-opacity', 1);
    }
    grad.selectAll('stop').attr('class', `grad-stop grad-stop--${hue}`);
    return grad;
}

// `vec` null: a two-way or undirected edge, drawn without a gradient
function placeGradient(id, vec) {
    if (!vec) return;
    gradientDefs.select(`#${id}`).attr('x1', vec.x1).attr('y1', vec.y1).attr('x2', vec.x2).attr('y2', vec.y2);
}

// Apply (or clear) an edge's gradient stroke; `dir` null = solid colour from the CSS
function strokeGradient(el, id, hue, dir, seg) {
    const vec = dir && gradientVector(seg, dir);
    if (!vec) { el.style('stroke', null); return false; }
    edgeGradient(id, hue);
    placeGradient(id, vec);
    el.style('stroke', `url(#${id})`);
    return true;
}

function ticked() {
    // Stop edges at the node rims so arrowheads aren't hidden under the nodes
    linksData.forEach(d => { d.seg = trimSegment(d.source, d.target, d.source.radius + 3, d.target.radius + 4); });
    [linkElements, linkHitElements].forEach(sel => sel
        .attr('x1', d => d.seg.x1)
        .attr('y1', d => d.seg.y1)
        .attr('x2', d => d.seg.x2)
        .attr('y2', d => d.seg.y2));
    linksData.forEach(d => { if (d.gradDir) placeGradient(`lg-${d.index}`, gradientVector(d.seg, d.gradDir)); });
    nodeElements.attr('transform', d => `translate(${d.x},${d.y})`);
    updateSynergyArcs();
}

function updateSynergyArcs() {
    synergyArcData.forEach(d => {
        d.geo = arcPath(d.source, d.target, d.source.radius + 4, d.target.radius + 4, SYNERGY_STYLE[d.category].bend);
        if (d.gradDir) placeGradient(`sg-${d.i}`, gradientVector(d.geo, d.gradDir));
    });
    synergyLayer.selectAll('path').attr('d', d => d.geo.d);
}

function drawSynergyArcs(arcs, focused) {
    const heroByName = new Map(nodesData.filter(n => n.type === 'hero').map(n => [n.name, n]));
    synergyArcData = arcs.map((a, i) => ({ ...a, i, source: heroByName.get(a.a), target: heroByName.get(a.b),
        gradDir: Boolean(a.aToB) !== Boolean(a.bToA) ? { toTrait: Boolean(a.aToB), toHero: Boolean(a.bToA) } : null }));
    const key = d => `${d.category}|${d.a}|${d.b}`;
    synergyLayer.selectAll('path.syn-arc-hit').data(synergyArcData, key).join('path')
        .attr('class', 'syn-arc-hit')
        .on('mouseenter', (event, d) => showArcTooltip(d))
        .on('mouseleave', hideTooltip)
        .on('click', (event, d) => {
            event.stopPropagation();
            selectArc(event, d);
        });
    synergyLayer.selectAll('path.syn-arc').data(synergyArcData, key).join('path')
        .attr('class', d => `syn-arc syn-arc--${d.category}${focused ? '' : ' syn-arc--overview'}${
            state.picked?.key === arcKey(d) ? ' syn-arc--picked' : ''}`)
        .attr('marker-end', d => (d.aToB ? `url(#arrow-${SYNERGY_STYLE[d.category].hue})` : null))
        .attr('marker-start', d => (d.bToA ? `url(#arrow-${SYNERGY_STYLE[d.category].hue})` : null));
    updateSynergyArcs();
    synergyLayer.selectAll('path.syn-arc').each(function (d) {
        if (!strokeGradient(d3.select(this), `sg-${d.i}`, SYNERGY_STYLE[d.category].hue, d.gradDir, d.geo)) d.gradDir = null;
    });
}

function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.2).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    if (analytics.once('drag')) track('node_drag', { node_type: d.type });
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

// { nodeIds, links } for the active filter; nodeIds is null when nothing filters.
// links is only set by the role filter (other filters keep links whose ends match)
function currentFilter() {
    if (state.role) return filterByRole(linksData, state.role);
    return {
        nodeIds: filterNodes(nodesData, { term: state.term, category: state.category, labelCategory: state.labelCategory, attribute: state.attribute }),
        links: null
    };
}

function fitToFilter() {
    const { nodeIds } = currentFilter();
    fitView(nodeIds ? nodesData.filter(n => nodeIds.has(n.id)) : nodesData);
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
    document.getElementById('clearAllBtn').addEventListener('click', () => clearAll('button'));
    document.getElementById('synergyToggle').addEventListener('click', () => toggleSynergies('button'));
    document.getElementById('opponentToggle').addEventListener('click', () => {
        state.showOpponent = !state.showOpponent;
        track('opponent_toggle', { state: state.showOpponent ? 'on' : 'off' });
        render();
    });
    document.getElementById('namesToggle').addEventListener('click', () => {
        state.showAllNames = !state.showAllNames;
        track('names_toggle', { state: state.showAllNames ? 'on' : 'off' });
        render();
    });
}

function toggleSynergies(method) {
    state.showSynergies = !state.showSynergies;
    if (state.showSynergies) state.role = null; // its legend control is hidden while synergies show
    else state.synergyCategory = null;
    hideTooltip();
    track('synergy_toggle', { state: state.showSynergies ? 'on' : 'off', method,
        hero_selected: nodesById.get(state.selectedId)?.type === 'hero' });
    render();
    const selected = nodesById.get(state.selectedId);
    if (state.showSynergies && selected?.type === 'hero') fitToSynergies(selected);
}

function runAction(action, method = 'button') {
    const selected = nodesById.get(state.selectedId);
    switch (action) {
        case 'zoom-in': svg.transition().duration(250).call(zoom.scaleBy, 1.35); break;
        case 'zoom-out': svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.35); break;
        case 'fit': fitView(nodesData); break;
        case 'center': if (selected) centerOn(selected); break;
    }
    track('graph_control', { control: action, method });
}

// ---------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------

function selectNode(id, { source = 'graph', center = true, picked = null } = {}) {
    const node = nodesById.get(id);
    if (!node) return;
    searchTyping = false; // a picked result (or any selection) is a step of its own
    state.selectedId = id;
    state.picked = picked;
    state.bandFocus = null;
    track('node_select', { node_type: node.type, node_name: node.name, source });
    render();
    if (state.showSynergies && node.type === 'hero') fitToSynergies(node);
    else if (center) fitToFocus(node);
}

const edgeKey = d => `edge|${d.source.id}|${d.target.id}`;
const arcKey = d => `arc|${d.category}|${d.a}|${d.b}`;
const sameLink = (a, b) => a.label === b.label && a.role === b.role && (a.on ?? null) === (b.on ?? null);

// Open a hero's card with the abilities behind `links` marked, scrolled into view
function selectPicked(heroId, key, links) {
    hideTooltip();
    selectNode(heroId, { source: key.split('|')[0], picked: { key, links } });
    document.querySelector('#heroInfo .card-ability--focus, #heroInfo .role-chip--focus')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Clicking an edge opens its hero's card with the abilities behind that trait marked
function selectEdge(d) {
    track('edge_click', { hero: d.source.name, trait: d.target.name, edge_role: d.kind });
    selectPicked(d.source.id, edgeKey(d), d.source.trait_links.filter(l => l.label === d.target.name));
}

// Clicking a synergy arc pins its hover view in the details panel: both heroes' abilities side by side.
// The hero at the nearer end becomes the graph selection; with a hero selected, every arc touches it, so it stays.
function selectArc(event, d) {
    const [x, y] = d3.pointer(event, viewport.node());
    const selected = state.selectedId && [d.source, d.target].find(n => n.id === state.selectedId);
    track('arc_click', { hero_a: d.a, hero_b: d.b, synergy_category: d.category, hero_selected: Boolean(selected) });
    const near = selected || (Math.hypot(x - d.source.x, y - d.source.y) <= Math.hypot(x - d.target.x, y - d.target.y)
        ? d.source : d.target);
    hideTooltip();
    selectNode(near.id, { source: 'arc', picked: { key: arcKey(d), arc: d } });
    document.getElementById('heroInfo').scrollTop = 0;
}

// Frame the selection together with the nodes it links to directly
function fitToFocus(node) {
    const ids = focusIds(node.id, adjacency);
    fitView(nodesData.filter(n => ids.has(n.id)));
}

// Frame the selected hero together with every hero it has a synergy line to
function fitToSynergies(node) {
    const names = new Set([node.name]);
    synergyArcs(synergyRelations, node.name, { category: state.synergyCategory }).forEach(a => { names.add(a.a); names.add(a.b); });
    fitView(nodesData.filter(n => n.type === 'hero' && names.has(n.name)));
}

function clearSelection(method) {
    if (method && state.selectedId) track('selection_clear', { method });
    state.selectedId = null;
    state.picked = null;
    render();
}

function clearAll(method) {
    const active = !document.getElementById('clearAllBtn').disabled; // Esc on a clear graph clears nothing
    Object.assign(state, { selectedId: null, picked: null, term: '', category: 'All', labelCategory: null, attribute: null, role: null, synergyCategory: null, bandFocus: null });
    document.getElementById('searchInput').value = '';
    closeSuggestions();
    if (active) track('filter_clear', { method });
    render();
}

// One function maps state -> visuals so every interaction stays consistent
function render() {
    const { nodeIds: filterSet, links: filterLinks } = currentFilter();

    // Synergy mode: hero-to-hero lines replace the trait edges (a selected trait keeps the normal view)
    const selectedNode = nodesById.get(state.selectedId);
    const band = state.bandFocus;
    const synergyMode = Boolean(band) || (state.showSynergies && (!selectedNode || selectedNode.type === 'hero'));
    let highlight = selectedNode ? computeHighlight(state.selectedId, adjacency, nodesById) : null;
    let arcs = [];
    applyBandLayout();
    if (band) {
        // A drafted band: its synergy lines (within it and to the pool) and, if shown, the opponent's counters
        const view = currentBandView();
        arcs = state.synergyCategory ? view.arcs.filter(a => a.category === state.synergyCategory) : view.arcs;
        highlight = new Map(nodesData.map(n => [n.id, n.type === 'hero' ? view.states.get(n.name) : 'dim']));
    } else if (synergyMode) {
        const focus = selectedNode ? selectedNode.name : null;
        arcs = synergyArcs(synergyRelations, focus, { category: state.synergyCategory });
        const heroId = name => nodesData.find(n => n.type === 'hero' && n.name === name).id;
        // Under the legend's line filter only heroes with such a line stay lit
        const lined = state.synergyCategory ? new Set(arcs.flatMap(a => [heroId(a.a), heroId(a.b)])) : null;
        if (focus) {
            highlight = new Map(nodesData.map(n => [n.id, 'dim']));
            highlight.set(state.selectedId, 'selected');
            arcs.forEach(a => highlight.set(heroId(a.a === focus ? a.b : a.a), 'connected'));
        } else {
            if (filterSet) arcs = arcs.filter(a => filterSet.has(heroId(a.a)) && filterSet.has(heroId(a.b)));
            highlight = new Map(nodesData.map(n => [n.id,
                n.type === 'label' || (filterSet && !filterSet.has(n.id)) || (lined && !lined.has(n.id)) ? 'dim' : 'none']));
        }
    }
    drawSynergyArcs(arcs, synergyMode && (Boolean(selectedNode) || Boolean(band)));

    nodeElements
        .classed('is-selected', d => highlight?.get(d.id) === 'selected')
        .classed('is-connected', d => highlight?.get(d.id) === 'connected')
        .classed('is-rival', d => highlight?.get(d.id) === 'rival')
        .classed('is-secondary', d => highlight?.get(d.id) === 'secondary')
        .classed('is-dim', d => highlight ? highlight.get(d.id) === 'dim' : (filterSet ? !filterSet.has(d.id) : false))
        .classed('is-match', d => !highlight && filterSet ? filterSet.has(d.id) : false)
        .attr('aria-pressed', d => String(d.id === state.selectedId));

    // Role colours and arrows show on edges in focus: the selection's own edges or the role filter's
    const roleShown = new Set();
    linkElements.attr('class', d => {
        if (synergyMode) return 'link link--dim';
        if (highlight) {
            const st = linkState(d, highlight);
            if (st === 'direct') roleShown.add(d);
            return `link link--${st}`;
        }
        if (filterLinks) {
            if (!filterLinks.has(d)) return 'link link--dim';
            roleShown.add(d);
            return 'link link--role';
        }
        if (filterSet) return filterSet.has(d.source.id) && filterSet.has(d.target.id) ? 'link' : 'link link--dim';
        return 'link';
    });
    linkElements.each(function (d) {
        // Under a role filter a mixed edge is drawn as the filtered role
        const roles = filterLinks && !highlight ? d.roles.filter(r => r.role === state.role) : d.roles;
        const kind = filterLinks && !highlight ? state.role : d.kind;
        const shown = roleShown.has(d) && kind !== 'has';
        const line = d3.select(this).classed(`kind--${kind}`, shown);
        const dir = linkDirection(roles);
        const hue = kind === 'mixed' ? 'mixed' : ROLE_STYLE[kind]?.hue;
        line.attr('marker-end', shown && dir.toTrait ? `url(#arrow-${hue})` : null)
            .attr('marker-start', shown && dir.toHero ? `url(#arrow-${hue})` : null);
        d.gradDir = shown && strokeGradient(line, `lg-${d.index}`, hue, dir, d.seg) ? dir : null;
    });

    // Raise highlighted nodes so they draw above the dimmed crowd
    nodeElements.filter(d => highlight && highlight.get(d.id) !== 'dim' && d.type === 'hero').raise();
    nodeElements.filter(d => highlight && highlight.get(d.id) !== 'dim' && d.type === 'label').raise();
    linkElements.filter(function () { return /--(direct|role)/.test(this.getAttribute('class')); }).raise();
    linkElements.classed('link--picked', d => !synergyMode && state.picked?.key === edgeKey(d))
        .filter('.link--picked').raise();

    svg.classed('has-highlight', Boolean(highlight || filterSet));
    svg.classed('synergy-mode', synergyMode);
    svg.classed('show-all-names', state.showAllNames);

    updateHeaderState(filterSet);
    renderDetails();
    syncRoute();
    // The Draft tab's "add to draft" button follows the selected hero (draft-ui.js)
    document.dispatchEvent(new CustomEvent('bestiary:selection',
        { detail: { hero: selectedNode?.type === 'hero' ? selectedNode.name : null } }));
}

function updateHeaderState(filterSet) {
    const heroCount = filterSet
        ? [...filterSet].filter(id => nodesById.get(id).type === 'hero').length
        : heroesData.length;
    const active = [];
    if (state.category !== 'All') active.push(state.category);
    if (state.attribute) active.push(`${HERO_ATTRIBUTES[state.attribute].label} heroes`);
    if (state.labelCategory) active.push(`${LABEL_SHAPES[state.labelCategory].label} traits`);
    if (state.role) active.push(`${ROLE_INFO[state.role].label} edges`);
    if (state.synergyCategory) active.push(`${SYNERGY_STYLE[state.synergyCategory].label} lines`);
    if (state.term.trim()) active.push(`“${state.term.trim()}”`);

    const roleLinks = state.role ? filterByRole(linksData, state.role).links.size : 0;
    document.getElementById('matchCount').textContent = state.role
        ? `${roleLinks} ${ROLE_INFO[state.role].label.toLowerCase()} edge${roleLinks === 1 ? '' : 's'}`
        : state.labelCategory
        ? `${filterSet.size} matching trait${filterSet.size === 1 ? '' : 's'}`
        : `${heroCount} ${filterSet ? 'matching ' : ''}hero${heroCount === 1 ? '' : 'es'}`;
    document.getElementById('activeFilters').textContent = active.join(' · ') || 'None';

    const selected = nodesById.get(state.selectedId);
    let title = state.showSynergies ? 'Synergy Map' : 'Hero Network';
    if (state.bandFocus) title = `Your band: ${state.bandFocus.mine.map(titleCase).join(', ')}`;
    else if (selected) title = state.showSynergies && selected.type === 'hero' ? `${selected.name} · Synergies` : selected.name;
    else if (active.length) title = `Filtered: ${active.join(' · ')}`;
    document.getElementById('graphTitle').textContent = title;
    document.getElementById('backToDraft').hidden = !(state.bandFocus || state.fromDraft);
    const opponentToggle = document.getElementById('opponentToggle');
    opponentToggle.hidden = !state.bandFocus?.theirs.length;
    opponentToggle.setAttribute('aria-pressed', String(state.showOpponent));
    document.querySelector('[data-legend="opponent"]').hidden = opponentToggle.hidden || !state.showOpponent;

    document.getElementById('clearAllBtn').disabled =
        !(state.selectedId || active.length || state.bandFocus);
    document.querySelector('[data-action="center"]').disabled = !selected;

    document.getElementById('synergyToggle').setAttribute('aria-pressed', String(state.showSynergies));
    // The legend explains whichever line type the Synergies toggle is drawing
    document.querySelector('[data-legend="roles"]').hidden = state.showSynergies;
    document.querySelector('[data-legend="synergy"]').hidden = !state.showSynergies;
    const names = document.getElementById('namesToggle');
    names.setAttribute('aria-pressed', String(state.showAllNames));

    document.querySelectorAll('#categoryChips .chip').forEach(chip => {
        chip.setAttribute('aria-pressed', String(chip.dataset.category === state.category));
    });
    document.querySelectorAll('.legend-filter[data-label-category]').forEach(item => {
        item.setAttribute('aria-pressed', String(item.dataset.labelCategory === state.labelCategory));
    });
    document.querySelectorAll('.legend-filter[data-attribute]').forEach(item => {
        item.setAttribute('aria-pressed', String(item.dataset.attribute === state.attribute));
    });
    document.querySelectorAll('.legend-filter[data-role]').forEach(item => {
        item.setAttribute('aria-pressed', String(item.dataset.role === state.role));
    });
    document.querySelectorAll('.legend-filter[data-synergy]').forEach(item => {
        item.setAttribute('aria-pressed', String(item.dataset.synergy === state.synergyCategory));
    });
}

// ---------------------------------------------------------------------------
// Details panel
// ---------------------------------------------------------------------------

// Attribute emblem on an attribute-coloured disc (graph badge, legend, tooltips)
function heroGlyph(attribute, size = 16) {
    return `<svg class="glyph" width="${size}" height="${size}" viewBox="-8 -8 16 16" aria-hidden="true">
        <circle r="7.5" fill="${HERO_ATTRIBUTES[attribute].color}"/>
        <path transform="translate(-5 -5) scale(0.4167)" d="${ATTRIBUTE_GLYPHS[attribute]}"/></svg>`;
}

// Reference-card row markers (target, effect, cooldown), as on the official card
function cardIcon(kind, title) {
    return `<svg class="card-icon" viewBox="0 0 24 24" role="img" aria-label="${title}"><title>${title}</title><path d="${GLYPHS[kind]}"/></svg>`;
}

// The vitality heart, shared by the graph tokens, draft portraits and the reference card
document.querySelector('.svg-defs defs').insertAdjacentHTML('afterbegin', glyphSymbol('heart-glyph', 'heart'));

function labelGlyph(category, size = 16, name = null) {
    const icon = name && effectIcon(name);
    if (icon) return `<img class="glyph glyph-img" src="${icon}" width="${size}" height="${size}" alt="">`;
    return `<svg class="glyph glyph-trait" width="${size}" height="${size}" viewBox="-8 -8 16 16" aria-hidden="true">
        <path d="${symbolPath(LABEL_SHAPES[category].symbol, 70)}"/></svg>`;
}

// Official effects quote their rule (with its source); other traits get a short gloss
function traitDescription(node, cls) {
    const d = node.description;
    if (!d) return '';
    return `<div class="${cls}${d.source ? ` ${cls}--rule` : ''}">
        ${d.source ? `<span class="${cls}-kicker">Official rule · ${escapeHtml(d.source)}</span>` : ''}
        <p>${escapeHtml(d.text)}</p></div>`;
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

// ---------------------------------------------------------------------------
// Synergies (deduced in synergy.js from the typed trait links)
// ---------------------------------------------------------------------------

const RULE_NOTE = { cooldowns: 'longer enemy cooldowns', 'tower control': 'via Control increase' };

function heroChip(name, title) {
    const node = nodesData.find(n => n.type === 'hero' && n.name === name);
    return `<button type="button" class="hero-chip" data-node="${node.id}" title="${escapeHtml(title)}">
        <img src="${node.image}" alt="" width="22" height="22"> ${escapeHtml(name)}</button>`;
}

// Rows of { heading, chips } grouped by a key, keeping first-seen order
function groupRows(entries, key, heading, chip) {
    const rows = new Map();
    entries.forEach(e => {
        const k = key(e);
        if (!rows.has(k)) rows.set(k, { heading: heading(e), chips: [] });
        rows.get(k).chips.push(chip(e));
    });
    return [...rows.values()].map(r => `
        <div class="syn-row"><div class="syn-need">${r.heading}</div><div class="syn-chips">${r.chips.join('')}</div></div>`).join('');
}

function synergySection(node) {
    const s = heroSynergies(node.name, synergyRelations);
    const supplyText = (hero, supply) => linkSummary(hero, supply.label, [supply])[0];
    const label = (text, rule) => `<strong>${escapeHtml(text)}</strong>${
        RULE_NOTE[rule] ? ` <span class="syn-rule">${RULE_NOTE[rule]}</span>` : ''}`;
    const blocks = [];

    if (s.selfCombos.length) {
        blocks.push(`<h5 class="syn-title">Self-combo</h5>` + s.selfCombos.map(c => `
            <p class="syn-line">${escapeHtml(abilityList(c.supply.sources))} → ${escapeHtml(abilityList(c.need.sources))}
                · ${label(c.label, c.rule)}</p>`).join(''));
    }
    if (s.helpedBy.length) {
        blocks.push(`<h5 class="syn-title"><span class="role-dot kind--grants"></span>Helped by</h5>` + groupRows(s.helpedBy,
            e => `${e.label}|${e.need.sources}`,
            e => `${label(e.label, e.rule)} for ${escapeHtml(abilityList(e.need.sources))}`,
            e => heroChip(e.hero, supplyText(e.hero, e.supply))));
    }
    if (s.helps.length) {
        blocks.push(`<h5 class="syn-title"><span class="role-dot kind--grants"></span>Helps</h5>` + groupRows(s.helps,
            e => `${e.label}|${e.supply.sources}`,
            e => `${label(e.label, e.rule)} from ${escapeHtml(abilityList(e.supply.sources))}`,
            e => heroChip(e.hero, `${e.hero} needs ${e.label} for ${abilityList(e.need.sources)}`)));
    }
    if (s.conflicts.length) {
        blocks.push(`<h5 class="syn-title"><span class="role-dot kind--hindered_by"></span>Careful with</h5>` + groupRows(s.conflicts,
            e => `${e.direction}|${e.label}`,
            e => e.direction === 'hurt-by'
                ? `${label(e.label, e.rule)} hinders your ${escapeHtml(abilityList(e.need.sources))}`
                : `Your ${escapeHtml(abilityList(e.supply.sources))} (${label(e.supply.label)}) hinders`,
            e => heroChip(e.hero, e.direction === 'hurt-by'
                ? supplyText(e.hero, e.supply) : `${e.hero}'s ${abilityList(e.need.sources)} is hindered by ${e.label}`)));
    }
    // One sentence per supplying ability; its effects on the victim joined ("undoes X and hinders Y")
    const counterText = (attacker, reasons) => {
        const bySupply = new Map();
        reasons.forEach(r => {
            if (r.rule === 'size') return;
            const key = `${r.supply.label}|${r.supply.sources}`;
            if (!bySupply.has(key)) bySupply.set(key, { supply: r.supply, effects: [] });
            bySupply.get(key).effects.push(r.rule === 'hindrance' ? `hinders ${abilityList(r.need.sources)}`
                : r.rule === 'formation' ? `${formationVerb(r)} the ${r.need.label} ${abilityList(r.need.sources)} needs`
                : `undoes ${r.need.label} for ${abilityList(r.need.sources)}`);
        });
        const size = reasons.filter(r => r.rule === 'size').map(r =>
            `${escapeHtml(titleCase(attacker))} is <strong>Small</strong> (max Vitality 2): ${escapeHtml(abilityList(r.need.sources))} cannot target it`);
        return [...size, ...[...bySupply.values()].map(({ supply, effects }) =>
            `${escapeHtml(titleCase(attacker))} ${ROLE_INFO[supply.role].verb} <strong>${escapeHtml(supply.label)}</strong>
             (${escapeHtml(abilityList(supply.sources))}): ${escapeHtml(effects.join(' and '))}`)].join('<br>');
    };
    const counterRows = (list, attacker) => list.map(c => `
        <div class="syn-row"><div class="syn-chips">${heroChip(c.hero, '')}</div>
            <div class="syn-need">${counterText(attacker(c), c.reasons)}</div></div>`).join('');
    if (s.counteredBy.length) {
        blocks.push(`<h5 class="syn-title"><span class="role-dot kind--inflicts"></span>Countered by</h5>`
            + counterRows(s.counteredBy, c => c.hero));
    }
    if (s.counters.length) {
        blocks.push(`<h5 class="syn-title"><span class="role-dot kind--inflicts"></span>Counters</h5>`
            + counterRows(s.counters, () => node.name));
    }
    if (s.flags.dontFeed) blocks.push(`<p class="syn-flag">Don't feed: grows stronger from its own Injuries.</p>`);
    if (s.flags.punishWithDamage) blocks.push(`<p class="syn-flag">Punish with damage: Injuries slow some of its abilities.</p>`);

    if (!blocks.length) return '';
    return `
        <section class="detail-section synergies">
            <h4 class="section-title">Synergies</h4>
            ${blocks.join('')}
        </section>`;
}

// One ability laid out like the printed reference card. `art: false` drops the artwork (tooltips),
// `focus` marks it as the source of the clicked edge, `extra` is appended inside the block
function cardAbilityHtml(node, a, i, { art = true, focus = false, extra = '' } = {}) {
    const range = abilityRange(a.range);
    const name = a.name || (i === 0 ? 'Core ability' : `Support ability ${i}`);
    return `
        <article class="card-ability${i === 0 ? ' card-ability--core' : ''}${focus ? ' card-ability--focus' : ''}">
            <header class="card-ability-head">
                <h4>${escapeHtml(name)}:</h4>
                ${range ? `<img class="card-range" src="${range.src}" alt="${escapeHtml(range.label)}" title="${escapeHtml(range.label)}">` : ''}
            </header>
            <div class="card-ability-body">
                <div class="card-rows">
                    <p class="card-row">${cardIcon('target', 'Target')}<span>${escapeHtml(tidyTarget(a.target))}</span></p>
                    <p class="card-row">${cardIcon('effect', 'Effect')}<span>${escapeHtml(a.effect)}</span></p>
                    ${a.cooldown ? `<p class="card-row">${cardIcon('cooldown', 'Cooldown')}<span>${escapeHtml(a.cooldown)}</span></p>` : ''}
                </div>
                ${art ? `<img class="card-art" src="${abilityImage(node.name, i)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
            </div>
            ${extra}
        </article>`;
}

// The printed reference card (portrait, vitality, features, abilities with range and cooldown).
// Shared by the details panel and the Draft tab's reference cards; `traits: false` leaves out the
// trait chips under each ability (they link into the graph, which the reference cards don't need).
// `focusLinks` (trait links) marks the abilities and chips behind a clicked edge.
function heroCardParts(node, { traits = true, focusLinks = [] } = {}) {
    const isFocus = l => focusLinks.some(f => sameLink(f, l));
    const attribute = HERO_ATTRIBUTES[node.attribute];
    const reach = node.labels.includes('Melee') ? 'Melee' : 'Ranged';
    const groups = abilityTraits(node);
    const roleChip = l => {
        const n = nodesById.get(`label_${l.label}`);
        return `<button type="button" class="trait-chip role-chip kind--${l.role}${isFocus(l) ? ' role-chip--focus' : ''}" data-node="${n.id}"
                    title="${escapeHtml(linkSummary(node.name, l.label, [l])[0])}">
            ${l.role === 'has' ? '' : `<span class="role-tag">${ROLE_INFO[l.role].label}</span>`}
            <span class="chip-label">${labelGlyph(n.category, 14, n.name)} ${escapeHtml(l.label)}</span>${
            SUBJECT_LABEL[l.on] ? ` <span class="role-on">· ${SUBJECT_LABEL[l.on]}</span>` : ''}</button>`;
    };
    const chips = links => links.length
        ? `<div class="trait-chips ability-traits">${links.map(roleChip).join('')}</div>` : '';
    // Laid out like the printed reference card: core ability boxed, support abilities ruled off below it
    const focused = new Set(focusLinks.length
        ? linkAbilities(node, node.trait_links.filter(isFocus)).map(g => g.index) : []);
    const ability = (a, i) => cardAbilityHtml(node, a, i, { focus: focused.has(i), extra: traits ? chips(groups[i].links) : '' });

    const html = `
            <div class="hero-card">
                <header class="card-top">
                    <div class="card-banner attr--${node.attribute}" title="${escapeHtml(attribute.label)}">
                        <span class="card-number">${node.originalId}</span>
                        ${attributeGlyph(node.attribute, 'card-banner-glyph')}
                    </div>
                    <h3 class="card-name">${escapeHtml(node.name)}</h3>
                    <div class="card-title">
                        <div class="card-vitality" title="Vitality">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#heart-glyph"/></svg>
                            <span class="sr-only">Vitality</span> ${node.vitality}
                        </div>
                        <div class="card-type">${escapeHtml(attribute.label)} · ${reach}</div>
                    </div>
                    <img class="card-portrait" src="${node.image}" alt="Portrait of ${escapeHtml(node.name)}">
                    ${node.features.length || node.sync_note ? `
                    <section class="card-features">
                        <h4>Features:</h4>
                        ${node.features.map(f => `<p>${escapeHtml(f)}</p>`).join('')}
                        ${node.sync_note ? `<p class="card-sync">${escapeHtml(node.sync_note)}</p>` : ''}
                    </section>` : ''}
                </header>

                ${ability(node.core_ability, 0)}
                ${node.support_abilities.map((a, i) => ability(a, i + 1)).join('')}
            </div>
`;
    return { html, groups, chips };
}

function heroCardHtml(node, options) {
    return heroCardParts(node, options).html;
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
                    <dt><kbd>+</kbd> <kbd>−</kbd> <kbd>F</kbd></dt><dd>Zoom, fit</dd>
                    <dt><kbd>S</kbd></dt><dd>Synergy lines</dd>
                    <dt><kbd>Esc</kbd></dt><dd>Clear selection</dd>
                </dl>
            </div>`;
        return;
    }

    if (state.picked?.arc) {
        panel.innerHTML = arcPanelHtml(state.picked.arc);
    } else if (node.type === 'hero') {
        const { html, groups, chips } = heroCardParts(node, { focusLinks: state.picked?.links || [] });
        panel.innerHTML = `
            ${html}

            ${groups.at(-1).links.length ? `
            <section class="detail-section">
                <h4 class="section-title">Card Traits <span class="count">${groups.at(-1).links.length}</span></h4>
                ${chips(groups.at(-1).links)}
            </section>` : ''}

            ${synergySection(node)}`;
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
            ${traitDescription(node, 'trait-desc')}
            ${traitHeroesByRole(node.name, nodesData).map(group => `
            <section class="detail-section">
                <h4 class="section-title"><span class="role-dot kind--${group.role}"></span>${ROLE_INFO[group.role].label}
                    <span class="count">${group.entries.length}</span></h4>
                <div class="hero-list">${group.entries.map(e => heroButton(heroesData.find(h => h.name === e.hero.name),
                    `<span class="shared">${escapeHtml([e.sources.join(' & '), SUBJECT_LABEL[e.on] && `on ${SUBJECT_LABEL[e.on]}`]
                        .filter(Boolean).join(' · '))}</span>`)).join('')}</div>
            </section>`).join('')}`;
    }
}

// Delegated clicks for everything rendered inside the details panel
document.addEventListener('click', event => {
    const nodeButton = event.target.closest('.details-body [data-node]');
    if (!nodeButton) return;
    const from = nodesById.get(state.selectedId);
    const target = nodesById.get(nodeButton.dataset.node);
    track('panel_link_click', { link_kind: PANEL_LINKS.find(k => nodeButton.classList.contains(k))?.replace(/-/g, '_'),
        from_node: from?.name, target_type: target?.type, target_name: target?.name, panel_section: panelSection(nodeButton) });
    selectNode(nodeButton.dataset.node, { source: 'panel' });
});

// Most specific first: the arc panel's hero headings are also .tt-side-head
const PANEL_LINKS = ['pair-side-head', 'hero-chip', 'hero-link', 'trait-chip'];

// Where in the panel a link sits: an ability box, the synergy pair, or a section (its sub-heading if it has one)
function panelSection(el) {
    if (el.closest('.card-ability')) return 'ability';
    if (el.closest('.pair-body')) return 'synergy_pair';
    const section = el.closest('.detail-section');
    if (!section) return null;
    let row = el;
    while (row.parentElement && row.parentElement !== section) row = row.parentElement;
    for (let s = row; s; s = s.previousElementSibling) if (s.matches('.syn-title')) return window.Analytics.slug(s.textContent);
    return window.Analytics.slug(section.querySelector('.section-title')?.textContent);
}

// ---------------------------------------------------------------------------
// Tooltip (hover / focus preview)
// ---------------------------------------------------------------------------

function showTooltip(d) {
    trackHover(`node|${d.id}`, 'node_tooltip_view', { node_type: d.type, node_name: d.name });
    const tooltip = document.getElementById('tooltip');
    setTooltipKind(tooltip, null);
    if (d.type === 'hero') {
        tooltip.innerHTML = `
            <div class="tt-head">
                <img src="${d.image}" alt="" width="40" height="40">
                <div><strong>${escapeHtml(d.name)}</strong>
                <div class="tt-sub">${heroGlyph(d.attribute, 12)} ${HERO_ATTRIBUTES[d.attribute].label} · Vitality ${d.vitality}</div></div>
            </div>
            ${d.features.length ? `<ul class="tt-features">${d.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
            ${tooltipSynergies(d.name)}`;
    } else {
        tooltip.innerHTML = `
            <div class="tt-head">${labelGlyph(d.category, 24, d.name)}
                <div><strong>${escapeHtml(d.name)}</strong>
                <div class="tt-sub">${escapeHtml(LABEL_SHAPES[d.category].label)}</div></div>
            </div>
            ${traitDescription(d, 'tt-desc')}
            <div class="tt-meta">Shared by ${d.degree} hero${d.degree === 1 ? '' : 'es'}<br>${
                traitHeroesByRole(d.name, nodesData).map(g => `${g.entries.length} ${ROLE_INFO[g.role].label.toLowerCase()}`).join(' · ')}</div>`;
    }
    placeTooltip(d.x, d.y, d.radius);
}

// The abilities behind an edge or arc as a slip of the parchment card. groups: [{ ability, index, links }],
// cardLevel: links no ability causes; `tags` lists the links under each block when they need telling apart
function abilitySlip(hero, groups, cardLevel, { tags = false } = {}) {
    const linkTags = links => tags ? `<div class="tt-ability-roles">${links.map(l => `<span class="role-tag-sm">
        <span class="role-dot kind--${l.role}"></span>${ROLE_INFO[l.role].label} ${escapeHtml(l.label)}${
        SUBJECT_LABEL[l.on] ? ` · ${SUBJECT_LABEL[l.on]}` : ''}</span>`).join('')}</div>` : '';
    const blocks = groups.map(g => cardAbilityHtml(hero, g.ability, g.index, { art: false, extra: linkTags(g.links) }));
    if (cardLevel.length) {
        const small = cardLevel.some(l => l.label === 'Small');
        blocks.push(`<article class="card-ability card-ability--level"><header class="card-ability-head"><h4>${small ? 'Small:' : 'Card trait:'}</h4></header>
            ${small ? `<p>Vitality ${hero.vitality}: a Small character (max Vitality 2).</p>`
                : (hero.features || []).map(f => `<p>${escapeHtml(f)}</p>`).join('') || '<p>Not tied to a single ability.</p>'}
            ${linkTags(cardLevel)}</article>`);
    }
    return `<div class="hero-card tt-abilities">${blocks.join('')}</div>`;
}

function setTooltipKind(tooltip, kind) {
    tooltip.classList.toggle('tooltip--edge', kind === 'edge');
    tooltip.classList.toggle('tooltip--arc', kind === 'arc');
}

// Edge preview: what the hero does with the trait, and the full card text of the abilities that do it
function showLinkTooltip(d) {
    trackHover(edgeKey(d), 'edge_tooltip_view', { hero: d.source.name, trait: d.target.name, edge_role: d.kind });
    const tooltip = document.getElementById('tooltip');
    const hero = d.source;
    const groups = linkAbilities(hero, d.roles);
    const asLinks = g => ({ ...g, links: g.roles.map(r => ({ ...r, label: d.target.name })) });
    const cardLevel = groups.filter(g => !g.ability).flatMap(g => asLinks(g).links);
    setTooltipKind(tooltip, 'edge');
    tooltip.innerHTML = `
        <div class="tt-head">
            <img src="${hero.image}" alt="" width="40" height="40">
            <div><strong>${escapeHtml(hero.name)}</strong>
            <div class="tt-sub">${labelGlyph(d.target.category, 14, d.target.name)} ${escapeHtml(d.target.name)}</div></div>
        </div>
        <ul class="tt-roles">${d.roles.map(r => `<li><span class="role-dot kind--${r.role}"></span>${
            escapeHtml(linkSummary(hero.name, d.target.name, [{ ...r, sources: [] }])[0])}</li>`).join('')}</ul>
        ${abilitySlip(hero, groups.filter(g => g.ability).map(asLinks), cardLevel, { tags: d.roles.length > 1 })}
        <div class="tt-hint">Click the edge to open the card</div>`;
    placeTooltip((d.seg.x1 + d.seg.x2) / 2, (d.seg.y1 + d.seg.y2) / 2, 2);
}

// An arc's relations in words, then each hero's abilities in them side by side (supplier first).
// `sideHead(hero)` renders each side's heading: a plain name in the tooltip, a card link in the panel.
function arcPairHtml(d, sideHead) {
    const sides = arcAbilities(d, heroesData).map(side => {
        const hero = nodesData.find(n => n.type === 'hero' && n.name === side.hero);
        return `<section class="tt-side">${sideHead(hero)}
            ${abilitySlip(hero, side.abilities, side.cardLevel, { tags: true })}</section>`;
    });
    return `
        <ul class="tt-roles">${d.relations.map(r => `<li>${escapeHtml(describeRelation(r))}</li>`).join('')}</ul>
        <div class="tt-sides">${sides.join('')}</div>`;
}

// Arc preview
function showArcTooltip(d) {
    trackHover(arcKey(d), 'arc_tooltip_view', { hero_a: d.a, hero_b: d.b, synergy_category: d.category });
    const tooltip = document.getElementById('tooltip');
    setTooltipKind(tooltip, 'arc');
    tooltip.innerHTML = `
        <div class="tt-head"><div><strong>${escapeHtml(titleCase(d.a))} · ${escapeHtml(titleCase(d.b))}</strong>
            <div class="tt-sub">${SYNERGY_STYLE[d.category].label}</div></div></div>
        ${arcPairHtml(d, hero => `<div class="tt-side-head"><img src="${hero.image}" alt="" width="26" height="26"><strong>${escapeHtml(titleCase(hero.name))}</strong></div>`)}
        <div class="tt-hint">Click the line to pin both cards' abilities</div>`;
    placeTooltip(d.geo.mx, d.geo.my, 2);
}

// Role dot per synergy category, matching the line's hue and dash
const ARC_DOT = { partner: 'grants', conflict: 'hindered_by', counter: 'inflicts' };

// Clicked arc in the details panel: the hover view, with each side opening its hero's full card
function arcPanelHtml(d) {
    return `
        <header class="pair-header">
            <h3 class="hero-name">${escapeHtml(titleCase(d.a))} · ${escapeHtml(titleCase(d.b))}</h3>
            <div class="hero-id"><span class="role-dot kind--${ARC_DOT[d.category]}"></span>${
                SYNERGY_STYLE[d.category].label} <small>· ${SYNERGY_STYLE[d.category].hint}</small></div>
        </header>
        <div class="pair-body">${arcPairHtml(d, hero => `<button type="button" class="tt-side-head pair-side-head" data-node="${hero.id}"
            title="Open ${escapeHtml(titleCase(hero.name))}'s card"><img src="${hero.image}" alt="" width="26" height="26"><strong>${
            escapeHtml(titleCase(hero.name))}</strong><span class="pair-open">Open card ›</span></button>`)}</div>`;
}

// Position the tooltip beside a point given in graph coordinates
function placeTooltip(gx, gy, radius) {
    const tooltip = document.getElementById('tooltip');
    const container = document.querySelector('.graph-panel').getBoundingClientRect();
    const t = d3.zoomTransform(svg.node());
    const svgRect = svg.node().getBoundingClientRect();
    const x = svgRect.left - container.left + t.applyX(gx);
    const y = svgRect.top - container.top + t.applyY(gy);
    tooltip.hidden = false;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const offset = radius * t.k + 14;
    const left = x + offset + tw > container.width ? x - offset - tw : x + offset;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.min(Math.max(8, y - th / 2), container.height - th - 8)}px`;
}

// Role hue per synergy group, matching the details panel
const TT_SYNERGY_KIND = { helpedBy: 'grants', helps: 'grants', conflicts: 'hindered_by', counteredBy: 'inflicts', counters: 'inflicts' };

function tooltipSynergies(name) {
    const { groups, notes } = synergySummary(name, synergyRelations);
    if (!groups.length && !notes.length) return '';
    return `
        <dl class="tt-synergies">${groups.map(g => `
            <dt><span class="role-dot kind--${TT_SYNERGY_KIND[g.key]}"></span>${g.label}</dt>
            <dd>${g.heroes.map(h => escapeHtml(titleCase(h))).join(', ')}${g.more ? ` <span class="tt-more">+${g.more} more</span>` : ''}</dd>`).join('')}
        </dl>
        ${notes.length ? `<div class="tt-notes">${notes.map(escapeHtml).join(' · ')}</div>` : ''}`;
}

function hideTooltip() {
    hoverDelay.cancel();
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
        state.role = null;
        state.attribute = null;
        state.selectedId = null;
        searchTyping = true;
        updateSuggestions();
        render();
        graphSearch.input(input.value);
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
    input.addEventListener('blur', () => {
        graphSearch.flush();
        setTimeout(closeSuggestions, 120);
    });

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
    track('search_suggestion_select', { surface: 'graph', search_term: input.value.trim(), node_type: node.type,
        node_name: node.name, position: currentSuggestions.indexOf(node) + 1 || undefined });
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
        state.attribute = null;
        state.role = null;
        state.selectedId = null;
        track('category_filter', { filter_value: state.category });
        render();
        fitToFilter();
    });
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

// The graph's tail-to-head fade for a legend line running from x1 to x2
const swatchGradient = (id, hue, [x1, x2]) => `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="0" x2="${x2}" y2="0">
    <stop offset="0" stop-opacity="${GRADIENT_TAIL_OPACITY}" class="grad-stop grad-stop--${hue}"/><stop offset="1" class="grad-stop grad-stop--${hue}"/></linearGradient></defs>`;

// Mini "hero — trait" diagram with the role's line style and arrow direction (and its fade)
function roleSwatch(kind) {
    const hue = kind === 'mixed' ? 'mixed' : ROLE_STYLE[kind].hue;
    const dir = kind === 'mixed' ? 'both' : ROLE_INFO[kind].direction;
    const arrowRight = '<path d="M33 2 L39 6 L33 10 Z"/>';
    const arrowLeft = '<path d="M13 2 L7 6 L13 10 Z"/>';
    const grad = dir === 'both' ? '' : swatchGradient(`swg-${kind}`, hue, dir === 'out' ? [8, 38] : [38, 8]);
    return `<svg class="role-swatch hue--${hue}" width="50" height="12" viewBox="0 0 50 12" aria-hidden="true">${grad}
        <circle cx="4" cy="6" r="3.5" class="sw-hero"/><rect x="42" y="2.5" width="7" height="7" class="sw-trait"/>
        <line x1="8" y1="6" x2="38" y2="6"${grad ? ` style="stroke:url(#swg-${kind})"` : ''} class="sw-line${kind === 'mixed' ? '' : ROLE_STYLE[kind].dashed === 'dotted'
            ? ' sw-dotted' : ROLE_STYLE[kind].dashed ? ' sw-dashed' : ''}"/>
        <g class="sw-arrow">${dir === 'out' || dir === 'both' ? arrowRight : ''}${dir === 'in' || dir === 'both' ? arrowLeft : ''}</g></svg>`;
}

// Two heroes joined by a bowed synergy line, as drawn on the graph
function synergySwatch(category) {
    const st = SYNERGY_STYLE[category];
    return `<svg class="role-swatch hue--${st.hue}" width="50" height="14" viewBox="0 0 50 14" aria-hidden="true">${swatchGradient(`swg-syn-${category}`, st.hue, [9, 38])}
        <circle cx="4" cy="9" r="3.5" class="sw-hero"/><circle cx="46" cy="9" r="3.5" class="sw-hero"/>
        <path d="M9 9 Q25 1 38 8" fill="none" style="stroke:url(#swg-syn-${category})" class="sw-line${category === 'conflict' ? ' sw-dashed' : ''}"/>
        <path class="sw-arrow" d="M36 4.5 L42 9 L35 11 Z"/></svg>`;
}

function renderLegend() {
    const stateSwatch = cls => `<svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true" class="legend-state ${cls}">
        <circle r="7" class="ls-fill"/><circle r="9.5" class="ls-ring"/></svg>`;
    const edgeSwatch = cls => `<svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="1" y1="6" x2="33" y2="6" class="link ${cls}"/></svg>`;

    document.getElementById('legendBody').innerHTML = `
        <h3 class="legend-title">Attribute <small>ring colour + glyph · click to filter</small></h3>
        <ul class="legend-list legend-cols">
            ${Object.entries(HERO_ATTRIBUTES).map(([key, t]) => `
                <li><button type="button" class="legend-filter" data-attribute="${key}" aria-pressed="false">
                    ${heroGlyph(key, 18)} ${t.label}</button></li>`).join('')}
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
            <li data-legend="opponent" hidden>${stateSwatch('st-rival')} Opponent</li>
        </ul>

        <h3 class="legend-title">Edges</h3>
        <ul class="legend-list legend-cols">
            <li>${edgeSwatch('link--direct')} Direct</li>
            <li>${edgeSwatch('link--secondary')} Secondary</li>
            <li>${edgeSwatch('link--dim')} Unrelated</li>
        </ul>

        <div class="legend-section" data-legend="roles">
        <h3 class="legend-title">Edge roles <small>colour · dash · arrow · click to filter</small></h3>
        <ul class="legend-list">
            ${ROLES.filter(r => r !== 'has').map(r => `
                <li><button type="button" class="legend-filter" data-role="${r}" aria-pressed="false">
                    ${roleSwatch(r)} ${ROLE_INFO[r].label} <small class="legend-hint">${ROLE_STYLE[r].hint}</small></button></li>`).join('')}
            <li>${roleSwatch('mixed')} Several roles <small class="legend-hint">hover an edge</small></li>
        </ul>
        </div>

        <div class="legend-section" data-legend="synergy" hidden>
        <h3 class="legend-title">Synergy lines <small>arrow: who helps or hurts whom · click to filter</small></h3>
        <ul class="legend-list">
            ${Object.entries(SYNERGY_STYLE).map(([key, st]) => `
                <li><button type="button" class="legend-filter" data-synergy="${key}" aria-pressed="false">
                    ${synergySwatch(key)} ${st.label} <small class="legend-hint">${st.hint}</small></button></li>`).join('')}
        </ul>
        </div>

        <h3 class="legend-title">Trait size</h3>
        <ul class="legend-list legend-sizes">
            <li><svg width="56" height="26" viewBox="0 0 56 26" aria-hidden="true" class="trait-sizes">
                <path transform="translate(10 13)" d="${symbolPath('diamond', 40)}"/><path transform="translate(30 13)" d="${symbolPath('diamond', 120)}"/></svg>
                Heroes sharing it</li>
        </ul>`;

    document.getElementById('legendBody').addEventListener('click', event => {
        const item = event.target.closest('.legend-filter');
        if (!item) return;
        if (item.dataset.synergy) {
            // Keeps the selection: a selected hero then shows only its lines of this kind
            state.synergyCategory = state.synergyCategory === item.dataset.synergy ? null : item.dataset.synergy;
            state.picked = null;
            track('legend_filter', { filter_type: 'synergy', filter_value: item.dataset.synergy, state: state.synergyCategory ? 'on' : 'off' });
            hideTooltip();
            render();
            const selected = nodesById.get(state.selectedId);
            if (state.bandFocus) return;
            if (selected?.type === 'hero') fitToSynergies(selected);
            else if (state.synergyCategory) {
                const names = new Set(synergyArcs(synergyRelations, null, { category: state.synergyCategory }).flatMap(a => [a.a, a.b]));
                fitView(nodesData.filter(n => n.type === 'hero' && names.has(n.name)));
            } else fitToFilter();
            return;
        }
        if (item.dataset.role) {
            state.role = state.role === item.dataset.role ? null : item.dataset.role;
            Object.assign(state, { labelCategory: null, attribute: null, category: 'All', term: '', selectedId: null, path: null });
            document.getElementById('searchInput').value = '';
            track('legend_filter', { filter_type: 'edge_role', filter_value: item.dataset.role, state: state.role ? 'on' : 'off' });
            render();
            fitToFilter();
            return;
        }
        state.role = null;
        if (item.dataset.attribute) {
            const attribute = item.dataset.attribute;
            Object.assign(state, { attribute: state.attribute === attribute ? null : attribute, labelCategory: null,
                category: 'All', term: '', selectedId: null });
            document.getElementById('searchInput').value = '';
            track('legend_filter', { filter_type: 'attribute', filter_value: attribute, state: state.attribute ? 'on' : 'off' });
            render();
            fitToFilter();
            return;
        }
        state.attribute = null;
        const category = item.dataset.labelCategory;
        state.labelCategory = state.labelCategory === category ? null : category;
        state.category = 'All';
        state.selectedId = null;
        track('legend_filter', { filter_type: 'trait_group', filter_value: category, state: state.labelCategory ? 'on' : 'off' });
        render();
        fitToFilter();
    });
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
            const open = toggle.getAttribute('aria-expanded') !== 'true';
            expandPanel(body, open);
            if (body.id === 'legendBody') track('legend_panel_toggle', { state: open ? 'open' : 'closed', control: 'collapse' });
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
        track('legend_panel_toggle', { state: open ? 'open' : 'closed', control: 'legend_button' });
    });
}

let resizeTimer;
function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const selected = nodesById.get(state.selectedId);
        if (selected) centerOn(selected, 0);
        else if (state.bandFocus) fitBand(0);
        else fitView(nodesData, 0);
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
        if (document.body.dataset.tab === 'draft') return; // the Draft tab has its own keys (draft-ui.js)
        const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName);
        if (event.key === 'Escape') {
            hideTooltip();
            if (state.selectedId) clearSelection('keyboard');
            else clearAll('keyboard');
            return;
        }
        if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

        if (event.key === '/') {
            event.preventDefault();
            document.getElementById('searchInput').focus();
        } else if (event.key === '+' || event.key === '=') {
            runAction('zoom-in', 'keyboard');
        } else if (event.key === '-' || event.key === '_') {
            runAction('zoom-out', 'keyboard');
        } else if (event.key.toLowerCase() === 'f') {
            runAction('fit', 'keyboard');
        } else if (event.key.toLowerCase() === 'c') {
            runAction('center', 'keyboard');
        } else if (event.key.toLowerCase() === 's') {
            toggleSynergies('keyboard');
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

// Show a drafted band (and the heroes it faces) with the synergy lines between them
function showBand(mine, theirs = []) {
    state.selectedId = null;
    state.bandFocus = { mine: [...mine], theirs: [...theirs] };
    render();
}

function currentBandView() {
    return bandView(synergyArcs(synergyRelations), heroesData.map(h => h.name), state.bandFocus,
        { showOpponent: state.showOpponent });
}

// Frame the band with every hero it is linked to
function fitBand(duration) {
    const { states } = currentBandView();
    fitView(nodesData.filter(n => n.type === 'hero' && states.get(n.name) !== 'dim'), duration);
}

// Band view layout: the bands are pulled to the top (mine left, the opponent right) and synergy
// springs draw each linked hero towards the band member it works with, with a light pull below the
// bands' row; trait links slacken so the springs win. Leaving the band view restores the base layout.
// Re-runs the simulation only when the targets change.
const BAND_FORCE = { anchor: 0.8, spring: 0.5, springDistance: 110, below: 0.12, traitLinks: 0.12 };
let bandLayoutKey = '';
function applyBandLayout() {
    if (!simulation) return;
    const { width, height } = layoutSize;
    const band = state.bandFocus;
    const view = band ? currentBandView() : null;
    const { heroes, pool } = band
        ? bandAnchors(band, { showOpponent: state.showOpponent }, width, height) : { heroes: new Map() };
    const key = JSON.stringify([...heroes, ...(view?.states ?? [])]);
    if (key === bandLayoutKey) return;
    bandLayoutKey = key;

    const anchor = d => (d.type === 'hero' ? heroes.get(d.name) : undefined);
    const linked = d => d.type === 'hero' && view?.states.get(d.name) === 'connected';
    const heroByName = new Map(nodesData.filter(n => n.type === 'hero').map(n => [n.name, n]));
    const springs = view ? bandSprings(view).map(s => ({ source: heroByName.get(s.source), target: heroByName.get(s.target) })) : [];
    simulation
        .force('x', d3.forceX(d => anchor(d)?.x ?? width / 2)
            .strength(d => (anchor(d) ? BAND_FORCE.anchor : baseForce.x)))
        .force('y', d3.forceY(d => anchor(d)?.y ?? (linked(d) ? pool.y : height / 2))
            .strength(d => (anchor(d) ? BAND_FORCE.anchor : linked(d) ? BAND_FORCE.below : baseForce.y)))
        .force('band', springs.length
            ? d3.forceLink(springs).distance(BAND_FORCE.springDistance).strength(BAND_FORCE.spring) : null);
    simulation.force('link').strength(band ? BAND_FORCE.traitLinks : TRAIT_LINK_STRENGTH);
    simulation.alpha(0.7).restart();
    // Frame the band once the layout has mostly settled, then again once it has stopped
    simulation.on('tick.band', !band ? null : () => {
        if (simulation.alpha() > 0.1) return;
        simulation.on('tick.band', null);
        if (state.bandFocus) fitBand();
    });
    simulation.on('end.band', !band ? null : () => {
        simulation.on('end.band', null);
        if (state.bandFocus) fitBand();
    });
}

// ---------------------------------------------------------------------------
// URL and selection history
// ---------------------------------------------------------------------------
// Every selection (hero, trait or band view) is a history entry with a shareable hash (graph-route.js),
// so back / forward replay them. history.state.graphNav numbers our entries for the toolbar arrows.
let navIndex = 0;
let navTop = 0;
let restoringRoute = false;
let routing = false; // set once the opening link has been applied

function currentRoute() {
    const band = state.bandFocus;
    if (band) return { type: 'band', mine: band.mine, theirs: band.theirs };
    const node = nodesById.get(state.selectedId);
    if (!node) return { type: 'none' };
    return { type: node.type === 'hero' ? 'hero' : 'trait', name: node.name };
}

// The URL of the current selection (?hero= / ?trait= / ?band=); the bare page when nothing is selected
function routeUrl() {
    return location.pathname + encodeRoute(currentRoute());
}

const routeNames = () => ({
    heroes: heroesData.map(h => h.name),
    traits: nodesData.filter(n => n.type === 'label').map(n => n.name)
});

// Title, description and canonical address follow the selection, so search engines index ?hero= addresses
// as pages of their own; no selection (or a band) restores the page's own metadata
const pageMeta = (() => {
    const tags = {
        title: { get: () => document.title, set: v => { document.title = v; } },
        description: 'meta[name="description"]', ogTitle: 'meta[property="og:title"]', ogDescription: 'meta[property="og:description"]',
        twitterTitle: 'meta[name="twitter:title"]', twitterDescription: 'meta[name="twitter:description"]',
        canonical: 'link[rel="canonical"]', ogUrl: 'meta[property="og:url"]'
    };
    const attr = el => (el.tagName === 'LINK' ? 'href' : 'content');
    const el = key => document.querySelector(tags[key]);
    const read = key => (typeof tags[key] === 'string' ? el(key)?.getAttribute(attr(el(key))) : tags[key].get());
    const defaults = Object.fromEntries(Object.keys(tags).map(k => [k, read(k)]));
    const write = (key, value) => {
        if (typeof tags[key] !== 'string') return tags[key].set(value);
        const node = el(key);
        if (node && value != null) node.setAttribute(attr(node), value);
    };
    return route => {
        const meta = routeMeta(route, { heroes: heroesData, traitDescriptions }, defaults.canonical);
        const values = meta ? {
            title: meta.title, description: meta.description, ogTitle: meta.title, ogDescription: meta.description,
            twitterTitle: meta.title, twitterDescription: meta.description, canonical: meta.canonical, ogUrl: meta.canonical
        } : defaults;
        Object.entries(values).forEach(([key, value]) => write(key, value));
    };
})();

// Typing in the search box clears the selection; the address waits for a picked result (historyStep)
let searchTyping = false;

function syncRoute() {
    if (!routing || restoringRoute || document.body.dataset.tab === 'draft') return;
    const url = routeUrl();
    const step = historyStep({ url, current: location.pathname + location.search + location.hash, typing: searchTyping, term: state.term.trim() });
    if (step === 'defer') return;
    searchTyping = false;
    pageMeta(currentRoute());
    if (step === 'replace') history.replaceState(history.state, '', url);
    if (step !== 'push') return;
    navTop = ++navIndex;
    history.pushState({ ...history.state, graphNav: navIndex }, '', url);
    updateNavButtons();
}

function applyRoute(route, source = 'link') {
    searchTyping = false;
    restoringRoute = true;
    try {
        if (route.type === 'band') {
            showBand(route.mine, route.theirs);
        } else if (route.type === 'none') {
            Object.assign(state, { selectedId: null, picked: null, bandFocus: null });
            render();
        } else {
            const type = route.type === 'hero' ? 'hero' : 'label';
            const node = nodesData.find(n => n.type === type && n.name === route.name);
            if (node) selectNode(node.id, { source });
        }
    } finally {
        restoringRoute = false;
    }
    pageMeta(currentRoute());
}

function updateNavButtons() {
    document.getElementById('navBack').disabled = navIndex <= 0;
    document.getElementById('navForward').disabled = navIndex >= navTop;
}

function setupRouting() {
    navIndex = navTop = history.state?.graphNav ?? 0;
    const route = decodeRoute(location, routeNames());
    if (route) applyRoute(route);
    // An old #graph/… link becomes its ?hero= address; a link to an unknown hero or trait opens the plain graph
    if (isLegacyRoute(location.hash) || !route) {
        history.replaceState(history.state, '', location.pathname + (route ? encodeRoute(route) : ''));
    }
    history.replaceState({ ...history.state, graphNav: navIndex }, '');
    routing = true;
    pageMeta(currentRoute());
    updateNavButtons();

    window.addEventListener('popstate', event => {
        // A draft link is the Draft tab's (draft-ui.js)
        if (location.hash && !isLegacyRoute(location.hash)) return;
        const next = decodeRoute(location, routeNames());
        if (!next || isLegacyRoute(location.hash)) {
            // An old #graph/… link pasted into the address bar, or a link to an unknown hero or trait
            history.replaceState(history.state, '', next ? location.pathname + encodeRoute(next) : routeUrl());
            if (!next) return;
        }
        if (typeof event.state?.graphNav === 'number') {
            const control = window.Analytics.navDirection(navIndex, event.state.graphNav);
            if (control) track('history_nav', { control, method: navVia });
            navIndex = event.state.graphNav;
        } else {
            // A link typed or pasted into the address bar: a new entry after the current one
            navTop = ++navIndex;
            history.replaceState({ ...history.state, graphNav: navIndex }, '');
        }
        applyRoute(next, 'history');
        updateNavButtons();
        navVia = 'browser';
    });
    // The ↶ / ↷ buttons go through popstate too; it reports them as buttons
    let navVia = 'browser';
    document.getElementById('navBack').addEventListener('click', () => { navVia = 'button'; history.back(); });
    document.getElementById('navForward').addEventListener('click', () => { navVia = 'button'; history.forward(); });
}

// The graph was hidden (Draft tab): re-measure and frame it again
function refit() {
    if (!svg) return;
    handleResize();
}

// Used by the Draft tab (draft-ui.js); the getters also help debugging
window.BestiaryGraph = {
    state, showBand, refit, routeUrl,
    // Back to draft: drop the band view and the way back
    clearBand() { state.bandFocus = null; state.fromDraft = false; render(); },
    // A hero inspected from the Draft tab keeps the way back to the draft
    selectHero(name) {
        state.fromDraft = true;
        const node = nodesData.find(n => n.type === 'hero' && n.name === name);
        if (node) selectNode(node.id, { source: 'draft' });
    },
    // Reference card markup for the Draft tab, without the graph trait chips (null until the data has loaded)
    heroCard(name) {
        const node = nodesData.find(n => n.type === 'hero' && n.name === name);
        return node ? heroCardHtml(node, { traits: false }) : null;
    },
    // Draft inspector (draft-view.js inspectView sides): each hero's abilities behind some reasons, laid out
    // like the synergy-line tooltip; the heading opens the hero's reference card (data-card)
    evidence(sides) {
        return sides.map(side => {
            const node = nodesData.find(n => n.type === 'hero' && n.name === side.hero);
            if (!node) return '';
            return `<section class="tt-side${side.theirs ? ' tt-side--theirs' : ''}">
                <button type="button" class="tt-side-head pair-side-head" data-card="${node.name}" title="Open ${escapeHtml(titleCase(node.name))}'s card">
                    <img src="${node.image}" alt="" width="26" height="26"><strong>${escapeHtml(titleCase(node.name))}</strong>${
                    side.theirs ? '<span class="side-tag">Opponent</span>' : ''}<span class="pair-open">Open card ›</span></button>
                ${side.notes.length ? `<p class="side-notes">${side.notes.map(escapeHtml).join(' · ')}</p>` : ''}
                ${side.abilities.length || side.cardLevel.length ? abilitySlip(node, side.abilities, side.cardLevel, { tags: true }) : ''}</section>`;
        }).join('');
    },
    get ready() { return nodesData.length > 0; },
    get selectedHero() {
        const node = nodesById.get(state.selectedId);
        return node?.type === 'hero' ? node.name : null;
    },
    get nodesData() { return nodesData; }, get linksData() { return linksData; }
};
