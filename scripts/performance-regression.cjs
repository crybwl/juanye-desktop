/* Offline heavy-document benchmark. Animations remain enabled. Never touches real user profiles. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) || 'current';
const questionCount = Number(process.argv.find(arg => arg.startsWith('--questions='))?.slice(12) || 120);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.join(root, 'artifacts/qa-performance');

function fixture() {
  const questions = Array.from({ length: questionCount }, (_, i) => ({
    id: `perf-${i + 1}`, importNumber: i + 1, type: 'single', score: 5,
    stem: `本地性能样例第 ${i + 1} 题：已知函数 $f_${i + 1}(x)=x^2+\\sin x$，以及 $P(A\\mid B)=\\frac{3}{4}$，求下列结论中正确的一项。\n（1）分析函数的单调性；（2）比较各个数值并说明理由。${i % 6 === 0 ? '\n\n| 类别 | 数量 | 概率 |\n| --- | --- | --- |\n| 甲 | $75$ | $\\frac{3}{4}$ |\n| 乙 | $25$ | $\\frac{1}{4}$ |' : ''}`,
    options: ['$\\frac{\\sqrt{3}}{2}$', '$\\int_0^1 x^2\\,dx=\\frac{1}{3}$', '$\\sin^2 x+\\cos^2 x=1$', '$a_n=2^n-1$'], answer: [String.fromCharCode(65 + i % 4)],
    analysis: `先按定义代入，得到 $f'(x)=2x+\\cos x$。由 $x^2+y^2\\ge 2xy$，等号在 $x=y$ 时成立。\n\n再由条件概率 $P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}$ 求解。对每个分支分别计算，保持所有数学内容与完整解析。\n\n\\[\\begin{aligned}S_n&=\\sum_{k=1}^{n} k^2\\\\&=\\frac{n(n+1)(2n+1)}{6}.\\end{aligned}\\]\n\n核验端点与取等条件。结论见答案，不能将正文混进速对框。`,
  }));
  return { version: 1, exam: { title: '离线性能压力检查', subtitle: '', duration: 120, notice: [], sections: [{ id: 'perf-section', title: '单项选择题', type: 'single', note: '', questions }] }, layout: { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'full', quickAnswers: true }, history: [] };
}

async function main() {
  assert.ok(Number.isInteger(questionCount) && questionCount >= 20 && questionCount <= 200);
  assert.match(label, /^[a-zA-Z0-9_-]+$/);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-performance-'));
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify(fixture()));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const watchdog = setTimeout(() => { app?.process().kill(); process.exitCode = 1; }, 150000);
  try {
    const timingFlags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: packaged ? path.join(root, 'release/win-unpacked/卷页.exe') : path.join(root, 'node_modules/electron/dist/electron.exe'), args: packaged ? timingFlags : [root, ...timingFlags], env, timeout: 30000 });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setSize(1500, 980);
      // A never-shown Electron window throttles rAF to 1 Hz despite backgroundThrottling:false.
      // Show without activation outside the desktop; no user window is covered or focused.
      win.setPosition(-16000, -16000); win.showInactive();
      globalThis.__perfRequests = 0; globalThis.__perfModels = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => { globalThis.__perfRequests++; cb({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__perfModels++; throw Error('No models during performance QA'); });
    });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__perfCommits = 0;
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject(renderer) { this.renderers.set(1, renderer); return 1; }, onCommitFiberRoot() { window.__perfCommits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {} };
    });
    await page.reload();
    await page.waitForFunction(count => document.querySelector('.workspace-preview-stage [data-pagination-ready="true"]') && document.querySelector('.workspace-editor-stage textarea')?.value.startsWith('本地性能样例第 1 题') && document.querySelectorAll('.workspace-preview-stage [data-page]').length > 5, questionCount, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready); await pause(6500);
    const client = await page.context().newCDPSession(page); await client.send('Performance.enable');
    const initial = await page.locator('.workspace-preview-stage').evaluate(el => ({ pages: el.querySelectorAll('[data-page]').length, nodes: el.querySelectorAll('*').length, math: el.querySelectorAll('.katex').length, tables: el.querySelectorAll('.math-table').length }));
    assert.ok(initial.math > questionCount, 'Heavy fixture did not render');
    await page.evaluate(() => {
      window.__perfProbe = null;
      const bounds = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (...args) { if (window.__perfProbe) window.__perfProbe.rectReads++; return bounds.apply(this, args); };
      new PerformanceObserver(list => { if (window.__perfProbe) window.__perfProbe.longTasks.push(...list.getEntries().map(e => e.duration)); }).observe({ type: 'longtask', buffered: false });
      new MutationObserver(records => { if (window.__perfProbe) records.forEach(record => { if (record.type === 'attributes') window.__perfProbe.styleWrites++; else { window.__perfProbe.domMutations++; window.__perfProbe.added += record.addedNodes.length; window.__perfProbe.removed += record.removedNodes.length; } }); }).observe(document.querySelector('.workspace-preview-stage'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] });
      function tick(time) { const probe = window.__perfProbe; if (probe) { if (probe.last) probe.frames.push(time - probe.last); probe.last = time; } requestAnimationFrame(tick); } requestAnimationFrame(tick);
    });
    async function measure(name, action) {
      await pause(250);
      const before = (await client.send('Performance.getMetrics')).metrics;
      await page.evaluate(() => { window.__perfCommits = 0; window.__perfProbe = { rectReads: 0, styleWrites: 0, domMutations: 0, added: 0, removed: 0, longTasks: [], frames: [], last: 0 }; });
      const start = Date.now(); await action(); await pause(1400);
      const sample = await page.evaluate(() => { const sample = { ...window.__perfProbe, reactCommits: window.__perfCommits }; window.__perfProbe = null; delete sample.last; return sample; });
      const after = (await client.send('Performance.getMetrics')).metrics;
      const metrics = Object.fromEntries(after.map(entry => [entry.name, entry.value - (before.find(item => item.name === entry.name)?.value || 0)]));
      const sorted = sample.frames.sort((a, b) => a - b);
      return { name, elapsedMs: Date.now() - start, reactCommits: sample.reactCommits, rectReads: sample.rectReads, styleWrites: sample.styleWrites, domMutations: sample.domMutations, addedNodes: sample.added, removedNodes: sample.removed, longTasks: sample.longTasks.length, longTaskMs: +sample.longTasks.reduce((a, b) => a + b, 0).toFixed(2), maxLongTaskMs: +Math.max(0, ...sample.longTasks).toFixed(2), frameCount: sorted.length, frameP95Ms: +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0).toFixed(2), framesOver34Ms: sorted.filter(value => value > 34).length, layoutMs: +(metrics.LayoutDuration * 1000).toFixed(2), styleMs: +(metrics.RecalcStyleDuration * 1000).toFixed(2), scriptMs: +(metrics.ScriptDuration * 1000).toFixed(2), taskMs: +(metrics.TaskDuration * 1000).toFixed(2), layouts: metrics.LayoutCount, styleRecalcs: metrics.RecalcStyleCount };
    }
    const samples = [];
    const sidebar = page.getByRole('complementary', { name: '试卷目录', exact: true });
    for (let trial = 1; trial <= 2; trial++) {
      samples.push(await measure(`mode_preview_${trial}`, () => page.keyboard.press('Control+2')));
      samples.push(await measure(`mode_edit_${trial}`, () => page.keyboard.press('Control+1')));
      const expanded = await sidebar.getAttribute('data-sidebar-state') === 'expanded';
      samples.push(await measure(`sidebar_${expanded ? 'collapse' : 'expand'}_${trial}`, () => sidebar.getByRole('button', { name: expanded ? '收起试卷目录' : '展开目录面板', exact: true }).click()));
      samples.push(await measure(`sidebar_${expanded ? 'expand' : 'collapse'}_${trial}`, () => sidebar.getByRole('button', { name: expanded ? '展开目录面板' : '收起试卷目录', exact: true }).click()));
      samples.push(await measure(`zoom_in_${trial}`, () => page.getByRole('button', { name: '放大', exact: true }).click()));
      samples.push(await measure(`zoom_out_${trial}`, () => page.getByRole('button', { name: '缩小', exact: true }).click()));
    }
    const final = await page.locator('.workspace-preview-stage').evaluate(el => ({ pages: el.querySelectorAll('[data-page]').length, nodes: el.querySelectorAll('*').length, math: el.querySelectorAll('.katex').length, tables: el.querySelectorAll('.math-table').length, formulaErrors: [...el.querySelectorAll('.katex-error')].map(node => node.textContent) }));
    assert.equal(final.pages, initial.pages); assert.deepEqual(final.formulaErrors, []); assert.deepEqual(errors, []);
    const requests = await app.evaluate(() => ({ cloudRequests: globalThis.__perfRequests, modelCalls: globalThis.__perfModels })); assert.deepEqual(requests, { cloudRequests: 0, modelCalls: 0 });
    const averages = {};
    for (const sample of samples) {
      const name = sample.name.replace(/_\d+$/, '');
      (averages[name] ||= []).push(sample);
    }
    for (const [name, entries] of Object.entries(averages)) averages[name] = Object.fromEntries(['reactCommits', 'rectReads', 'styleWrites', 'longTaskMs', 'frameP95Ms', 'layoutMs', 'scriptMs', 'taskMs'].map(key => [key, +(entries.reduce((sum, entry) => sum + entry[key], 0) / entries.length).toFixed(2)]));
    fs.mkdirSync(output, { recursive: true });
    const buildFile = packaged ? path.join(root, 'release/win-unpacked/resources/app.asar') : path.join(root, 'dist/index.html');
    const report = { passed: true, label, packaged, questionCount, buildSha256: crypto.createHash('sha256').update(fs.readFileSync(buildFile)).digest('hex'), environment: { platform: process.platform, note: 'Inactive Electron window positioned offscreen with background/occlusion throttling disabled; comparative rAF timings are not a visible-window FPS guarantee. All existing animations enabled.' }, initial, final, samples, averages, ...requests, errors };
    fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ label, passed: true, initial, averages, ...requests }));
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    const resolved = fs.realpathSync(profile), parent = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() === parent.toLowerCase() && path.basename(resolved).startsWith('juanye-performance-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
