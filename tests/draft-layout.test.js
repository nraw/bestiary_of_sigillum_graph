// Run with: node --test tests/*.test.js
// Draft tab markup (index.html, styles.css): the top of the Band Analysis panel
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const panel = html.slice(html.indexOf('id="analysisPanel"'), html.indexOf('id="tilePopover"'));
const at = id => {
    const i = panel.indexOf(`id="${id}"`);
    assert.ok(i >= 0, `${id} is in the analysis panel`);
    return i;
};

test('Band Analysis: the player switch on its own full row, then View band in graph, then Team balance; What beats this band last', () => {
    assert.ok(at('focusSwitch') < at('viewInGraph') && at('viewInGraph') < at('balanceHeading'));
    assert.match(panel, /class="btn btn-ghost view-graph"[^>]*id="viewInGraph"[^>]*>View band in graph →</);
    assert.ok(!panel.includes('analysis-bar'), 'no shared row');
    assert.match(css, /#focusSwitch \{[^}]*display: flex;[^}]*\}/, 'the switch spans the panel');
    assert.match(css, /#focusSwitch button \{[^}]*flex: 1;[^}]*\}/, 'its halves share the width');
    ['balanceHeading', 'scoreHeading', 'analysisSections'].forEach(id => assert.ok(at(id) < at('beatsBlock'), id));
});

test('the format picker (standard / ban phase first / interleaved) is not hidden in the markup: nothing un-hides it', () => {
    assert.match(html, /<div class="setup" id="twoPlayerSetup">/);
    assert.doesNotMatch(read('draft-ui.js'), /twoPlayerSetup'\)\.hidden/, 'draft-ui.js never hides it either');
});

const rule = selector => {
    const m = css.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(m, `${selector} has a rule`);
    return m[2];
};

test('empty band slots are full hero-card size for both players, before and after the first selection', () => {
    assert.match(rule('.slot'), /min-height: 196px;/);
    assert.doesNotMatch(rule('.slot.is-empty'), /min-height/, 'empty slots keep the hero-card height');
    assert.doesNotMatch(css, /\.is-started \.slot\.is-empty|\.is-p2 \.slot\.is-empty|#againstRow\.slots \.slot\.is-empty/,
        'no state- or player-specific slot heights');
});

test('every empty slot reserves the "let fate decide" line, so its + lines up with its neighbours', () => {
    const ui = read('draft-ui.js');
    assert.match(ui, /class="slot-fate is-placeholder" aria-hidden="true"/);
    assert.match(css, /\.slot-fate\.is-placeholder \{[^}]*visibility: hidden;/);
});

test('the draft order row keeps one height in every format: "+ Add extra bans" never wraps or shrinks', () => {
    assert.match(rule('.seq-add-item'), /flex: none;/);
    assert.match(rule('.seq-add'), /white-space: nowrap;/);
    assert.match(rule('.sequence'), /align-items: center;/);
});

test('the format cards share the width evenly', () => {
    assert.match(rule('.setup-group'), /flex: 1 1 100%;[^]*display: grid;[^]*grid-template-columns: repeat\(auto-fit, minmax\(\d+px, 1fr\)\);/);
});
