/* Local-only wallpaper QA: synthetic draft, temporary userData, no account, cloud or PDF calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const suffix = packaged ? 'packaged' : 'source';
const output = path.join(root, 'artifacts/qa-v022');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(60); }
  throw new Error(message);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-wallpaper-qa-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const question = (id, type, stem) => ({ id, type, stem, score: type === 'essay' ? 12 : 5, options: type === 'single' ? ['$1$', '$2$', '$3$', '$4$'] : [], answer: [], analysis: '' });
  const exam = { title: '花纹动效 · 隔离示例', subtitle: '本地测试', duration: 120, notice: [], sections: [
    { id: 'qa-s1', type: 'single', title: '单项选择题', note: '', questions: [question('qa-q1', 'single', '已知函数 $f(x)=x^2$，则 $f(2)$ 的值为'), question('qa-q2', 'single', '若集合 $A=\\{1,2\\}$，则下列结论正确的是')] },
    { id: 'qa-s2', type: 'essay', title: '解答题', note: '', questions: [question('qa-q3', 'essay', '已知函数 $f(x)=x^2-2x$。\n(1) 求函数的最小值；\n(2) 求 $f(x)\\le0$ 的解集。')] },
  ] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: true, answerMode: 'none' };
  fs.writeFileSync(path.join(userData, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(output, { recursive: true });
  let app, page, stage = 'launch', timedOut = false, rendererRequests = 0;
  const errors = [], checks = [], snapshots = [], screenshots = [];
  const progress = name => { stage = name; console.log(JSON.stringify({ progress: name })); };
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(JSON.stringify({ passed: false, stage, error: 'Wallpaper QA exceeded 110 seconds' }));
    try { app?.process().kill(); } catch {}
    process.exitCode = 1;
  }, 110000);
  const sidebar = () => page.getByRole('complementary', { name: '试卷目录', exact: true });
  async function openAppearance() {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '外观', exact: true }).click();
    await dialog.getByText('界面模式', { exact: true }).waitFor();
    return dialog;
  }
  async function appearance(mode) {
    const dialog = await openAppearance();
    await dialog.locator('label').filter({ has: page.locator(`input[name="juanye-appearance"][value="${mode}"]`) }).click();
    await until(async () => await page.evaluate(() => document.documentElement.dataset.theme) === mode, `Theme did not become ${mode}`);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await pause(350);
  }
  async function motion(value) {
    const dialog = await openAppearance();
    await dialog.getByRole('tab', { name: value === 'reduced' ? '减弱' : '完整', exact: true }).click();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await until(async () => await page.locator('.app-bg').getAttribute('data-interface-motion') === value, `Motion state did not become ${value}`);
    await pause(300);
  }
  async function layers() {
    return page.evaluate(() => {
      const describe = (style, content) => ({ content, display: style.display, visibility: style.visibility, opacity: Number(style.opacity), backgroundImage: style.backgroundImage.startsWith('url("data:') ? `url("data:image/svg+xml; ${style.backgroundImage.length} chars")` : style.backgroundImage, backgroundPosition: style.backgroundPosition, backgroundSize: style.backgroundSize, pointerEvents: style.pointerEvents, animationName: style.animationName, animationDuration: style.animationDuration, animationPlayState: style.animationPlayState, transform: style.transform, clipPath: style.clipPath });
      const result = {};
      for (const selector of ['.workspace-editor-stage', '.canvas-dots']) {
        const host = document.querySelector(selector);
        if (!host) { result[selector] = null; continue; }
        const shared = host.closest('.workspace-stage');
        const clippingLayer = shared?.querySelector(':scope > .workspace-wallpaper');
        const explicit = shared ? shared.querySelector(':scope > [data-wallpaper-layer]') : host.querySelector(':scope > [data-wallpaper-layer]');
        const style = clippingLayer ? getComputedStyle(clippingLayer, '::before') : explicit ? getComputedStyle(explicit) : getComputedStyle(shared || host, '::before');
        const clippingStyle = clippingLayer ? getComputedStyle(clippingLayer) : null;
        result[selector] = { ...describe(style, explicit && !clippingLayer ? 'element' : style.content), layerHost: clippingLayer ? '.workspace-wallpaper' : shared ? '.workspace-stage' : selector, hostBackground: getComputedStyle(host).backgroundColor, clipOverflow: clippingStyle?.overflow ?? null, clipPointerEvents: clippingStyle?.pointerEvents ?? null };
      }
      return result;
    });
  }
  const visible = layer => layer && layer.display !== 'none' && layer.visibility !== 'hidden' && layer.opacity > 0 && layer.content !== 'none' && layer.content !== 'normal' && layer.backgroundImage !== 'none';
  const running = layer => visible(layer) && layer.animationName !== 'none' && layer.animationPlayState !== 'paused' && layer.animationDuration.split(',').some(duration => parseFloat(duration) > 0.1);
  async function assertStatic(label, active) {
    const before = await layers();
    await pause(350);
    const after = await layers();
    for (const [selector, layer] of Object.entries(after)) {
      assert.ok(layer, `${label}: missing ${selector}`);
      assert.equal(running(layer), false, `${label}: ${selector} wallpaper is still animated`);
      assert.equal(layer.transform, before[selector].transform, `${label}: ${selector} transform moved`);
      assert.equal(layer.backgroundPosition, before[selector].backgroundPosition, `${label}: ${selector} background moved`);
      if (active) assert.ok(visible(layer), `${label}: static wallpaper disappeared`);
      else assert.equal(visible(layer), false, `${label}: Telegram wallpaper is visible in another theme`);
    }
    snapshots.push({ label, layers: after });
  }
  async function geometry() {
    return page.evaluate(() => {
      const editor = document.querySelector('.workspace-editor-stage');
      const preview = document.querySelector('.canvas-dots');
      const sidebar = document.querySelector('[aria-label="试卷目录"]');
      const nodes = { main: editor.parentElement, sidebar, editor, preview: preview.parentElement.parentElement };
      const result = {};
      for (const [name, el] of Object.entries(nodes)) {
        const r = el.getBoundingClientRect();
        result[name] = { x: r.x, y: r.y, width: r.width, height: r.height, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight };
      }
      result.canvas = { clientWidth: preview.clientWidth, scrollWidth: preview.scrollWidth, clientHeight: preview.clientHeight, scrollHeight: preview.scrollHeight };
      result.document = { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
      return result;
    });
  }
  function assertSameGeometry(before, after, label) {
    for (const name of ['main', 'sidebar', 'editor', 'preview']) for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(after[name][key] - before[name][key]) < 0.75, `${label}: ${name}.${key} changed from ${before[name][key]} to ${after[name][key]}`);
    }
    for (const name of ['main', 'editor', 'preview', 'canvas', 'document']) assert.ok(after[name].scrollWidth <= after[name].clientWidth + 1, `${label}: ${name} gained horizontal overflow`);
    assert.equal(after.canvas.scrollHeight, before.canvas.scrollHeight, `${label}: wallpaper increased preview scroll height`);
  }
  async function settle() {
    let previous, stableSince = 0;
    await until(async () => {
      const current = await geometry();
      const stable = previous && ['main', 'sidebar', 'editor', 'preview'].every(name => ['x', 'y', 'width', 'height'].every(key => Math.abs(current[name][key] - previous[name][key]) < 0.1));
      previous = current;
      if (!stable) stableSince = 0;
      else if (!stableSince) stableSince = Date.now();
      return stable && Date.now() - stableSince >= 600;
    }, 'Workspace motion did not settle');
    await pause(450);
  }
  async function assertPaper(label) {
    const paper = await page.locator('.paper[data-sheet]').first().evaluate(el => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, color: style.color, backgroundImage: style.backgroundImage };
    });
    assert.equal(paper.background, 'rgb(255, 255, 255)', `${label}: paper is not white`);
    assert.equal(paper.backgroundImage, 'none', `${label}: wallpaper leaked onto printed paper`);
    assert.ok(/^rgb\((\d+), (\d+), (\d+)\)$/.test(paper.color) && paper.color.match(/\d+/g).every(channel => Number(channel) < 40), `${label}: paper text is not dark`);
    snapshots.push({ label, paper });
  }
  async function screenshot(name) {
    await page.mouse.move(5, 5);
    await settle();
    const filename = `wallpaper-${name}-${suffix}.png`;
    await page.screenshot({ path: path.join(output, filename) });
    screenshots.push(filename);
  }
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env, timeout: 30000 });
    await app.evaluate(({ session, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (typeof window?.webContents.setBackgroundThrottling === 'function') window.webContents.setBackgroundThrottling(false);
      globalThis.__wallpaperRequests = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__wallpaperRequests++; callback({ cancel: true }); });
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(9000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { rendererRequests++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('textarea');
    await page.evaluate(() => { localStorage.setItem('juanye.appearance.v1', 'telegram'); localStorage.setItem('juanye.telegram-theme.v1', 'ember'); localStorage.setItem('juanye.sidebar-expanded.v1', 'true'); });
    await page.reload();
    await page.waitForSelector('.workspace-editor-stage textarea');
    await page.locator('.paper[data-sheet]').first().waitFor();
    await settle();
    await screenshot('expanded');
    console.log(JSON.stringify({ screenshot: path.join(output, `wallpaper-expanded-${suffix}.png`) }));
    progress('Telegram wallpaper presence, motion and fixed geometry');
    assert.equal(await page.locator('.app-bg').getAttribute('data-interface-motion'), 'full');
    const before = await layers(), beforeGeometry = await geometry();
    for (const [selector, layer] of Object.entries(before)) {
      assert.ok(visible(layer), `${selector}: wallpaper is not visible`);
      assert.equal(layer.hostBackground, 'rgba(0, 0, 0, 0)', `${selector}: opaque host hides shared wallpaper`);
      assert.equal(layer.pointerEvents, 'none', `${selector}: wallpaper can intercept pointer input`);
      if (layer.layerHost === '.workspace-wallpaper') {
        assert.equal(layer.clipOverflow, 'hidden', `${selector}: wallpaper is not clipped to the workspace`);
        assert.equal(layer.clipPointerEvents, 'none', `${selector}: wallpaper wrapper can intercept input`);
      }
      assert.ok(running(layer), `${selector}: wallpaper is not animated with full motion`);
    }
    await pause(1000);
    const after = await layers(), afterGeometry = await geometry();
    snapshots.push({ label: 'full motion', before, after, beforeGeometry, afterGeometry });
    for (const selector of Object.keys(after)) assert.ok(after[selector].transform !== before[selector].transform || after[selector].backgroundPosition !== before[selector].backgroundPosition, `${selector}: wallpaper did not actually move`);
    assertSameGeometry(beforeGeometry, afterGeometry, 'Full wallpaper animation');
    checks.push('Both workspace backgrounds show non-interactive moving patterns without changing pane or scroll geometry');
    await assertPaper('Telegram');
    const textarea = page.locator('.workspace-editor-stage textarea').first();
    const initial = await textarea.inputValue();
    assert.ok(await textarea.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + 12) === el; }), 'Wallpaper covers question input hit target');
    await textarea.click();
    await textarea.fill(`${initial}\n花纹不遮挡编辑`);
    assert.match(await textarea.inputValue(), /花纹不遮挡编辑/);
    await textarea.fill(initial);
    checks.push('Question text remains clickable and editable; paper stays white with dark text');
    progress('Collapsed sidebar and motion preferences');
    await sidebar().getByRole('button', { name: '收起试卷目录', exact: true }).click();
    await until(async () => Math.abs((await sidebar().boundingBox()).width - 76) < 1, 'Sidebar did not collapse at its existing 76px width', 12000);
    await screenshot('collapsed');
    const collapsedBefore = await geometry();
    await pause(700);
    assertSameGeometry(collapsedBefore, await geometry(), 'Collapsed workspace wallpaper');
    await motion('reduced');
    await assertStatic('User reduced motion', true);
    await motion('full');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await assertStatic('System reduced motion', true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await until(async () => Object.values(await layers()).every(running), 'Wallpaper did not resume with full motion');
    checks.push('User and system reduced-motion settings both stop wallpaper animation; full motion resumes');
    progress('Original light/dark themes and isolated draft');
    for (const mode of ['light', 'dark']) {
      await appearance(mode);
      await assertStatic(`${mode} theme`, false);
      await assertPaper(mode);
    }
    const draft = await page.evaluate(() => window.juanye.loadDraft());
    assert.equal(draft.exam.title, exam.title);
    assert.equal(draft.exam.sections.flatMap(section => section.questions).length, 3);
    checks.push('Original light/dark themes have no Telegram pattern animation and preserve white paper');
    assert.deepEqual(errors, [], 'Renderer reported uncaught errors');
    const requests = rendererRequests + await app.evaluate(() => globalThis.__wallpaperRequests);
    assert.equal(requests, 0, 'Wallpaper QA attempted an external network request');
    assert.equal(timedOut, false, 'Wallpaper QA exceeded its deadline');
    const report = { passed: true, packaged, checks, errors, cloudRequests: requests, pdfExports: 0, screenshotsAreIsolatedRendererOnly: true, screenshots, snapshots };
    fs.writeFileSync(path.join(output, `wallpaper-results-${suffix}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, packaged, checks, cloudRequests: requests, screenshots }));
  } catch (error) {
    const report = { passed: false, packaged, stage, error: String(error), errors, checks, snapshots, timedOut };
    fs.writeFileSync(path.join(output, `wallpaper-results-${suffix}.json`), JSON.stringify(report, null, 2));
    console.error(JSON.stringify({ passed: false, packaged, stage, error: String(error), errors, checks, timedOut, report: path.join(output, `wallpaper-results-${suffix}.json`) }));
    throw error;
  } finally {
    clearTimeout(timer);
    if (app) {
      try { await Promise.race([app.close(), pause(5000).then(() => { try { app.process().kill(); } catch {} })]); } catch {}
    }
    const resolved = fs.realpathSync(userData);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-wallpaper-qa-')) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
