/* 组卷可视编辑 + 题库新布局回归：隔离 userData、离屏窗口、禁止外网，不调用模型。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require(process.env.JUANYE_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts/qa-exam-visual');
const noScreenshots = process.argv.includes('--no-screenshots');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(60); }
  throw new Error(message);
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-exam-visual-'));
  fs.mkdirSync(artifacts, { recursive: true });
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const errors = [];
  let app;
  const shot = async (page, name) => { if (!noScreenshots) await page.screenshot({ path: path.join(artifacts, `${name}.png`) }); };
  try {
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], env, timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.fetch = () => { throw new Error('Network disabled during exam visual regression'); };
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.showInactive(); win.setContentSize(1440, 920);
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route(/^https?:\/\//, route => route.abort('blockedbyclient'));
    await page.getByRole('complementary', { name: '试卷目录', exact: true }).waitFor();
    const draft = () => page.evaluate(() => window.juanye.loadDraft());
    const firstQuestion = async () => (await draft())?.exam.sections[0].questions[0];

    // 顶栏：工作区切换在标题栏，试卷操作在工具行
    assert.equal(await page.locator('header').getByRole('navigation', { name: '工作区', exact: true }).count(), 1, 'workspace tabs are not in the title bar');
    assert.equal(await page.getByRole('toolbar', { name: '当前工作区工具' }).getByRole('button', { name: '导出 PDF' }).count(), 1, 'exam export is not in the workspace toolbar');
    assert.equal(await page.getByRole('complementary', { name: '试卷目录', exact: true }).getAttribute('data-sidebar-state'), 'expanded', 'outline is not expanded by default');

    // 题干：静态显示排版，点击后原位编辑，写回原字符串格式
    const stem = page.locator('[data-exam-field="stem"][role="textbox"]');
    await stem.waitFor();
    assert.ok(await stem.locator('.katex').count() > 0, 'stem does not render formulas in place');
    await stem.click({ position: { x: 30, y: 20 } });
    await page.waitForSelector('[data-exam-field="stem"] .ProseMirror-focused');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('，测试');
    await page.keyboard.type('$');
    await page.waitForSelector('[data-exam-field="stem"] math-field');
    await until(() => page.evaluate(() => document.activeElement?.tagName === 'MATH-FIELD'), 'formula field did not take focus');
    await page.keyboard.type('x^2');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await until(async () => (await page.locator('[data-exam-field="stem"] math-field').count()) === 0, 'arrow keys did not leave the formula');
    await page.keyboard.type('。');
    await shot(page, '01-stem-visual');
    await page.keyboard.press('Escape');
    await until(async () => /，测试\$x\^\{?2\}?\$。$/.test((await firstQuestion())?.stem ?? ''), 'visual stem edit was not saved as $…$ text').catch(async error => { throw new Error(`${error.message}: ${JSON.stringify((await firstQuestion())?.stem.slice(-40))}`); });

    // 选项：单行可视编辑，Enter 结束
    const optionA = page.locator('[data-exam-field="option-A"][role="textbox"]');
    await optionA.click();
    await page.waitForSelector('[data-exam-field="option-A"] .ProseMirror-focused');
    await page.keyboard.press('End');
    await page.keyboard.type('Z');
    await page.keyboard.press('Enter');
    await until(async () => ((await firstQuestion())?.options[0] ?? '').endsWith('Z'), 'option edit was not saved');

    // 源码编辑开关
    await page.getByRole('button', { name: 'LaTeX 源码编辑' }).click();
    await page.waitForSelector('[data-exam-field="stem"] textarea');
    assert.match(await page.locator('[data-exam-field="stem"] textarea').inputValue(), /\$x\^\{?2\}?\$/);
    await page.getByRole('button', { name: '改回可视编辑' }).click();
    await page.waitForSelector('[data-exam-field="stem"][role="textbox"]');

    // 题图 · 绘图 · 属性：默认折叠
    assert.equal(await page.getByRole('textbox', { name: '题目来源' }).count(), 0, 'properties should start collapsed');
    await page.locator('.editor-extras-head').click();
    await page.getByRole('textbox', { name: '题目来源' }).waitFor();

    // 编辑区 / 预览分隔线
    const preview = page.locator('.workspace-preview-stage');
    const before = (await preview.boundingBox()).width;
    const handle = await page.locator('.preview-resizer').boundingBox();
    await page.mouse.move(handle.x + 3, handle.y + 200); await page.mouse.down(); await page.mouse.move(handle.x - 117, handle.y + 200, { steps: 6 }); await page.mouse.up();
    // 目录展开时编辑区至少保留 520px，预览能加宽的幅度受此限制。
    await until(async () => (await preview.boundingBox()).width > before + 15, 'dragging the divider did not widen the preview');
    assert.ok(Number(await page.evaluate(() => localStorage.getItem('juanye.preview-ratio.v1'))) > 0.5, 'preview ratio was not remembered');
    await shot(page, '02-exam-layout');

    // 题库：选项预览、单行筛选、常驻选题按钮、按题型自动归入
    const questions = (await draft()).exam.sections.flatMap(section => section.questions);
    const counts = (await draft()).exam.sections.map(section => [section.type, section.questions.length]);
    await page.evaluate(qs => window.juanye.bankSave({ questions: qs, origin: { examTitle: '回归示例' } }), questions);
    await page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name: '本地题库', exact: true }).click();
    await page.locator('[data-bank-id]').first().waitFor();
    assert.ok(await page.locator('.bank-entry-options').count() > 0, 'choice options are not previewed in the list');
    assert.equal(await page.locator('.bank-filter-bar').count(), 1, 'filters are not merged into one row');
    await page.getByRole('button', { name: '筛选' }).click();
    assert.equal(await page.getByRole('dialog', { name: '更多筛选条件' }).getByRole('combobox').count(), 3);
    await page.keyboard.press('Escape');
    await until(async () => (await page.getByRole('dialog', { name: '更多筛选条件' }).count()) === 0, 'filter panel did not close');
    const picks = page.locator('.bank-pick:not([data-picked])');
    assert.ok(await picks.first().isVisible(), 'pick button is hidden until hover');
    const essay = page.locator('[data-bank-id]').filter({ has: page.locator('.bank-type-tag', { hasText: '解答' }) }).first();
    const single = page.locator('[data-bank-id]').filter({ has: page.locator('.bank-type-tag', { hasText: '单选' }) }).first();
    await single.locator('.bank-pick').click();
    await essay.locator('.bank-pick').click();
    await until(async () => (await page.locator('.bank-basket-chip b [aria-hidden="true"]').innerText()).trim() === '2', 'basket chip did not count picks');
    await page.locator('.bank-basket-chip').click();
    assert.equal((await page.getByRole('combobox', { name: '题库目标大题' }).innerText()).trim(), '按题型自动归入');
    await shot(page, '03-bank');
    await page.getByRole('button', { name: '加入当前试卷' }).click();
    await until(async () => {
      const next = (await draft()).exam.sections.map(section => [section.type, section.questions.length]);
      const plus = (type, n) => (counts.find(item => item[0] === type)?.[1] ?? 0) + n;
      return next.find(item => item[0] === 'single')?.[1] === plus('single', 1) && next.find(item => item[0] === 'essay')?.[1] === plus('essay', 1);
    }, 'basket questions were not routed by type');

    assert.deepEqual(errors, [], `renderer errors: ${errors.join(' | ')}`);
    console.log(JSON.stringify({ ok: true, artifacts }, null, 2));
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
