/* Own-window UI QA only: isolated dummy exam, temporary userData, no accounts or cloud calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const screensOnly = process.argv.includes('--screens-only');
const noScreenshots = process.argv.includes('--no-screenshots');
const suffix = packaged ? 'packaged' : 'source';
const artifacts = path.join(root, 'artifacts/qa-v012');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(40); }
  throw new Error(message);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-sidebar-regression-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const sections = [
    { id: 'qa-single', type: 'single', title: '单项选择题', note: '', questions: [] },
    { id: 'qa-multi', type: 'multi', title: '多项选择题', note: '', questions: [] },
    { id: 'qa-blank', type: 'blank', title: '填空题', note: '', questions: [] },
    { id: 'qa-essay', type: 'essay', title: '解答题', note: '', questions: [] },
  ];
  if (screensOnly) {
    sections[2].questions = [{ id: 'qa-shot-blank', type: 'blank', score: 5, stem: '若 $x+1=3$，则 $x=$______。', options: [], answer: [], analysis: '' }];
    sections[3].questions = [
      { id: 'qa-shot-essay-one', type: 'essay', score: 12, stem: '已知函数 $f(x)=x^2-2x$。\n(1) 求函数的最小值；\n(2) 求 $f(x)\\le 0$ 的解集。', options: [], answer: [], analysis: '' },
      { id: 'qa-shot-essay-two', type: 'essay', score: 12, stem: '已知数列 $\\{a_n\\}$ 满足 $a_1=1$，$a_{n+1}=a_n+2$。求其通项公式。', options: [], answer: [], analysis: '' },
    ];
  }
  const exam = { title: '侧栏回归 · 隔离测试空卷', subtitle: '不含真实用户数据', duration: 120, notice: [], sections };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 14, fontSize: 9.5, lineHeight: 1.5, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: true };
  fs.writeFileSync(path.join(userData, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(artifacts, { recursive: true });
  let app;
  let page;
  let stage = 'launch';
  const checks = [];
  const screenshots = [];
  const geometries = [];
  const errors = [];
  let externalRequests = 0;
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: stage })); };
  const watchdog = setTimeout(() => {
    try { app?.process().kill(); } catch {}
    console.error(JSON.stringify({ passed: false, stage, error: 'Sidebar regression exceeded 120 seconds' }));
    process.exit(1);
  }, 120000);

  const sidebar = () => page.getByRole('complementary', { name: '试卷目录', exact: true });
  const icon = title => sidebar().getByRole('button', { name: `展开${title}`, exact: true });
  const blankExpand = () => sidebar().getByRole('button', { name: '展开试卷目录', exact: true });
  async function state(expected) {
    await until(async () => await sidebar().getAttribute('data-sidebar-state') === expected, `Sidebar did not become ${expected}`);
    await until(async () => {
      const box = await sidebar().boundingBox();
      return box && (expected === 'collapsed' ? Math.abs(box.width - 76) < 1 : box.width > 300);
    }, `Sidebar ${expected} width did not settle`);
    let previous = null;
    let stable = 0;
    await until(async () => {
      const width = (await sidebar().boundingBox())?.width;
      stable = previous !== null && Math.abs(width - previous) < 0.05 ? stable + 1 : 0;
      previous = width;
      return stable >= 3;
    }, `Sidebar ${expected} animation never settled`);
  }
  async function collapse() {
    if (await sidebar().getAttribute('data-sidebar-state') === 'expanded') await sidebar().getByRole('button', { name: '收起试卷目录', exact: true }).click();
    await state('collapsed');
  }
  async function assertCollapsedActionsAbsent() {
    assert.equal(await sidebar().getByRole('button', { name: '新建题目', exact: true }).count(), 0, 'Collapsed new-question action remains in DOM/focus order');
    assert.equal(await sidebar().getByRole('button', { name: '图片 OCR', exact: true }).count(), 0, 'Collapsed OCR action remains in DOM/focus order');
    const focusableActions = await sidebar().evaluate(el => [...el.querySelectorAll('button,input,a,[tabindex]')].filter(node => /新建题目|图片 OCR/.test(node.getAttribute('aria-label') || node.textContent || '')).length);
    assert.equal(focusableActions, 0, 'Collapsed bottom actions are still keyboard-focusable');
  }
  async function draftWhere(predicate, message) {
    let draft;
    await until(async () => { draft = await page.evaluate(() => window.juanye.loadDraft()); return predicate(draft); }, message);
    return draft;
  }
  async function addQuestion(sectionId, marker) {
    const previous = await page.evaluate(() => window.juanye.loadDraft());
    const previousIds = new Set(previous.exam.sections.flatMap(section => section.questions.map(q => q.id)));
    await sidebar().getByRole('button', { name: '新建题目', exact: true }).click();
    // AnimatePresence briefly retains the outgoing textarea. Wait for the new question/editor first.
    await draftWhere(d => d.exam.sections.find(s => s.id === sectionId)?.questions.some(q => !previousIds.has(q.id)), 'New question was not appended to the chosen section');
    await until(async () => await page.locator('textarea').first().inputValue() === '', 'New question editor did not replace its outgoing textarea');
    await page.locator('textarea').first().fill(marker);
    const draft = await draftWhere(d => d.exam.sections.find(s => s.id === sectionId)?.questions.some(q => q.stem === marker), 'New question did not enter the chosen section');
    return draft.exam.sections.find(s => s.id === sectionId).questions.find(q => q.stem === marker);
  }
  async function viewport(width, height) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
    // Windows can clamp an offscreen native window; emulate the intended renderer viewport explicitly.
    await page.setViewportSize({ width, height });
    await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, { width, height });
    await pause(400);
  }
  async function checkGeometry(label) {
    await visualSettled();
    const geometry = await page.evaluate(() => {
      const side = document.querySelector('[data-sidebar-state]');
      const textarea = document.querySelector('textarea');
      const canvas = document.querySelector('.canvas-dots');
      const rect = el => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null; };
      const actions = [...side.querySelectorAll('button')].filter(b => ['新建题目', '图片 OCR'].includes(b.textContent.trim())).map(b => {
        const r = b.getBoundingClientRect();
        const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { name: b.textContent.trim(), rect: rect(b), hit: at === b || b.contains(at) };
      });
      return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, state: side.dataset.sidebarState, sidebar: rect(side), editor: rect(textarea), preview: rect(canvas), actions };
    });
    assert.ok(geometry.documentWidth <= geometry.width + 1, `${label}: page horizontally overflows`);
    assert.ok(geometry.sidebar.right <= geometry.width, `${label}: sidebar exceeds viewport`);
    assert.ok(geometry.editor && geometry.preview && geometry.editor.right <= geometry.preview.x + 2, `${label}: editor overlaps preview`);
    assert.ok(geometry.editor.x >= geometry.sidebar.right - 2, `${label}: editor overlaps sidebar`);
    assert.ok(geometry.preview.right <= geometry.width + 2, `${label}: preview exceeds the visible viewport`);
    for (const action of geometry.actions) {
      assert.ok(action.hit && action.rect.bottom <= geometry.height + 1 && action.rect.y >= 0, `${label}: bottom action is obstructed`);
    }
    geometries.push({ label, ...geometry });
  }
  async function visualSettled() {
    let previous = '';
    let stable = 0;
    await until(async () => {
      const visual = await page.evaluate(() => {
        const canvas = document.querySelector('.canvas-dots');
        const paper = canvas?.querySelector('[data-sheet]');
        const textarea = document.querySelector('textarea');
        if (!canvas || !paper) return null;
        const c = canvas.getBoundingClientRect();
        const p = paper.getBoundingClientRect();
        let unblurred = true;
        for (let el = textarea; el; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (!['none', 'blur(0px)'].includes(style.filter) || Number(style.opacity) < 0.999) unblurred = false;
        }
        const positions = [c.x, c.width, c.right, p.x, p.width, p.right, textarea?.getBoundingClientRect().x ?? 0].map(n => Math.round(n * 10) / 10);
        return { unblurred, contained: c.right <= innerWidth + 2 && p.left >= c.left + 6 && p.right <= c.right - 6, positions };
      });
      if (!visual?.unblurred || !visual.contained) { stable = 0; return false; }
      const signature = JSON.stringify(visual.positions);
      stable = signature === previous ? stable + 1 : 0;
      previous = signature;
      return stable >= 3;
    }, 'Editor blur or paper-fit/column animation did not settle');
  }
  async function screenshot(name) {
    if (noScreenshots) return;
    await page.evaluate(() => document.fonts.ready);
    await visualSettled();
    const file = `${name}-${suffix}.png`;
    // Playwright captures this isolated renderer only; never the OS desktop or another window.
    await page.screenshot({ path: path.join(artifacts, file), fullPage: false, omitBackground: false });
    screenshots.push(file);
  }
  let report;
  try {
    const timingFlags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: packaged ? path.join(root, 'release/win-unpacked/卷页.exe') : path.join(root, 'node_modules/electron/dist/electron.exe'), args: packaged ? timingFlags : [root, ...timingFlags], env, timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__sidebarRegressionExternalRequests = 0;
      globalThis.fetch = () => { globalThis.__sidebarRegressionExternalRequests++; throw new Error('Network disabled during sidebar regression'); };
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive();
      const setBackgroundColor = win.setBackgroundColor.bind(win);
      globalThis.__sidebarRegressionNativeColors = [];
      win.setBackgroundColor = value => { globalThis.__sidebarRegressionNativeColors.push(String(value).toLowerCase()); return setBackgroundColor(value); };
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { externalRequests++; return route.abort('blockedbyclient'); });
    await sidebar().waitFor();
    await viewport(1440, 900);

    if (screensOnly) {
      progress('stable Telegram screenshots only; no repeated feature/model regression');
      await page.evaluate(() => { localStorage.setItem('juanye.appearance.v1', 'telegram'); localStorage.setItem('juanye.sidebar-expanded.v1', 'false'); });
      await page.reload();
      await sidebar().waitFor();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'telegram' && document.documentElement.dataset.nativeTransparency === 'false');
      await page.getByRole('button', { name: '适应宽度', exact: true }).click();
      for (const [width, height] of [[1440, 900], [1280, 800]]) {
        await viewport(width, height);
        await collapse();
        await pause(1100);
        await checkGeometry(`${width}-telegram-collapsed-stable`);
        await screenshot(`sidebar-${width}-telegram-collapsed-stable`);
        await blankExpand().click();
        await state('expanded');
        await pause(1100);
        await checkGeometry(`${width}-telegram-expanded-stable`);
        await screenshot(`sidebar-${width}-telegram-expanded-stable`);
      }
      report = { passed: true, packaged, screensOnly: true, geometries, screenshots, cloudRequests: 0, screenshotsAreIsolatedRendererOnly: true };
      return;
    }

    progress('empty collapsed rail');
    await state('collapsed');
    await assertCollapsedActionsAbsent();
    for (const section of sections) {
      assert.equal(await icon(section.title).count(), 1, `Missing empty-section icon: ${section.title}`);
      const shape = await icon(section.title).evaluate(el => {
        const r = el.getBoundingClientRect();
        const radius = getComputedStyle(el).borderRadius;
        return { width: r.width, height: r.height, radius };
      });
      assert.ok(Math.abs(shape.width - shape.height) < 1 && shape.width >= 36, 'Section icon is not a useful square/circle target');
      assert.ok(shape.radius.includes('%') || Number.parseFloat(shape.radius) >= shape.width / 2 - 1, 'Section icon is not circular');
    }
    checks.push('Empty exam keeps four circular section icons; collapsed bottom actions absent');
    await screenshot('sidebar-1440-empty-collapsed');

    progress('blank expand and persistence');
    await blankExpand().click();
    await state('expanded');
    assert.equal(await sidebar().getByRole('button', { name: '新建题目', exact: true }).count(), 1);
    assert.equal(await sidebar().getByRole('button', { name: '图片 OCR', exact: true }).count(), 1);
    await page.reload();
    await sidebar().waitFor();
    await state('expanded');
    assert.equal(await page.evaluate(() => localStorage.getItem('juanye.sidebar-expanded.v1')), 'true');
    await collapse();
    await page.reload();
    await sidebar().waitFor();
    await state('collapsed');
    assert.equal(await page.evaluate(() => localStorage.getItem('juanye.sidebar-expanded.v1')), 'false');
    await assertCollapsedActionsAbsent();
    checks.push('Blank area expands; expanded/collapsed state survives reload');

    progress('section targeting, keyboard and editor');
    await icon('填空题').click();
    await state('expanded');
    await addQuestion('qa-blank', 'QA 填空题：$1+1=$______');
    await collapse();
    await icon('解答题').focus();
    await icon('解答题').press('Enter');
    await state('expanded');
    const first = await addQuestion('qa-essay', 'QA 解答题一：证明 $x^2\\ge 0$。');
    const second = await addQuestion('qa-essay', 'QA 解答题二：求 $x+1=2$ 的解。');
    const firstRow = sidebar().locator(`[data-question-id="${first.id}"]`);
    await firstRow.click();
    await until(async () => await page.locator('textarea').first().inputValue() === first.stem, 'Question click did not select its editor');
    checks.push('Icon/Enter expand selected section; new questions target it; row click selects editor');

    progress('drag reorder');
    const secondRow = sidebar().locator(`[data-question-id="${second.id}"]`);
    await firstRow.hover();
    const handle = firstRow.locator('[title="拖动排序"], [aria-label^="拖动第"]').first();
    const from = await handle.boundingBox();
    const to = await secondRow.boundingBox();
    assert.ok(from && to, 'Drag handle is unavailable');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, to.y + to.height - 2, { steps: 16 });
    await page.mouse.up();
    await draftWhere(d => d.exam.sections.find(s => s.id === 'qa-essay')?.questions[0]?.id === second.id, 'Dragging did not persist the new question order');
    checks.push('Question drag reorder persists in its own section');

    progress('expanded OCR entry');
    await sidebar().getByRole('button', { name: '图片 OCR', exact: true }).click();
    const ocrDialog = page.getByRole('dialog');
    await ocrDialog.getByText('识别题目', { exact: true }).waitFor();
    await ocrDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await ocrDialog.waitFor({ state: 'hidden' });
    checks.push('Expanded OCR opens without sending any request');

    progress('viewport geometry');
    await checkGeometry('1440-expanded');
    await screenshot('sidebar-1440-expanded');
    await collapse();
    await checkGeometry('1440-collapsed');
    await viewport(1280, 800);
    await state('collapsed');
    await assertCollapsedActionsAbsent();
    await checkGeometry('1280-collapsed');
    await screenshot('sidebar-1280-collapsed');
    await blankExpand().click();
    await state('expanded');
    await checkGeometry('1280-expanded');
    await screenshot('sidebar-1280-expanded');
    checks.push('1440×900 and 1280×800 have usable non-overlapping panels/actions');

    progress('legacy glass migration and Telegram');
    await page.evaluate(() => { localStorage.setItem('juanye.appearance.v1', 'glass'); localStorage.setItem('juanye.glass-opacity.v1', '0.25'); });
    await page.reload();
    await sidebar().waitFor();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'telegram');
    await page.waitForFunction(() => document.documentElement.dataset.nativeTransparency === 'false');
    await page.waitForSelector('.paper[data-sheet]');
    assert.equal(await page.evaluate(() => localStorage.getItem('juanye.appearance.v1')), 'telegram', 'Legacy glass was not migrated to canonical Telegram');
    assert.equal(await page.evaluate(() => localStorage.getItem('juanye.glass-opacity.v1')), null, 'Legacy opacity preference was not removed');
    const telegram = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, paper: getComputedStyle(document.querySelector('.paper[data-sheet]')).backgroundColor, body: getComputedStyle(document.body).backgroundColor }));
    assert.equal(telegram.paper, 'rgb(255, 255, 255)', 'Telegram theme changed printed paper to a tinted surface');
    const native = await app.evaluate(({ BrowserWindow }) => ({ opacity: BrowserWindow.getAllWindows()[0].getOpacity(), backgroundRgb: BrowserWindow.getAllWindows()[0].getBackgroundColor(), lastBackgroundArgument: globalThis.__sidebarRegressionNativeColors.at(-1), requests: globalThis.__sidebarRegressionExternalRequests }));
    assert.equal(native.opacity, 1, 'Telegram fades the entire native window');
    assert.ok(native.lastBackgroundArgument && native.lastBackgroundArgument !== '#00000000' && native.lastBackgroundArgument !== 'transparent', 'Telegram native window still requests a transparent background');
    assert.equal(native.requests + externalRequests, 0, 'Sidebar regression attempted a network request');
    await screenshot('sidebar-1280-telegram');
    assert.deepEqual(errors, [], 'Renderer produced an unhandled error');
    checks.push('Legacy glass migrates to Telegram; white paper and opaque native window remain');
    report = { passed: true, packaged, checks, geometries, telegram, native, cloudRequests: 0, screenshots, screenshotsAreIsolatedRendererOnly: true };
  } catch (error) {
    report = { passed: false, packaged, stage, error: error.message, checks, geometries, screenshots, cloudRequests: 0 };
    process.exitCode = 1;
  } finally {
    if (app) {
      let timer;
      try { await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('close timeout')), 7000); })]); }
      catch { try { app.process().kill(); } catch {} }
      finally { clearTimeout(timer); }
    }
    clearTimeout(watchdog);
    if (screensOnly && report) {
      fs.writeFileSync(path.join(artifacts, `sidebar-stable-screens-${suffix}.json`), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    }
    if (path.dirname(userData) === os.tmpdir() && path.basename(userData).startsWith('juanye-sidebar-regression-')) fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  if (screensOnly) return;
  fs.writeFileSync(path.join(artifacts, `sidebar-results-${suffix}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
