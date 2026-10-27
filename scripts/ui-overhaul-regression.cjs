/* UI-overhaul contract QA: real preload IPC, synthetic temporary profile, zero HTTP/model calls.
 * Run AFTER npm run build. --packaged tests release/win-unpacked/卷页.exe.
 * Screenshots + machine-readable evidence land in artifacts/qa-ui-overhaul/{source,packaged}.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts', 'qa-ui-overhaul', packaged ? 'packaged' : 'source');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const themes = ['ocean', 'spring', 'frost', 'gem', 'classroom', 'blossom', 'dusk', 'ember', 'neon'];
const types = ['single', 'multi', 'judge', 'blank', 'essay', 'material', 'custom'];
const shortTypes = ['单选', '多选', '判断', '填空', '解答', '材料', '自定义'];
async function until(check, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await pause(50); }
  throw Error(label);
}

// Trigger and first sample share a renderer turn: click auto-wait cannot hide the motion.
async function motionFrames(button, selectors, duration = 950) {
  return button.evaluate((element, { selectors, duration }) => new Promise(resolve => {
    const frames = [], start = performance.now();
    const capture = () => {
      const nodes = {};
      for (const [name, selector] of Object.entries(selectors)) {
        const node = document.querySelector(selector);
        if (!node) { nodes[name] = null; continue; }
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        nodes[name] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, transform: style.transform, opacity: +style.opacity, text: node.textContent };
      }
      frames.push({ time: performance.now() - start, nodes });
    };
    capture(); element.click();
    const tick = () => { capture(); if (performance.now() - start < duration) requestAnimationFrame(tick); else resolve(frames); };
    requestAnimationFrame(tick);
  }), { selectors, duration });
}
function renderedMotion(frames, name, label) {
  const visible = frames.map(frame => frame.nodes[name]).filter(node => node && node.width > 0 && node.height > 0 && node.opacity > .01);
  const states = new Set(visible.map(node => [node.x.toFixed(2), node.y.toFixed(2), node.transform, node.opacity.toFixed(3)].join('|'))).size;
  assert.ok(visible.length >= 6 && states >= 3, `${label} has no intermediate rendered states (${visible.length} frames / ${states} states)`);
  return { samples: visible.length, states };
}

function figureFixture() {
  const canvas = createCanvas(480, 270), context = canvas.getContext('2d');
  context.fillStyle = '#f9fafc'; context.fillRect(0, 0, 480, 270);
  context.strokeStyle = '#e4e9f1'; context.lineWidth = 1;
  for (let x = 40; x < 470; x += 40) { context.beginPath(); context.moveTo(x, 20); context.lineTo(x, 240); context.stroke(); }
  for (let y = 40; y < 250; y += 40) { context.beginPath(); context.moveTo(30, y); context.lineTo(460, y); context.stroke(); }
  context.strokeStyle = '#3c4c68'; context.lineWidth = 2; context.beginPath(); context.moveTo(35, 225); context.lineTo(460, 225); context.moveTo(70, 245); context.lineTo(70, 20); context.stroke();
  context.strokeStyle = '#6c84d5'; context.lineWidth = 4; context.beginPath();
  for (let i = 0; i <= 200; i++) { const x = 85 + i * 1.7, y = 215 - (i / 14) ** 2; if (!i) context.moveTo(x, y); else context.lineTo(x, y); }
  context.stroke(); context.fillStyle = '#526584'; context.font = '18px sans-serif'; context.fillText('y', 49, 25); context.fillText('x', 452, 250); context.fillText('O', 50, 246); context.fillText('f(x)', 340, 56);
  return `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`;
}
function questionsFixture() {
  const figure = figureFixture();
  const stems = [
    '已知函数 $f(x)=x^2-2x+3$，则 $f(2)$ 的值为（　）。',
    '下列关于函数单调性与定义域的说法，正确的有（　）。',
    '若 $a>b>0$，则 $a^2>b^2$。判断这一命题的正误。',
    '在三角形 $ABC$ 中，已知 $AB=3$，$AC=4$，$\\angle A=90^\\circ$，则 $BC=$ ______。',
    '如图，抛物线经过点 $A(0,3)$。请写出函数解析式，并说明图像与坐标轴交点的意义。',
    '阅读材料：某校对学生每日阅读时间进行了抽样调查。根据分组数据，分析样本的集中趋势。',
    '探究活动：设计一个公平的随机试验，用频率估计事件发生的概率，并解释实验结论。',
  ];
  return Array.from({ length: 84 }, (_, index) => {
    const t = index % types.length, type = types[t], sequence = Math.floor(index / types.length) + 1;
    return {
      id: `overhaul-question-${index + 1}`, type, score: type === 'essay' ? 12.5 : type === 'material' ? 10 : 5,
      stem: `${stems[t]}（专题练习 ${sequence}）`,
      options: type === 'single' ? ['$1$', '$2$', '$3$', '$4$'] : type === 'multi' ? ['定义域为实数集', '图像关于 $y$ 轴对称', '在区间 $(0,+\\infty)$ 上递增', '存在最小值'] : type === 'judge' ? ['正确', '错误'] : [],
      answer: type === 'single' ? ['C'] : type === 'multi' ? ['A', 'C', 'D'] : type === 'judge' ? ['A'] : type === 'blank' ? ['$5$'] : ['$f(x)=x^2-2x+3$'],
      analysis: '先明确题目中的条件，再结合基本关系进行推理。代入已知量化简，注意定义域及单位，最后检验结果是否满足原题要求。',
      source: ['2026 春季同步精选', '校本题库 · 期中复习', '数学探究与应用'][Math.floor(t / 3)],
      knowledge: [t < 3 ? '函数与运算' : t < 5 ? '空间几何' : '统计与概率', t % 2 ? '综合应用' : '基础概念'],
      difficulty: ['easy', 'medium', 'hard'][index % 3],
      ...(index % 9 === 0 ? { flag: '建议核对题目中的边界条件与单位。' } : {}),
      ...(type === 'essay' ? { figures: [{ id: `overhaul-figure-${index}`, src: figure, caption: '二次函数图像示意', layout: 'full', width: 70 }] } : {}),
    };
  });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-ui-overhaul-'));
  const questions = questionsFixture();
  const exam = { id: 'overhaul-exam', title: '数学 · 春季同步练习', subtitle: '本地隔离测试样卷', duration: 90, notice: [], sections: [{ id: 'overhaul-section', type: 'single', title: '单项选择题', note: '', questions: [questions[0], questions[7]] }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const buildFile = path.join(root, packaged ? 'release/win-unpacked/resources/app.asar' : 'dist/index.html');
  const build = { file: buildFile, sha256: crypto.createHash('sha256').update(fs.readFileSync(buildFile)).digest('hex'), modified: fs.statSync(buildFile).mtime.toISOString() };
  let app, page, stage = 'launch', report, rendererRequests = 0;
  const errors = [], checks = [], screenshots = [], appearances = [], hoverControls = [], motion = {};
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: value, packaged })); };
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`UI overhaul QA timed out: ${stage}`); process.exit(1); }, 240000);
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env, timeout: 30000 });
    await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.setContentSize(1500, 900); win.showInactive();
      globalThis.__overhaul = { network: 0, modelCalls: 0 };
      globalThis.fetch = () => { globalThis.__overhaul.network++; throw Error('HTTP is disabled in isolated UI overhaul QA'); };
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__overhaul.network++; callback({ cancel: true }); });
      for (const name of ['model:test', 'model:recognize', 'exam:analyze']) {
        ipcMain.removeHandler(name); ipcMain.handle(name, () => { globalThis.__overhaul.modelCalls++; throw Error(`Paid/model IPC disabled: ${name}`); });
      }
    });
    page = await app.firstWindow(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:\/\//, route => { rendererRequests++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1500, height: 900 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('complementary', { name: '试卷目录', exact: true }).waitFor();
    const nav = name => page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name, exact: true });
    const bank = () => page.getByTestId('bank-workspace');
    const rows = () => bank().getByTestId('bank-entry');
    const basket = () => bank().getByTestId('bank-basket');
    const basketIds = () => basket().locator('[data-basket-id]').evaluateAll(nodes => nodes.map(node => node.dataset.basketId));
    const header = () => bank().locator('.bank-workspace-header');
    const catalogHeading = () => bank().locator('.bank-catalog-heading');
    const detailTools = () => bank().locator('.bank-detail-tools');
    const detailHeading = () => bank().locator('.bank-detail-heading');
    const headerControls = () => bank().locator('.bank-workspace-actions > button, .bank-workspace-actions > details > summary');
    const cardControls = card => card.locator('.bank-favorite, .bank-pick, [role="checkbox"]');
    const basketTools = item => item.locator('button:not(.bank-basket-stem)');
    const idlePointer = async () => { await bank().getByRole('textbox', { name: '搜索题库', exact: true }).focus(); await page.mouse.move(3, 3); };
    // Opacity can be on an ancestor (e.g. the header action group), not the button.
    const controlStates = controls => controls.evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      let opacity = 1;
      for (let parent = node; parent; parent = parent.parentElement) opacity *= +getComputedStyle(parent).opacity;
      return { name: node.getAttribute('aria-label') || node.textContent.trim(), opacity, pointerEvents: style.pointerEvents, disabled: !!node.disabled, rendered: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' };
    }));
    const exposed = async (controls, visible, label) => {
      let states = [];
      try {
        await until(async () => {
          states = await controlStates(controls);
          return states.length > 0 && states.every(state => state.rendered && (visible
            ? state.opacity >= (state.disabled ? .15 : .95) && (state.disabled || state.pointerEvents !== 'none')
            : state.opacity <= .01 && state.pointerEvents === 'none'));
        }, label, 4000);
      } catch { throw Error(`${label}: ${JSON.stringify(states)}`); }
      hoverControls.push({ label, visible, states });
    };
    const keyboardFocus = async control => {
      // Enter the real sequential focus order from the preceding control. Opacity
      // and pointer-events must not make hover-only actions keyboard-inaccessible.
      await control.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
      assert.equal(await control.evaluate(node => node === document.activeElement && node.matches(':focus-visible')), true, 'Tab did not focus the hover-only control');
    };
    const hoverAndFocus = async (container, controls, label) => {
      await idlePointer(); await exposed(controls, false, `${label}: hidden at rest`);
      await container.hover(); await exposed(controls, true, `${label}: hover reveals controls`);
      await idlePointer(); await exposed(controls, false, `${label}: pointer leave hides controls`);
      await keyboardFocus(controls.first()); await exposed(controls, true, `${label}: keyboard focus reveals controls`);
      await idlePointer(); await exposed(controls, false, `${label}: focus leave hides controls`);
    };
    const settled = async count => { await until(async () => await rows().count() === count && await bank().getByTestId('bank-question-list').getAttribute('aria-busy') === 'false', `Expected ${count} settled bank cards`); await pause(450); };
    const openBank = async () => { await nav('本地题库').click(); await bank().waitFor(); await until(async () => await bank().getByTestId('bank-question-list').getAttribute('aria-busy') === 'false', 'Bank load did not settle'); };
    const select = async (label, name) => { await bank().getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name, exact: true }).click(); await pause(400); };
    const shot = async (name, hoverTarget) => { await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }); await bank().locator('.bank-catalog-list, .bank-preview-scroll').evaluateAll(nodes => nodes.forEach(node => { node.scrollTop = 0; })); await page.mouse.move(3, 3); await page.evaluate(() => document.fonts.ready); if (hoverTarget) await hoverTarget.hover(); await pause(550); const file = `${name}.png`; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file); };
    const settings = async action => {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '外观', exact: true }).click();
      await action(dialog); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await pause(350);
    };
    const applyAppearance = async item => {
      await settings(async dialog => {
        await dialog.locator('label').filter({ has: page.locator(`input[name="juanye-appearance"][value="${item.mode}"]`) }).click();
        if (item.mode === 'telegram') {
          await dialog.getByRole('group', { name: 'Telegram 明暗模式', exact: true }).getByRole('tab', { name: item.scheme === 'light' ? '浅色' : '深色', exact: true }).click();
          await dialog.locator('label').filter({ has: page.locator(`input[name="juanye-telegram-theme"][value="${item.id}"]`) }).click();
        }
      });
      await page.evaluate(() => document.fonts.ready);
    };
    const bounds = () => bank().evaluate(element => {
      const selectors = ['.bank-workspace-header', '.bank-workspace-layout', '.bank-library-sidebar', '.bank-catalog', '.bank-detail-pane', '.bank-entry', '.bank-basket'];
      const nodes = [{ selector: '.bank-workspace', client: element.clientWidth, scroll: element.scrollWidth, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }, ...selectors.flatMap(selector => [...element.querySelectorAll(selector)].flatMap(node => {
        const rect = node.getBoundingClientRect(); if (!rect.width || !rect.height) return [];
        return [{ selector, client: node.clientWidth, scroll: node.scrollWidth, left: rect.left, right: rect.right }];
      }))];
      const overflow = nodes.filter(node => node.scroll > node.client + 2 || node.left < -1 || node.right > innerWidth + 1);
      return { width: innerWidth, height: innerHeight, document: document.documentElement.scrollWidth, nodes, overflow };
    });

    progress('empty state and complete isolated mixed-type fixture');
    await openBank(); await bank().getByRole('heading', { name: '题库暂无题目', exact: true }).waitFor();
    await shot('bank-empty-dark');
    await page.evaluate(async items => { await window.juanye.bankSave({ questions: items, origin: { examTitle: '春季数学精选 · 本地隔离素材', examId: 'overhaul-fixture' } }); }, questions);
    await nav('组卷').click(); await openBank(); await settled(25);
    assert.equal((await page.evaluate(() => window.juanye.bankLoad())).entries.length, 84);
    assert.equal(await bank().locator('.bank-filter-grid').getByRole('combobox').count(), 3);
    assert.equal(await bank().locator('.bank-type-rail > button').count(), 8);
    for (const name of shortTypes) assert.equal((await bank().locator('.bank-type-rail > button').filter({ hasText: name }).first().locator('small [aria-hidden="true"]').innerText()).trim(), '12');
    assert.match(await bank().locator('.bank-hero-spectrum [role="img"]').getAttribute('aria-label'), /单选 12.*自定义 12/);
    await bank().getByRole('button', { name: '题库下一页', exact: true }).click(); await settled(25);
    await bank().getByRole('button', { name: '题库上一页', exact: true }).click(); await settled(25);
    checks.push('Empty illustration, 84 complete questions, bounded 25-card pagination, seven type counters, live hero spectrum');

    progress('quiet bank header, unboxed footer statistics and hover/keyboard controls');
    assert.equal(await header().getByRole('button', { name: '返回组卷', exact: true }).count(), 0);
    assert.equal(await header().locator('.bank-brand-orb, .bank-workspace-brand .lucide-library').count(), 0);
    assert.equal(await header().locator('[data-tone="favorite"], [data-tone="review"]').count(), 0);
    const sidebarStats = bank().locator('.bank-sidebar-stats');
    assert.equal(await sidebarStats.locator('[data-tone="favorite"], [data-tone="review"]').count(), 2);
    const statGeometry = await sidebarStats.evaluate(node => {
      const rect = node.getBoundingClientRect(), footer = document.querySelector('.bank-sidebar-footer').getBoundingClientRect();
      return { bottom: rect.bottom, footerTop: footer.top, controls: [...node.querySelectorAll('[data-tone]')].map(button => {
        const style = getComputedStyle(button); return { background: style.backgroundColor, border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], shadow: style.boxShadow };
      }) };
    });
    assert.ok(statGeometry.bottom <= statGeometry.footerTop + 1, 'Favorite/review statistics must sit above local-only footer');
    for (const stat of statGeometry.controls) { assert.match(stat.background, /^(transparent|rgba\(0, 0, 0, 0\))$/); assert.deepEqual(stat.border, ['0px', '0px', '0px', '0px']); assert.equal(stat.shadow, 'none'); }
    hoverControls.push({ label: 'Unboxed favorite/review icon counters above local-only footer', statGeometry });
    assert.equal(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), true, 'Desktop hover checks need a fine hover-capable pointer');
    await hoverAndFocus(header(), headerControls(), 'Header actions');
    await hoverAndFocus(catalogHeading(), bank().locator('.bank-catalog-tools button'), 'Catalog display tools');
    await hoverAndFocus(bank().locator('.bank-collection-heading'), bank().locator('.bank-collection-heading button'), 'New collection action');
    await hoverAndFocus(rows().first(), cardControls(rows().first()), 'Question favorite/selection/checkbox');
    await hoverAndFocus(detailTools(), detailTools().locator('button'), 'Detail history/edit actions');
    await hoverAndFocus(detailHeading(), detailHeading().locator('button'), 'Detail collapse action');
    await hoverAndFocus(bank().locator('.bank-preview-scroll'), bank().locator('.bank-preview-bottom-actions button'), 'Detail preview actions');
    await exposed(sidebarStats.locator('button'), true, 'Footer favorite/review navigation remains visible');
    await exposed(bank().locator('.bank-type-rail > button'), true, 'Type filters remain visible');
    await shot('bank-quiet-default-dark');
    await shot('bank-question-hover-dark', rows().first());
    checks.push('Removed top return/library icon; unboxed favorite/review counters above local-only note; seven action groups hide at rest, reveal on hover and real Tab focus');

    progress('type filters preserve contextual counts; selection and keyboard navigation');
    await bank().locator('.bank-type-rail > button').filter({ hasText: '单选' }).click(); await settled(12);
    await select('题库知识点', '函数与运算'); await settled(12);
    assert.equal(await bank().locator('.bank-type-rail > button').count(), 4);
    assert.equal((await bank().locator('.bank-type-rail > button').first().locator('small [aria-hidden="true"]').innerText()).trim(), '36');
    await bank().getByRole('button', { name: '重置筛选', exact: true }).click(); await settled(25);
    await page.locator('body').click({ position: { x: 2, y: 200 } }); await page.keyboard.press('/');
    assert.equal(await bank().getByRole('textbox', { name: '搜索题库', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.keyboard.type('绝不会命中的隔离关键词'); await settled(0);
    await bank().getByRole('heading', { name: '没有符合条件的题目', exact: true }).waitFor();
    await shot('bank-search-empty'); await bank().getByRole('textbox', { name: '搜索题库', exact: true }).focus(); await page.keyboard.press('Escape'); await settled(25);
    await page.keyboard.press('Tab');
    await page.locator('body').click({ position: { x: 2, y: 200 } });
    const firstActive = await bank().locator('.bank-entry[data-active="true"]').getAttribute('data-bank-id');
    await page.keyboard.press('ArrowDown'); await pause(450);
    assert.notEqual(await bank().locator('.bank-entry[data-active="true"]').getAttribute('data-bank-id'), firstActive);
    for (let index = 0; index < 3; index++) { await rows().nth(index).hover(); await rows().nth(index).getByRole('checkbox').click(); }
    await bank().getByTestId('bank-batch-toolbar').waitFor();
    assert.equal(await bank().locator('.bank-entry[data-selected="true"]').count(), 3);
    await idlePointer(); await exposed(bank().locator('.bank-entry[data-selected="true"] [role="checkbox"]'), true, 'Checked question selectors remain visible without hover');
    checks.push('Contextual type counts, always-visible filters, search/Escape, slash focus, arrow preview and three-card batch selection');

    progress('list/grid persisted preference and attractive populated delivery views');
    await applyAppearance({ mode: 'dark' }); await shot('bank-populated-list-dark');
    await catalogHeading().hover(); await bank().getByRole('button', { name: '卡片视图', exact: true }).click(); await pause(600);
    assert.equal(await bank().getByTestId('bank-question-list').getAttribute('data-density'), 'grid');
    assert.equal(await page.evaluate(() => localStorage.getItem('juanye.bankDensity')), 'grid');
    await shot('bank-populated-grid-dark');
    await page.reload(); await openBank(); await settled(25);
    assert.equal(await bank().getByRole('button', { name: '卡片视图', exact: true }).getAttribute('aria-pressed'), 'true');
    await hoverAndFocus(rows().first(), cardControls(rows().first()), 'Grid question favorite/selection/checkbox');
    await catalogHeading().hover(); await bank().getByRole('button', { name: '列表视图', exact: true }).click(); await pause(500);
    assert.equal(await page.evaluate(() => localStorage.getItem('juanye.bankDensity')), 'list');
    checks.push('Both densities render; grid choice survives renderer reload; list choice is saved');

    progress('favorite starburst persists via real IPC and updates sidebar/view counts');
    const favoriteId = await rows().first().getAttribute('data-bank-id');
    await rows().first().hover();
    motion.favorite = await motionFrames(rows().first().getByRole('button', { name: '收藏题目', exact: true }), { burst: '.bank-star-burst', star: '.bank-favorite[data-favorite="true"] > span' });
    motion.favoriteEvidence = renderedMotion(motion.favorite, 'burst', 'Favorite star burst');
    assert.equal((await page.evaluate(() => window.juanye.bankLoad())).entries.find(entry => entry.id === favoriteId).favorite, true);
    assert.equal((await bank().locator('.bank-sidebar-stats [data-tone="favorite"] b [aria-hidden="true"]').innerText()).trim(), '1');
    await idlePointer(); await exposed(rows().first().locator('.bank-favorite[data-favorite="true"]'), true, 'Favorited question star remains visible without hover');
    await bank().locator('[data-bank-view="favorites"]').click(); await settled(1);
    await bank().locator('[data-bank-view="all"]').click(); await settled(25);
    checks.push('Rendered favorite particles, persisted favorite, live sidebar count, favorite view and always-visible favorited star');

    progress('fly-to-basket, native drop, reordering, removal, clear and workspace persistence');
    await rows().first().hover();
    motion.flight = await motionFrames(rows().first().getByRole('button', { name: '选题', exact: true }), { flight: '.bank-flight > span', anchor: '[data-basket-anchor]' }, 1100);
    motion.flightEvidence = renderedMotion(motion.flight, 'flight', 'Fly-to-basket');
    assert.equal((await basketIds()).length, 1); assert.equal(await page.locator('.bank-flight').count(), 0);
    await idlePointer(); await exposed(rows().first().locator('.bank-pick[data-picked]'), true, 'Already-picked question action remains visible without hover');
    const drop = await rows().nth(1).evaluate(async card => {
      const transfer = new DataTransfer(), target = document.querySelector('[data-testid="bank-basket"]');
      card.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const active = target.dataset.drop;
      const result = { types: [...transfer.types], payload: transfer.getData('application/x-juanye-bank-id'), active };
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      card.dispatchEvent(new DragEvent('dragend', { dataTransfer: transfer, bubbles: true })); return result;
    });
    assert.equal(drop.active, 'true'); assert.ok(drop.types.includes('application/x-juanye-bank-id'));
    await until(async () => (await basketIds()).length === 2, 'Native bank drop failed'); await pause(450);
    await hoverAndFocus(basket().locator('.bank-basket-item').nth(1), basketTools(basket().locator('.bank-basket-item').nth(1)), 'Basket row actions');
    progress('real touch/no-hover media fallback keeps controls discoverable');
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await until(() => page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), 'Chromium did not expose a real coarse/no-hover pointer');
      await idlePointer();
      for (const [label, controls] of [
        ['Touch header actions', headerControls()],
        ['Touch catalog tools', bank().locator('.bank-catalog-tools button')],
        ['Touch new collection action', bank().locator('.bank-collection-heading button')],
        ['Touch question actions', cardControls(rows().nth(2))],
        ['Touch detail tools', detailTools().locator('button')],
        ['Touch detail collapse', detailHeading().locator('button')],
        ['Touch detail preview actions', bank().locator('.bank-preview-bottom-actions button')],
        ['Touch basket row actions', basketTools(basket().locator('.bank-basket-item').nth(1))],
      ]) await exposed(controls, true, label);
      hoverControls.push({ label: 'Native no-hover media verified', media: await page.evaluate(() => ({ hoverNone: matchMedia('(hover: none)').matches, coarse: matchMedia('(pointer: coarse)').matches, maxTouchPoints: navigator.maxTouchPoints })) });
    } finally {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach();
    }
    await until(() => page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches), 'Desktop pointer media was not restored');
    await idlePointer(); await exposed(headerControls(), false, 'Desktop hover-only behavior is restored after touch fallback');
    checks.push('Basket row actions reveal on hover/Tab; native Chromium coarse/no-hover mode exposes all eight control groups; desktop mode restores hidden actions');
    const originalOrder = await basketIds();
    await basket().locator('.bank-basket-item').nth(1).hover();
    await basket().getByRole('button', { name: '上移选题 2', exact: true }).click(); await pause(400);
    assert.deepEqual(await basketIds(), [...originalOrder].reverse());
    await nav('组卷').click(); await openBank(); assert.deepEqual(await basketIds(), [...originalOrder].reverse());
    await basket().locator('.bank-basket-item').first().hover(); await basket().getByRole('button', { name: '移除选题 1', exact: true }).click(); assert.equal((await basketIds()).length, 1);
    await basket().getByRole('button', { name: '清空选题篮', exact: true }).click(); assert.equal((await basketIds()).length, 0);
    for (let index = 0; index < 3; index++) { await rows().nth(index).hover(); await rows().nth(index).getByRole('checkbox').click(); }
    await bank().getByTestId('bank-batch-toolbar').getByRole('button', { name: '加入选题篮', exact: true }).click();
    await until(async () => (await basketIds()).length === 3, 'Batch basket add failed'); await pause(1200);
    const scores = await basket().locator('.bank-basket-item small').allTextContents();
    assert.deepEqual(await basket().locator('.bank-basket-summary [aria-hidden="true"]').allTextContents(), ['3', String(scores.reduce((sum, text) => sum + parseFloat(text), 0))]);
    await bank().locator('.bank-result-toolbar').getByRole('button', { name: '清除', exact: true }).click();
    checks.push('Actual flight frames, native drag MIME/drop hint, order controls, remove/clear, batch add, exact score and workspace persistence');

    progress('figure keyboard activation, Escape, focus confinement and restoration');
    await bank().locator('.bank-type-rail > button').filter({ hasText: '解答' }).click(); await settled(12);
    await rows().first().getByRole('button', { name: /^预览题目/ }).click();
    const zoom = bank().getByRole('button', { name: '放大题图', exact: true }); await zoom.waitFor();
    await zoom.focus(); await page.keyboard.press('Enter');
    const lightbox = page.getByRole('dialog', { name: '题图大图', exact: true }); await lightbox.waitFor(); await pause(450);
    assert.equal(await lightbox.getAttribute('aria-modal'), 'true');
    assert.equal(await lightbox.evaluate(node => node.contains(document.activeElement)), true, 'Lightbox did not take focus');
    for (const key of ['Tab', 'Tab', 'Shift+Tab']) { await page.keyboard.press(key); assert.equal(await lightbox.evaluate(node => node.contains(document.activeElement)), true, 'Lightbox leaked keyboard focus'); }
    await page.keyboard.press('Escape'); await lightbox.waitFor({ state: 'hidden' });
    assert.equal(await zoom.evaluate(node => node === document.activeElement), true, 'Lightbox did not restore trigger focus');
    await bank().locator('.bank-type-rail > button').first().click(); await settled(25);
    checks.push('Figure trigger is keyboard-operable; modal takes/traps/restores focus; Escape closes without changing preview');

    progress('all 20 actual settings appearances and supported-width geometry');
    for (const item of [{ mode: 'dark' }, { mode: 'light' }, ...themes.flatMap(id => [{ mode: 'telegram', scheme: 'dark', id }, { mode: 'telegram', scheme: 'light', id }])]) {
      await applyAppearance(item);
      const actualSettings = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, scheme: document.documentElement.dataset.telegramScheme, themeId: document.documentElement.dataset.telegramTheme, accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(), background: getComputedStyle(document.querySelector('.bank-catalog')).backgroundColor, color: getComputedStyle(document.querySelector('.bank-entry-stem')).color }));
      assert.equal(actualSettings.theme, item.mode); if (item.mode === 'telegram') { assert.equal(actualSettings.scheme, item.scheme); assert.equal(actualSettings.themeId, item.id); }
      assert.ok(actualSettings.accent && !actualSettings.accent.includes('var('), `Unresolved accent: ${JSON.stringify(item)}`);
      const geometry = await bounds(); assert.deepEqual(geometry.overflow, [], `${JSON.stringify(item)} horizontal overflow`); assert.ok(geometry.document <= geometry.width + 1);
      appearances.push({ requested: item, actualSettings, geometry });
      if (item.mode === 'light') await shot('bank-populated-list-light');
      if (item.mode === 'telegram' && item.id === 'ember') {
        await shot(`bank-populated-list-telegram-${item.scheme}`);
        await catalogHeading().hover(); await bank().getByRole('button', { name: '卡片视图', exact: true }).click(); await pause(500); await shot(`bank-populated-grid-telegram-${item.scheme}`);
        await catalogHeading().hover(); await bank().getByRole('button', { name: '列表视图', exact: true }).click(); await pause(500);
      }
    }
    const widths = [];
    for (const width of [1000, 1280, 1500]) for (const density of ['列表视图', '卡片视图']) {
      await page.setViewportSize({ width, height: 900 }); await catalogHeading().hover(); await bank().getByRole('button', { name: density, exact: true }).click(); await pause(500);
      const geometry = await bounds(); assert.deepEqual(geometry.overflow, [], `${width}px ${density} horizontal overflow`); assert.ok(geometry.document <= geometry.width + 1); widths.push({ density, ...geometry });
    }
    await page.setViewportSize({ width: 1500, height: 900 });
    await catalogHeading().hover(); await bank().getByRole('button', { name: '列表视图', exact: true }).click();
    checks.push('Public settings really apply all 20 appearances; list/grid stay within 1000/1280/1500px supported widths');

    progress('new-editor sections, keyboard tabs and independent unsaved bank draft');
    await settings(async dialog => { const toggle = dialog.getByRole('switch', { name: '实验性题目编辑台', exact: true }); if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click(); });
    await header().hover(); await bank().getByRole('button', { name: '新建题目', exact: true }).click();
    const editor = bank().getByTestId('bank-question-editor'); await editor.waitFor();
    const tablist = editor.getByRole('tablist', { name: '题目编辑分组', exact: true }); assert.equal(await tablist.getByRole('tab').count(), 4);
    await editor.getByPlaceholder('输入题干…', { exact: true }).fill('本地题库独立草稿：$x+1=3$');
    for (const [name, group] of [['答案解析', 'answers'], ['题图与绘图', 'figures'], ['属性', 'properties'], ['题目', 'question']]) {
      await tablist.getByRole('tab', { name, exact: true }).click();
      const visibleGroups = await editor.locator('[data-workbench-group]').evaluateAll(nodes => [...new Set(nodes.filter(node => !node.hidden).map(node => node.dataset.workbenchGroup))]); assert.deepEqual(visibleGroups, [group]);
    }
    await tablist.getByRole('tab', { name: '题目', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await tablist.getByRole('tab', { name: '答案解析', exact: true }).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End'); assert.equal(await tablist.getByRole('tab', { name: '属性', exact: true }).getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    await nav('组卷').click(); await openBank(); await editor.waitFor();
    assert.equal(await editor.getByPlaceholder('输入题干…', { exact: true }).inputValue(), '本地题库独立草稿：$x+1=3$');
    await shot('bank-new-editor-question');
    await bank().locator('.bank-edit-footer').getByRole('button', { name: '取消', exact: true }).click(); await pause(450);
    checks.push('Four editor sections, correct hidden groups, roving keyboard tabs and unsaved bank draft survive workspace switches');

    progress('OS and explicit reduced motion preserve function without decorative flight/burst');
    for (const preference of ['system', 'setting']) {
      if (preference === 'system') { await page.emulateMedia({ reducedMotion: 'reduce' }); await pause(250); }
      else {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await settings(async dialog => { await dialog.getByRole('tab', { name: '减弱', exact: true }).click(); });
        assert.equal(await page.locator('[data-interface-motion]').getAttribute('data-interface-motion'), 'reduced');
      }
      await basket().getByRole('button', { name: '清空选题篮', exact: true }).click();
      await rows().first().hover();
      const frames = await motionFrames(rows().first().getByRole('button', { name: '选题', exact: true }), { flight: '.bank-flight', count: '.bank-basket-summary' }, 350);
      assert.equal(frames.filter(frame => frame.nodes.flight).length, 0, `${preference} reduced motion creates a flight`);
      assert.equal((await basketIds()).length, 1);
      const favorite = rows().filter({ has: page.getByRole('button', { name: '收藏题目', exact: true }) }).first();
      await favorite.hover();
      const favoriteFrames = await motionFrames(favorite.getByRole('button', { name: '收藏题目', exact: true }), { burst: '.bank-star-burst' }, 350);
      assert.equal(favoriteFrames.filter(frame => frame.nodes.burst).length, 0, `${preference} reduced motion creates particles`);
      motion[`reduced-${preference}`] = { flightFrames: frames, favoriteFrames };
    }
    checks.push('System and in-app reduced motion suppress flight/particle decoration while basket/favorite actions still work');
    assert.deepEqual((await page.evaluate(() => window.juanye.loadDraft())).exam, exam, 'UI overhaul QA changed the current paper');
    const counters = await app.evaluate(() => globalThis.__overhaul);
    assert.equal(counters.network + rendererRequests, 0); assert.equal(counters.modelCalls, 0); assert.deepEqual(errors, []);
    report = { passed: true, packaged, build, checks, screenshots, appearances, widths, hoverControls, motion, nativeDrop: drop, externalRequests: counters.network + rendererRequests, paidModelCalls: counters.modelCalls, rendererErrors: errors, profile, note: 'Real Electron/preload IPC, isolated synthetic data, no accounts/network/paid calls. Offscreen inactive window; snapshots demonstrate renderer output, not desktop FPS.' };
    console.log(JSON.stringify({ passed: true, packaged, checks, screenshots, appearances: appearances.length, externalRequests: 0, paidModelCalls: 0 }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    report = { passed: false, packaged, build, stage, error: error.stack || String(error), checks, screenshots, appearances, hoverControls, motion, rendererErrors: errors, profile };
    console.error(JSON.stringify({ ...report, motion: Object.keys(motion) }, null, 2)); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
