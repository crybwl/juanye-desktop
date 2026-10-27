/* Integrated-surface contract QA. Run after the app has been built; never builds itself.
 * Real Electron/preload/storage IPC, synthetic temporary data, no credentials or HTTP/model calls.
 * Nine Telegram palettes x light/dark + the two original modes = 20 settings-driven appearances.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const capture = !process.argv.includes('--no-screenshots');
const suffix = packaged ? 'packaged' : 'source';
const output = path.join(root, 'artifacts', 'qa-integrated-surfaces', suffix);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const paletteIds = ['ocean', 'spring', 'frost', 'gem', 'classroom', 'blossom', 'dusk', 'ember', 'neon'];
const commonSurfaces = ['.app-bg > header', '.workspace-nav', '.question-sidebar', '.sidebar-rail', '.sidebar-drawer', '.sidebar-summary', '.sidebar-actions', '.workspace-exam-area > [class~="bg-panel/80"]', '.workspace-preview-stage > div > [class~="shrink-0"]', '[data-editor-workbench]', 'section[data-workbench-group]'];
const bankSurfaces = ['.bank-library-summary', '.bank-library-sidebar', '.bank-catalog', '.bank-detail-pane', '.bank-basket', '.bank-preview-paper'];
async function until(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(50); }
  throw Error(message);
}

function fixture() {
  const types = ['single', 'multi', 'judge', 'blank', 'essay', 'material', 'custom'];
  const questions = Array.from({ length: 21 }, (_, index) => {
    const type = types[index % types.length];
    return {
      id: `surface-question-${index + 1}`, type, score: type === 'essay' ? 12 : 5,
      stem: `${['已知函数 $f(x)=x^2-2x+3$，则 $f(2)$ 的值为（　）。', '下列关于函数定义域与单调性的叙述中，正确的有（　）。', '若 $a>b>0$，则 $a^2>b^2$。判断命题是否正确。', '在直角三角形中，两条直角边长分别为 $3$ 和 $4$，斜边长为______。', '已知二次函数 $f(x)=x^2-2x+3$。求最小值，并说明解题过程。', '阅读材料：某校抽样记录学生每日阅读时间，分析样本的集中趋势。', '探究活动：设计一个公平随机试验，用频率估计事件概率。'][index % types.length]}（本地示例 ${index + 1}）`,
      options: type === 'single' || type === 'multi' ? ['$1$', '$2$', '$3$', '$4$'] : type === 'judge' ? ['正确', '错误'] : [],
      answer: type === 'single' ? ['C'] : type === 'multi' ? ['A', 'C'] : type === 'judge' ? ['A'] : ['$3$'],
      analysis: '先明确已知条件，再代入基本关系化简，最后检查结论与题目要求是否一致。',
      source: '校本练习 · 仅用于界面验证', knowledge: [index % 2 ? '函数与运算' : '统计与概率'],
      difficulty: ['easy', 'medium', 'hard'][index % 3],
      ...(index % 5 === 0 ? { flag: '建议复核边界条件。' } : {}),
    };
  });
  const exam = { id: 'surface-exam', title: '数学 · 春季同步练习', subtitle: '本地隔离样卷', duration: 90, notice: [], sections: [
    { id: 'surface-section-one', type: 'single', title: '单项选择题', note: '', questions: [questions[0], questions[7]] },
    { id: 'surface-section-two', type: 'essay', title: '解答题', note: '', questions: [questions[4]] },
  ] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  return { questions, exam, layout };
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-integrated-surfaces-'));
  const { questions, exam, layout } = fixture();
  const history = [{ id: 'surface-history', at: Date.UTC(2026, 8, 1), label: '隔离样卷 · 初稿', exam, layout }];
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history }));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const buildFile = path.join(root, packaged ? 'release/win-unpacked/resources/app.asar' : 'dist/index.html');
  const build = { file: buildFile, modified: fs.statSync(buildFile).mtime.toISOString(), sha256: crypto.createHash('sha256').update(fs.readFileSync(buildFile)).digest('hex') };
  const checks = [], appearances = [], surfaces = [], geometries = [], screenshots = [], motion = {}, errors = [], contrastIssues = [], controls = [];
  let app, page, stage = 'launch', report, rendererRequests = 0;
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: value, packaged })); };
  const watchdog = setTimeout(() => { try { app?.process().kill(); } catch {} console.error(`Integrated-surface QA timed out: ${stage}`); process.exit(1); }, 300000);

  // Require one decoded continuous scene; ordinary panes must NOT stamp a
  // fresh texture at their own origin. Only each popup root owns another tile.
  async function inspect(label, selectors, expectedPattern = true) {
    if (expectedPattern === true) {
      assert.equal(await page.locator('[data-scene-backdrop]').count(), 1, 'Scene must have one application owner');
      await page.waitForFunction(() => document.documentElement.dataset.sceneReady === 'true');
      const image = await page.locator('.scene-backdrop-art').evaluate(node => getComputedStyle(node).backgroundImage);
      assert.match(image, /data:image\/png/, 'Scene must reuse the decoded PNG texture');
    }
    const value = await page.evaluate(({ selectors }) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
      const over = (front, back) => { const a = front[3] / 255; return front.slice(0, 3).map((v, i) => v * a + back[i] * (1 - a)).concat(255); };
      const background = node => { const chain = []; for (let current = node; current; current = current.parentElement) chain.unshift(current); return chain.reduce((color, current) => over(rgba(getComputedStyle(current).backgroundColor), color), [255, 255, 255, 255]); };
      const luminance = color => { const c = color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
      return selectors.flatMap(selector => {
        const nodes = [...document.querySelectorAll(selector)];
        if (!nodes.length) return [{ selector, missing: true }];
        return nodes.map(node => {
          const style = getComputedStyle(node), image = style.backgroundImage, bg = background(node);
          const fg = over(rgba(style.color), bg), a = luminance(fg), b = luminance(bg);
          return { selector, missing: false, count: nodes.length, rootTexture: node.matches(".glass, .select-menu, .bank-more-menu"), pattern: /url\(["']?data:image\/(?:png|svg\+xml)/i.test(image), unresolved: image.includes('var('), image: image.length > 300 ? `${image.slice(0, 65)}… (${image.length} chars)` : image, background: style.backgroundColor, foreground: style.color, contrast: +((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2), border: style.borderColor, shadow: style.boxShadow };
        });
      });
    }, { selectors });
    surfaces.push({ label, expectedPattern, nodes: value });
    for (const node of value) {
      assert.equal(node.missing, false, `${label}: missing structural surface ${node.selector}`);
      assert.equal(node.unresolved, false, `${label}: unresolved image token on ${node.selector}`);
      if (expectedPattern !== null) assert.equal(node.pattern, expectedPattern && node.rootTexture, `${label}: ${node.selector} has an unexpected independently restarted texture`);
      if (expectedPattern === null && node.contrast < 4.5) contrastIssues.push({ label, selector: node.selector, contrast: node.contrast, foreground: node.foreground, background: node.background });
      else assert.ok(node.contrast >= 4.5, `${label}: main text contrast ${node.contrast} on ${node.selector}`);
    }
    return value;
  }
  async function paper(label) {
    const sheets = await page.locator('.workspace-preview-stage [data-sheet]').evaluateAll(nodes => nodes.map(node => ({ background: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage, color: getComputedStyle(node).color })));
    assert.ok(sheets.length, `${label}: no preview paper`);
    for (const sheet of sheets) assert.deepEqual(sheet, { background: 'rgb(255, 255, 255)', image: 'none', color: 'rgb(22, 23, 26)' }, `${label}: theme leaked into printable paper`);
  }
  async function geometry(label, selectors) {
    await pause(400);
    const value = await page.evaluate(selectors => {
      const nodes = selectors.flatMap(selector => [...document.querySelectorAll(selector)].flatMap(node => {
        const r = node.getBoundingClientRect(), style = getComputedStyle(node);
        if (!r.width || !r.height || style.visibility === 'hidden' || node.closest('[aria-hidden="true"]')) return [];
        return [{ selector, x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width, client: node.clientWidth, scroll: node.scrollWidth }];
      }));
      return { width: innerWidth, height: innerHeight, documentScroll: document.documentElement.scrollWidth, nodes };
    }, selectors);
    geometries.push({ label, ...value });
    assert.ok(value.documentScroll <= value.width + 2, `${label}: horizontal document overflow`);
    for (const node of value.nodes) {
      assert.ok(node.x >= -2 && node.right <= value.width + 2 && node.y >= -2 && node.bottom <= value.height + 2, `${label}: ${node.selector} escaped viewport: ${JSON.stringify(node)}`);
      assert.ok(node.scroll <= node.client + 2, `${label}: ${node.selector} overflows horizontally: ${JSON.stringify(node)}`);
    }
  }
  async function shot(name) {
    if (!capture) return;
    await page.mouse.move(3, 3); await page.evaluate(() => document.fonts.ready); await pause(400);
    const target = path.join(output, `${name}.png`);
    const encoded = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
    fs.writeFileSync(target, Buffer.from(encoded, 'base64')); screenshots.push(target);
  }
  const nav = name => page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name, exact: true });
  const bank = () => page.getByTestId('bank-workspace');
  async function openBank() {
    await nav('本地题库').click(); await bank().waitFor();
    await until(async () => await bank().getByTestId('bank-question-list').getAttribute('aria-busy') === 'false', 'Bank load did not settle');
    await pause(400);
  }
  async function settings() {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '外观', exact: true }).click();
    await dialog.getByText('界面模式', { exact: true }).waitFor(); return dialog;
  }
  async function close(dialog, name = '关闭') { await dialog.getByRole('button', { name, exact: true }).click(); await pause(300); }
  async function chooseAppearance(dialog, mode, scheme, id) {
    await dialog.locator('label').filter({ has: page.locator(`input[name="juanye-appearance"][value="${mode}"]`) }).click();
    if (mode === 'telegram') {
      await dialog.getByRole('group', { name: 'Telegram 明暗模式', exact: true }).getByRole('tab', { name: scheme === 'light' ? '浅色' : '深色', exact: true }).click();
      await dialog.locator('label').filter({ has: page.locator(`input[name="juanye-telegram-theme"][value="${id}"]`) }).click();
    }
    await page.waitForFunction(({ mode, scheme, id }) => document.documentElement.dataset.theme === mode && document.documentElement.style.colorScheme === (mode === 'telegram' ? scheme : mode) && (mode !== 'telegram' || document.documentElement.dataset.telegramTheme === id), { mode, scheme, id });
    if (mode === 'telegram') await page.waitForFunction(() => document.documentElement.dataset.sceneReady === 'true');
    await pause(170);
  }
  async function command(title) {
    await page.keyboard.press('Control+k'); const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('搜索题目、执行命令…').fill(title);
    await dialog.getByText(title, { exact: true }).click(); await pause(450);
  }
  async function exclusions(label) {
    const value = await page.locator('input:not([type="radio"]), textarea, .workbench-live-preview, .print-summary-paper').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({ node: node.getAttribute('aria-label') || node.className, image: getComputedStyle(node).backgroundImage })).filter(node => /data:image\/(?:png|svg\+xml)/.test(node.image)));
    assert.deepEqual(value, [], `${label}: wallpaper invaded document/input content`);
  }
  async function neutralControls(label) {
    const value = await page.locator('[data-ui-button="icon"], .btn[data-ui-button]:is([data-variant="secondary"], [data-variant="outline"], [data-variant="ghost"])').evaluateAll(nodes => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d');
      const painted = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return context.getImageData(0, 0, 1, 1).data[3] > 0; };
      return { count: nodes.length, hardBoxes: nodes.flatMap(node => {
        const style = getComputedStyle(node);
        const border = ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) > 0 && painted(style[`border${side}Color`]));
        return border || style.boxShadow !== 'none' ? [{ name: node.getAttribute('aria-label') || node.textContent.trim(), border: style.borderColor, shadow: style.boxShadow }] : [];
      }) };
    });
    assert.ok(value.count > 0, `${label}: no integrated button hooks`);
    assert.deepEqual(value.hardBoxes, [], `${label}: neutral action retains a detached hard border or shadow`);
    controls.push({ label, ...value });
  }
  async function wallpaper() {
    return page.locator('.scene-backdrop-art').evaluate(node => { const style = getComputedStyle(node); return { image: /data:image\/(?:png|svg\+xml)/.test(style.backgroundImage), animation: style.animationName, duration: style.animationDuration, transform: style.transform }; });
  }

  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env, timeout: 30000 });
    await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.setContentSize(1500, 980); win.showInactive();
      globalThis.__integratedSurfaces = { network: 0, modelCalls: 0 };
      globalThis.fetch = () => { globalThis.__integratedSurfaces.network++; throw Error('HTTP disabled in isolated surface QA'); };
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__integratedSurfaces.network++; callback({ cancel: true }); });
      for (const channel of ['model:test', 'model:recognize', 'model:generate', 'exam:analyze']) {
        ipcMain.removeHandler(channel); ipcMain.handle(channel, () => { globalThis.__integratedSurfaces.modelCalls++; throw Error(`Model execution forbidden in surface QA: ${channel}`); });
      }
    });
    page = await app.firstWindow(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:\/\//, route => { rendererRequests++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1500, height: 980 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    const outline = page.getByRole('complementary', { name: '试卷目录', exact: true });
    if (await outline.getAttribute('data-sidebar-state') !== 'expanded') {
      await outline.getByRole('button', { name: '展开目录面板', exact: true }).click();
      await until(async () => await outline.getAttribute('data-sidebar-state') === 'expanded', 'Question outline did not expand');
    }
    await page.evaluate(async questions => { await window.juanye.bankSave({ questions, origin: { examTitle: '本地界面验证 · 合成题库', examId: 'surface-fixture' } }); }, questions);
    await openBank(); assert.equal(await bank().getByTestId('bank-entry').count(), 21);
    await nav('组卷').click(); await pause(400);

    progress('20 appearances through actual settings controls; direct resolved backgrounds, contrast and white paper');
    let dialog = await settings();
    await chooseAppearance(dialog, 'telegram', 'dark', 'ember');
    assert.equal(await dialog.locator('input[name="juanye-telegram-theme"]').count(), paletteIds.length);
    for (const scheme of ['dark', 'light']) for (const id of paletteIds) {
      await chooseAppearance(dialog, 'telegram', scheme, id);
      const label = `telegram-${scheme}-${id}`;
      const nodes = await inspect(label, [...commonSurfaces, ...bankSurfaces, '.glass[role="dialog"]', '.glass > aside', '.telegram-gallery']);
      await neutralControls(label);
      await close(dialog);
      const primary = await inspect(`${label}-primary-actions`, ['.app-bg > header [data-ui-button][data-variant="primary"]'], null);
      await page.locator('.app-bg > header [data-ui-button][data-variant="primary"]').hover(); await pause(220);
      const hovered = await inspect(`${label}-primary-hover`, ['.app-bg > header [data-ui-button][data-variant="primary"]'], null);
      await page.mouse.move(3, 3);
      await paper(label); appearances.push({ mode: 'telegram', scheme, id, minimumContrast: Math.min(...nodes.map(node => node.contrast)), primaryContrast: primary.map(node => node.contrast), primaryHoverContrast: hovered[0].contrast });
      dialog = await settings();
    }
    for (const mode of ['dark', 'light']) {
      await chooseAppearance(dialog, mode);
      await inspect(`ordinary-${mode}`, [...commonSurfaces, ...bankSurfaces, '.glass[role="dialog"]', '.glass > aside'], false);
      await neutralControls(`ordinary-${mode}`);
      await close(dialog);
      const primary = await inspect(`ordinary-${mode}-primary-actions`, ['.app-bg > header [data-ui-button][data-variant="primary"]'], null);
      await page.locator('.app-bg > header [data-ui-button][data-variant="primary"]').hover(); await pause(220);
      const hovered = await inspect(`ordinary-${mode}-primary-hover`, ['.app-bg > header [data-ui-button][data-variant="primary"]'], null);
      await page.mouse.move(3, 3);
      assert.equal(await page.locator('.scene-backdrop').evaluate(node => getComputedStyle(node).display), 'none');
      await paper(mode); appearances.push({ mode, primaryContrast: primary.map(node => node.contrast), primaryHoverContrast: hovered[0].contrast });
      dialog = await settings();
    }
    assert.equal(appearances.length, 20);
    console.log(JSON.stringify({ primaryContrast: appearances.map(({ mode, scheme, id, primaryContrast, primaryHoverContrast }) => ({ mode, scheme, id, primaryContrast, primaryHoverContrast })), contrastIssues }));
    await close(dialog);
    checks.push('All 20 real settings-driven appearances: one decoded continuous scene across chrome/editor/bank/settings, no restarted pane textures, readable main text and normal/hover primary actions, neutral buttons without hard borders or shadows, ordinary modes without Telegram pattern, white paper');

    for (const scheme of ['dark', 'light']) {
      progress(`complete ${scheme} Telegram interface tour`);
      dialog = await settings(); await chooseAppearance(dialog, 'telegram', scheme, 'ember');
      const toggle = dialog.getByRole('switch', { name: '实验性题目编辑台', exact: true });
      if (await toggle.getAttribute('aria-checked') === 'true') await toggle.click();
      await dialog.getByRole('tab', { name: '完整', exact: true }).click();
      await inspect(`${scheme}-settings-appearance`, ['.glass[role="dialog"]', '.glass > aside', '.telegram-gallery']);
      await shot(`telegram-${scheme}-settings`);
      for (const tab of ['模型服务', '识别', '快捷键', '关于']) {
        await dialog.getByRole('button', { name: tab, exact: true }).click(); await pause(220);
        await inspect(`${scheme}-settings-${tab}`, ['.glass[role="dialog"]', '.glass > aside']);
      }
      await close(dialog);
      await inspect(`${scheme}-classic-editor`, commonSurfaces);
      await exclusions(`${scheme}-classic-editor`); await geometry(`${scheme}-classic-editor`, ['.question-sidebar', '.workspace-editor-stage', '[data-editor-workbench]']);
      await shot(`telegram-${scheme}-editor-classic`);

      await page.getByRole('button', { name: '打开公式编辑器', exact: true }).first().click();
      dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: '公式代码', exact: true }).fill('\\frac{a}{b}+\\sqrt{x}');
      assert.ok(await dialog.locator('.katex').count());
      await inspect(`${scheme}-formula-dialog`, ['.glass[role="dialog"]']); await geometry(`${scheme}-formula-dialog`, ['.glass[role="dialog"]']);
      await close(dialog, '取消');

      dialog = await settings();
      await dialog.getByRole('switch', { name: '实验性题目编辑台', exact: true }).click(); await close(dialog);
      await until(async () => await page.locator('.workspace-editor-stage [data-editor-workbench]').getAttribute('data-editor-workbench') === 'experimental', 'Experimental editor did not activate');
      for (const group of ['题目', '答案解析', '题图与绘图', '属性']) {
        await page.locator('.workspace-editor-stage').getByRole('tab', { name: group, exact: true }).click();
        await inspect(`${scheme}-experimental-${group}`, ['.workspace-editor-stage [data-editor-workbench]', '.workspace-editor-stage .workbench-nav', '.workspace-editor-stage .workbench-panel--experimental', '.workspace-editor-stage .workbench-section']);
        await exclusions(`${scheme}-experimental-${group}`);
      }
      await page.locator('.workspace-editor-stage').getByRole('combobox', { name: '题目难度', exact: true }).click();
      await inspect(`${scheme}-select-menu`, ['.select-menu']); await geometry(`${scheme}-select-menu`, ['.select-menu']);
      await page.keyboard.press('Escape');
      await page.locator('.workspace-editor-stage').getByRole('tab', { name: '题目', exact: true }).click();
      await shot(`telegram-${scheme}-editor-experimental`);

      await command('一图多题识别'); dialog = page.getByRole('dialog');
      await dialog.getByText('识别题目', { exact: true }).waitFor();
      await inspect(`${scheme}-ocr-empty`, ['.glass[role="dialog"]']);
      await dialog.locator('input[type="file"]').setInputFiles({ name: 'surface-dummy.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hKQAAAAASUVORK5CYII=', 'base64') });
      await dialog.getByRole('button', { name: '查看第 1 页', exact: true }).waitFor();
      await inspect(`${scheme}-ocr-loaded`, ['.glass[role="dialog"]']); await geometry(`${scheme}-ocr`, ['.glass[role="dialog"]']);
      await close(dialog); // Never click recognition: the real model bridge remains forbidden.

      for (const title of ['导入题目文件', '导入解析文件', '导入解析版试卷']) {
        await command(title); dialog = page.getByRole('dialog', { name: title, exact: true });
        await inspect(`${scheme}-${title}`, ['.glass[role="dialog"]']); await geometry(`${scheme}-${title}`, ['.glass[role="dialog"]']);
        await close(dialog, '关闭导入');
      }

      await page.getByRole('button', { name: '试卷分析', exact: true }).click(); dialog = page.getByRole('dialog');
      for (const tab of ['本地统计', 'AI 评估', '双向细目表', '逐题细目']) {
        await dialog.getByRole('tab', { name: tab, exact: true }).click(); await pause(220);
        await inspect(`${scheme}-analysis-${tab}`, ['.glass[role="dialog"]', '.dialog-header']);
        await geometry(`${scheme}-analysis-${tab}`, ['.glass[role="dialog"]']); await exclusions(`${scheme}-analysis-${tab}`);
      }
      await close(dialog, '关闭试卷分析');

      await page.getByRole('button', { name: '导出中心', exact: true }).click(); dialog = page.getByRole('dialog');
      await inspect(`${scheme}-export`, ['.glass[role="dialog"]', '.dialog-header', '.export-options']);
      for (const name of ['PDF', 'Word', 'Markdown', 'LaTeX', '卷页项目']) {
        await dialog.getByRole('group', { name: '导出格式', exact: true }).getByText(name, { exact: true }).click(); await pause(180);
        await exclusions(`${scheme}-export-${name}`);
      }
      const miniature = await dialog.locator('.print-summary-paper').evaluate(node => ({ background: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage }));
      assert.deepEqual(miniature, { background: 'rgb(255, 255, 255)', image: 'none' });
      await geometry(`${scheme}-export`, ['.glass[role="dialog"]']); await close(dialog, '取消');

      await page.getByRole('button', { name: '历史记录', exact: true }).click();
      await page.locator('.glass').filter({ hasText: '隔离样卷 · 初稿' }).waitFor();
      await inspect(`${scheme}-history`, ['.glass']); await geometry(`${scheme}-history`, ['.glass']);
      await close(page.locator('.glass').filter({ hasText: '隔离样卷 · 初稿' }));

      await page.getByRole('button', { name: '从题库选题', exact: true }).click(); dialog = page.getByRole('dialog', { name: '本地题库', exact: true });
      await inspect(`${scheme}-bank-sheet`, ['.question-bank-sheet']); await geometry(`${scheme}-bank-sheet`, ['.question-bank-sheet']);
      await close(dialog, '关闭本地题库');

      await openBank();
      const row = bank().getByTestId('bank-entry').first(); await row.hover();
      if (await row.getByRole('button', { name: '收藏题目', exact: true }).count()) await row.getByRole('button', { name: '收藏题目', exact: true }).click();
      if (await bank().getByTestId('bank-basket').locator('[data-basket-id]').count() === 0) { await row.hover(); await row.getByRole('button', { name: '选题', exact: true }).click(); }
      await inspect(`${scheme}-bank-workspace`, bankSurfaces);
      await geometry(`${scheme}-bank-workspace`, ['.bank-workspace', '.bank-library-sidebar', '.bank-catalog', '.bank-detail-pane', '.bank-basket']);
      await shot(`telegram-${scheme}-bank`);
      await bank().locator('.bank-search-toolbar').hover(); await bank().getByRole('button', { name: '新建题目', exact: true }).click();
      await bank().getByTestId('bank-question-editor').waitFor();
      await inspect(`${scheme}-bank-authoring`, ['.bank-question-editor [data-editor-workbench]']);
      await bank().locator('.bank-edit-footer').getByRole('button', { name: '取消', exact: true }).click();
      await nav('组卷').click(); await pause(400); await paper(`${scheme}-tour`);

      motion[`${scheme}-full-before`] = await wallpaper(); await pause(180); motion[`${scheme}-full-after`] = await wallpaper();
      assert.equal(motion[`${scheme}-full-before`].image, true);
      assert.equal(motion[`${scheme}-full-before`].animation, 'workspace-wallpaper-drift');
      assert.notEqual(motion[`${scheme}-full-before`].transform, motion[`${scheme}-full-after`].transform, `${scheme}: wallpaper animation no longer advances`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal((await wallpaper()).animation, 'none'); await page.emulateMedia({ reducedMotion: 'no-preference' });
      dialog = await settings(); await dialog.getByRole('tab', { name: '减弱', exact: true }).click(); await close(dialog);
      assert.equal((await wallpaper()).animation, 'none');
      dialog = await settings(); await dialog.getByRole('tab', { name: '完整', exact: true }).click(); await close(dialog);
      await page.emulateMedia({ media: 'print' });
      await paper(`${scheme}-print`);
      assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
      assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundImage), 'none');
      await page.emulateMedia({ media: 'screen' });
    }
    checks.push('Telegram dark/light tours cover classic and experimental editor groups, formula, every settings tab, empty/loaded OCR, all three import dialogs, all four analysis tabs including AI, all export formats, history, quick-bank sheet and bank authoring without model calls or document mutations');
    checks.push('Wallpaper drift advances in full motion; both system and in-app reduced motion stop it; print paper, white export miniature, inputs and live question content remain pattern-free');

    progress('narrow windows, persistence and isolation');
    for (const width of [1280, 1100]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width);
      await page.setViewportSize({ width, height: 800 }); await openBank();
      await geometry(`bank-${width}`, ['.bank-workspace', '.bank-library-sidebar', '.bank-catalog', '.bank-detail-pane']);
    }
    await nav('组卷').click(); await pause(400); await page.reload(); await page.locator('.workspace-editor-stage [data-editor-workbench]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'telegram');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.telegramScheme), 'light');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.telegramTheme), 'ember');
    assert.deepEqual((await page.evaluate(() => window.juanye.loadDraft())).exam, exam);
    const ipc = await app.evaluate(() => globalThis.__integratedSurfaces);
    assert.deepEqual(ipc, { network: 0, modelCalls: 0 }); assert.equal(rendererRequests, 0); assert.deepEqual(errors, []);
    checks.push('1100/1280px bank remains within the viewport; appearance persists after reload; synthetic exam is unchanged; zero renderer errors, HTTP or model execution');
    assert.deepEqual(contrastIssues, [], 'Primary action foreground/background contrast fell below 4.5:1');
    report = { passed: true, packaged, build, checks, appearances, surfaces, controls, geometries, motion, screenshots, contrastIssues, cloudRequests: ipc.network + rendererRequests, modelCalls: ipc.modelCalls, errors };
    console.log(JSON.stringify({ passed: true, packaged, appearances: appearances.length, surfaceGroups: surfaces.length, geometryChecks: geometries.length, checks, screenshots, cloudRequests: 0, modelCalls: 0 }));
  } catch (error) {
    if (page) await shot('failure').catch(() => {});
    report = { passed: false, packaged, stage, build, error: error.stack || String(error), checks, appearances, surfaces, controls, geometries, motion, screenshots, contrastIssues, rendererRequests, errors };
    console.error(JSON.stringify({ passed: false, stage, error: error.stack || String(error), screenshots })); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    const resolved = fs.realpathSync(profile), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() === temp.toLowerCase() && path.basename(resolved).startsWith('juanye-integrated-surfaces-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
