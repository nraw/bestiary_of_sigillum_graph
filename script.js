// Load and process the bestiary data
let heroesData = [];
let nodesData = [];
let linksData = [];
let simulation;
let svg;
let nodeElements;
let linkElements;
let labelElements;
let currentFilter = null;

// Color mapping for different node types
const colorMap = {
    // Hero type colors
    'Melee': '#8B1538',
    'Ranged': '#FF8C00', 
    'Support': '#663399',
    'AoE': '#FF4500',
    'hero': '#CD7F32',
    // Label type colors
    'label': '#DAA520',
    'Combat': '#8B1538',
    'Magic': '#663399',
    'Movement': '#FF8C00',
    'Effect': '#FF4500',
    'Structure': '#CD7F32',
    'default': '#A0522D'
};

// Initialize the application
async function init() {
    try {
        // Load the JSON data
        const response = await fetch('bestiary_reference_cards.json');
        const data = await response.json();
        heroesData = data.bestiary_of_sigilum.characters;
        
        // Process the data to create nodes and links
        processData();
        
        // Setup the graph
        setupGraph();
        
        // Setup controls
        setupControls();
        
        // Setup search functionality
        setupSearch();
        
        console.log('Application initialized successfully');
    } catch (error) {
        console.error('Error initializing application:', error);
    }
}

// Process the raw data to create bipartite graph (heroes + labels as nodes)
function processData() {
    // Get all unique labels
    const allLabels = new Set();
    heroesData.forEach(hero => {
        hero.labels.forEach(label => allLabels.add(label));
    });
    
    // Create hero nodes
    const heroNodes = heroesData.map(hero => ({
        id: `hero_${hero.id}`,
        name: hero.name,
        type: 'hero',
        vitality: hero.vitality,
        labels: hero.labels,
        core_ability: hero.core_ability,
        support_abilities: hero.support_abilities,
        image: `hero_images/${hero.name.toLowerCase()}.png`,
        primaryType: getPrimaryType(hero.labels),
        size: 30,
        x: Math.random() * 600,
        y: Math.random() * 400
    }));
    
    // Create label nodes
    const labelNodes = Array.from(allLabels).map(label => ({
        id: `label_${label}`,
        name: label,
        type: 'label',
        category: getLabelCategory(label),
        size: 20,
        x: Math.random() * 600,
        y: Math.random() * 400
    }));
    
    // Combine all nodes
    nodesData = [...heroNodes, ...labelNodes];
    
    // Create links between heroes and their labels
    linksData = [];
    heroNodes.forEach(hero => {
        hero.labels.forEach(label => {
            linksData.push({
                source: hero.id,
                target: `label_${label}`,
                type: 'hero-label'
            });
        });
    });
    
    console.log(`Created ${heroNodes.length} hero nodes, ${labelNodes.length} label nodes, and ${linksData.length} links`);
}

// Determine the primary type of a hero based on their labels
function getPrimaryType(labels) {
    const priorities = ['AoE', 'Ranged', 'Melee', 'Support'];
    for (const priority of priorities) {
        if (labels.includes(priority)) {
            return priority;
        }
    }
    return 'hero';
}

// Categorize labels for coloring
function getLabelCategory(label) {
    // Official effects from effects.md
    const officialEffects = [
        'Attack increase', 'Attack decrease', 'Defense increase', 'Defense decrease', 
        'Control increase', 'Control decrease', 'Swiftness', 'Slowness', 'Flying', 
        'Place obstacle', 'Resistance', 'Vampirism', 'Stun', 'Silence', 'Poison', 'Web'
    ];
    
    const combatLabels = ['Melee', 'Ranged', 'AoE', 'Line-Attack', 'Anti-Large', 'Anti-Group'];
    const magicLabels = ['Support', 'Healing', 'Effect-Copy', 'Effect-Manipulation', 'Teleport'];
    const movementLabels = ['Mobility', 'Displacement', 'Speed-Buff', 'Speed-Debuff', 'Conditional-Mobility'];
    const structureLabels = ['Structure-Dependent', 'Structure-Counter', 'Terrain-Control', 'Castle-Defender'];
    
    // Check for official effects first
    if (officialEffects.includes(label)) return 'Effect';
    if (combatLabels.includes(label)) return 'Combat';
    if (magicLabels.includes(label)) return 'Magic';
    if (movementLabels.includes(label)) return 'Movement';
    if (structureLabels.includes(label)) return 'Structure';
    return 'label';
}

// Setup the D3 force simulation and SVG elements
function setupGraph() {
    const container = d3.select('#graph');
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;
    
    svg = container
        .attr('width', width)
        .attr('height', height);
    
    // Create a main group for panning and zooming
    const mainGroup = svg.append('g')
        .attr('class', 'main-group');
    
    // Add zoom and pan behavior
    const zoom = d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => {
            mainGroup.attr('transform', event.transform);
        });
    
    svg.call(zoom);
    
    // Add click handler to clear filter when clicking on empty space
    svg.on('click', function(event) {
        if (event.target === this) {
            clearAllFilters();
        }
    });
    
    // Create simulation with different forces for bipartite graph
    simulation = d3.forceSimulation(nodesData)
        .force('link', d3.forceLink(linksData).id(d => d.id).distance(60).strength(0.8))
        .force('charge', d3.forceManyBody().strength(d => d.type === 'hero' ? -400 : -200))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => d.size + 5))
        .force('x', d3.forceX().strength(0.1))
        .force('y', d3.forceY().strength(0.1));
    
    // Create link elements
    linkElements = mainGroup.append('g')
        .attr('class', 'links')
        .selectAll('line')
        .data(linksData)
        .enter()
        .append('line')
        .attr('class', 'link')
        .attr('stroke-width', 2);
    
    // Create node groups
    const nodeGroups = mainGroup.append('g')
        .attr('class', 'nodes')
        .selectAll('g')
        .data(nodesData)
        .enter()
        .append('g')
        .attr('class', d => `node ${d.type}`)
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));
    
    // Add hero images
    nodeGroups.filter(d => d.type === 'hero')
        .append('image')
        .attr('class', 'node-image')
        .attr('xlink:href', d => d.image)
        .attr('x', -25)
        .attr('y', -25)
        .attr('width', 50)
        .attr('height', 50)
        .style('clip-path', 'circle(25px)')
        .on('error', function(event, d) {
            // Fallback if image doesn't load
            d3.select(this.parentNode)
                .append('circle')
                .attr('r', 25)
                .attr('fill', colorMap[d.primaryType] || colorMap.hero)
                .attr('stroke', '#CD7F32')
                .attr('stroke-width', 2);
        });
    
    // Add colored border circles for heroes
    nodeGroups.filter(d => d.type === 'hero')
        .append('circle')
        .attr('r', 27)
        .attr('fill', 'none')
        .attr('stroke', d => colorMap[d.primaryType] || colorMap.hero)
        .attr('stroke-width', 3);
    
    // Add label nodes as colored circles
    nodeGroups.filter(d => d.type === 'label')
        .append('circle')
        .attr('r', d => d.size)
        .attr('fill', d => colorMap[d.category] || colorMap.label)
        .attr('stroke', '#DAA520')
        .attr('stroke-width', 2);
    
    // Add text labels
    labelElements = nodeGroups.append('text')
        .attr('class', 'node-label')
        .attr('dy', d => d.type === 'hero' ? 45 : 5)
        .text(d => d.name);
    
    nodeElements = nodeGroups;
    
    // Add click handlers with event stopping to prevent bubbling to svg
    nodeElements.on('click', function(event, d) {
        event.stopPropagation();
        showHeroInfo(event, d);
    });
    
    // Start simulation
    simulation.on('tick', ticked);
}

// Animation tick function
function ticked() {
    linkElements
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
    
    nodeElements
        .attr('transform', d => `translate(${d.x},${d.y})`);
}

// Drag functions for nodes
function dragstarted(event, d) {
    event.sourceEvent.stopPropagation();
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

// Show node information and apply filter
function showHeroInfo(event, node) {
    // Remove previous selection
    nodeElements.classed('selected', false);
    linkElements.classed('highlighted', false);
    
    // Add selection to current node
    d3.select(event.currentTarget).classed('selected', true);
    
    // Highlight connected links
    linkElements
        .classed('highlighted', d => d.source.id === node.id || d.target.id === node.id);
    
    // Apply filter based on clicked node
    applyNodeFilter(node);
    
    // Update info panel
    const infoPanel = document.getElementById('heroInfo');
    showNodeInfo(node, infoPanel);
}

// Setup filter controls
function setupControls() {
    const select = document.getElementById('labelFilter');
    
    // Get all unique labels and add all heroes
    const allItems = new Set();
    
    // Add all hero names
    heroesData.forEach(hero => {
        allItems.add(`Hero: ${hero.name}`);
    });
    
    // Add all labels
    heroesData.forEach(hero => {
        hero.labels.forEach(label => allItems.add(`Label: ${label}`));
    });
    
    // Populate dropdown
    Array.from(allItems).sort().forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        select.appendChild(option);
    });
    
    // Add change handler
    select.addEventListener('change', handleQuickFilter);
    
    // Setup clear filter button
    document.getElementById('clearFilter').addEventListener('click', clearAllFilters);
    
    // Setup legend click handlers
    setupLegendClickHandlers();
}

// Apply filter for a specific node
function applyNodeFilter(node) {
    currentFilter = node;
    
    if (node.type === 'hero') {
        // Filter to show this hero and all its connected labels
        nodeElements.style('opacity', d => {
            if (d.id === node.id) return 1;
            if (d.type === 'label' && node.labels.includes(d.name)) return 1;
            return 0.2;
        });
        
        labelElements.style('opacity', d => {
            if (d.id === node.id) return 1;
            if (d.type === 'label' && node.labels.includes(d.name)) return 1;
            return 0.2;
        });
        
        linkElements.style('opacity', d => {
            return (d.source.id === node.id || d.target.id === node.id) ? 0.8 : 0.1;
        });
        
        updateFilterStatus(`Hero: ${node.name}`);
        
    } else if (node.type === 'label') {
        // Filter to show this label and all connected heroes
        nodeElements.style('opacity', d => {
            if (d.id === node.id) return 1;
            if (d.type === 'hero' && d.labels.includes(node.name)) return 1;
            return 0.2;
        });
        
        labelElements.style('opacity', d => {
            if (d.id === node.id) return 1;
            if (d.type === 'hero' && d.labels.includes(node.name)) return 1;
            return 0.2;
        });
        
        linkElements.style('opacity', d => {
            return (d.source.id === node.id || d.target.id === node.id) ? 0.8 : 0.1;
        });
        
        updateFilterStatus(`Label: ${node.name}`);
    }
}

// Handle quick filter dropdown
function handleQuickFilter(event) {
    const selectedValue = event.target.value;
    
    if (!selectedValue) {
        clearAllFilters();
        return;
    }
    
    const [type, name] = selectedValue.split(': ');
    const node = nodesData.find(n => 
        (type === 'Hero' && n.type === 'hero' && n.name === name) ||
        (type === 'Label' && n.type === 'label' && n.name === name)
    );
    
    if (node) {
        applyNodeFilter(node);
        // Also select the node visually
        nodeElements.classed('selected', d => d.id === node.id);
        // Update info panel
        const infoPanel = document.getElementById('heroInfo');
        showNodeInfo(node, infoPanel);
    }
}

// Clear all filters
function clearAllFilters() {
    currentFilter = null;
    
    // Reset all opacities
    nodeElements.style('opacity', 1);
    linkElements.style('opacity', 0.6);
    labelElements.style('opacity', 1);
    
    // Clear selections
    nodeElements.classed('selected', false);
    linkElements.classed('highlighted', false);
    
    // Reset dropdowns and search
    document.getElementById('labelFilter').value = '';
    document.getElementById('searchInput').value = '';
    
    updateFilterStatus('All nodes');
    
    // Reset info panel
    document.getElementById('heroInfo').innerHTML = '<p>Click on any node to see details and apply filter</p>';
}

// Update filter status display
function updateFilterStatus(status) {
    document.getElementById('filterStatus').textContent = `Showing: ${status}`;
    document.getElementById('clearFilter').style.display = status === 'All nodes' ? 'none' : 'inline-block';
}

// Setup search functionality
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');
    
    searchInput.addEventListener('input', handleSearch);
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearAllFilters();
    });
}

// Handle search input
function handleSearch(event) {
    const searchTerm = event.target.value.toLowerCase().trim();
    
    if (!searchTerm) {
        clearAllFilters();
        return;
    }
    
    // Find matching nodes
    const matchingNodes = nodesData.filter(node => 
        node.name.toLowerCase().includes(searchTerm)
    );
    
    if (matchingNodes.length === 0) {
        // No matches - hide all
        nodeElements.style('opacity', 0.2);
        linkElements.style('opacity', 0.1);
        labelElements.style('opacity', 0.2);
        updateFilterStatus('No matches');
    } else if (matchingNodes.length === 1) {
        // Single match - apply filter
        applyNodeFilter(matchingNodes[0]);
        nodeElements.classed('selected', d => d.id === matchingNodes[0].id);
        showNodeInfo(matchingNodes[0], document.getElementById('heroInfo'));
    } else {
        // Multiple matches - show all matching
        nodeElements.style('opacity', d => 
            matchingNodes.some(m => m.id === d.id) ? 1 : 0.2
        );
        
        labelElements.style('opacity', d => 
            matchingNodes.some(m => m.id === d.id) ? 1 : 0.2
        );
        
        // Show links between visible nodes
        linkElements.style('opacity', d => {
            const sourceVisible = matchingNodes.some(m => m.id === d.source.id);
            const targetVisible = matchingNodes.some(m => m.id === d.target.id);
            return (sourceVisible && targetVisible) ? 0.8 : 0.1;
        });
        
        updateFilterStatus(`${matchingNodes.length} matches for "${searchTerm}"`);
    }
}

// Helper function to show node info in panel
function showNodeInfo(node, infoPanel) {
    if (node.type === 'hero') {
        const coreAbilityHtml = `
            <div class="ability">
                <div class="ability-target">Target: ${node.core_ability.target}</div>
                <div class="ability-effect">Effect: ${node.core_ability.effect}</div>
            </div>
        `;
        
        const supportAbilitiesHtml = node.support_abilities.map(ability => `
            <div class="ability">
                <div class="ability-target">Target: ${ability.target}</div>
                <div class="ability-effect">Effect: ${ability.effect}</div>
            </div>
        `).join('');
        
        const labelsHtml = node.labels.map(label => `
            <span class="label clickable-label" data-label="${label}" onclick="filterByClickableLabel('${label}')">${label}</span>
        `).join('');
        
        infoPanel.innerHTML = `
            <div class="hero-name">${node.name}</div>
            <div class="hero-vitality">Vitality: ${node.vitality}</div>
            
            <div class="ability-section">
                <h4>Core Ability</h4>
                ${coreAbilityHtml}
            </div>
            
            <div class="ability-section">
                <h4>Support Abilities</h4>
                ${supportAbilitiesHtml}
            </div>
            
            <div class="labels">
                ${labelsHtml}
            </div>
        `;
    } else if (node.type === 'label') {
        const connectedHeroes = nodesData
            .filter(n => n.type === 'hero' && n.labels.includes(node.name))
            .map(n => n.name);
        
        infoPanel.innerHTML = `
            <div class="hero-name">${node.name}</div>
            <div class="hero-vitality">Label Category: ${node.category}</div>
            
            <div class="ability-section">
                <h4>Connected Heroes (${connectedHeroes.length})</h4>
                <div class="connected-heroes">
                    ${connectedHeroes.map(hero => `<span class="label clickable-hero" data-hero="${hero}" onclick="filterByClickableHero('${hero}')">${hero}</span>`).join('')}
                </div>
            </div>
        `;
    }
}

// Handle clicks on labels in the info panel
function filterByClickableLabel(labelName) {
    const node = nodesData.find(n => n.type === 'label' && n.name === labelName);
    if (node) {
        applyNodeFilter(node);
        // Also select the node visually
        nodeElements.classed('selected', d => d.id === node.id);
        // Update info panel
        showNodeInfo(node, document.getElementById('heroInfo'));
    }
}

// Handle clicks on heroes in the info panel
function filterByClickableHero(heroName) {
    const node = nodesData.find(n => n.type === 'hero' && n.name === heroName);
    if (node) {
        applyNodeFilter(node);
        // Also select the node visually
        nodeElements.classed('selected', d => d.id === node.id);
        // Update info panel
        showNodeInfo(node, document.getElementById('heroInfo'));
    }
}

// Handle window resize
function handleResize() {
    const container = d3.select('#graph');
    const width = container.node().getBoundingClientRect().width;
    const height = container.node().getBoundingClientRect().height;
    
    svg.attr('width', width).attr('height', height);
    simulation.force('center', d3.forceCenter(width / 2, height / 2));
    simulation.alpha(0.3).restart();
}

// Event listeners
window.addEventListener('resize', handleResize);
document.addEventListener('DOMContentLoaded', init);

// Setup legend click handlers for filtering by node type
function setupLegendClickHandlers() {
    const legendItems = document.querySelectorAll('.legend-item');
    
    legendItems.forEach(item => {
        const span = item.querySelector('span');
        const nodeType = getNodeTypeFromLegendText(span.textContent);
        
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            filterByNodeType(nodeType);
        });
    });
}

// Get node type from legend text
function getNodeTypeFromLegendText(text) {
    switch(text) {
        case 'Heroes': return 'hero';
        case 'Combat Labels': return 'Combat';
        case 'Magic Labels': return 'Magic';
        case 'Movement Labels': return 'Movement';
        case 'Structure Labels': return 'Structure';
        default: 
            if (text.includes('Official Effects')) return 'Effect';
            return null;
    }
}

// Filter nodes by type/category
function filterByNodeType(nodeType) {
    if (!nodeType) return;
    
    let filteredNodes;
    let statusText;
    
    if (nodeType === 'hero') {
        // Show all heroes
        filteredNodes = nodesData.filter(n => n.type === 'hero');
        statusText = 'All Heroes';
    } else {
        // Show all labels of this category
        filteredNodes = nodesData.filter(n => 
            n.type === 'label' && n.category === nodeType
        );
        statusText = `${nodeType} Labels`;
    }
    
    if (filteredNodes.length === 0) {
        clearAllFilters();
        return;
    }
    
    // Apply visual filtering
    nodeElements.style('opacity', d => 
        filteredNodes.some(f => f.id === d.id) ? 1 : 0.2
    );
    
    labelElements.style('opacity', d => 
        filteredNodes.some(f => f.id === d.id) ? 1 : 0.2
    );
    
    // Show links between visible nodes or links to/from visible nodes
    linkElements.style('opacity', d => {
        const sourceVisible = filteredNodes.some(f => f.id === d.source.id);
        const targetVisible = filteredNodes.some(f => f.id === d.target.id);
        return (sourceVisible || targetVisible) ? 0.8 : 0.1;
    });
    
    // Clear selections
    nodeElements.classed('selected', false);
    linkElements.classed('highlighted', false);
    
    // Update filter status
    updateFilterStatus(statusText);
    
    // Reset dropdown and search
    document.getElementById('labelFilter').value = '';
    document.getElementById('searchInput').value = '';
    
    // Update info panel
    document.getElementById('heroInfo').innerHTML = `
        <p>Showing ${filteredNodes.length} ${statusText.toLowerCase()}</p>
        <p>Click on any node to see details</p>
    `;
    
    // Set current filter for clearing
    currentFilter = { type: 'nodeType', value: nodeType };
}

// Export for debugging
window.BestiaryGraph = {
    heroesData,
    nodesData,
    linksData,
    simulation
};