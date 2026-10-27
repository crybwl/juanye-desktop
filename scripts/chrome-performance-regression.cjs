/* Offline, synthetic Electron/CDP comparison. Keep animations enabled.
 * Baseline: node scripts/chrome-performance-regression.cjs --label=beta5
 * After build: node scripts/chrome-performance-regression.cjs --label=beta6 --baseline=beta5
 * Focused: add --quick-navigation --appearances=telegram-dark --latest-export
 * Sources: https://github.com/motiondivision/motion (34.6k stars, researched 2026-10-27)
 * https://motion.dev/docs/performance ; https://github.com/w3c/long-animation-frames
 * https://chromedevtools.github.io/devtools-protocol/tot/Performance/
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const label = arg('label', 'current');
const baselineLabel = arg('baseline', '');
const bankCount = Number(arg('bank-questions', '500'));
const paperCount = Number(arg('paper-questions', '120'));
const packaged = process.argv.includes('--packaged');
const latestExportCheck = process.argv.includes('--latest-export');
const guardsOnly = process.argv.includes('--guards-only');
const assertParking = process.argv.includes('--assert-parking') || guardsOnly;
const allAppearances = [{ name: 'dark', mode: 'dark' }, { name: 'light', mode: 'light' }, { name: 'telegram-dark', mode: 'telegram', scheme: 'dark' }, { name: 'telegram-light', mode: 'telegram', scheme: 'light' }];
const allCases = ['typing', 'question-selection', 'sidebar-roundtrip', 'workspace-to-bank', 'bank-search', 'bank-selection', 'workspace-to-exam', 'dialog-roundtrip'];
const quickNavigation = process.argv.includes('--quick-navigation');
const selectedAppearances = arg('appearances', allAppearances.map(item => item.name).join(',')).split(',');
const selectedCases = arg('cases', quickNavigation ? 'workspace-to-bank,workspace-to-exam' : allCases.join(',')).split(',');
const caseSet = new Set(selectedCases);
const focusedRun = selectedCases.length < allCases.length || selectedAppearances.length < allAppearances.length;
const output = path.join(root, 'artifacts', 'qa-chrome-performance', label);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : 0;
const rounded = value => +value.toFixed(2);
const metricKeys = ['ScriptDurationMs', 'LayoutDurationMs', 'RecalcStyleDurationMs', 'TaskDurationMs', 'frameP95Ms', 'longTaskMs', 'reactCommits', 'rectReads', 'mathHtmlWrites'];

function averagesFor(samples) {
  const groups = {};
  for (const sample of samples) (groups[`${sample.variant}/${sample.name}`] ||= []).push(sample);
  return Object.fromEntries(Object.entries(groups).map(([key, entries]) => [key, Object.fromEntries(metricKeys.map(metric => [metric, rounded(entries.reduce((sum, entry) => sum + entry[metric], 0) / entries.length)]))]));
}
function comparisonFor(current, previous) {
  assert.equal(previous.fixtureHash, current.fixtureHash, 'Baseline and current must use the same deterministic fixture');
  const isPackaged = report => report.packaged ?? /app\.asar$/i.test(report.build.file);
  assert.equal(isPackaged(previous), isPackaged(current), 'Do not compare source and packaged runs');
  const averages = averagesFor(current.samples);
  return Object.fromEntries(Object.entries(averages).flatMap(([key, value]) => {
    const entries = previous.samples.filter(sample => `${sample.variant}/${sample.name}` === key);
    if (!entries.length) return [];
    const matchingTrials = new Set(entries.map(entry => entry.trial));
    const currentEntries = current.samples.filter(sample => `${sample.variant}/${sample.name}` === key && matchingTrials.has(sample.trial));
    const baselineEntries = entries.filter(entry => currentEntries.some(sample => sample.trial === entry.trial));
    if (!baselineEntries.length) return [];
    const mean = (list, metric) => rounded(list.reduce((sum, entry) => sum + entry[metric], 0) / list.length);
    return [[key, { baselineSamples: baselineEntries.length, currentSamples: currentEntries.length, baselineValidationPassed: previous.passed, ...Object.fromEntries(metricKeys.map(metric => {
      const before = mean(baselineEntries, metric), after = mean(currentEntries, metric);
      return [metric, { baseline: before, current: after, changePercent: before ? rounded((after / before - 1) * 100) : null }];
    })) }]];
  }));
}
const question = index => ({
  id: `chrome-fixture-${index}`, importNumber: index, type: 'single', score: 5,
  stem: `本地性能样例第 ${index} 题：已知函数 $f_${index}(x)=x^2+\\sin x$，且 $P(A\\mid B)=\\frac{3}{4}$，下列结论正确的是。分析函数的单调性，并比较各个数值。${index % 8 === 0 ? '\n\n| 类别 | 数量 | 概率 |\n| --- | --- | --- |\n| 甲 | 75 | $\\frac{3}{4}$ |\n| 乙 | 25 | $\\frac{1}{4}$ |' : ''}`,
  options: ['$\\frac{\\sqrt{3}}{2}$', '$\\int_0^1 x^2\\,dx=\\frac{1}{3}$', '$\\sin^2 x+\\cos^2 x=1$', '$a_n=2^n-1$'],
  answer: [String.fromCharCode(65 + index % 4)],
  analysis: `先代入条件 $f'(x)=2x+\\cos x$，再由 $x^2+y^2\\ge2xy$ 核验取等条件。条件概率为 $P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}$。`,
  source: '离线合成性能样例', knowledge: ['函数与运算'], difficulty: 'medium',
});

function fixture() {
  return {
    version: 1,
    exam: { id: 'chrome-perf-exam', title: '性能回归 · 本地合成试卷', subtitle: '', duration: 120, notice: [], sections: [{ id: 'chrome-perf-section', title: '单项选择题', type: 'single', note: '', questions: Array.from({ length: paperCount }, (_, index) => question(index + 1)) }] },
    layout: { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' }, history: [],
  };
}

// Installs before the app reload, including the production React devtools hook.
function instrumentation() {
  window.__chromeCommits = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject(renderer) { this.renderers.set(1, renderer); return 1; }, onCommitFiberRoot() { window.__chromeCommits++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {} };
  window.__chromeProbe = null;
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (...args) { if (window.__chromeProbe) window.__chromeProbe.rectReads++; return rect.apply(this, args); };
  const html = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (html?.set) Object.defineProperty(Element.prototype, 'innerHTML', { ...html, set(value) { if (window.__chromeProbe && typeof value === 'string' && value.includes('katex')) window.__chromeProbe.mathHtmlWrites++; html.set.call(this, value); } });
  const supported = PerformanceObserver.supportedEntryTypes;
  for (const type of ['longtask', 'long-animation-frame']) if (supported.includes(type)) new PerformanceObserver(list => {
    const probe = window.__chromeProbe;
    if (probe) for (const entry of list.getEntries()) probe[type].push({ duration: entry.duration, blockingDuration: entry.blockingDuration || 0 });
  }).observe({ type, buffered: false });
  new MutationObserver(records => {
    const probe = window.__chromeProbe;
    if (!probe) return;
    for (const record of records) {
      probe.domMutations++;
      probe.addedNodes += record.addedNodes.length;
      probe.removedNodes += record.removedNodes.length;
      if (record.type === 'attributes') probe.styleWrites++;
    }
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style'] });
  function tick(time) { const probe = window.__chromeProbe; if (probe) { if (probe.last) probe.frames.push(time - probe.last); probe.last = time; } requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
}

async function main() {
  assert.match(label, /^[a-zA-Z0-9_-]+$/);
  if (baselineLabel) assert.match(baselineLabel, /^[a-zA-Z0-9_-]+$/);
  assert.ok(Number.isInteger(bankCount) && bankCount >= 25 && bankCount <= 1000);
  assert.ok(Number.isInteger(paperCount) && paperCount >= 20 && paperCount <= 200);
  assert.ok(selectedAppearances.length > 0 && selectedAppearances.every(name => allAppearances.some(item => item.name === name)), 'Unknown appearance filter');
  assert.ok(selectedCases.length > 0 && selectedCases.every(name => allCases.includes(name)), 'Unknown case filter');
  if (process.argv.includes('--summarize')) {
    assert.ok(baselineLabel, '--summarize requires --baseline');
    const current = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
    const previous = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'qa-chrome-performance', baselineLabel, 'report.json'), 'utf8'));
    const comparison = comparisonFor(current, previous);
    const identity = sample => `${sample.variant}/${sample.name}/${sample.trial}`;
    const currentIds = new Set(current.samples.map(identity)), previousIds = new Set(previous.samples.map(identity));
    const variants = Object.fromEntries([...new Set(current.samples.map(sample => sample.variant))].map(variant => {
      const before = previous.samples.filter(sample => sample.variant === variant && currentIds.has(identity(sample))), after = current.samples.filter(sample => sample.variant === variant && previousIds.has(identity(sample)));
      return [variant, Object.fromEntries(['ScriptDurationMs', 'LayoutDurationMs', 'RecalcStyleDurationMs', 'TaskDurationMs', 'longTaskMs'].map(metric => {
        const a = rounded(before.reduce((sum, entry) => sum + entry[metric], 0)), b = rounded(after.reduce((sum, entry) => sum + entry[metric], 0));
        return [metric, { baseline: a, current: b, changePercent: a ? rounded((b / a - 1) * 100) : null }];
      }))];
    }));
    const metadataIssue = current.error?.includes('Do not compare source and packaged runs') && current.samples.length === 64;
    const latestGuardsReachedComparison = metadataIssue && current.stage === 'latest keystroke: immediate PDF print root and project export';
    const summary = { baselineLabel, label, fixtureHash: current.fixtureHash, baselineSamples: previous.samples.length, currentSamples: current.samples.length, baselineValidationPassed: previous.passed, currentValidationPassed: current.passed, baselineHarnessError: previous.error, currentHarnessError: current.error, metadataIssue: metadataIssue ? 'Failed baseline error-report omitted packaged:false; comparison used undefined rather than source mode. Fixed using captured build path.' : null, runtimeChecksReachedComparison: Boolean(current.passed || metadataIssue), latestExport: current.latestExport, latestExportGuardsInferredPassed: Boolean(latestGuardsReachedComparison), inferenceEvidence: latestGuardsReachedComparison ? 'The captured failure stack is in comparison, which executes after sequential true-paper-white, all-question, no-model/network, immediate-PDF-print-DOM, project-JSON and persisted-draft assertions. This is source-order inference, not an independently repeated export test.' : null, comparison, variants, note: 'Derived without rerunning Electron. Exact matching timed case/trial sets only. Functional failure flags are preserved; raw valid telemetry is not relabeled as a passing regression.' };
    fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ baselineSamples: summary.baselineSamples, currentSamples: summary.currentSamples, variants }, null, 2)); return;
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-chrome-perf-'));
  const draft = fixture(), fixtureHash = crypto.createHash('sha256').update(JSON.stringify({ draft, bankCount })).digest('hex');
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify(draft));
  fs.mkdirSync(output, { recursive: true });
  const buildFile = path.join(root, packaged ? 'release/win-unpacked/resources/app.asar' : 'dist/index.html');
  const build = { file: buildFile, sha256: crypto.createHash('sha256').update(fs.readFileSync(buildFile)).digest('hex'), modified: fs.statSync(buildFile).mtime.toISOString() };
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const samples = [], screenshots = [], motion = [], errors = [];
  let workspaceGuards;
  let app, page, report, stage = 'launch', rendererRequests = 0;
  const started = Date.now();
  const progress = name => { stage = name; console.log(JSON.stringify({ progress: name, label, elapsedMs: Date.now() - started })); };
  const watchdog = setTimeout(() => { try { app?.process().kill(); } catch {} console.error(`Chrome performance QA timed out at ${stage}`); process.exit(1); }, 180000);
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env, timeout: 20000 });
    await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.setContentSize(1440, 900); win.showInactive();
      globalThis.__chromePerf = { network: 0, modelCalls: 0 };
      globalThis.fetch = () => { globalThis.__chromePerf.network++; throw Error('Offline synthetic QA blocks HTTP'); };
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => { globalThis.__chromePerf.network++; done({ cancel: true }); });
      for (const name of ['model:recognize', 'model:test', 'model:generate', 'exam:analyze']) { ipcMain.removeHandler(name); ipcMain.handle(name, () => { globalThis.__chromePerf.modelCalls++; throw Error('Performance QA must not invoke a model'); }); }
    });
    page = await app.firstWindow(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { rendererRequests++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(instrumentation); await page.reload();
    await page.waitForFunction(() => document.querySelector('.workspace-preview-stage [data-pagination-ready="true"]') && document.querySelector('.workspace-editor-stage textarea')?.value.startsWith('本地性能样例第 1 题'), null, { timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(questions => window.juanye.bankSave({ questions, origin: { examTitle: '合成性能题库', examId: 'chrome-fixture' } }), Array.from({ length: bankCount }, (_, index) => question(index + 1)));
    assert.equal((await page.evaluate(() => window.juanye.bankLoad())).entries.length, bankCount);
    const client = await page.context().newCDPSession(page); await client.send('Performance.enable');
    const nav = name => page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name, exact: true });
    const bank = () => page.getByTestId('bank-workspace');
    const rows = () => bank().getByTestId('bank-entry');
    const sidebar = () => page.getByRole('complementary', { name: '试卷目录', exact: true });
    const text = () => page.locator('.workspace-editor-stage').getByPlaceholder('输入题干…', { exact: true });
    const shot = async name => { const file = `${name}.png`; await page.mouse.move(3, 3); await page.screenshot({ path: path.join(output, file) }); screenshots.push(file); };
    async function measure(variant, name, trial, action, settle = 450) {
      const before = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(entry => [entry.name, entry.value]));
      await page.evaluate(() => { window.__chromeCommits = 0; window.__chromeProbe = { rectReads: 0, mathHtmlWrites: 0, domMutations: 0, styleWrites: 0, addedNodes: 0, removedNodes: 0, longtask: [], 'long-animation-frame': [], frames: [], last: 0 }; });
      const start = Date.now(); await action(); await pause(settle);
      const sample = await page.evaluate(() => { const result = { ...window.__chromeProbe, reactCommits: window.__chromeCommits }; window.__chromeProbe = null; delete result.last; return result; });
      const after = Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(entry => [entry.name, entry.value]));
      const metrics = Object.fromEntries(['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'].map(key => [`${key}Ms`, rounded((after[key] - before[key]) * 1000)]));
      const result = { variant, name, trial, elapsedMs: Date.now() - start, ...metrics, layoutCount: after.LayoutCount - before.LayoutCount, styleRecalcCount: after.RecalcStyleCount - before.RecalcStyleCount, ...Object.fromEntries(['reactCommits', 'rectReads', 'mathHtmlWrites', 'domMutations', 'styleWrites', 'addedNodes', 'removedNodes'].map(key => [key, sample[key]])), frameCount: sample.frames.length, frameP95Ms: rounded(percentile(sample.frames, .95)), frameMaxMs: rounded(Math.max(0, ...sample.frames)), framesOver34Ms: sample.frames.filter(value => value > 34).length, longTasks: sample.longtask.length, longTaskMs: rounded(sample.longtask.reduce((sum, value) => sum + value.duration, 0)), maxLongTaskMs: rounded(Math.max(0, ...sample.longtask.map(value => value.duration))), longAnimationFrames: sample['long-animation-frame'].length, longAnimationFrameMs: rounded(sample['long-animation-frame'].reduce((sum, value) => sum + value.duration, 0)) };
      samples.push(result); return result;
    }
    async function captureMotion(button, selectors, name) {
      const frames = await button.evaluate((element, selectors) => new Promise(resolve => {
        const start = performance.now(), frames = [];
        const capture = () => frames.push({ time: performance.now() - start, nodes: selectors.map(selector => { const node = document.querySelector(selector); if (!node) return null; const rect = node.getBoundingClientRect(), style = getComputedStyle(node); return { x: rect.x, width: rect.width, height: rect.height, opacity: +style.opacity, transform: style.transform, display: style.display, visibility: style.visibility, contentVisibility: style.contentVisibility, inert: node.inert }; }) });
        capture(); element.click();
        function tick() {
          capture();
          const elapsed = performance.now() - start, nodes = frames.at(-1).nodes.filter(Boolean);
          const parked = nodes.some(node => node.contentVisibility === 'hidden') && nodes.some(node => node.contentVisibility === 'visible' && node.opacity > .999);
          if (elapsed < 550 || elapsed < 1100 && !parked) requestAnimationFrame(tick); else resolve(frames);
        } requestAnimationFrame(tick);
      }), selectors);
      const evidence = selectors.map((selector, index) => ({ selector, states: new Set(frames.map(frame => frame.nodes[index]).filter(node => node && node.display !== 'none').map(node => JSON.stringify(node))).size }));
      // Preserve frame starvation as a baseline result, not a test harness
      // exception. The full run still must prove real intermediate movement.
      const exitBeforeParking = selectors.some((_, index) => frames.some((frame, frameIndex) => { const node = frame.nodes[index]; return node && node.contentVisibility === 'visible' && node.opacity > .01 && node.opacity < .99 && frames.slice(frameIndex + 1).some(later => later.nodes[index]?.contentVisibility === 'hidden' && later.nodes[index].opacity < .01); }));
      motion.push({ name, frames, evidence, captureDurationMs: rounded(frames.at(-1).time), intermediateMotionCaptured: evidence.some(item => item.states >= 3), exitBeforeParking });
      if (assertParking) assert.ok(exitBeforeParking, `${name}: did not observe visible intermediate exit followed by content-visibility parking`);
    }
    async function applyAppearance(item) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const settings = page.getByRole('dialog'); await settings.getByRole('button', { name: '外观', exact: true }).click();
      await settings.locator('label').filter({ has: page.locator(`input[name="juanye-appearance"][value="${item.mode}"]`) }).click();
      if (item.mode === 'telegram') {
        await settings.getByRole('group', { name: 'Telegram 明暗模式', exact: true }).getByRole('tab', { name: item.scheme === 'light' ? '浅色' : '深色', exact: true }).click();
        await settings.locator('label').filter({ has: page.locator('input[name="juanye-telegram-theme"][value="ember"]') }).click();
      }
      await settings.getByRole('button', { name: '关闭', exact: true }).click(); await pause(350);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), item.mode);
      if (item.scheme) assert.equal(await page.evaluate(() => document.documentElement.dataset.telegramScheme), item.scheme);
    }
    const initial = await page.locator('.workspace-preview-stage').evaluate(el => ({ pages: el.querySelectorAll('[data-page]').length, nodes: el.querySelectorAll('*').length, math: el.querySelectorAll('.katex').length }));
    assert.ok(initial.pages >= 5 && initial.math > paperCount, 'Heavy paper fixture did not render');
    progress('warm bank and measure selected appearances');
    await nav('本地题库').click(); await rows().first().waitFor(); await pause(500);
    assert.equal(await rows().count(), 25, '500-question bank must render only one 25-card page');
    await nav('组卷').click(); await pause(500);
    // Fresh installations start with the catalog collapsed; normalize through
    // the public control before benchmarking real question selection.
    if (await sidebar().getAttribute('data-sidebar-state') === 'collapsed') await sidebar().getByRole('button', { name: '展开目录面板', exact: true }).click();
    await sidebar().getByRole('button', { name: '编辑第 2 题', exact: true }).waitFor();
    await pause(350);
    for (const item of allAppearances.filter(appearance => selectedAppearances.includes(appearance.name))) {
      progress(item.name); await applyAppearance(item);
      for (let trial = 1; !guardsOnly && trial <= 2; trial++) {
        if (caseSet.has('typing')) await measure(item.name, 'typing', trial, async () => { await text().focus(); await text().press('End'); await text().pressSequentially(` ${trial}ab`, { delay: 25 }); }, 650);
        if (caseSet.has('question-selection')) await measure(item.name, 'question-selection', trial, async () => { await sidebar().getByRole('button', { name: '编辑第 2 题', exact: true }).click(); await pause(100); await sidebar().getByRole('button', { name: '编辑第 1 题', exact: true }).click(); });
        if (caseSet.has('sidebar-roundtrip')) await measure(item.name, 'sidebar-roundtrip', trial, async () => { await sidebar().getByRole('button', { name: '收起试卷目录', exact: true }).click(); await pause(350); await sidebar().getByRole('button', { name: '展开目录面板', exact: true }).click(); });
        // Unmeasured navigation supplies prerequisites when only bank actions
        // or only the return transition was requested.
        if (caseSet.has('workspace-to-bank')) await measure(item.name, 'workspace-to-bank', trial, () => nav('本地题库').click());
        else await nav('本地题库').click();
        if (caseSet.has('bank-search')) await measure(item.name, 'bank-search', trial, async () => { const search = bank().getByRole('textbox', { name: '搜索题库', exact: true }); await search.pressSequentially('函数', { delay: 30 }); await pause(100); await search.fill(''); });
        if (caseSet.has('bank-selection')) await measure(item.name, 'bank-selection', trial, async () => { await rows().nth(1).locator('.bank-entry-stem').click(); await pause(100); await rows().nth(0).locator('.bank-entry-stem').click(); });
        if (caseSet.has('workspace-to-exam')) await measure(item.name, 'workspace-to-exam', trial, () => nav('组卷').click());
        else await nav('组卷').click();
        if (caseSet.has('dialog-roundtrip')) await measure(item.name, 'dialog-roundtrip', trial, async () => { await page.getByRole('button', { name: '设置', exact: true }).click(); await pause(350); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); });
      }
      if (!guardsOnly && (item.mode === 'telegram' || focusedRun)) {
        await shot(`editor-${item.name}`);
        await captureMotion(nav('本地题库'), ['[data-workspace-view="exam"]', '[data-workspace-view="bank"]'], `${item.name}-workspace`);
        await shot(`bank-${item.name}`);
        await captureMotion(nav('组卷'), ['[data-workspace-view="exam"]', '[data-workspace-view="bank"]'], `${item.name}-workspace-return`);
      }
    }
    if (assertParking) {
      progress('outside timed cases: exiting workspace input/focus and rapid-toggle guards');
      const exiting = await nav('本地题库').evaluate(async button => {
        const exam = document.querySelector('[data-workspace-view="exam"]');
        const textarea = exam.querySelector('textarea[placeholder="输入题干…"]');
        const original = textarea.value; textarea.focus(); button.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        const bank = document.querySelector('[data-workspace-view="bank"]');
        const ownership = () => document.activeElement?.closest('[data-workspace-view]')?.getAttribute('data-workspace-view') || null;
        const focusAfterSwitch = ownership();
        const target = exam.querySelector('[aria-label="编辑第 2 题"]');
        const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true }); target.dispatchEvent(pointer);
        const click = new MouseEvent('click', { bubbles: true, cancelable: true }); target.dispatchEvent(click);
        const candidates = [...bank.querySelectorAll('button,input,select,textarea,a[href],[tabindex],[contenteditable="true"]')].filter(node => {
          if (node.tabIndex < 0 || node.matches(':disabled') || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
          for (let parent = node; parent && parent !== bank; parent = parent.parentElement) { const rect = parent.getBoundingClientRect(); if (!parent.getClientRects().length || rect.width <= 0 || rect.height <= 0 || getComputedStyle(parent).visibility === 'hidden') return false; }
          return true;
        });
        // Match actual browser focusability, not merely selector/geometry. A
        // custom control may have tabindex and a box yet reject focus (for
        // example inside a collapsed/skipped region). The production redirect
        // also tries candidates until document.activeElement confirms success.
        const rejected = []; let last;
        for (const candidate of [...candidates].reverse()) {
          candidate.focus({ preventScroll: true });
          if (document.activeElement === candidate) { last = candidate; break; }
          rejected.push(candidate.outerHTML.slice(0, 350));
        }
        window.__workspaceGuard = { first: candidates[0], last, original };
        candidates[0].focus({ preventScroll: true });
        // Reloading the bank can disable its target combobox between this
        // snapshot and the trusted key. Check the last ENABLED control at the
        // actual inactive-focus event, not a stale pre-key candidate.
        const focusBoundary = event => {
          if (!exam.contains(event.target)) return;
          const eligible = [...bank.querySelectorAll('button,input,select,textarea,a[href],[tabindex],[contenteditable="true"]')].filter(node => {
            if (node.tabIndex < 0 || node.matches(':disabled') || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
            for (let parent = node; parent && parent !== bank; parent = parent.parentElement) { const rect = parent.getBoundingClientRect(); if (!parent.getClientRects().length || rect.width <= 0 || rect.height <= 0 || getComputedStyle(parent).visibility === 'hidden') return false; }
            return true;
          });
          window.__workspaceGuard.last = eligible.at(-1);
          window.__workspaceGuard.boundaryAtNativeFocus = { enabledControls: eligible.length, expectedLast: eligible.at(-1)?.outerHTML.slice(0, 450) };
        };
        document.addEventListener('focusin', focusBoundary, true);
        window.__workspaceGuard.stopBoundary = () => document.removeEventListener('focusin', focusBoundary, true);
        return { inactiveAria: exam.getAttribute('aria-hidden'), inactiveInertDuringExit: exam.inert, inactiveContentVisibility: getComputedStyle(exam).contentVisibility, focusAfterSwitch, pointerCanceled: pointer.defaultPrevented, clickCanceled: click.defaultPrevented, textareaUnchanged: textarea.value === original, candidates: candidates.length, rejectedFocusTargets: rejected, expectedFirst: candidates[0].outerHTML.slice(0, 450), firstActuallyFocused: document.activeElement === candidates[0], expectedLast: last?.outerHTML.slice(0, 450) };
      });
      workspaceGuards = { exiting };
      assert.equal(exiting.inactiveAria, 'true'); assert.equal(exiting.inactiveInertDuringExit, false); assert.equal(exiting.inactiveContentVisibility, 'visible');
      assert.equal(exiting.focusAfterSwitch, 'bank', 'Switching away from focused textarea did not redirect into active workspace');
      assert.ok(exiting.pointerCanceled && exiting.clickCanceled && exiting.textareaUnchanged, 'Exiting workspace accepted pointer/click mutation');
      assert.ok(exiting.candidates > 2, 'No active-workspace focus traversal candidates');
      await page.keyboard.press('Shift+Tab');
      const backward = await page.evaluate(() => ({ activeWorkspace: document.activeElement?.closest('[data-workspace-view]')?.getAttribute('data-workspace-view'), redirectedToLast: document.activeElement === window.__workspaceGuard.last, actualFocus: document.activeElement?.outerHTML.slice(0, 450), expectedFocus: window.__workspaceGuard.last?.outerHTML.slice(0, 450), inactiveInertWhenKeyCompleted: document.querySelector('[data-workspace-view="exam"]').inert, boundaryAtNativeFocus: window.__workspaceGuard.boundaryAtNativeFocus }));
      workspaceGuards.backward = backward;
      assert.equal(backward.activeWorkspace, 'bank'); assert.equal(backward.redirectedToLast, true, 'Shift+Tab from first active control did not redirect to active last control');
      await page.evaluate(() => window.__workspaceGuard.stopBoundary());
      await page.evaluate(() => window.__workspaceGuard.first.focus({ preventScroll: true }));
      await page.keyboard.press('Tab');
      const forward = await page.evaluate(() => ({ activeWorkspace: document.activeElement?.closest('[data-workspace-view]')?.getAttribute('data-workspace-view'), advanced: document.activeElement !== window.__workspaceGuard.first }));
      workspaceGuards.forward = forward;
      assert.equal(forward.activeWorkspace, 'bank'); assert.equal(forward.advanced, true, 'Forward Tab looped or entered inactive workspace');
      await nav('组卷').click(); await pause(650);
      await nav('本地题库').evaluate(async button => {
        const nav = button.closest('nav'), exam = [...nav.querySelectorAll('button')].find(node => node.textContent.trim() === '组卷');
        for (const element of [button, exam, button, exam, button, exam]) { element.click(); await new Promise(resolve => setTimeout(resolve, 25)); }
      });
      await page.waitForFunction(() => {
        const exam = document.querySelector('[data-workspace-view="exam"]'), bank = document.querySelector('[data-workspace-view="bank"]');
        return exam?.getAttribute('aria-hidden') === 'false' && !exam.inert && getComputedStyle(exam).contentVisibility === 'visible' && +getComputedStyle(exam).opacity > .999 && bank?.getAttribute('aria-hidden') === 'true' && bank.inert && getComputedStyle(bank).contentVisibility === 'hidden' && bank.dataset.workspaceParked === 'true';
      }, null, { timeout: 4000 });
      const rapid = await page.evaluate(() => [...document.querySelectorAll('[data-workspace-view]')].map(node => ({ name: node.dataset.workspaceView, ariaHidden: node.getAttribute('aria-hidden'), inert: node.inert, contentVisibility: getComputedStyle(node).contentVisibility, opacity: +getComputedStyle(node).opacity, parked: node.dataset.workspaceParked })));
      assert.equal(await text().inputValue(), await page.evaluate(() => window.__workspaceGuard.original), 'Exiting click or rapid navigation mutated the selected question');
      workspaceGuards = { exiting, backward, forward, rapid, rapidToggles: 6, inputUnchanged: true, note: 'Actual trusted Tab/Shift+Tab keys; public navigation preserves old textarea focus for switch test; synthetic pointer/click probes exercise inactive capture guards. Excluded from timed cases.' };
    }
    progress('validate and compare');
    const final = await page.evaluate(() => ({ pages: document.querySelectorAll('.workspace-preview-stage [data-page]').length, questions: new Set([...document.querySelectorAll('.workspace-preview-stage [data-page] [data-qid]')].map(node => node.dataset.qid)).size, formulaErrors: [...document.querySelectorAll('.katex-error')].map(node => node.textContent), paperBackgrounds: [...document.querySelectorAll('.workspace-preview-stage [data-page] .paper')].slice(0, 3).map(node => getComputedStyle(node).backgroundColor), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, interfaceMotion: document.querySelector('[data-interface-motion]')?.getAttribute('data-interface-motion'), reactRenderers: window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size, supportedObserverTypes: PerformanceObserver.supportedEntryTypes }));
    assert.deepEqual(final.formulaErrors, []); assert.equal(final.questions, paperCount); assert.equal(final.reducedMotion, false); assert.notEqual(final.interfaceMotion, 'reduced');
    assert.ok(final.paperBackgrounds.length > 0, 'No rendered paper surfaces found');
    assert.ok(final.paperBackgrounds.every(value => value === 'rgb(255, 255, 255)'), `Paper is no longer white: ${JSON.stringify(final.paperBackgrounds)}`);
    assert.ok(final.reactRenderers > 0, 'React commit instrumentation was not installed');
    assert.ok(samples.every(sample => sample.frameCount > 0), 'No real rAF samples for an interaction');
    if (!guardsOnly) assert.ok(motion.some(item => item.intermediateMotionCaptured), 'No real intermediate animation frames were captured');
    const requests = await app.evaluate(() => globalThis.__chromePerf); assert.deepEqual(requests, { network: 0, modelCalls: 0 }); assert.equal(rendererRequests, 0); assert.deepEqual(errors, []);
    let latestExport;
    if (latestExportCheck) {
      progress('latest keystroke: immediate PDF print root and project export');
      await app.evaluate(({ ipcMain, BrowserWindow }) => {
        globalThis.__chromeLatestExport = { pdfText: null, projectContent: null };
        ipcMain.removeHandler('document:pdf');
        ipcMain.handle('document:pdf', async () => {
          globalThis.__chromeLatestExport.pdfText = await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('document.querySelector("#print-root")?.textContent || ""');
          return { canceled: true };
        });
        ipcMain.removeHandler('document:text');
        ipcMain.handle('document:text', (_event, options) => { globalThis.__chromeLatestExport.projectContent = options.content; return { canceled: true }; });
      });
      const marker = 'LATEST_KEYSTROKE_271026';
      await text().focus(); await text().press('End'); await text().pressSequentially(marker);
      // No pause or preview wait before the real export shortcut.
      await page.keyboard.press('Control+e');
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline && !await app.evaluate(() => globalThis.__chromeLatestExport.pdfText !== null)) await pause(100);
      const pdfText = await app.evaluate(() => globalThis.__chromeLatestExport.pdfText);
      assert.ok(pdfText?.includes(marker), 'Immediate PDF print DOM omitted the last keystroke');
      await page.getByRole('button', { name: '导出中心', exact: true }).click();
      const center = page.getByRole('dialog');
      await center.locator('.export-format-list').getByRole('button', { name: /卷页项目/ }).click();
      await center.getByRole('button', { name: '导出 卷页项目', exact: true }).click();
      const projectDeadline = Date.now() + 8000;
      while (Date.now() < projectDeadline && !await app.evaluate(() => globalThis.__chromeLatestExport.projectContent !== null)) await pause(50);
      const project = JSON.parse(await app.evaluate(() => globalThis.__chromeLatestExport.projectContent));
      assert.ok(project.exam.sections[0].questions[0].stem.includes(marker), 'Project export omitted the last keystroke');
      await page.waitForFunction(async marker => (await window.juanye.loadDraft()).exam.sections[0].questions[0].stem.includes(marker), marker, { timeout: 8000 });
      latestExport = { marker, immediatePdfPrintDom: true, projectContent: true, persistedDraft: true, nativeSaveDialogCalls: 0, realPdfCalls: 0 };
    }
    assert.deepEqual(await app.evaluate(() => globalThis.__chromePerf), { network: 0, modelCalls: 0 }); assert.equal(rendererRequests, 0); assert.deepEqual(errors, []);
    const averages = averagesFor(samples);
    let comparison;
    if (baselineLabel) {
      const previous = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'qa-chrome-performance', baselineLabel, 'report.json'), 'utf8'));
      // Incomplete functional runs can still contain legitimate timed cases.
      // Compare only exact matching case/trial sets; never inflate their sample
      // count or describe a failed baseline as a fully passing regression.
      comparison = comparisonFor({ fixtureHash, packaged, build, samples }, previous);
    }
    report = { passed: true, label, packaged, bankCount, paperCount, workload: { selectedAppearances, selectedCases, repetitions: 2, focusedRun, note: focusedRun ? 'Same deterministic initial fixture; skipped actions are not timed or replayed. Compare matching cases, not full-run totals.' : 'Full repeated workflow.' }, fixtureHash, build, elapsedMs: Date.now() - started, initial, final, samples, averages, comparison, motion, workspaceGuards, screenshots, requests, rendererRequests, errors, latestExport, environment: { platform: process.platform, note: 'One inactive offscreen Electron window, background/occlusion throttling disabled. Comparable local rAF telemetry, not a visible-desktop FPS guarantee. Existing animations stay enabled. Math HTML writes count DOM publication, not KaTeX render calls. Independent repetitions use identical action order.' } };
    console.log(JSON.stringify({ passed: true, label, elapsedMs: report.elapsedMs, samples: samples.length, initial, screenshots, requests }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    report = { passed: false, label, packaged, bankCount, paperCount, workload: { selectedAppearances, selectedCases, repetitions: 2, focusedRun }, stage, fixtureHash, build, elapsedMs: Date.now() - started, error: error.stack || String(error), samples, motion, workspaceGuards, screenshots, errors, profile };
    console.error(JSON.stringify({ passed: false, stage, error: report.error }, null, 2)); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    const resolved = fs.realpathSync(profile), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() === temp.toLowerCase() && path.basename(resolved).startsWith('juanye-chrome-perf-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
