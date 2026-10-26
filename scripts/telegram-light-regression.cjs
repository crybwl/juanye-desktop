/* Focused daylight-theme QA. Synthetic draft and isolated profile, no model calls or user documents. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const capture = process.argv.includes('--screenshots');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const paletteNames = ['海蓝', '春芽', '霜雪', '宝石', '课堂', '花语', '暮紫', '暖橙', '霓虹'];
const paletteIds = ['ocean', 'spring', 'frost', 'gem', 'classroom', 'blossom', 'dusk', 'ember', 'neon'];
const luminance = rgb => {
  const channels = /^#[\da-f]{6}$/i.test(rgb) ? rgb.slice(1).match(/../g).map(value => parseInt(value, 16)) : rgb.match(/[\d.]+/g).slice(0, 3).map(Number);
  const values = channels.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
};
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-telegram-daylight-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const exam = { title: '卷页 · 浅色外观', subtitle: '本地隔离样例', duration: 90, notice: [], sections: [{ id: 's', title: '单项选择题', type: 'single', note: '', questions: [{ id: 'q1', type: 'single', score: 5, stem: '已知 $f(x)=x^2$，则 $f(2)$ 的值是（　　）。\n\n| 条件 | 数值 |\n| --- | --- |\n| 输入 | $2$ |', options: ['$1$', '$2$', '$3$', '$4$'], answer: ['D'], analysis: '代入 $x=2$，得 $f(2)=4$。' }] }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false, paperMode: 'questions', answerMode: 'none' };
  fs.writeFileSync(path.join(profile, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  let app; const errors = [], checks = [], screenshots = [];
  const watchdog = setTimeout(() => { app?.process().kill(); process.exitCode = 1; }, 100000);
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env });
    await app.evaluate(({ BrowserWindow, ipcMain, session }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setSize(1500, 980); win.setPosition(-16000, -16000); win.showInactive();
      globalThis.__daylightRequests = 0; globalThis.__daylightModelCalls = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => { globalThis.__daylightRequests++; cb({ cancel: true }); });
      ipcMain.removeHandler('model:recognize'); ipcMain.handle('model:recognize', () => { globalThis.__daylightModelCalls++; throw Error('No OCR during theme QA'); });
    });
    const page = await app.firstWindow(); page.setDefaultTimeout(8000); await page.setViewportSize({ width: 1500, height: 980 });
    page.on('pageerror', error => errors.push(error.message));
    await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    await page.evaluate(() => { localStorage.setItem('juanye.appearance.v1', 'telegram'); localStorage.setItem('juanye.telegram-theme.v1', 'ocean'); localStorage.setItem('juanye.telegram-scheme.v1', 'dark'); localStorage.setItem('juanye.sidebar-expanded.v1', 'true'); });
    await page.reload(); await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    await page.keyboard.press('Control+,'); const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '外观', exact: true }).click();
    const scheme = dialog.getByRole('group', { name: 'Telegram 明暗模式', exact: true });
    await scheme.getByRole('tab', { name: '浅色', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.telegramScheme === 'light' && document.documentElement.style.colorScheme === 'light');
    for (let index = 0; index < paletteIds.length; index++) {
      await dialog.locator('.telegram-theme-choice').filter({ hasText: paletteNames[index] }).click();
      await page.waitForFunction(id => document.documentElement.dataset.telegramTheme === id, paletteIds[index]);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.telegramScheme), 'light');
      const state = await page.evaluate(() => {
        const paper = document.querySelector('.workspace-preview-stage [data-sheet]');
        const root = document.documentElement;
        return { scheme: getComputedStyle(root).colorScheme, accent: getComputedStyle(root).getPropertyValue('--tg-accent').trim(), paper: getComputedStyle(paper).backgroundColor, color: getComputedStyle(paper).color, card: getComputedStyle(document.querySelector('.telegram-theme-card')).backgroundColor };
      });
      assert.equal(state.scheme, 'light'); assert.equal(state.paper, 'rgb(255, 255, 255)'); assert.equal(state.color, 'rgb(22, 23, 26)');
      assert.ok(contrast(state.accent, 'rgb(255,255,255)') >= 4.5, `Low light-theme accent contrast for ${paletteIds[index]}`);
      assert.equal(state.card, 'rgb(229, 238, 236)');
    }
    checks.push('All nine palettes retain independent daylight mode, contrast-safe accents and white paper');
    await dialog.locator('.telegram-theme-choice').filter({ hasText: '海蓝' }).click();
    await scheme.getByRole('tab', { name: '深色', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.style.colorScheme === 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.telegramTheme), 'ocean');
    await scheme.getByRole('tab', { name: '浅色', exact: true }).click();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.reload(); await page.getByPlaceholder('输入题干…', { exact: true }).waitFor();
    await page.waitForFunction(() => document.documentElement.style.colorScheme === 'light');
    assert.equal(await page.evaluate(() => localStorage.getItem('juanye.telegram-theme.v1')), 'ocean');
    await page.waitForFunction(() => document.documentElement.dataset.nativeTransparency === 'false');
    const native = await app.evaluate(({ BrowserWindow }) => ({ background: BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase(), opacity: BrowserWindow.getAllWindows()[0].getOpacity() }));
    assert.equal(native.background, '#e8eff0'); assert.equal(native.opacity, 1);
    for (const value of ['dark', 'light']) {
      await page.evaluate(value => {
        localStorage.setItem('juanye.telegram-scheme.v1', value);
        window.dispatchEvent(new StorageEvent('storage', { key: 'juanye.telegram-scheme.v1', newValue: value }));
      }, value);
      await page.waitForFunction(value => document.documentElement.style.colorScheme === value, value);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.telegramTheme), 'ocean');
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      if (fs.existsSync(path.join(profile, 'appearance.json')) && JSON.parse(fs.readFileSync(path.join(profile, 'appearance.json'), 'utf8')).telegramScheme === 'light') break;
      await pause(60);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'appearance.json'), 'utf8')), { mode: 'telegram', telegramScheme: 'light' });
    checks.push('Dark/light switching preserves the selected palette; reload restores daylight and the opaque native window background');
    const source = page.getByRole('textbox', { name: '题目来源', exact: true }); await source.fill('本地浅色样例');
    const sourceColors = await source.evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    assert.ok(contrast(sourceColors.foreground, sourceColors.background) >= 4.5);
    const select = page.getByRole('combobox', { name: '题目难度', exact: true }); await select.focus(); await select.press('ArrowDown');
    const menu = page.getByRole('listbox'); await menu.waitFor();
    const menuColors = await menu.evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    assert.ok(contrast(menuColors.foreground, menuColors.background) >= 4.5); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '批量编辑', exact: true }).click();
    await page.getByRole('checkbox', { name: '第 1 题，未选择', exact: true }).click();
    await page.locator('.checkbox-indicator[data-checked="true"]').first().waitFor();
    const checkboxColors = await page.locator('.checkbox-indicator[data-checked="true"]').first().evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundImage }));
    assert.equal(checkboxColors.foreground, 'rgb(255, 255, 255)'); assert.ok(checkboxColors.background.includes('gradient'));
    const closeBatch = page.getByRole('button', { name: '关闭批量面板', exact: true });
    if (await closeBatch.count()) await closeBatch.click(); else await page.getByRole('button', { name: '退出批量编辑', exact: true }).click();
    const wallpaper = await page.locator('.workspace-wallpaper').evaluate(el => { const style = getComputedStyle(el, '::before'); return { image: style.backgroundImage, animation: style.animationName, opacity: style.opacity }; });
    assert.ok(wallpaper.image.startsWith('url(')); assert.equal(wallpaper.animation, 'workspace-wallpaper-drift');
    assert.ok(await page.locator('.workspace-preview-stage .katex').count());
    assert.equal(await page.locator('.workspace-preview-stage .katex-error').count(), 0);
    checks.push('Editor input, dropdown and checked indicators remain readable; doodle motion, KaTeX and table rendering remain enabled');
    const out = path.join(root, 'artifacts/qa-telegram-daylight'); fs.mkdirSync(out, { recursive: true });
    if (capture) {
      await page.evaluate(() => { document.querySelectorAll('.workspace-editor-stage .overflow-y-auto, .workspace-preview-stage .canvas-dots').forEach(el => el.scrollTo(0,0)); });
      await page.keyboard.press('Control+1'); await pause(600); await page.evaluate(() => document.fonts.ready);
      const target = path.join(out, `telegram-light-${packaged ? 'packaged' : 'source'}.png`);
      const encoded = await app.evaluate(async ({ BrowserWindow }) => { const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); return image.toPNG().toString('base64'); });
      fs.writeFileSync(target, Buffer.from(encoded, 'base64'));
      screenshots.push(target);
    }
    const requests = await app.evaluate(() => ({ cloudRequests: globalThis.__daylightRequests, modelCalls: globalThis.__daylightModelCalls }));
    assert.deepEqual(requests, { cloudRequests: 0, modelCalls: 0 }); assert.deepEqual(errors, []);
    const report = { passed: true, packaged, checks, native, wallpaper: { hasImage: wallpaper.image.startsWith('url('), animation: wallpaper.animation, opacity: wallpaper.opacity }, sourceColors, menuColors, screenshots, ...requests, errors };
    fs.writeFileSync(path.join(out, `results-${packaged ? 'packaged' : 'source'}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill());
    const resolved = fs.realpathSync(profile);
    if (path.dirname(resolved).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(resolved).startsWith('juanye-telegram-daylight-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
