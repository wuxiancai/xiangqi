import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('play sidebar places the engine above history with settings between them', async () => {
  const [html, app] = await Promise.all([read('../index.html'), read('../src/app.js')]);
  assert.ok(html.indexOf('class="panel setup-panel"') < html.indexOf('class="panel history-panel"'));
  assert.equal((html.match(/class="panel history-panel"/g) ?? []).length, 1);
  assert.match(app, /\.game-sidebar'\)\.prepend\(panel\)/);
});

test('play view removes the standalone advice action while keeping AI status output', async () => {
  const html = await read('../index.html');
  const app = await read('../src/app.js');
  assert.doesNotMatch(html, /suggest-button|局势建议/);
  assert.match(html, /id="ai-output"/);
  assert.doesNotMatch(app, /requestAdvice|suggest-button/);
});

test('play board header shows red-normalized score cp and WDL output', async () => {
  const [html, app, engine] = await Promise.all([read('../index.html'), read('../src/app.js'), read('../engine/pikafish/engine.js')]);
  assert.match(html, /id="red-evaluation"[^>]*>红方 score cp — · WDL 胜/);
  assert.match(app, /formatRedEvaluation\(currentLine, currentAnalysis\?\.side \?\? state\.side\)/);
  assert.match(engine, /setoption name UCI_ShowWDL value true/);
});

test('study replay draws the current move with the shared analysis arrow renderer', async () => {
  const app = await read('../src/app.js');
  assert.match(app, /const arrows = previous \? \[\{ \.\.\.previous, side: previousSide \}\] : \[\]/);
  assert.match(app, /renderBoard\(\$\('#study-board'\).*previous, new Map\(\), arrows\)/);
});


test('red analysis arrow has strong contrast on the wooden board', async () => {
  const css = await read('../styles.css');
  const app = await read('../src/app.js');
  assert.match(css, /analysis-arrow[^}]*--arrow-color:#f02b22/);
  assert.match(css, /analysis-arrow \.arrow-visible[^}]*stroke-width:6/);
  assert.match(css, /analysis-arrow \.arrow-visible[^}]*drop-shadow\(0 0 2px #fff\)/);
  assert.equal((app.match(/markerWidth="16" markerHeight="16"/g) ?? []).length, 2);
});

test('piece status rings rotate without intercepting input and respect reduced motion', async () => {
  const css = await read('../styles.css');
  const app = await read('../src/app.js');
  assert.match(css, /\.threat-ring,\.selected-piece-ring,\.last-move-origin-ring,\.last-move-origin,\.last-move-destination\{[^}]*animation:chess-ring-spin 16\.8s linear infinite/);
  assert.match(css, /@keyframes chess-ring-spin\{to\{transform:rotate\(360deg\)\}\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[^{]*\{[^}]*animation:none/);
  assert.match(css, /\.threat-ring\.protected\{animation:none\}/);
  assert.match(app, /class: 'selected-piece-ring'/);
});
