/* Local-only UI QA: synthetic draft, isolated temporary userData, no real account or cloud calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const railOnly = process.argv.includes('--rail-only');
const suffix = packaged ? 'packaged' : 'source';
const output = path.join(root, 'artifacts/qa-v021');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const themeIds = ['ocean', 'spring', 'frost', 'gem', 'classroom', 'blossom', 'dusk', 'ember', 'neon'];
async function until(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(50); }
  throw new Error(message);
}
async function inspectRail(sidebar) {
  return sidebar.evaluate(el => {
    const rail = el.querySelector('.sidebar-rail');
    const wrapper = rail.querySelector('[data-question-type]')?.parentElement;
    const describe = node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { tag: node.tagName, class: node.className, x: rect.x, y: rect.y, width: rect.width, height: rect.height, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop, cssHeight: style.height, flex: style.flex, minHeight: style.minHeight, overflowY: style.overflowY };
    };
    const buttons = [...rail.querySelectorAll('[data-question-type]')].map(node => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[data-question-type]') === node;
      return { ...describe(node), hit };
    });
    return { state: el.dataset.sidebarState, aside: describe(el), parent: describe(el.parentElement), rail: describe(rail), wrapper: wrapper ? describe(wrapper) : null, buttons };
  });
}
const assertRail = rail => {
  assert.ok(rail.wrapper && rail.wrapper.height >= 40, 'Collapsed sidebar icon container has collapsed below one button height');
  assert.ok(rail.buttons.some(button => button.hit), 'Collapsed rail has no visible, hittable question-type buttons');
};

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-controls-theme-qa-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const question = (id, type, stem) => ({ id, type, stem, score: type === 'essay' ? 12 : 5, options: type === 'single' ? ['$1$', '$2$', '$3$', '$4$'] : [], answer: [], analysis: '' });
  const sections = [
    { id: 'qa-s1', type: 'single', title: '单项选择题', note: '', questions: [question('qa-q1', 'single', '已知函数 $f(x)=x^2$，则 $f(2)$ 的值为'), question('qa-q2', 'single', '若集合 $A=\\{1,2\\}$，则下列结论正确的是')] },
    { id: 'qa-s2', type: 'essay', title: '解答题', note: '', questions: [question('qa-q3', 'essay', '已知函数 $f(x)=x^2-2x$。\n(1) 求函数的最小值；\n(2) 求 $f(x)\\le0$ 的解集。')] },
    ...Array.from({ length: 6 }, (_, index) => ({ id: `qa-extra-${index}`, type: 'blank', title: `附加大题 ${index + 3}`, note: '', questions: [] })),
  ];
  const exam = { title: '主题与控件 · 隔离示例', subtitle: '本地测试', duration: 120, notice: [], sections };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: true, answerMode: 'none' };
  fs.writeFileSync(path.join(userData, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(output, { recursive: true });
  let app, page, stage = 'launch', rendererRequests = 0, timedOut = false;
  const errors = [], checks = [], geometries = [], colors = [];
  const screenshots = [];
  const progress = name => { stage = name; console.log(JSON.stringify({ progress: name })); };
  const deadlineMs = railOnly ? 30000 : 180000;
  const timer = setTimeout(() => { timedOut = true; console.error(JSON.stringify({ passed: false, stage, error: `UI QA exceeded ${deadlineMs / 1000} seconds` })); try { app?.process().kill(); } catch {} process.exitCode = 1; }, deadlineMs);
  const screenshot = async name => {
    await page.mouse.move(5, 5);
    await pause(750);
    const filename = `${name}-${suffix}.png`;
    await page.screenshot({ path: path.join(output, filename) }); screenshots.push(filename);
  };
  const sidebar = () => page.getByRole('complementary', { name: '试卷目录', exact: true });
  const batch = () => page.getByRole('dialog', { name: /^批量属性/ });
  const menu = () => page.getByRole('listbox');
  async function waitMenuClosed() { await until(async () => await menu().count() === 0, 'Select menu did not close'); }
  async function openSettings() {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '外观', exact: true }).click();
    await dialog.getByText('界面模式', { exact: true }).waitFor();
    return dialog;
  }
  async function appearance(mode) {
    const dialog = await openSettings();
    await dialog.locator('label').filter({ has: page.locator(`input[name="juanye-appearance"][value="${mode}"]`) }).click();
    await until(async () => await page.evaluate(() => document.documentElement.dataset.theme) === mode, `Theme did not become ${mode}`);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await pause(300);
  }
  async function assertPaper() {
    const state = await page.locator('.paper[data-sheet]').first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    assert.equal(state.background, 'rgb(255, 255, 255)', 'Theme changed the printed paper background');
    assert.ok(state.color !== 'rgb(255, 255, 255)', 'Theme made printed text white');
  }
  async function menuGeometry(label) {
    const geometry = await menu().evaluate(el => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      const visible = [...el.querySelectorAll('[role=option]')].find(option => { const r = option.getBoundingClientRect(); return r.height > 0 && r.top >= rect.top && r.bottom <= rect.bottom; });
      const r = visible?.getBoundingClientRect();
      const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return { viewport: { width: innerWidth, height: innerHeight }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }, bodyPortal: el.parentElement === document.body, radius: parseFloat(style.borderRadius), background: style.backgroundColor, hit: Boolean(hit && el.contains(hit)), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    assert.ok(geometry.rect.x >= 0 && geometry.rect.y >= 0 && geometry.rect.right <= geometry.viewport.width + 1 && geometry.rect.bottom <= geometry.viewport.height + 1, `${label}: menu extends beyond window`);
    assert.ok(geometry.bodyPortal && geometry.hit, `${label}: menu is clipped or unclickable`);
    assert.ok(geometry.radius >= 8, `${label}: menu is not rounded`);
    geometries.push({ label, ...geometry });
    return geometry;
  }
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env, timeout: 30000 });
    await app.evaluate(({ session, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (typeof window?.webContents.setBackgroundThrottling === 'function') window.webContents.setBackgroundThrottling(false);
      globalThis.__controlsThemeRequests = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__controlsThemeRequests++; callback({ cancel: true }); });
    });
    page = await app.firstWindow(); page.setDefaultTimeout(9000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { rendererRequests++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForSelector('textarea');
    await page.evaluate(() => { localStorage.setItem('juanye.appearance.v1', 'telegram'); localStorage.setItem('juanye.sidebar-expanded.v1', 'true'); });
    await page.reload(); await page.waitForSelector('textarea');
    if (railOnly) {
      progress('collapsed rail only; full controls/theme checks are not repeated');
      await sidebar().getByRole('button', { name: '收起试卷目录', exact: true }).click();
      await until(async () => Math.abs((await sidebar().boundingBox()).width - 76) < 1, 'Sidebar collapsed animation did not settle at 76px', 12000);
      const rail = await inspectRail(sidebar());
      await screenshot('telegram-workspace');
      fs.writeFileSync(path.join(output, `rail-results-${suffix}.json`), JSON.stringify({ railOnly: true, packaged, rail }, null, 2));
      assertRail(rail);
      assert.deepEqual(errors, []);
      assert.equal(rendererRequests + await app.evaluate(() => globalThis.__controlsThemeRequests), 0);
      assert.equal(timedOut, false, 'Rail QA exceeded its deadline');
      console.log(JSON.stringify({ passed: true, railOnly: true, packaged, rail, cloudRequests: 0 }));
      return;
    }
    progress('nine dark Telegram themes and persistence');
    const settings = await openSettings();
    assert.equal(await settings.locator('[data-telegram-gallery] input[name="juanye-telegram-theme"]').count(), 9, 'Telegram gallery does not contain nine actual theme choices');
    for (const id of themeIds) {
      await settings.locator('label').filter({ has: page.locator(`input[name="juanye-telegram-theme"][value="${id}"]`) }).click();
      await until(async () => await page.evaluate(() => document.documentElement.dataset.telegramTheme) === id, `Theme card ${id} did not apply`);
      colors.push(await page.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue('--accent-fill').trim(), getComputedStyle(document.documentElement).getPropertyValue('--accent-fill-2').trim()]));
    }
    assert.equal(new Set(colors.map(color => color.join('|'))).size, 9, 'Some theme cards have identical accent palettes');
    await settings.locator('label').filter({ has: page.locator('input[name="juanye-telegram-theme"][value="ember"]') }).click();
    await settings.locator('[data-telegram-gallery]').scrollIntoViewIfNeeded();
    await screenshot('telegram-theme-gallery');
    await settings.getByRole('button', { name: '关闭', exact: true }).click(); await pause(300);
    await assertPaper();
    const dark = await page.evaluate(() => {
      const rgba = color => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
      return { mode: document.documentElement.dataset.theme, selected: localStorage.getItem('juanye.telegram-theme.v1'), scheme: document.documentElement.style.colorScheme, app: rgba(getComputedStyle(document.querySelector('.app-bg')).backgroundColor), pattern: getComputedStyle(document.querySelector('.canvas-dots')).backgroundImage };
    });
    assert.equal(dark.mode, 'telegram'); assert.equal(dark.selected, 'ember'); assert.equal(dark.scheme, 'dark');
    assert.ok(Math.max(...dark.app.slice(0, 3)) < 55 && dark.app[3] === 255, 'Telegram interface is not opaque dark');
    assert.notEqual(dark.pattern, 'none');
    await page.reload(); await page.waitForSelector('textarea');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.telegramTheme), 'ember');
    assert.equal((await page.evaluate(() => window.juanye.loadDraft())).exam.title, exam.title);
    assert.equal((await page.evaluate(() => window.juanye.loadDraft())).exam.sections.flatMap(section => section.questions).length, 3);
    const native = await app.evaluate(({ BrowserWindow }) => ({ background: BrowserWindow.getAllWindows()[0].getBackgroundColor(), opacity: BrowserWindow.getAllWindows()[0].getOpacity() }));
    assert.equal(native.background.slice(-6).toLowerCase(), '0b0e13'); assert.equal(native.opacity, 1);
    checks.push('Nine distinct Telegram palettes; dark opaque host; theme persists without changing draft or white paper');
    progress('rounded portal dropdowns and keyboard');
    await sidebar().getByRole('button', { name: '批量编辑', exact: true }).click();
    await batch().getByText('批量属性 · 0 题', { exact: true }).waitFor();
    assert.ok((await batch().boundingBox()).width <= 349, 'Batch sheet exceeds its intended width');
    const overflow = await batch().evaluate(el => {
      const rect = el.getBoundingClientRect();
      return [...el.querySelectorAll('button,input,textarea')].flatMap(control => {
        const bounds = control.getBoundingClientRect();
        return bounds.width > 0 && (bounds.left < rect.left + 1 || bounds.right > rect.right - 1) ? [{ label: control.getAttribute('aria-label') || control.textContent?.trim(), x: bounds.x, right: bounds.right }] : [];
      });
    });
    assert.deepEqual(overflow, [], 'Batch inputs or apply buttons overflow the sheet');
    const answer = batch().getByRole('combobox', { name: '批量作答区', exact: true });
    await answer.focus(); await answer.press('Space'); await menu().waitFor();
    await answer.press('ArrowDown'); await answer.press('Enter'); await waitMenuClosed();
    assert.match(await answer.innerText(), /四分之一页/);
    await answer.press('Space'); await answer.press('Home'); await answer.press('End'); await answer.press('Enter');
    await waitMenuClosed(); assert.match(await answer.innerText(), /整页/);
    await answer.press('Space'); await menu().waitFor(); await answer.press('Escape'); await waitMenuClosed();
    assert.equal(await batch().count(), 1, 'Escape closed the batch sheet rather than only the select');
    assert.equal(await answer.evaluate(el => el === document.activeElement), true, 'Escape failed to return focus to combobox');
    await answer.press('Space'); await menu().waitFor(); await menuGeometry('Telegram answer-space menu');
    await screenshot('telegram-batch-dropdown');
    await answer.press('Tab'); await waitMenuClosed();
    await answer.click(); await menu().waitFor();
    await batch().getByRole('heading', { name: '批量属性 · 0 题', exact: true }).click(); await waitMenuClosed();
    assert.equal(await batch().count(), 1, 'Outside click unexpectedly closed the parent sheet');
    const target = batch().getByRole('combobox', { name: '批量目标大题', exact: true });
    await target.click(); await menu().waitFor();
    const longList = await menuGeometry('Long target-section menu'); assert.ok(longList.scrollHeight > longList.clientHeight, 'Long option list cannot scroll');
    await target.press('End'); await target.press('Enter'); await waitMenuClosed();
    assert.match(await target.innerText(), /附加大题 8/);
    checks.push('Custom dropdown works with zero selected questions, keyboard selection, Home/End, Escape, Tab, viewport placement, scrolling and portal hit-testing');
    progress('checkbox and partial selection states');
    const all = batch().getByRole('checkbox', { name: '全选', exact: true });
    assert.equal(await all.getAttribute('aria-checked'), 'false');
    const firstQuestion = sidebar().locator('[data-question-id="qa-q1"]').getByRole('checkbox');
    await firstQuestion.click();
    assert.equal(await firstQuestion.getAttribute('aria-checked'), 'true');
    assert.equal(await all.getAttribute('aria-checked'), 'mixed');
    const sectionToggle = sidebar().locator('[data-section-id="qa-s1"]').getByRole('checkbox', { name: '选择本大题', exact: true });
    assert.equal(await sectionToggle.getAttribute('aria-checked'), 'mixed');
    await answer.click(); await menu().waitFor();
    await screenshot('telegram-batch-checked-dropdown');
    await answer.press('Escape'); await waitMenuClosed();
    await all.click(); assert.equal(await all.getAttribute('aria-checked'), 'true');
    await all.press('Space'); assert.equal(await all.getAttribute('aria-checked'), 'false');
    await firstQuestion.focus(); await firstQuestion.press('Enter');
    assert.equal(await all.getAttribute('aria-checked'), 'mixed');
    assert.ok(await sidebar().locator('[data-checked="mixed"]').count(), 'Mixed check has no visible indicator');
    await batch().getByRole('button', { name: '完成', exact: true }).click();
    checks.push('Styled checkbox exposes checked, unchecked and mixed state; pointer/Space/Enter operations work');
    progress('light and original dark remain usable');
    for (const mode of ['light', 'dark']) {
      await appearance(mode); await assertPaper();
      await sidebar().getByRole('button', { name: '批量编辑', exact: true }).click();
      const select = batch().getByRole('combobox', { name: '批量题型', exact: true });
      await select.click(); await menu().waitFor(); await menuGeometry(`${mode} menu`);
      await select.press('Escape'); await waitMenuClosed();
      await batch().getByRole('button', { name: '完成', exact: true }).click();
    }
    await appearance('telegram');
    await sidebar().getByRole('button', { name: '收起试卷目录', exact: true }).click();
    await until(async () => Math.abs((await sidebar().boundingBox()).width - 76) < 1, 'Sidebar collapsed animation did not settle at 76px', 12000);
    const rail = await inspectRail(sidebar());
    geometries.push({ label: 'collapsed sidebar rail', ...rail });
    await screenshot('telegram-workspace');
    if (!rail.wrapper || rail.wrapper.height < 40) {
      console.error(JSON.stringify({ suspectedSidebarBug: rail }));
      throw new Error('Collapsed sidebar icon container has collapsed below one button height');
    }
    assertRail(rail);
    checks.push('Original light and dark themes keep styled controls and white paper');
    assert.deepEqual(errors, []);
    const requests = rendererRequests + await app.evaluate(() => globalThis.__controlsThemeRequests);
    assert.equal(requests, 0, 'UI QA attempted an external request');
    assert.equal(timedOut, false, 'UI QA exceeded its deadline');
    const report = { passed: true, packaged, checks, errors, cloudRequests: requests, screenshotsAreIsolatedRendererOnly: true, screenshots, geometries, native, colors };
    fs.writeFileSync(path.join(output, `results-${suffix}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = { passed: false, packaged, stage, error: String(error), errors, checks, geometries, timingOnly: timedOut };
    fs.writeFileSync(path.join(output, `${railOnly ? 'rail-results' : 'results'}-${suffix}.json`), JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report)); throw error;
  } finally {
    clearTimeout(timer); if (app) await app.close();
    const resolved = fs.realpathSync(userData);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-controls-theme-qa-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
