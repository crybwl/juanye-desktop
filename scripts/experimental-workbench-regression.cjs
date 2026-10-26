/* Focused editor/appearance QA: isolated synthetic draft, zero OCR or external requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const capture = process.argv.includes('--screenshots');
const suffix = packaged ? 'packaged' : 'source';
const out = path.join(root, 'artifacts/qa-experimental-workbench');
const storageKey = 'juanye.experimental-workbench.v1';
const groupNames = ['题目', '答案解析', '题图与绘图', '属性'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6UGkAAAAASUVORK5CYII=';
const stem = '已知 $f(x)=x^2$，则 $f(2)$ 的值是（　　）。\n\n| 条件 | 数值 |\n| --- | --- |\n| 输入 | $2$ |';
const analysis = '代入 $x=2$，得 $f(2)=4$。';
const editedAnalysis = '编辑台校对：由 $f(x)=x^2$，得 $f(2)=4$。';
const pendingDrawing = '\\begin{tikzpicture}\n  \\draw (0,0)--(1,1);\n% 尚未应用的编辑台草稿\n\\end{tikzpicture}';

async function until(predicate, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(50); }
  throw Error(message);
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-workbench-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const exam = {
    title: '卷页 · 编辑台校对', subtitle: '本地隔离样例', duration: 90, notice: [],
    sections: [
      { id: 's1', title: '单项选择题', type: 'single', note: '', questions: [
        { id: 'q1', type: 'single', score: 5, stem, options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis,
          sourceImage: image, figures: [{ id: 'figure1', src: image, layout: 'right', caption: '原始题图' }] },
      ] },
      { id: 's2', title: '填空题', type: 'blank', note: '', questions: [
        { id: 'q2', type: 'blank', score: 5, stem: '若 $x+1=3$，则 $x=$______。', options: [], answer: ['$2$'], analysis: '移项得 $x=2$。' },
      ] },
    ],
  };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(out, { recursive: true });
  let app, page, stage = 'launch';
  const checks = [], errors = [], geometries = [], screenshots = [];
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: value })); };
  const watchdog = setTimeout(() => { try { app?.process().kill(); } catch {} console.error('Workbench QA exceeded 100 seconds'); process.exit(1); }, 100000);
  const editor = () => page.locator('[data-editor-workbench]');
  const tabs = () => editor().getByRole('tablist', { name: '题目编辑分组', exact: true });

  async function settings() {
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '外观', exact: true }).click();
    return dialog;
  }
  async function enable(value) {
    const dialog = await settings();
    const toggle = dialog.getByRole('switch', { name: '实验性题目编辑台', exact: true });
    if ((await toggle.getAttribute('aria-checked') === 'true') !== value) await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), String(value));
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), String(value));
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await until(async () => await editor().getAttribute('data-editor-workbench') === (value ? 'experimental' : 'classic'), 'Editor mode did not follow appearance switch');
  }
  async function group(name) {
    const tab = tabs().getByRole('tab', { name, exact: true });
    await tab.click();
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    const id = await tab.getAttribute('aria-controls');
    assert.ok(id, `No panel relationship for ${name}`);
    const panel = page.locator(`[id="${id}"]`);
    await panel.waitFor({ state: 'visible' });
    assert.equal(await editor().getByRole('tabpanel').count(), 1, 'Hidden groups remain in the accessible panel tree');
    return panel;
  }
  async function draftWhere(predicate, message) {
    let draft;
    await until(async () => { draft = await page.evaluate(() => window.juanye.loadDraft()); return predicate(draft); }, message);
    return draft;
  }
  async function theme(mode, scheme = 'dark') {
    await page.evaluate(({ mode, scheme }) => {
      localStorage.setItem('juanye.appearance.v1', mode);
      localStorage.setItem('juanye.telegram-scheme.v1', scheme);
      window.dispatchEvent(new StorageEvent('storage', { key: 'juanye.telegram-scheme.v1', newValue: scheme }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'juanye.appearance.v1', newValue: mode }));
    }, { mode, scheme });
    await page.waitForFunction(({ mode, scheme }) => document.documentElement.dataset.theme === mode && document.documentElement.style.colorScheme === (mode === 'telegram' ? scheme : mode), { mode, scheme });
  }
  async function geometry(name, width) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 980), width);
    await page.setViewportSize({ width, height: 980 });
    await pause(450);
    const value = await editor().evaluate(el => {
      const box = el.getBoundingClientRect();
      const tablist = el.querySelector('[role="tablist"]');
      const fields = [...el.querySelectorAll('textarea,input,select,[role="combobox"]')].filter(field => field.getClientRects().length && field.type !== 'hidden');
      const overflowingFields = fields.filter(field => { const rect = field.getBoundingClientRect(); return rect.left < box.left - 2 || rect.right > box.right + 2; }).map(field => field.getAttribute('aria-label') || field.placeholder || field.tagName);
      return { width: box.width, client: el.clientWidth, scroll: el.scrollWidth, tabClient: tablist.clientWidth, tabScroll: tablist.scrollWidth, overflowingFields };
    });
    assert.ok(value.scroll <= value.client + 2, `${name}: editor overflows horizontally ${JSON.stringify(value)}`);
    assert.ok(value.tabScroll <= value.tabClient + 2, `${name}: tab strip overflows horizontally`);
    assert.deepEqual(value.overflowingFields, [], `${name}: field escaped editor`);
    geometries.push({ name, viewport: width, ...value });
    const paper = await page.locator('.workspace-preview-stage [data-sheet]').first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    assert.deepEqual(paper, { background: 'rgb(255, 255, 255)', color: 'rgb(22, 23, 26)' });
    assert.ok(await page.locator('.workspace-preview-stage .katex').count());
    assert.equal(await page.locator('.workspace-preview-stage .katex-error').count(), 0);
    assert.ok(await page.locator('.workspace-preview-stage table').count());
  }
  async function screenshot(name) {
    if (!capture) return;
    await page.evaluate(async () => { await document.fonts.ready; document.querySelectorAll('.workspace-editor-stage .overflow-y-auto').forEach(el => el.scrollTo(0, 0)); });
    const target = path.join(out, `${name}-${suffix}.png`);
    const encoded = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
    fs.writeFileSync(target, Buffer.from(encoded, 'base64')); screenshots.push(target);
  }

  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env });
    await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setSize(1500, 980); win.setPosition(-16000, -16000); win.showInactive();
      globalThis.__workbenchRequests = 0; globalThis.__workbenchModelCalls = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => { globalThis.__workbenchRequests++; callback({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__workbenchModelCalls++; throw Error('No OCR during workbench QA'); });
    });
    page = await app.firstWindow(); page.setDefaultTimeout(8000); await page.setViewportSize({ width: 1500, height: 980 });
    page.on('pageerror', error => errors.push(error.message));
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    assert.equal(await editor().getAttribute('data-editor-workbench'), 'classic');
    assert.equal(await tabs().count(), 0);
    checks.push('Fresh installs keep the classic editor and all existing fields');

    progress('appearance opt-in and grouped editor');
    const dialog = await settings();
    const toggle = dialog.getByRole('switch', { name: '实验性题目编辑台', exact: true });
    assert.equal(await toggle.getAttribute('aria-checked'), 'false'); await toggle.click();
    const staticLogoCount = await dialog.locator('.brand-logo:not([data-animate="true"])').count();
    assert.ok(staticLogoCount >= 1, 'Settings logo should remain static');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await until(async () => await editor().getAttribute('data-editor-workbench') === 'experimental', 'Experimental editor not enabled');
    assert.equal(await tabs().getByRole('tab').count(), 4);
    assert.equal(await tabs().getByRole('tab').allTextContents().then(text => text.map(value => value.trim()).join('|')), groupNames.join('|'));
    assert.equal(await page.locator('[role="tabpanel"]').count(), 1, 'Editor should expose one shared panel labelled by the active group');
    assert.deepEqual(await editor().locator('[data-workbench-group]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.workbenchGroup))].sort()), ['answers', 'figures', 'properties', 'question'], 'All four content groups must stay mounted when hidden');
    await tabs().getByRole('tab', { name: '题目', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await tabs().getByRole('tab', { name: '答案解析', exact: true }).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End');
    assert.equal(await tabs().getByRole('tab', { name: '属性', exact: true }).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await tabs().getByRole('tab', { name: '题目', exact: true }).getAttribute('aria-selected'), 'true');
    let panel = await group('题目');
    assert.equal(await panel.getByPlaceholder('输入题干…', { exact: true }).inputValue(), stem);
    assert.ok(await panel.getByRole('button', { name: '将 D 设为正确答案', exact: true }).isVisible());
    assert.equal(await editor().getByPlaceholder('写下解题思路…', { exact: true }).isVisible(), false);
    assert.equal(await editor().getByRole('textbox', { name: 'TikZ 绘图代码', exact: true }).isVisible(), false);

    progress('content edits and temporary drawing survive tabs');
    await panel.getByRole('button', { name: '将 B 设为正确答案', exact: true }).click();
    const option = panel.getByRole('button', { name: '将 D 设为正确答案', exact: true }).locator('..');
    await option.locator('.cursor-text').click(); await option.locator('input').fill('$5$');
    panel = await group('答案解析');
    await panel.getByPlaceholder('写下解题思路…', { exact: true }).fill(editedAnalysis);
    panel = await group('题图与绘图');
    assert.ok(await panel.getByAltText('OCR 原图', { exact: true }).isVisible());
    assert.equal(await panel.getByRole('textbox', { name: '题图 1 图注', exact: true }).inputValue(), '原始题图');
    await panel.getByRole('textbox', { name: '题图 1 图注', exact: true }).fill('校对题图');
    await panel.getByRole('textbox', { name: 'TikZ 绘图代码', exact: true }).fill(pendingDrawing);
    panel = await group('属性');
    await panel.getByRole('textbox', { name: '题目来源', exact: true }).fill('编辑台回归样例');
    await panel.getByRole('textbox', { name: '题目知识点', exact: true }).fill('函数，代入求值');
    await group('题目');
    panel = await group('题图与绘图');
    assert.equal(await panel.getByRole('textbox', { name: 'TikZ 绘图代码', exact: true }).inputValue(), pendingDrawing, 'Unapplied drawing was lost on tab switch');
    await draftWhere(value => {
      const q = value?.exam.sections[0].questions[0];
      return q?.answer.join('') === 'B' && q.options[3] === '$5$' && q.analysis === editedAnalysis && q.source === '编辑台回归样例' && q.figures[0].caption === '校对题图';
    }, 'Grouped edits did not save into the real question fields');
    checks.push('Stem/options/answers/analysis/images/metadata use the same saved question; unapplied drawings survive group switches');

    progress('blank answers and group retained between questions');
    await group('答案解析');
    await editor().getByRole('button', { name: '下一题', exact: true }).click();
    await until(async () => await editor().getByPlaceholder('输入答案…', { exact: true }).isVisible(), 'Answer group did not stay active after changing question');
    assert.equal(await tabs().getByRole('tab', { name: '答案解析', exact: true }).getAttribute('aria-selected'), 'true');
    await editor().getByPlaceholder('输入答案…', { exact: true }).fill('$2$（已校对）');
    await group('属性'); await group('答案解析');
    assert.equal(await editor().getByPlaceholder('输入答案…', { exact: true }).inputValue(), '$2$（已校对）');
    await draftWhere(value => value?.exam.sections[1].questions[0].answer[0] === '$2$（已校对）', 'Blank answer edit did not save');
    await editor().getByRole('button', { name: '上一题', exact: true }).click();
    await until(async () => await editor().getByPlaceholder('写下解题思路…', { exact: true }).inputValue() === editedAnalysis, 'Previous question analysis not retained');
    checks.push('Non-choice answers remain editable and the selected group follows previous/next question navigation');

    progress('classic restoration and persistence');
    panel = await group('题图与绘图');
    await panel.getByRole('textbox', { name: 'TikZ 绘图代码', exact: true }).fill(pendingDrawing);
    await enable(false);
    assert.equal(await tabs().count(), 0);
    assert.equal(await editor().getByPlaceholder('写下解题思路…', { exact: true }).inputValue(), editedAnalysis);
    assert.equal(await editor().getByRole('textbox', { name: '题目来源', exact: true }).inputValue(), '编辑台回归样例');
    assert.equal(await editor().getByRole('textbox', { name: 'TikZ 绘图代码', exact: true }).inputValue(), pendingDrawing, 'Unapplied drawing lost when restoring classic layout');
    await enable(true); await group('题目');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), 'true');
    await page.reload(); await editor().waitFor();
    await until(async () => await editor().getAttribute('data-editor-workbench') === 'experimental', 'Reload did not remember experimental editor');
    panel = await group('答案解析');
    assert.equal(await panel.getByPlaceholder('写下解题思路…', { exact: true }).inputValue(), editedAnalysis);
    panel = await group('题图与绘图');
    assert.equal(await panel.getByRole('textbox', { name: '题图 1 图注', exact: true }).inputValue(), '校对题图');
    checks.push('Opt-out restores classic appearance without data/draft loss; opt-in survives reload independently of themes');

    progress('four themes, narrow pane and native brand animation');
    await group('题目');
    const outline = page.getByRole('complementary', { name: '试卷目录', exact: true });
    if (await outline.getAttribute('data-sidebar-state') !== 'expanded') {
      await outline.getByRole('button', { name: '展开试卷目录', exact: true }).click();
      await until(async () => await outline.getAttribute('data-sidebar-state') === 'expanded', 'Question outline did not expand');
    }
    for (const [mode, scheme, name] of [['dark', 'dark', 'dark'], ['light', 'light', 'light'], ['telegram', 'dark', 'telegram-dark'], ['telegram', 'light', 'telegram-light']]) {
      await theme(mode, scheme); await geometry(name, 1500);
      if (mode === 'telegram') {
        const wallpaper = await page.locator('.workspace-wallpaper').evaluate(el => { const style = getComputedStyle(el, '::before'); return { image: style.backgroundImage.startsWith('url('), animation: style.animationName }; });
        assert.deepEqual(wallpaper, { image: true, animation: 'workspace-wallpaper-drift' });
      }
      if (name === 'light' || name === 'telegram-dark') await screenshot(name);
    }
    await geometry('telegram-light-narrow', 1280);
    for (const name of groupNames) { await group(name); await geometry(`narrow-${name}`, 1280); }
    const animatedLogo = page.locator('header .brand-logo[data-animate="true"]'); assert.equal(await animatedLogo.count(), 1);
    const brandAnimation = await animatedLogo.evaluate(el => [...el.querySelectorAll('.brand-page,.brand-fold,.brand-question--one,.brand-question--two')].map(node => { const style = getComputedStyle(node); return { name: style.animationName, count: style.animationIterationCount }; }));
    assert.ok(brandAnimation.some(value => value.name !== 'none'), 'No startup motion on the titlebar brand');
    assert.ok(brandAnimation.every(value => value.count === '1'), 'Brand startup motion must not loop');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(await animatedLogo.evaluate(el => [...el.querySelectorAll('.brand-page,.brand-fold,.brand-question--one,.brand-question--two')].every(node => getComputedStyle(node).animationName === 'none')));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const existingMotion = await page.locator('.app-bg').getAttribute('data-interface-motion');
    await page.locator('.app-bg').evaluate(el => { el.dataset.interfaceMotion = 'reduced'; });
    assert.ok(await animatedLogo.evaluate(el => [...el.querySelectorAll('.brand-page,.brand-fold,.brand-question--one,.brand-question--two')].every(node => getComputedStyle(node).animationName === 'none')));
    await page.locator('.app-bg').evaluate((el, value) => { if (value === null) delete el.dataset.interfaceMotion; else el.dataset.interfaceMotion = value; }, existingMotion);
    checks.push('All four themes and 1280px/narrow editor preserve accessible fields, white PDF, math/tables and wallpaper motion; brand startup is finite and respects reduced motion');

    const requests = await app.evaluate(() => ({ cloudRequests: globalThis.__workbenchRequests, modelCalls: globalThis.__workbenchModelCalls }));
    assert.deepEqual(requests, { cloudRequests: 0, modelCalls: 0 }); assert.deepEqual(errors, []);
    const report = { passed: true, packaged, checks, geometries, screenshots, ...requests, errors };
    fs.writeFileSync(path.join(out, `results-${suffix}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch (error) {
    fs.writeFileSync(path.join(out, `results-${suffix}.json`), JSON.stringify({ passed: false, stage, error: error.stack || String(error), checks, errors }, null, 2));
    throw error;
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    const resolved = fs.realpathSync(profile), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() === temp.toLowerCase() && path.basename(resolved).startsWith('juanye-workbench-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
