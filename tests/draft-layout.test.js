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
