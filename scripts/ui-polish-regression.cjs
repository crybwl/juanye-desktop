/* Local-only visual/motion QA. Real preload IPC + isolated synthetic profile.
 * Network is blocked; only the AI service boundary is replaced by a deterministic delayed reply.
 * Run after npm run build; add --packaged to test release/win-unpacked/卷页.exe.
 * Motion assertions sample actual rendered frames AFTER lazy loading, not Motion component names.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const suffix = packaged ? 'packaged' : 'source';
const output = path.join(root, 'artifacts', 'qa-ui-polish', suffix);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const themes = ['ocean', 'spring', 'frost', 'gem', 'classroom', 'blossom', 'dusk', 'ember', 'neon'];
async function until(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(50); }
  throw Error(message);
}
const compact = frames => frames.map(frame => ({ ...frame, nodes: Object.fromEntries(Object.entries(frame.nodes).map(([key, value]) => [key, value && { ...value, x: +value.x.toFixed(2), y: +value.y.toFixed(2), width: +value.width.toFixed(2), height: +value.height.toFixed(2) }])) }));

// A click and the first sample happen in one renderer evaluation: Playwright's
// click auto-wait cannot accidentally wait until the transition has already ended.
async function framesFor(button, probes, duration = 750) {
  return button.evaluate((element, { probes, duration }) => new Promise(resolve => {
    const frames = [], start = performance.now();
    const capture = () => {
      const nodes = {};
      for (const [name, selector] of Object.entries(probes)) {
        const node = document.querySelector(selector);
        if (!node) { nodes[name] = null; continue; }
        const bounds = node.getBoundingClientRect(), style = getComputedStyle(node);
        nodes[name] = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, opacity: +style.opacity, transform: style.transform, filter: style.filter, visibility: style.visibility, display: style.display };
      }
      const animations = document.getAnimations().filter(animation => {
        const target = animation.effect?.target;
        return target instanceof Element && Object.values(probes).some(selector => target.matches(selector) || target.closest(selector));
      }).map(animation => ({ state: animation.playState, duration: animation.effect?.getComputedTiming().duration, progress: animation.effect?.getComputedTiming().progress }));
      frames.push({ time: performance.now() - start, nodes, animations });
    };
    capture(); element.click();
    function tick() { capture(); if (performance.now() - start < duration) requestAnimationFrame(tick); else resolve(frames); }
    requestAnimationFrame(tick);
  }), { probes, duration });
}
function motionEvidence(frames, name) {
  const states = frames.map(frame => frame.nodes[name]).filter(value => value && value.display !== 'none' && value.visibility !== 'hidden' && value.opacity > .01 && value.width > 0 && value.height > 0);
  const signature = value => [value.x.toFixed(2), value.y.toFixed(2), value.width.toFixed(2), value.height.toFixed(2), value.opacity.toFixed(3), value.transform, value.filter].join('|');
  return { samples: states.length, states: new Set(states.map(signature)).size, first: states[0], last: states.at(-1) };
}
function assertRenderedMotion(frames, names, label) {
  const evidence = Object.fromEntries(names.map(name => [name, motionEvidence(frames, name)]));
  assert.ok(Object.values(evidence).some(item => item.samples >= 8 && item.states >= 3), `${label} has no intermediate rendered states: ${JSON.stringify(evidence)}`);
  // At least two changing frames must exist beyond the click turn; instant display:none
  // switching and a decorative button tap do not satisfy this assertion.
  const late = frames.filter(frame => frame.time >= 35 && frame.time < 350);
  assert.ok(names.some(name => motionEvidence(late, name).states >= 2), `${label} has no ongoing motion after 35ms`);
  return evidence;
}
function assertIntermediateDimension(frames, name, dimension, label) {
  const values = frames.map(frame => frame.nodes[name]?.[dimension]).filter(Number.isFinite);
  assert.ok(values.length >= 8, `${label}: insufficient animation frames`);
  const min = Math.min(...values), max = Math.max(...values);
  assert.ok(max - min >= 30, `${label}: ${dimension} did not change materially (${min}–${max})`);
  assert.ok(values.some(value => value > min + 5 && value < max - 5), `${label}: ${dimension} jumped between endpoints with no intermediate geometry`);
  return { min, max, intermediate: values.filter(value => value > min + 5 && value < max - 5).length };
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-ui-polish-'));
  const question = index => ({ id: `polish-bank-${index}`, type: 'single', score: 5, stem: `第 ${index} 题：已知函数 $f(x)=x^2+${index}$，则 $f(2)$ 的值为（　）。这是一段用于验证题库卡片换行、收藏状态和窗口边界的示例文本。`, options: ['$1$', '$2$', '$3$', `$${index + 4}$`], answer: ['D'], analysis: `代入 $x=2$，得到 $f(2)=${index + 4}$。`, source: '本地隔离回归样例', knowledge: ['函数与运算'], difficulty: 'easy' });
  const exam = { id: 'polish-exam', title: '界面与动效 · 本地隔离样卷', subtitle: '', duration: 90, notice: [], sections: [{ id: 'polish-section', title: '单项选择题', type: 'single', note: '', questions: [question(1), question(2)] }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(output, { recursive: true });
  const shared = await import(pathToFileURL(path.join(root, 'electron', 'exam-ai-shared.mjs')).href);
  const reportFixture = { version: 1, id: 'polish-ai-report', examKey: shared.examReportKey(exam), createdAt: new Date().toISOString(), promptVersion: shared.PROMPT_VERSION, fingerprint: shared.examSnapshotFingerprint(exam), contextHash: shared.examContextHash(shared.DEFAULT_EXAM_AI_CONFIG), config: shared.DEFAULT_EXAM_AI_CONFIG, snapshot: shared.snapshotExam(exam), model: { name: 'deterministic-local-fixture', endpoint: 'mock://no-network' }, requestCount: 1, cacheHits: 0, checkedImageQuestionIds: [], summary: '隔离回归：切换分析标签后任务仍然完成。', recommendations: [], findings: [], questionReviews: exam.sections[0].questions.map(q => ({ questionId: q.id, knowledge: ['函数与运算'], estimatedDifficulty: 'easy', rationale: '仅测试本地界面状态。', answerCheck: 'not_checked', visualCheck: 'not_checked' })) };
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const buildFile = path.join(root, packaged ? 'release/win-unpacked/resources/app.asar' : 'dist/index.html');
  const build = { file: buildFile, sha256: crypto.createHash('sha256').update(fs.readFileSync(buildFile)).digest('hex'), modified: fs.statSync(buildFile).mtime.toISOString() };
  let app, page, stage = 'launch', report, rendererRequests = 0;
  const errors = [], checks = [], motion = {}, appearances = [], screenshots = [];
  const progress = name => { stage = name; console.log(JSON.stringify({ progress: name, packaged })); };
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`UI polish QA timed out at ${stage}`); process.exit(1); }, 180000);
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env, timeout: 30000 });
    await app.evaluate(({ BrowserWindow, ipcMain, session }, fixture) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.setContentSize(1280, 800); win.showInactive();
      globalThis.__polish = { network: 0, aiCalls: 0, aiCancels: 0, ocrCancels: 0, completed: 0, reports: [] };
      globalThis.fetch = () => { globalThis.__polish.network++; throw Error('HTTP disabled in UI polish regression'); };
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => { globalThis.__polish.network++; cb({ cancel: true }); });
      ipcMain.removeHandler('model:get'); ipcMain.handle('model:get', () => ({ model: 'deterministic-local-fixture', hasKey: true }));
      ipcMain.removeHandler('model:cancel'); ipcMain.handle('model:cancel', () => { globalThis.__polish.ocrCancels++; });
      ipcMain.removeHandler('exam:reports'); ipcMain.handle('exam:reports', () => globalThis.__polish.reports);
      ipcMain.removeHandler('exam:cancel'); ipcMain.handle('exam:cancel', () => { globalThis.__polish.aiCancels++; });
      ipcMain.removeHandler('exam:analyze'); ipcMain.handle('exam:analyze', async (_event, input) => {
        globalThis.__polish.aiCalls++;
        if (!input.taskId || input.expectedFingerprint !== fixture.fingerprint) throw Error('Invalid synthetic analysis input');
        await new Promise(resolve => setTimeout(resolve, 2200));
        const report = { ...fixture, config: input.config, fingerprint: input.expectedFingerprint };
        globalThis.__polish.reports.unshift(report); globalThis.__polish.completed++;
        return report;
      });
    }, reportFixture);
    page = await app.firstWindow(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:\/\//, route => { rendererRequests++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(async questions => { await window.juanye.bankSave({ questions, origin: { examTitle: '120 题分页隔离检查', examId: 'polish-fixture' } }); }, Array.from({ length: 120 }, (_, i) => question(i + 1)));
    assert.equal((await page.evaluate(() => window.juanye.bankLoad())).entries.length, 120, 'Heavy bank fixture did not persist all 120 questions');
    const nav = name => page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name, exact: true });
    const bank = () => page.getByTestId('bank-workspace');
    const rows = () => bank().getByTestId('bank-entry');
    const analysis = () => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '试卷分析与双向细目表', exact: true }) });
    const probes = { exam: '[data-workspace-view="exam"]', bank: '[data-workspace-view="bank"]' };
    const shot = async name => { await page.mouse.move(3, 3); await pause(300); const file = `${name}.png`; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file); };
    const applyAppearance = async item => {
      // Use the public controls. The theme-id storage listener is scoped to the
      // mounted gallery; dispatching storage events with settings closed can
      // silently test the previous palette twenty times.
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const settings = page.getByRole('dialog');
      await settings.getByRole('button', { name: '外观', exact: true }).click();
      await settings.locator('label').filter({ has: page.locator(`input[name="juanye-appearance"][value="${item.mode}"]`) }).click();
      if (item.mode === 'telegram') {
        await settings.getByRole('group', { name: 'Telegram 明暗模式', exact: true }).getByRole('tab', { name: item.scheme === 'light' ? '浅色' : '深色', exact: true }).click();
        await settings.locator('label').filter({ has: page.locator(`input[name="juanye-telegram-theme"][value="${item.id || 'ember'}"]`) }).click();
      }
      await settings.getByRole('button', { name: '关闭', exact: true }).click();
      // Theme color transitions are intentionally animated. Contrast is an
      // at-rest property, not the interpolation between a dark and light palette.
      await page.evaluate(() => document.fonts.ready); await pause(300);
    };

    progress('120 questions: bounded page rendering, bank card and favorite layout');
    await nav('本地题库').click(); await bank().waitFor();
    await until(async () => await rows().count() === 25 && await bank().getByTestId('bank-question-list').getAttribute('aria-busy') === 'false', '120-question fixture did not settle on a 25-question page');
    await pause(600);
    const pagination = { first: await bank().evaluate(el => ({ rows: el.querySelectorAll('[data-testid="bank-entry"]').length, nodes: el.querySelectorAll('*').length, height: el.clientHeight, width: el.clientWidth })) };
    assert.equal(pagination.first.rows, 25); assert.ok(pagination.first.nodes < 12000, `Bank DOM is not bounded: ${pagination.first.nodes}`);
    await bank().getByRole('button', { name: '题库下一页', exact: true }).click(); await pause(650);
    pagination.second = await bank().evaluate(el => ({ rows: el.querySelectorAll('[data-testid="bank-entry"]').length, nodes: el.querySelectorAll('*').length }));
    assert.equal(pagination.second.rows, 25); assert.ok(pagination.second.nodes < 12000, 'Changing pages retained old question cards');
    await bank().getByRole('button', { name: '题库上一页', exact: true }).click(); await pause(650);
    progress('advanced filters animate, expose four selectors and clear without losing search/sort');
    const filterToggle = bank().getByTestId('bank-filter-toggle');
    assert.equal(await filterToggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await bank().locator('.bank-filter-grid').count(), 0, 'Advanced filters should start collapsed');
    motion.filterExpand = await framesFor(filterToggle, { filters: '.bank-advanced-filters' });
    motion.filterHeight = assertIntermediateDimension(motion.filterExpand, 'filters', 'height', 'Advanced-filter expansion');
    assert.equal(await bank().locator('.bank-filter-grid').getByRole('combobox').count(), 4);
    const selectBank = async (label, option) => { await bank().getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click(); };
    await bank().getByRole('textbox', { name: '搜索题库', exact: true }).fill('函数');
    await selectBank('题库排序', '分值从高到低');
    await selectBank('题库知识点', '函数与运算');
    motion.filterCollapse = await framesFor(filterToggle, { filters: '.bank-advanced-filters' });
    assertIntermediateDimension(motion.filterCollapse, 'filters', 'height', 'Advanced-filter collapse');
    await bank().getByRole('button', { name: '移除知识点筛选', exact: true }).waitFor();
    await bank().getByRole('button', { name: '清除筛选', exact: true }).click();
    assert.equal(await bank().getByRole('textbox', { name: '搜索题库', exact: true }).inputValue(), '函数', 'Clear filters erased search query');
    assert.match(await bank().getByRole('combobox', { name: '题库排序', exact: true }).innerText(), /分值从高到低/, 'Clear filters reset sort');
    assert.equal(await bank().getByRole('button', { name: '移除知识点筛选', exact: true }).count(), 0);
    await filterToggle.click(); await bank().getByRole('combobox', { name: '题库知识点', exact: true }).waitFor();
    assert.match(await bank().getByRole('combobox', { name: '题库知识点', exact: true }).innerText(), /全部知识点/);
    await filterToggle.click(); await pause(400);
    await bank().getByRole('textbox', { name: '搜索题库', exact: true }).fill(''); await selectBank('题库排序', '最近添加');
    await until(async () => await rows().count() === 25, 'Cleared filters did not restore paginated questions');
    checks.push('Advanced filters open/close with intermediate height, expose four selectors and clear a real knowledge filter without erasing search or sort');
    await rows().first().getByRole('button', { name: '收藏题目', exact: true }).click();
    await bank().locator('[data-bank-view="favorites"]').click();
    await until(async () => await rows().count() === 1, 'Favorite card not shown');
    assert.equal((await page.evaluate(() => window.juanye.bankLoad())).entries.filter(item => item.favorite).length, 1);
    await bank().locator('[data-bank-view="all"]').click(); await until(async () => await rows().count() === 25, 'All questions not restored');
    checks.push('Real bank IPC persists favorite; 120 bank questions render exactly 25 cards');

    progress('actual workspace animation after lazy loading and repeated navigation');
    motion.toExam = await framesFor(nav('组卷'), probes);
    motion.toExamEvidence = assertRenderedMotion(motion.toExam, ['exam', 'bank'], 'Bank→exam');
    motion.toBank = await framesFor(nav('本地题库'), probes);
    motion.toBankEvidence = assertRenderedMotion(motion.toBank, ['exam', 'bank'], 'Exam→bank revisit');
    const frameGaps = motion.toBank.slice(1).map((frame, i) => frame.time - motion.toBank[i].time).sort((a, b) => a - b);
    assert.ok(frameGaps.length >= 12, 'Insufficient rAF progress while animating 120-question bank');
    const frameP95 = frameGaps[Math.floor(frameGaps.length * 0.95)];
    assert.ok(frameP95 < 150, `Workspace animation frame p95 regressed beyond 150ms: ${frameP95}`);
    checks.push('Loaded workspace revisits have real intermediate rendered frames; rAF p95 stays below 150ms');

    progress('detail width and basket height animate through intermediate geometry');
    // The same grid slot may contain its full pane or its collapsed rail; measure
    // its actual occupied width rather than requiring one React mount strategy.
    const detailProbe = { detail: '.bank-detail-pane, .bank-detail-rail', layout: '.bank-workspace-layout' };
    motion.detailCollapse = await framesFor(bank().locator('.bank-catalog-heading').getByRole('button', { name: '收起题目详情', exact: true }), detailProbe);
    motion.detailWidth = assertIntermediateDimension(motion.detailCollapse, 'detail', 'width', 'Detail collapse');
    await bank().getByRole('button', { name: /^展开题目详情和选题篮/ }).click(); await pause(650);
    for (let i = 0; i < 3; i++) await rows().nth(i).getByRole('button', { name: '选题', exact: true }).click();
    const basketHeading = bank().getByTestId('bank-basket').locator('.bank-basket-heading');
    await pause(350);
    motion.basketCollapse = await framesFor(basketHeading, { basket: '.bank-basket' });
    motion.basketHeight = assertIntermediateDimension(motion.basketCollapse, 'basket', 'height', 'Basket collapse');
    motion.basketExpand = await framesFor(basketHeading, { basket: '.bank-basket' });
    assertIntermediateDimension(motion.basketExpand, 'basket', 'height', 'Basket expansion');
    checks.push('Detail collapse has intermediate width; basket collapse/expand has intermediate height');

    progress('bank editing retains normal usable width at 1280px');
    await bank().getByRole('button', { name: '新建题目', exact: true }).click();
    const editor = bank().getByTestId('bank-question-editor'); await editor.waitFor(); await pause(500);
    const editorGeometry = await editor.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, width: r.width, right: r.right, scroll: el.scrollWidth, client: el.clientWidth, viewport: innerWidth }; });
    assert.ok(editorGeometry.width >= 650, `Bank authoring remains cramped: ${JSON.stringify(editorGeometry)}`);
    assert.ok(editorGeometry.right <= editorGeometry.viewport + 1 && editorGeometry.scroll <= editorGeometry.client + 1, 'Bank editor overflows');
    await editor.getByPlaceholder('输入题干…', { exact: true }).fill('未保存题库草稿：$x+1=3$');
    await shot('bank-editor-1280');
    await nav('组卷').click(); await nav('本地题库').click(); await editor.waitFor();
    assert.equal(await editor.getByPlaceholder('输入题干…', { exact: true }).inputValue(), '未保存题库草稿：$x+1=3$');
    await bank().locator('.bank-edit-footer').getByRole('button', { name: '取消', exact: true }).click(); await pause(400);
    checks.push('1280px bank editing width ≥650px; unsaved bank draft survives workspace navigation');

    progress('20 appearance computed contrast/overflow checks, four base-mode screenshots');
    const variants = [{ mode: 'dark' }, { mode: 'light' }, ...themes.flatMap(id => [{ mode: 'telegram', scheme: 'dark', id }, { mode: 'telegram', scheme: 'light', id }])];
    for (const item of variants) {
      await applyAppearance(item);
      const appearance = await bank().evaluate(el => {
        const rgba = color => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
        const over = (a, b) => { const alpha = a[3] + b[3] * (1 - a[3]); return [0, 1, 2].map(i => alpha ? (a[i] * a[3] + b[i] * b[3] * (1 - a[3])) / alpha : 0).concat(alpha); };
        const background = node => { const chain = []; for (let n = node; n instanceof Element; n = n.parentElement) chain.unshift(n); return chain.reduce((color, n) => over(rgba(getComputedStyle(n).backgroundColor), color), [255, 255, 255, 1]); };
        const lum = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const samples = ['.bank-catalog-heading h2', '.bank-entry-stem', '.bank-nav-item[data-active="true"]', '.bank-entry-bottom > span'].map(selector => {
          const node = el.querySelector(selector); if (!node) return { selector, missing: true };
          const bg = background(node), fg = over(rgba(getComputedStyle(node).color), bg), a = lum(fg), b = lum(bg);
          return { selector, foreground: fg, background: bg, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), minimum: selector.endsWith('> span') ? 3 : 4.5 };
        });
        const selectors = ['.bank-library-sidebar', '.bank-catalog', '.bank-detail-pane', '.bank-entry', '.bank-basket'];
        const overflow = selectors.flatMap(selector => [...el.querySelectorAll(selector)].flatMap(node => { const r = node.getBoundingClientRect(); return r.width > 0 && (node.scrollWidth > node.clientWidth + 2 || r.left < -1 || r.right > innerWidth + 1) ? [{ selector, width: r.width, client: node.clientWidth, scroll: node.scrollWidth, left: r.left, right: r.right }] : []; }));
        return { theme: document.documentElement.dataset.theme, scheme: document.documentElement.dataset.telegramScheme, themeId: document.documentElement.dataset.telegramTheme, accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(), samples, overflow, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert.equal(appearance.theme, item.mode); if (item.mode === 'telegram') { assert.equal(appearance.scheme, item.scheme); assert.equal(appearance.themeId, item.id); }
      assert.deepEqual(appearance.overflow, [], `${JSON.stringify(item)} card/control horizontal overflow`); assert.equal(appearance.documentOverflow, false);
      for (const sample of appearance.samples) assert.ok(!sample.missing && sample.contrast >= sample.minimum, `${JSON.stringify(item)} low contrast: ${JSON.stringify(sample)}`);
      appearances.push({ ...item, ...appearance });
      const base = item.mode !== 'telegram' ? item.mode : item.id === 'ember' ? `telegram-${item.scheme}` : null;
      if (base) {
        await shot(`bank-${base}`);
        await bank().locator('[data-bank-view="favorites"]').click(); await until(async () => await rows().count() === 1, 'Favorites failed in theme QA'); await shot(`favorites-${base}`);
        await bank().locator('[data-bank-view="all"]').click(); await until(async () => await rows().count() === 25, 'All cards failed in theme QA');
      }
    }
    for (const width of [1000, 1280, 1500]) {
      await page.setViewportSize({ width, height: 800 }); await pause(100);
      const bounds = await bank().evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, right: el.getBoundingClientRect().right, viewport: innerWidth }));
      assert.ok(bounds.scroll <= bounds.width + 1 && bounds.right <= bounds.viewport + 1, `Bank overflows at ${width}: ${JSON.stringify(bounds)}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    pagination.final = await bank().evaluate(el => ({ rows: el.querySelectorAll('[data-testid="bank-entry"]').length, nodes: el.querySelectorAll('*').length }));
    assert.equal(pagination.final.rows, 25); assert.ok(pagination.final.nodes < Math.max(pagination.first.nodes * 1.35, pagination.first.nodes + 1000), 'Repeated theme/view navigation retained excessive bank DOM');
    checks.push('All 20 appearances pass computed text contrast and horizontal bounds; four base appearances captured in all/favorite views');

    progress('AI tab has actual rendered transition; running task survives tab navigation');
    await applyAppearance({ mode: 'telegram', scheme: 'dark', id: 'ember' });
    await nav('组卷').click(); await nav('试卷分析').click(); await analysis().waitFor(); await pause(400);
    motion.aiTab = await framesFor(analysis().getByRole('tab', { name: 'AI 评估', exact: true }), { panel: '.exam-tools-scroll', ai: '.exam-ai-panel', tab: '.exam-analysis-tabs [aria-selected="true"]' });
    motion.aiTabEvidence = assertRenderedMotion(motion.aiTab, ['ai'], 'Analysis AI tab');
    await analysis().getByRole('button', { name: '预览并确认发送', exact: true }).click();
    assert.equal(await app.evaluate(() => globalThis.__polish.aiCalls), 0, 'Model request occurred before confirmation');
    await analysis().getByRole('button', { name: '确认并开始分析', exact: true }).click();
    await until(async () => await app.evaluate(() => globalThis.__polish.aiCalls) === 1, 'Synthetic AI request did not reach main IPC');
    await analysis().getByRole('tab', { name: '本地统计', exact: true }).click(); await pause(150);
    await analysis().getByRole('tab', { name: '双向细目表', exact: true }).click(); await pause(150);
    await analysis().getByRole('tab', { name: 'AI 评估', exact: true }).click();
    assert.equal(await app.evaluate(() => globalThis.__polish.aiCancels), 0, 'Navigating analysis tabs cancelled the active task');
    await analysis().getByText(reportFixture.summary, { exact: true }).waitFor();
    const aiCounters = await app.evaluate(() => ({ calls: globalThis.__polish.aiCalls, cancelled: globalThis.__polish.aiCancels, completed: globalThis.__polish.completed, ocrCancels: globalThis.__polish.ocrCancels }));
    assert.deepEqual(aiCounters, { calls: 1, cancelled: 0, completed: 1, ocrCancels: 0 });
    await shot('analysis-ai-complete');
    await analysis().getByRole('button', { name: '关闭试卷分析', exact: true }).click(); await pause(350);
    checks.push('Analysis AI tab has real intermediate rendered states; one mock IPC task survives tab navigation and completes without cancellation or HTTP');

    progress('export center format transition and bounds');
    await page.getByRole('button', { name: '导出中心', exact: true }).click();
    const center = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '导出', exact: true }) }); await center.waitFor(); await pause(700);
    motion.exportFormat = await framesFor(center.getByRole('button', { name: /Word.*可编辑文字/ }), { options: '.export-options', center: '.export-center-body', format: '.export-format-options' });
    motion.exportEvidence = assertRenderedMotion(motion.exportFormat, ['format'], 'Export format');
    const exportBounds = await center.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, right: el.getBoundingClientRect().right, viewport: innerWidth }));
    assert.ok(exportBounds.scroll <= exportBounds.width + 1 && exportBounds.right <= exportBounds.viewport + 1, 'Export dialog overflows');
    await shot('export-center-word'); await center.getByRole('button', { name: '取消', exact: true }).click(); await pause(350);
    checks.push('Export format transition has intermediate rendered frames and stays inside viewport');

    progress('system and explicit reduced-motion preferences');
    for (const mode of ['system', 'setting']) {
      if (mode === 'system') { await page.emulateMedia({ reducedMotion: 'reduce' }); await pause(100); }
      else {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.getByRole('button', { name: '设置', exact: true }).click();
        const settings = page.getByRole('dialog'); await settings.getByRole('button', { name: '外观', exact: true }).click();
        await settings.getByRole('tab', { name: '减弱', exact: true }).click();
        await settings.getByRole('button', { name: '关闭', exact: true }).click(); await pause(350);
        assert.equal(await page.locator('[data-interface-motion]').getAttribute('data-interface-motion'), 'reduced');
      }
      const frames = await framesFor(nav('本地题库'), probes);
      motion[`reduced-${mode}`] = { frames };
      for (const name of ['exam', 'bank']) {
        const positions = frames.map(frame => frame.nodes[name]).filter(value => value && value.width > 0).map(value => value.x);
        assert.ok(!positions.length || Math.max(...positions) - Math.min(...positions) < 1, `${mode} reduced-motion still translates ${name} workspace: x ${Math.min(...positions)}–${Math.max(...positions)}`);
      }
      const wallpaper = await page.locator('.workspace-wallpaper').evaluate(el => { const style = getComputedStyle(el, '::before'); return { animation: style.animationName, duration: style.animationDuration }; });
      assert.ok(wallpaper.animation === 'none' || wallpaper.duration.split(',').every(value => parseFloat(value) <= .00002), `${mode} reduced-motion retains looping wallpaper: ${JSON.stringify(wallpaper)}`);
      motion[`reduced-${mode}`] = { frames, wallpaper };
      await nav('组卷').click(); await pause(300);
    }
    checks.push('OS and in-app reduced-motion stop workspace spatial movement and looping wallpaper');
    assert.deepEqual((await page.evaluate(() => window.juanye.loadDraft())).exam, exam, 'UI QA changed the paper');
    const requests = await app.evaluate(() => globalThis.__polish.network); assert.equal(requests + rendererRequests, 0, 'UI QA attempted HTTP'); assert.deepEqual(errors, []);
    report = { passed: true, packaged, build, checks, pagination, frameP95Ms: frameP95, editorGeometry, appearances, aiCounters, exportBounds, motion: Object.fromEntries(Object.entries(motion).map(([key, value]) => [key, Array.isArray(value) ? compact(value) : value])), screenshots, externalRequests: requests + rendererRequests, paidModelCalls: 0, rendererErrors: errors, profile, note: 'Offscreen inactive Electron window with throttling disabled; frame samples validate actual renderer animation, not visible-desktop FPS. Temporary synthetic profile retained for diagnosis.' };
    console.log(JSON.stringify({ passed: true, packaged, checks, screenshots, appearances: appearances.length, frameP95Ms: frameP95, aiCounters, externalRequests: 0 }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    report = { passed: false, packaged, build, stage, error: error.stack || String(error), checks, rendererErrors: errors, appearances, motion, screenshots, profile };
    console.error(JSON.stringify({ passed: false, packaged, stage, error: report.error, checks, rendererErrors: errors, screenshots, profile }, null, 2)); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
