/* Isolated UI-copy check: no real user data, model calls, or desktop capture. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-copy-qa-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv.includes('--packaged');
  let app;
  const errors = [];
  const timer = setTimeout(() => { app?.process().kill(); process.exitCode = 1; }, 60000);
  const banned = [
    '题目数据 → HTML/CSS', 'KaTeX 渲染公式', '公式用 $…$ 包裹',
    '支持图片选择、拖放、粘贴及 PDF 逐页识别', '每页发送一次请求',
    '按主题号分题，小问保留在原题内', '小问不单独拆题，不自动编造答案',
    '图片会随题目排版', 'plot_q3.svg', '题目内容已就绪',
    '配置仅保存在当前设备', '清爽蓝白配色', '将自动补全',
  ];
  let checkedViews = 0;
  try {
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? [] : [root], env, timeout: 20000 });
    let network = 0;
    await app.evaluate(({ session }) => {
      globalThis.__copyQaRequests = 0;
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { globalThis.__copyQaRequests++; callback({ cancel: true }); });
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { network++; return route.abort(); });
    const clean = async () => {
      const text = await page.locator('body').innerText();
      for (const value of banned) assert.ok(!text.includes(value), `Unexpected explanatory copy: ${value}`);
      checkedViews++;
    };
    await page.waitForSelector('textarea');
    await clean();
    // Formula insertion and live math remain available after removing the prose hint.
    await page.getByRole('button', { name: '行内公式', exact: true }).click();
    assert.ok((await page.locator('textarea').first().inputValue()).includes('$x$'));
    await page.waitForSelector('.katex');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Qwen 模型设置', { exact: true }).waitFor();
    assert.equal(await dialog.locator('input[type=password]').count(), 1);
    await clean();
    for (const tab of ['识别', '外观', '快捷键', '关于']) {
      await dialog.getByRole('button', { name: tab, exact: true }).click();
      if (tab === '关于') {
        await dialog.getByText('版本 0.3.4', { exact: true }).waitFor();
        assert.equal((await dialog.locator('main').innerText()).trim(), '卷页\n版本 0.3.4');
      } else {
        await dialog.getByText(tab === '外观' ? '界面模式' : tab === '快捷键' ? '命令面板' : '默认多题识别', { exact: true }).waitFor();
      }
      await clean();
    }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '打开图片识别', exact: true }).click();
    await dialog.getByText('识别题目', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '选择文件', exact: true }).count(), 1);
    assert.equal(await dialog.getByText('识别可能产生模型服务费用', { exact: true }).count(), 1);
    await clean();
    assert.deepEqual(errors, []);
    assert.equal(network + await app.evaluate(() => globalThis.__copyQaRequests), 0);
    console.log(JSON.stringify({ passed: true, packaged, checkedViews, errors, cloudRequests: 0 }));
  } finally {
    clearTimeout(timer);
    if (app) await app.close();
    const verified = fs.realpathSync(userData);
    if (path.dirname(verified).toLowerCase() === fs.realpathSync(os.tmpdir()).toLowerCase() && path.basename(verified).startsWith('juanye-copy-qa-')) fs.rmSync(verified, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
