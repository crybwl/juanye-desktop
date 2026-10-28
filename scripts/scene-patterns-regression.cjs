/* Actual settings-driven scene QA. Synthetic isolated profile; no network/model calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const output = path.join(root, 'artifacts', 'qa-scene-patterns', packaged ? 'packaged' : 'source');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const patterns = ['study', 'geometry', 'botanical', 'cosmos', 'contours', 'lattice'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-scene-patterns-'));
  const question = { id: 'scene-q1', type: 'single', stem: '已知 $f(x)=x^2$，求 $f(2)$。', options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis: '代入得 $4$。', score: 5 };
  const exam = { id: 'scene-exam', title: '图案背景 · 隔离样卷', subtitle: '', duration: 90, notice: [], sections: [{ id: 'scene-s1', type: 'single', title: '单项选择题', note: '', questions: [question] }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, paperMode: 'questions', answerMode: 'none' };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const checks = [], variants = [], screenshots = [], errors = [];
  let app, page, report, stage = 'launch', external = 0;
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: value, packaged })); };
  const watchdog = setTimeout(() => { app?.process().kill(); console.error(`Scene pattern QA timeout: ${stage}`); process.exit(1); }, 140000);
  const buildFile = path.join(root, packaged ? 'release/win-unpacked/resources/app.asar' : 'dist/index.html');
  const build = { file: buildFile, sha256: digest(fs.readFileSync(buildFile)) };
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env });
    await app.evaluate(({ BrowserWindow, session, ipcMain }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive();
      globalThis.__sceneQA = { requests: 0, models: 0 };
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => { globalThis.__sceneQA.requests++; done({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__sceneQA.models++; throw Error('No model calls in scene QA'); });
    });
    page = await app.firstWindow(); page.setDefaultTimeout(9000); await page.setViewportSize({ width: 1400, height: 940 }); await page.emulateMedia({ reducedMotion: 'no-preference' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { external++; return route.abort('blockedbyclient'); });
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    const settings = async () => { await page.getByRole('button', { name: '设置', exact: true }).click(); const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '外观', exact: true }).click(); return dialog; };
    const appearance = async (dialog, mode) => dialog.locator('label').filter({ has: page.locator(`input[name="juanye-appearance"][value="${mode}"]`) }).click();
    const settle = async expected => {
      await page.waitForFunction(expected => document.documentElement.dataset.sceneReady === 'true' && document.documentElement.dataset.sceneTextureKey?.endsWith(expected), expected);
      const scene = await page.locator('.scene-backdrop-art').evaluate(node => getComputedStyle(node).backgroundImage);
      assert.match(scene, /data:image\/png/, 'The application must display the cached raster texture, not rerender moving vector nodes');
      assert.equal(await page.locator('[data-scene-backdrop]').count(), 1);
      return digest(scene);
    };
    const close = async dialog => { await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await pause(250); };
    const shot = async name => {
      await page.mouse.move(550, 25); await page.evaluate(() => document.fonts.ready); await pause(120);
      const target = path.join(output, `${name}.png`);
      const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'));
      fs.writeFileSync(target, Buffer.from(bytes, 'base64')); screenshots.push(target);
    };
    progress('six distinct actual PNG scenes in both Telegram schemes');
    for (const scheme of ['dark', 'light']) {
      const palette = scheme === 'dark' ? 'ocean' : 'ember';
      let dialog = await settings(); await appearance(dialog, 'telegram');
      await dialog.getByRole('group', { name: 'Telegram 明暗模式', exact: true }).getByRole('tab', { name: scheme === 'light' ? '浅色' : '深色', exact: true }).click();
      await dialog.locator('label').filter({ has: page.locator(`input[name="juanye-telegram-theme"][value="${palette}"]`) }).click();
      const hashes = new Set();
      for (const pattern of patterns) {
        await dialog.locator('label').filter({ has: page.locator(`input[name="juanye-scene-pattern"][value="${pattern}"]`) }).click();
        const hash = await settle(`:${pattern}:large:rich`); hashes.add(hash); variants.push({ scheme, palette, pattern, hash });
        if (pattern === 'cosmos') await shot(`settings-gallery-${scheme}`);
        await close(dialog); await shot(`${scheme}-${pattern}`); dialog = await settings();
      }
      assert.equal(hashes.size, 6, `${scheme}: choices reused the same picture`); await close(dialog);
    }
    checks.push('All six patterns produce distinct decoded local PNGs in dark/light; actual pattern thumbnails and one scene owner');
    progress('size/density change real artwork and preferences survive reload');
    let dialog = await settings(); const picker = dialog.getByTestId('scene-pattern-picker');
    const sizes = new Set();
    for (const [value, label] of [['small', '小'], ['standard', '标准'], ['large', '大']]) { await picker.getByRole('group', { name: '图案大小', exact: true }).getByRole('tab', { name: label, exact: true }).click(); sizes.add(await settle(`:lattice:${value}:rich`)); }
    assert.equal(sizes.size, 3);
    const densities = new Set();
    for (const [value, label] of [['sparse', '疏'], ['balanced', '适中'], ['rich', '丰富']]) { await picker.getByRole('group', { name: '图案密度', exact: true }).getByRole('tab', { name: label, exact: true }).click(); densities.add(await settle(`:lattice:large:${value}`)); }
    assert.equal(densities.size, 3);
    await dialog.locator('label').filter({ has: page.locator('input[name="juanye-scene-pattern"][value="botanical"]') }).click(); await settle(':botanical:large:rich'); await close(dialog);
    await page.reload(); await page.getByPlaceholder('输入题干…', { exact: true }).waitFor(); await settle(':botanical:large:rich');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('juanye.scene-pattern.v1'))); assert.deepEqual(saved, { pattern: 'botanical', size: 'large', density: 'rich' });
    checks.push('Every size/density changes the actual cached picture; selection persists independently after reload');
    progress('animation and paper/input isolation; ordinary modes unchanged');
    const transform = () => page.locator('.scene-backdrop-art').evaluate(node => getComputedStyle(node).transform);
    const first = await transform(); await pause(250); assert.notEqual(await transform(), first, 'Existing full-motion scene drift stopped');
    await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await page.locator('.scene-backdrop-art').evaluate(node => getComputedStyle(node).animationName), 'none'); await page.emulateMedia({ reducedMotion: 'no-preference' });
    const papers = await page.locator('.workspace-preview-stage [data-sheet]').evaluateAll(nodes => nodes.map(node => ({ background: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage })));
    assert.ok(papers.length > 0); for (const paper of papers) assert.deepEqual(paper, { background: 'rgb(255, 255, 255)', image: 'none' });
    assert.deepEqual(await page.locator('input,textarea,.workbench-live-preview').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => /data:image\/(?:png|svg)/.test(getComputedStyle(node).backgroundImage)).map(node => node.tagName)), []);
    const before = await page.locator('.scene-backdrop-art').evaluate(node => getComputedStyle(node).backgroundImage); await page.getByPlaceholder('输入题干…', { exact: true }).pressSequentially(' 本地输入'); await pause(250);
    assert.equal(await page.locator('.scene-backdrop-art').evaluate(node => getComputedStyle(node).backgroundImage), before, 'Typing rebuilt the scene texture');
    dialog = await settings(); await appearance(dialog, 'light'); await close(dialog); assert.equal(await page.locator('.scene-backdrop').evaluate(node => getComputedStyle(node).display), 'none');
    dialog = await settings(); await appearance(dialog, 'telegram'); await close(dialog); await settle(':botanical:large:rich');
    const requests = await app.evaluate(() => globalThis.__sceneQA); assert.deepEqual(requests, { requests: 0, models: 0 }); assert.equal(external, 0); assert.deepEqual(errors, []);
    checks.push('Drift retained, OS reduced motion honored, paper/inputs clear, typing does not rebuild texture, ordinary mode has no pattern');
    report = { passed: true, packaged, build, checks, variants, screenshots, requests, externalRequests: external, errors };
    console.log(JSON.stringify({ passed: true, packaged, checks, variants: variants.length, screenshots: screenshots.length, requests }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    report = { passed: false, packaged, stage, build, error: error.stack || String(error), checks, variants, screenshots, errors };
    console.error(JSON.stringify({ passed: false, stage, error: report.error })); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    const resolved = fs.realpathSync(profile), temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved).toLowerCase() === temp.toLowerCase() && path.basename(resolved).startsWith('juanye-scene-patterns-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
