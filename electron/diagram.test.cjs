const test = require('node:test');
const assert = require('node:assert/strict');
const { checkedTikz, sanitizeSvg } = require('./diagram-security.cjs');
const { createDiagramService } = require('./diagram.cjs');
const cube = String.raw`\begin{tikzpicture}[line join=round,scale=2]
\coordinate (A) at (0,0);\coordinate (B) at (1,0);\coordinate (C) at (1,1);\coordinate (D) at (0,1);
\coordinate (E) at (0.4,0.4);\coordinate (F) at (1.4,0.4);\coordinate (G) at (1.4,1.4);\coordinate (H) at (0.4,1.4);
\draw[dashed] (A)--(E)--(F) (E)--(H);\draw (A)--(B)--(C)--(D)--cycle;
\draw (B)--(F)--(G)--(H)--(D);\draw (C)--(G);\end{tikzpicture}`;
test('drawing forbids files, execution, obfuscation and external SVG resources', () => {
  assert.equal(checkedTikz(cube), cube);
  for (const bad of [String.raw`\input{secret}`, String.raw`\write18{command}`, String.raw`\csname input\endcsname{secret}`, '^^5cinput']) assert.throws(() => checkedTikz(cube.replace('\\draw[dashed]', `${bad}\\draw[dashed]`)));
  assert.throws(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script/></svg>'));
  assert.throws(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="https://example.com/a.svg"/></svg>'));
});
test('actual offline TikZ renders user cube and embeds local mathematical label fonts', async () => {
  const service = createDiagramService();
  try {
    const result = await service.render(cube);
    assert.ok(result.width > 20 && result.height > 20);
    assert.match(result.svg, /stroke-dasharray/);
    assert.match(result.svg, /path/);
    const label = await service.render(String.raw`\begin{tikzpicture}\draw (0,0)--(1,1) node[above] {$A_1$};\end{tikzpicture}`);
    assert.match(label.svg, /data:font\/ttf;base64/);
    assert.ok(!/https:|@import/.test(label.svg.replaceAll('http://www.w3.org/2000/svg', '')));
    assert.deepEqual(await service.render(cube), result);
  } finally { service.dispose(); }
});
