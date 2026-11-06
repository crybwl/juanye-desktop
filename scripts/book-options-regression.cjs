/* Actual Chromium DOM / KaTeX measurements. Isolated app profile, no model calls or network. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const esbuild = require('esbuild');

(async () => {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'artifacts/qa-book-options');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-book-options-'));
  const bundled = await esbuild.build({ stdin: { contents: `import{measureBookOptions,measureRawBookOptions}from'./src/book-option-measure';import{pickOptionColumns}from'./src/book-layout-contract';import{renderMathText}from'./src/math';window.optionQA={measureBookOptions,measureRawBookOptions,pickOptionColumns,renderMathText};`, resolveDir: root, loader: 'ts' }, platform: 'browser', bundle: true, format: 'iife', write: false });
  let app, report;
  try {
    const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--disable-renderer-backgrounding'], env });
    const windowPromise = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => { const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { backgroundThrottling: false } }); return win.loadURL('about:blank'); });
    const page = await windowPromise;
    let network = 0;
    await page.route(/^https?:\/\//, route => { network++; return route.abort(); });
    let css = fs.readFileSync(path.join(root, 'node_modules/katex/dist/katex.min.css'), 'utf8');
    css = css.replace(/url\(([^)]+)\)/g, (_, url) => { const clean = url.replace(/["']/g, ''); const font = fs.readFileSync(path.join(root, 'node_modules/katex/dist', clean)); return `url(data:font/woff2;base64,${font.toString('base64')})`; });
    await page.addStyleTag({ content: css + '\nbody{font:14px SimSun,serif}.book-options{display:grid;gap:6px 15px}.book-option{min-width:0}.book-option b{font-weight:700}' });
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const measurements = await page.evaluate(async () => {
      const qa = window.optionQA, root = document.createElement('main'); document.body.append(root);
      const fixtures = [
        { id: 'short', mm: 170, options: ['$1$', '$2$', '$3$', '$4$'] },
        { id: 'narrow', mm: 50, options: ['函数单调递增', '函数单调递减', '偶函数', '奇函数'] },
        { id: 'fullWords', mm: 170, options: ['函数单调递增', '函数单调递减', '偶函数', '奇函数'] },
        { id: 'b5Column', mm: 67, sourceMm: 170, options: ['函数单调递增', '函数单调递减', '偶函数', '奇函数'] },
        { id: 'long', mm: 90, options: ['这个选项包含很长的一段中文说明文字以及另一个长公式 $x^2+y^2=1$', 'b', 'c', 'd'] },
        { id: 'fraction', mm: 170, options: ['$\\frac{1}{2}$', '$\\sqrt{3}$', '$\\frac{1+\\sqrt{3}}{2}$', '$-1$'] },
        { id: 'side', mm: 170, side: true, options: ['$1$', '$2$', '$3$', '$4$'] },
        { id: 'manual', mm: 170, choice: '1', options: ['$1$', '$2$', '$3$', '$4$'] },
        { id: 'manualSide', mm: 170, side: true, choice: '4', options: ['$1$', '$2$', '$3$', '$4$'] },
        { id: 'break', mm: 170, options: ['第一行\n第二行', 'b', 'c', 'd'] },
      ];
      for (const fixture of fixtures) {
        const group = document.createElement('div'); group.className = 'book-options'; group.id = fixture.id;
        group.dataset.choice = fixture.choice || 'auto'; group.dataset.availableMm = String(fixture.mm); group.dataset.sideFigure = String(!!fixture.side);
        group.style.width = `${fixture.sourceMm || fixture.mm}mm`;
        group.innerHTML = fixture.options.map((value, index) => `<div class="book-option"><b>${'ABCD'[index]}.</b> ${qa.renderMathText(value)}</div>`).join(''); root.append(group);
      }
      await document.fonts.ready;
      const first = await qa.measureBookOptions(root), second = await qa.measureBookOptions(root);
      const result = Object.fromEntries(fixtures.map(fixture => [fixture.id, Number(document.getElementById(fixture.id).dataset.measuredColumns)]));
      const raw = qa.measureRawBookOptions(['$1$', '$\\frac{1+\\sqrt{3}}{2}$'], 10.5, 'SimSun, serif');
      const editor = qa.pickOptionColumns({ options: ['$1$', '$2$', '$3$', '$4$'], availableMm: 170, fontSizePt: 10.5, fontFamily: 'SimSun, serif' });
      return { first, second, result, raw, editor, mathCount: root.querySelectorAll('.katex').length, probes: document.querySelectorAll('[data-book-option-probe]').length };
    });
    assert.deepEqual(measurements.result, { short: 4, narrow: 1, fullWords: 4, b5Column: 2, long: 1, fraction: 4, side: 2, manual: 1, manualSide: 2, break: 1 });
    assert.equal(measurements.first.measured, 10); assert.deepEqual(measurements.first, measurements.second);
    assert.equal(measurements.probes, 0); assert.equal(measurements.editor, 4);
    assert.ok(measurements.raw[1] > measurements.raw[0]); assert.ok(measurements.mathCount > 12); assert.equal(network, 0);
    report = { passed: true, measurements, externalRequests: network };
  } catch (error) { report = { passed: false, error: error.stack || String(error) }; process.exitCode = 1; }
  finally {
    await app?.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    const resolved = fs.realpathSync(profile); assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-book-options-')); fs.rmSync(resolved, { recursive: true, force: true });
  }
})();
