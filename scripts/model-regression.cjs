/* Local-only end-to-end regression. Uses dummy credentials, isolated userData and no screenshots. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const dummyKeys = [0, 1].map(() => `local-regression-not-real-${crypto.randomBytes(18).toString('hex')}`);
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNGcAAAAASUVORK5CYII=';
const redacted = (value) => dummyKeys.reduce((message, key) => message.replaceAll(key, '[dummy credential redacted]'), String(value));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(predicate, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await pause(25);
  }
  throw new Error(message);
}
async function bounded(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-model-regression-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  let page;
  let stage = 'initialise';
  const progress = label => { stage = label; console.log(JSON.stringify({ progress: stage })); };
  let expectedKey = dummyKeys[0];
  let delayNextTest = 0;
  let delayNextOcr = 0;
  let canceledResponses = 0;
  let blockedRendererRequests = 0;
  const records = [];
  const results = [];
  const errors = [];
  const responseTimers = new Set();
  const mockQuestions = JSON.stringify({ questions: [{ type: 'single', score: 5, stem: '计算 $1+1$ 的值。', options: ['$1$', '$2$', '$3$', '$4$'], answer: [], analysis: '' }] });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      let request;
      try { request = JSON.parse(body); } catch { res.writeHead(400); res.end('{}'); return; }
      const test = typeof request.messages?.[0]?.content === 'string';
      const matches = req.headers.authorization === `Bearer ${expectedKey}`;
      const record = { kind: test ? 'test' : 'ocr', matches, completed: false, aborted: false, model: request.model };
      // Keep actual headers in memory for precise assertions, never log or persist them.
      Object.defineProperty(record, 'authorization', { value: req.headers.authorization, enumerable: false });
      records.push(record);
      const send = () => {
        record.completed = true;
        if (res.destroyed) return;
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || !matches) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Local regression authorization mismatch' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: test ? 'OK' : mockQuestions } }] }));
      };
      const delay = test ? delayNextTest : delayNextOcr;
      if (test) delayNextTest = 0; else delayNextOcr = 0;
      if (delay) {
        const timer = setTimeout(() => { responseTimers.delete(timer); send(); }, delay);
        responseTimers.add(timer);
        res.once('close', () => {
          if (!res.writableEnded) { canceledResponses++; record.aborted = true; clearTimeout(timer); responseTimers.delete(timer); }
        });
      } else send();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const baseUrl = `${origin}/v1`;
  const configModel = 'local-regression-model';
  const watchdog = setTimeout(() => {
    try { app?.process().kill(); } catch {}
    server.closeAllConnections();
    console.error(JSON.stringify({ passed: false, stage, error: 'Model regression exceeded 150-second deadline' }));
    process.exit(1);
  }, 150000);

  async function launch() {
    app = await _electron.launch({
      executablePath: packaged ? path.join(root, 'release/win-unpacked/卷页.exe') : path.join(root, 'node_modules/electron/dist/electron.exe'),
      args: packaged ? [] : [root], env, timeout: 30000,
    });
    // Guard Node fetch too, so a regression cannot accidentally contact a cloud service.
    await app.evaluate((_, allowedOrigin) => {
      const originalFetch = globalThis.fetch;
      globalThis.__modelRegressionBlocked = 0;
      globalThis.fetch = (input, init) => {
        const target = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
        if (target.origin !== allowedOrigin) { globalThis.__modelRegressionBlocked++; throw new Error('External request blocked by local regression'); }
        return originalFetch(input, init);
      };
    }, origin);
    // Electron's getBackgroundColor intentionally omits alpha; observe the real native setter instead.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      globalThis.__modelRegressionBackgroundCalls = [];
      const setBackgroundColor = win.setBackgroundColor.bind(win);
      win.setBackgroundColor = color => {
        globalThis.__modelRegressionBackgroundCalls.push(String(color).toLowerCase());
        return setBackgroundColor(color);
      };
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(redacted(error.message)));
    await page.route(/^https?:\/\//, route => { blockedRendererRequests++; return route.abort('blockedbyclient'); });
    await page.waitForFunction(() => Boolean(window.juanye));
    await page.getByRole('button', { name: '设置', exact: true }).waitFor();
  }
  async function closeApp() {
    if (!app) return;
    const current = app;
    app = undefined;
    try { await bounded(current.close(), 7000, 'Application shutdown timed out'); }
    catch { try { current.process().kill(); } catch {} }
  }
  async function settings() {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '模型服务', exact: true }).click();
    await dialog.locator('input[type="password"]').waitFor();
    return dialog;
  }
  const keyInput = dialog => dialog.locator('input[type="password"]');
  async function closeSettings(dialog) { await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); }
  async function testUi(dialog) {
    const before = records.length;
    await dialog.getByRole('button', { name: '测试连接', exact: true }).click();
    await until(() => records.length === before + 1, 'Test button did not issue exactly one request');
    await dialog.getByText(/连接正常/).waitFor();
    assert.ok(records[before].matches, 'Test request did not preserve the exact dummy credential');
  }
  async function saveUi(dialog) {
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByText('模型设置已保存', { exact: true }).waitFor();
    await until(async () => await keyInput(dialog).inputValue() === '', 'Saved API Key input did not clear');
    const publicConfig = await page.evaluate(() => window.juanye.getModel());
    assert.equal(publicConfig.hasKey, true, 'Saved config does not report a stored key');
    assert.ok(!Object.hasOwn(publicConfig, 'key') && !Object.hasOwn(publicConfig, 'encryptedKey'), 'Config API exposed credential material');
    const stored = fs.readFileSync(path.join(userData, 'model.json'), 'utf8');
    assert.ok(dummyKeys.every(key => !stored.includes(key)), 'Credential was persisted as plaintext');
  }
  async function recognizeBridge(label) {
    const before = records.length;
    const raw = await page.evaluate(image => window.juanye.recognize({ image, multiple: false }), IMAGE);
    const questions = JSON.parse(raw).questions;
    assert.equal(questions.length, 1, `${label}: mock question result was lost`);
    assert.equal(records.length, before + 1, `${label}: OCR did not issue exactly one request`);
    assert.ok(records[before].matches && records[before].authorization === `Bearer ${expectedKey}`, `${label}: exact Authorization mismatch`);
    results.push(label);
  }
  async function recognizeUi() {
    await page.keyboard.press('Control+k');
    await page.getByRole('button').filter({ hasText: '一图多题识别' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=file]').setInputFiles({ name: 'local-regression.png', mimeType: 'image/png', buffer: Buffer.from(IMAGE.split(',')[1], 'base64') });
    const before = records.length;
    await dialog.getByRole('button', { name: '开始识别', exact: true }).click();
    await dialog.getByText('1/1 页 · 1 道题', { exact: true }).waitFor();
    assert.equal(records.length, before + 1, 'OCR UI did not issue exactly one request');
    assert.ok(records[before].matches && records[before].authorization === `Bearer ${expectedKey}`, 'OCR UI credential differs from tested credential');
    assert.equal(await dialog.getByRole('alert').count(), 0, 'OCR UI displayed an unexpected error');
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }

  let report;
  try {
    progress('initial UI test-save-recognize');
    await launch();
    let dialog = await settings();
    await dialog.getByLabel(/^请求地址/).fill(baseUrl);
    await dialog.getByLabel(/^模型名称/).fill(configModel);
    await keyInput(dialog).fill(dummyKeys[0]);
    await testUi(dialog);
    await saveUi(dialog);
    await closeSettings(dialog);
    await recognizeUi();
    results.push('UI entered credential → tested → saved/cleared → actual OCR');

    progress('restart preserves exact credential');
    await closeApp();
    await launch();
    await recognizeBridge('Restart preserves exact credential');

    progress('blank key preserves and replaces explicit key');
    dialog = await settings();
    assert.equal(await keyInput(dialog).inputValue(), '', 'Reopening settings revealed the stored key');
    await saveUi(dialog);
    await closeSettings(dialog);
    await recognizeBridge('Blank key preserves credential');
    dialog = await settings();
    await testUi(dialog);
    await dialog.getByLabel(/^模型名称/).fill(`${configModel}-changed`);
    await until(async () => await dialog.getByText(/连接正常/).count() === 0, 'Editing model did not clear prior connection status');
    results.push('Edited settings clear stale connection status');

    // A late connection response must not mark a different form revision as successful.
    delayNextTest = 550;
    let before = records.length;
    await dialog.getByRole('button', { name: '测试连接', exact: true }).click();
    await until(() => records.length === before + 1, 'Delayed test request never started');
    await dialog.getByLabel(/^模型名称/).fill(`${configModel}-revision`);
    await until(() => records[before].completed, 'Delayed test response never completed');
    await pause(80);
    assert.equal(await dialog.getByText(/连接正常/).count(), 0, 'Stale test response overwrote edited form status');
    results.push('Late test response cannot validate changed settings');

    expectedKey = dummyKeys[1];
    await keyInput(dialog).fill(dummyKeys[1]);
    await testUi(dialog);
    await saveUi(dialog);
    await closeSettings(dialog);
    await recognizeBridge('Explicit replacement uses new exact credential');

    progress('cancellation and next request');
    delayNextOcr = 5000;
    before = records.length;
    await page.evaluate(image => {
      window.__modelRegressionPending = window.juanye.recognize({ image }).then(value => ({ ok: true, value }), error => ({ ok: false, message: String(error.message) }));
    }, IMAGE);
    await until(() => records.length === before + 1, 'Canceled OCR request never reached mock');
    assert.ok(records[before].matches, 'Cancelable request used a different credential');
    await page.evaluate(() => window.juanye.cancelRecognition());
    const canceled = await bounded(page.evaluate(() => window.__modelRegressionPending), 5000, 'Cancellation did not settle request');
    assert.equal(canceled.ok, false, 'Canceled request unexpectedly succeeded');
    await until(() => canceledResponses > 0, 'Cancellation did not abort the HTTP response');
    await recognizeBridge('Cancellation releases task and next OCR succeeds');

    progress('replacement survives restart');
    await closeApp();
    await launch();
    await recognizeBridge('Replacement credential survives restart');

    progress('Telegram opaque appearance and legacy migration');
    dialog = await settings();
    await dialog.getByRole('button', { name: '外观', exact: true }).click();
    // Force a real transition through dark, even if this isolated profile starts in dark mode.
    await dialog.locator('label').filter({ has: page.locator('input[type="radio"][value="light"]') }).click();
    await dialog.locator('label').filter({ has: page.locator('input[type="radio"][value="dark"]') }).click();
    const darkWindowOpacity = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity());
    assert.equal(darkWindowOpacity, 1, 'Dark mode must not fade the whole window');
    await dialog.locator('label').filter({ has: page.locator('input[type="radio"][value="telegram"]') }).click();
    assert.equal(await dialog.locator('#glass-opacity').count(), 0, 'Telegram still exposes the removed opacity slider');
    await page.waitForFunction(() => document.documentElement.dataset.nativeTransparency === 'false');
    const native = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { isTransparent: typeof win.isTransparent === 'function' ? win.isTransparent() : null, backgroundColorRgb: win.getBackgroundColor(), backgroundColorArgument: globalThis.__modelRegressionBackgroundCalls.at(-1), windowOpacity: win.getOpacity() };
    });
    const readAppearance = () => page.evaluate(() => {
      const background = selector => { const el = document.querySelector(selector); return el ? getComputedStyle(el).backgroundColor : null; };
      return { mode: document.documentElement.dataset.theme, nativeTransparency: document.documentElement.dataset.nativeTransparency ?? null, savedMode: localStorage.getItem('juanye.appearance.v1'), legacyOpacity: localStorage.getItem('juanye.glass-opacity.v1'), backgrounds: { html: background('html'), body: background('body'), root: background('#root'), app: background('.app-bg'), paper: background('.paper[data-sheet]') } };
    });
    const assertAppearance = appearance => {
      assert.equal(appearance.mode, 'telegram', 'Telegram appearance did not apply');
      assert.equal(appearance.savedMode, 'telegram', 'Appearance storage is not canonical Telegram');
      assert.equal(appearance.nativeTransparency, 'false', 'Desktop host still enables native transparency');
      for (const name of ['html', 'body', 'root', 'app']) assert.ok(appearance.backgrounds[name] && appearance.backgrounds[name] !== 'rgba(0, 0, 0, 0)', `${name} Telegram background is still transparent`);
      assert.equal(appearance.backgrounds.paper, 'rgb(255, 255, 255)', 'Paper preview must remain opaque white');
    };
    const appearance = await readAppearance();
    assertAppearance(appearance);
    assert.equal(native.windowOpacity, 1, 'Whole-window opacity would fade text and paper');
    assert.ok(native.backgroundColorArgument && native.backgroundColorArgument !== '#00000000' && native.backgroundColorArgument !== 'transparent', 'Telegram native background remains transparent');
    await closeSettings(dialog);
    await page.evaluate(() => {
      localStorage.setItem('juanye.appearance.v1', 'glass');
      localStorage.setItem('juanye.glass-opacity.v1', '0.25');
    });
    await page.reload();
    await page.waitForSelector('.paper[data-sheet]');
    await page.waitForFunction(() => document.documentElement.dataset.nativeTransparency === 'false');
    const afterReload = await readAppearance();
    assertAppearance(afterReload);
    assert.equal(afterReload.legacyOpacity, null, 'Obsolete glass opacity preference was not removed');
    results.push('Legacy glass migrates to opaque Telegram; white paper survives reload');
    const blockedMainRequests = await app.evaluate(() => globalThis.__modelRegressionBlocked);
    assert.equal(blockedMainRequests, 0, 'Application attempted an external model request');
    assert.equal(blockedRendererRequests, 0, 'Renderer attempted an external request');
    assert.equal(errors.length, 0, 'Renderer produced an unhandled error');
    assert.ok(records.every(record => record.matches), 'At least one request used a changed credential');
    report = { passed: true, packaged, checks: results, localRequests: records.length, exactAuthorizationMatches: records.filter(record => record.matches).length, abortedRequests: canceledResponses, cloudRequests: 0, screenshots: 0, telegram: { ...native, darkWindowOpacity, ...appearance, legacyMigrated: afterReload.savedMode === 'telegram' && afterReload.legacyOpacity === null } };
  } catch (error) {
    report = { passed: false, packaged, stage, error: redacted(error.message), localRequests: records.length, exactAuthorizationMatches: records.filter(record => record.matches).length, authorizationMismatches: records.filter(record => !record.matches).length, cloudRequests: 0, screenshots: 0 };
    process.exitCode = 1;
  } finally {
    await closeApp();
    for (const timer of responseTimers) clearTimeout(timer);
    server.closeAllConnections();
    await bounded(new Promise(resolve => server.close(resolve)), 3000, 'Mock server shutdown timed out').catch(() => {});
    clearTimeout(watchdog);
    // Delete only the exact directory freshly created for this regression, never real AppData.
    if (path.dirname(userData) === os.tmpdir() && path.basename(userData).startsWith('juanye-model-regression-')) {
      fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(redacted(error.message)); process.exitCode = 1; });
