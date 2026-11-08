/* 教辅编辑台回归：隔离 userData、离屏窗口、禁止外网；验证原位编辑零跳动、学/教版切换、插入撤销、保存与 PDF 导出。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts/qa-workbook');
const noScreenshots = process.argv.includes('--no-screenshots');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pdfPages = file => (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

async function until(predicate, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(50); }
  throw new Error(message);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-workbook-regression-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-workbook-pdf-'));
  fs.mkdirSync(artifacts, { recursive: true });
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const errors = [];
  let app;
  const shot = async (page, name) => { if (!noScreenshots) await page.screenshot({ path: path.join(artifacts, `${name}.png`) }); };
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], env, timeout: 30000 });
    await app.evaluate(({ BrowserWindow, dialog }) => {
      globalThis.fetch = () => { throw new Error('Network disabled during workbook regression'); };
      dialog.showSaveDialog = async () => globalThis.__wbSaveTarget ? { canceled: false, filePath: globalThis.__wbSaveTarget } : { canceled: true };
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive(); win.setContentSize(1440, 920);
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route(/^https?:\/\//, route => route.abort('blockedbyclient'));

    await page.getByRole('button', { name: '教辅', exact: true }).click();
    await until(async () => (await page.locator('.wb-content > .wb-block').count()) >= 10, 'sample workbook did not render');
    await page.evaluate(() => document.fonts.ready);
    await pause(400);
    const pages = await page.locator('.wb-content > .wb-page').count();
    assert.ok(pages >= 1, 'no paper pages');
    await shot(page, '01-student');

    // 原位编辑：点击前后所有块高度一致（静态 DOM 与 Tiptap DOM 同构）。
    const heights = () => page.$$eval('.wb-content > .wb-block', blocks => blocks.map(b => b.offsetHeight));
    const before = await heights();
    const note = page.locator('.wb-block[data-kind="note"]').first();
    await note.locator('.wb-field .wb-flow p').first().click({ position: { x: 40, y: 8 } });
    await page.waitForSelector('.wb-content .ProseMirror-focused');
    assert.deepEqual(await heights(), before, 'entering edit mode changed block heights');
    await page.keyboard.type('QA');
    // 编辑其他块时选项不应产生位移动画（曾因布局投影导致选项文字跳动）。
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.closest?.('.wb-option')).length), 0, 'options animated while editing another block');
    await shot(page, '02-editing');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until(async () => JSON.stringify(await page.evaluate(() => window.juanye.workbookLoad())).includes('QA'), 'workbook edit was not saved to disk');
    assert.ok(fs.existsSync(path.join(userData, 'workbook.json')), 'workbook.json missing');

    // 章节目录：列出全部标题，点击后滚动定位。
    assert.equal(await page.locator('.wb-outline-item').count(), 4, 'outline headings missing');
    const scroller = page.locator('.wb-scroller');
    await scroller.evaluate(el => { el.scrollTop = 0; });
    await page.locator('.wb-outline-item', { hasText: '课堂训练' }).click();
    await until(async () => (await scroller.evaluate(el => el.scrollTop)) > 150, 'outline jump did not scroll');
    await until(async () => (await page.locator('.wb-outline-item[data-active]').innerText()).includes('课堂训练'), 'outline did not track the current section');
    await scroller.evaluate(el => { el.scrollTop = 0; });
    await pause(300);

    // Desmos 式公式：点击公式原位打开 MathLive，连续输入后 Enter 回到正文。
    await page.locator('.wb-block[data-kind="note"] .wb-math .katex-html').first().click();
    await page.waitForSelector('math-field');
    await until(() => page.evaluate(() => document.activeElement?.tagName === 'MATH-FIELD'), 'math field did not take focus');
    await page.keyboard.press('End');
    await page.keyboard.type('+1');
    await page.keyboard.type('/');
    await page.keyboard.type('2');
    assert.equal(await page.locator('math-field').count(), 1, 'math field closed while typing');
    await shot(page, '02b-math');
    const latex = await page.evaluate(() => document.querySelector('math-field').value);
    assert.match(latex, /\\frac\{?1\}?\{?2\}?$/, `typing / did not build a fraction: ${latex}`);
    await page.keyboard.press('Enter');
    await until(async () => (await page.locator('math-field').count()) === 0, 'Enter did not leave the math field');
    await page.keyboard.type('Z');
    assert.match(await page.evaluate(() => document.querySelector('.wb-content .ProseMirror').editor.getText()), /frac\{?1\}?\{?2\}?\$Z/, 'text after the formula was not typed into the paragraph');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // 题型切换：单选 → 解答出现留白，切回单选留白收起。
    const choice = page.locator('.wb-block[data-kind="question"]').nth(1);
    await choice.locator('.wb-q-num').click();
    await page.locator('.wb-tool-seg-item', { hasText: '解答' }).click();
    await until(async () => (await choice.locator('.wb-space').count()) === 1, 'essay space missing after conversion');
    await page.locator('.wb-tool-seg-item', { hasText: '单选' }).click();
    await until(async () => (await choice.locator('.wb-space').count()) === 0, 'answer space kept after converting back to single choice');
    await page.keyboard.press('Escape');

    // 教师版：答案与解析展开、正确选项着色。
    await page.getByRole('tab', { name: '教师版' }).click();
    await until(async () => (await page.locator('.wb-content[data-edition="teacher"] .wb-key').count()) === 4, 'teacher keys missing');
    assert.ok(await page.locator('.wb-option[data-correct]').count() >= 2, 'correct options not marked');
    await pause(500);
    await shot(page, '03-teacher');
    await page.getByRole('tab', { name: '学生版' }).click();
    await until(async () => (await page.locator('.wb-key').count()) === 0, 'student edition still shows keys');

    // “+” 插入题目，再撤销。
    const questions = () => page.locator('.wb-block[data-kind="question"]').count();
    const count = await questions();
    const target = page.locator('.wb-block[data-kind="question"]').nth(1);
    await target.hover();
    await target.locator('button[aria-label="在下方插入"]').click();
    await page.locator('.wb-menu-item', { hasText: '多选题' }).click();
    await until(async () => (await questions()) === count + 1, 'insert did not add a question');
    await page.keyboard.type('新插入的多选题');
    await pause(300);
    await shot(page, '04-inserted');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Z');
    await page.keyboard.press('Control+Z');
    await until(async () => (await questions()) === count, 'undo did not remove the inserted question');

    // PDF：学生版与教师版分别导出，页面树按对应版本重新分页。
    for (const edition of ['student', 'teacher']) {
      const file = path.join(out, `${edition}.pdf`);
      await app.evaluate((_, value) => { globalThis.__wbSaveTarget = value; }, file);
      if (edition === 'teacher') await page.getByRole('tab', { name: '教师版' }).click();
      await page.getByRole('button', { name: edition === 'teacher' ? '导出教师版' : '导出学生版' }).click();
      await until(() => fs.existsSync(file) && fs.statSync(file).size > 2000, `${edition} PDF was not written`, 20000);
      await until(async () => (await page.locator('#print-root').count()) === 0, 'print tree was not removed');
      const count = pdfPages(file);
      assert.ok(count >= 1, `${edition} PDF has no pages`);
      fs.copyFileSync(file, path.join(artifacts, `${edition}.pdf`));
      console.log(`${edition} PDF: ${count} page(s)`);
    }
    assert.deepEqual(errors, [], `renderer errors: ${errors.join(' | ')}`);
    console.log(JSON.stringify({ ok: true, pages, artifacts }, null, 2));
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
