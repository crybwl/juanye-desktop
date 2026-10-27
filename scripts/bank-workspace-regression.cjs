/* Isolated renderer regression. Dummy data, temporary userData, no accounts or HTTP. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const artifacts = path.join(root, 'artifacts', packaged ? 'bank-workspace-packaged' : 'bank-workspace');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 12000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await pause(60); } throw Error(label); }

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-bank-ui-'));
  const exam = { id: 'bank-ui-exam', title: '隔离题库测试卷', subtitle: '', duration: 120, notice: [], sections: [{ id: 'bank-ui-section', type: 'essay', title: '解答题', note: '', questions: [{ id: 'bank-ui-exam-question', type: 'essay', score: 8, stem: '原卷题：计算 $2+3$。', options: [], answer: ['5'], analysis: '相加得 5。' }] }] };
  const layout = { style: 'real', density: 'compact', paper: 'A4', orientation: 'portrait', margin: 11, fontSize: 9.5, lineHeight: 1.42, optionCols: 'auto', pageNumber: true, showScore: true, keepTogether: false, answerSpace: false };
  fs.writeFileSync(path.join(userData, 'draft.json'), JSON.stringify({ version: 1, exam, layout, history: [] }));
  fs.mkdirSync(artifacts, { recursive: true });
  const env = { ...process.env, JUANYE_TEST_USER_DATA: userData }; delete env.ELECTRON_RUN_AS_NODE;
  const checks = [], errors = []; let app, page, stage = 'launch', externalRequests = 0;
  const progress = value => { stage = value; console.log(JSON.stringify({ progress: stage })); };
  const watchdog = setTimeout(() => { app?.process().kill(); console.error('Bank UI regression exceeded 150 seconds'); process.exit(1); }, 150000);
  let report;
  try {
    const flags = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
    app = await _electron.launch({ executablePath: path.join(root, packaged ? 'release/win-unpacked/卷页.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? flags : [root, ...flags], env, timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => { globalThis.fetch = () => { throw Error('HTTP disabled in isolated bank test'); }; const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.setPosition(-16000, -16000); win.setContentSize(1280, 800); win.showInactive(); });
    page = await app.firstWindow(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.route(/^https?:\/\//, route => { externalRequests++; return route.abort('blockedbyclient'); });
    await page.setViewportSize({ width: 1280, height: 800 });
    const bank = () => page.getByTestId('bank-workspace');
    const rows = () => bank().getByTestId('bank-entry');
    const nav = name => page.getByRole('navigation', { name: '工作区', exact: true }).getByRole('button', { name, exact: true });
    const loadBank = () => page.evaluate(() => window.juanye.bankLoad());
    const loadDraft = () => page.evaluate(() => window.juanye.loadDraft());
    const select = async (scope, label, option) => { await scope.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click(); };
    const openBank = async () => { await nav('本地题库').click(); await bank().waitFor(); await until(async () => await bank().locator('[data-testid="bank-question-list"]').getAttribute('aria-busy') === 'false', 'Bank did not finish loading'); };
    await page.getByRole('complementary', { name: '试卷目录', exact: true }).waitFor();
    await openBank();
    assert.equal((await loadBank()).entries.length, 0);

    progress('direct create with options, answer, analysis, metadata and embedded image');
    await bank().getByRole('button', { name: '新建题目', exact: true }).click();
    const editor = bank().getByTestId('bank-question-editor');
    await editor.getByPlaceholder('输入题干…', { exact: true }).fill('新建题库题：若 $x+1=3$，则 $x=$');
    await editor.locator('.workbench-option-text').first().click();
    await editor.getByRole('textbox', { name: '选项 A', exact: true }).fill('$2$');
    await editor.getByPlaceholder('输入题干…', { exact: true }).click();
    await editor.getByRole('button', { name: '将 A 设为正确答案', exact: true }).click();
    await editor.getByPlaceholder('写下解题思路…').fill('两边同时减去 $1$，得到 $x=2$。');
    await editor.getByRole('textbox', { name: '题目来源', exact: true }).fill('题库独立编辑');
    await editor.getByRole('textbox', { name: '题目知识点', exact: true }).fill('方程，运算');
    await select(editor, '题目难度', '基础');
    await editor.locator('input[type="file"]').setInputFiles({ name: 'dummy-pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hKQAAAAASUVORK5CYII=', 'base64') });
    await until(async () => await editor.locator('[data-editor-figure]').count() === 1, 'Embedded figure was not loaded');
    await page.screenshot({ path: path.join(artifacts, 'bank-editor-1280.png') });
    await bank().locator('.bank-edit-footer').getByRole('button', { name: '保存', exact: true }).click();
    await until(async () => (await loadBank()).entries.length === 1, 'New bank question was not saved');
    let stored = await loadBank(), entry = stored.entries[0], libraryId = entry.libraryId;
    assert.deepEqual(entry.question.answer, ['A']); assert.equal(entry.question.figures.length, 1); assert.equal(entry.question.analysis.includes('同时减去'), true);
    assert.deepEqual((await loadDraft()).exam, exam);
    await bank().getByTestId('bank-question-preview').waitFor();
    assert.equal(await bank().locator('.bank-complete-preview figure img').count(), 1);
    checks.push('Direct authoring persists complete question without mutating current paper');

    progress('favorite and collection create / assign / rename');
    await rows().first().getByRole('button', { name: '收藏题目', exact: true }).click();
    await bank().locator('[data-bank-view="favorites"]').click();
    await until(async () => await rows().count() === 1, 'Favorite not visible');
    await bank().locator('.bank-collection-heading').getByRole('button', { name: '新建收藏夹', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '新建收藏夹', exact: true });
    await dialog.getByRole('textbox', { name: '收藏夹名称', exact: true }).fill('测试收藏夹');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await until(async () => (await loadBank()).collections.length === 1, 'Collection not saved');
    await rows().first().getByRole('checkbox').click();
    await select(bank(), '批量加入收藏夹', '测试收藏夹');
    await bank().getByRole('button', { name: '确定', exact: true }).click();
    await until(async () => (await loadBank()).entries[0].collectionIds.length === 1, 'Collection assignment failed');
    await bank().locator('.bank-collection-row').hover();
    await bank().getByRole('button', { name: '重命名收藏夹 测试收藏夹', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '编辑收藏夹', exact: true });
    await dialog.getByRole('textbox', { name: '收藏夹名称', exact: true }).fill('方程题集');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await until(async () => (await loadBank()).collections[0].name === '方程题集', 'Collection rename failed');
    checks.push('Favorite, collection create/assignment/rename persisted');

    progress('edit revision history and batch metadata');
    await bank().getByRole('button', { name: '编辑', exact: true }).click();
    await editor.getByPlaceholder('输入题干…', { exact: true }).fill('修订题库题：若 $x+1=3$，则 $x=$');
    await bank().locator('.bank-edit-footer').getByRole('button', { name: '保存', exact: true }).click();
    await until(async () => (await loadBank()).entries.length === 2, 'Question revision did not preserve the original');
    await bank().getByRole('button', { name: '版本历史', exact: true }).click();
    assert.equal(await bank().getByTestId('bank-version-history').locator(':scope > div').count(), 2);
    await bank().getByRole('button', { name: '批量属性', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '批量修改题目属性', exact: true });
    await dialog.getByRole('checkbox', { name: '修改所选题目来源', exact: true }).click();
    await dialog.getByRole('textbox', { name: '批量来源', exact: true }).fill('批量校对');
    await select(dialog, '批量难度', '较难');
    await dialog.getByRole('button', { name: '保存属性', exact: true }).click();
    await until(async () => (await loadBank()).entries.length === 3, 'Batch metadata did not produce a version');
    stored = await loadBank(); assert.equal(stored.entries.at(-1).question.source, '批量校对'); assert.equal(stored.entries.at(-1).question.difficulty, 'hard');
    checks.push('Question edit and batch metadata preserve version history');

    progress('trash and restore retain versions, collection and favorite');
    await bank().getByTestId('bank-batch-toolbar').getByRole('button', { name: '移入回收站', exact: true }).click();
    await until(async () => (await loadBank()).entries.every(item => item.trashedAt), 'Trash did not preserve all versions');
    await bank().locator('[data-bank-view="trash"]').click();
    await until(async () => await rows().count() === 1, 'Trash should show one logical question');
    await rows().first().getByRole('button', { name: '恢复', exact: true }).click();
    await until(async () => (await loadBank()).entries.every(item => !item.trashedAt), 'Restore failed');
    stored = await loadBank(); assert.equal(stored.entries.length, 3); assert.equal(stored.entries.at(-1).favorite, true); assert.equal(stored.entries.at(-1).collectionIds.length, 1);
    await bank().locator('[data-bank-view="all"]').click();
    checks.push('Trash/restore recovers all revisions and metadata');

    progress('ordered basket survives workspace switch and narrow collapse');
    await bank().getByLabel('更多题库操作', { exact: true }).click();
    await bank().getByRole('button', { name: '保存当前试卷', exact: true }).click();
    await until(async () => await rows().count() === 2, 'Current paper was not saved into bank');
    for (const row of await rows().all()) await row.getByRole('button', { name: '选题', exact: true }).click();
    const basket = bank().getByTestId('bank-basket');
    assert.equal(await basket.locator('[data-basket-id]').count(), 2);
    const initialOrder = await basket.locator('[data-basket-id]').evaluateAll(items => items.map(item => item.dataset.basketId));
    await basket.getByRole('button', { name: '上移选题 2', exact: true }).click();
    assert.deepEqual(await basket.locator('[data-basket-id]').evaluateAll(items => items.map(item => item.dataset.basketId)), [...initialOrder].reverse());
    await bank().locator('.bank-catalog-heading').getByRole('button', { name: '收起题目详情', exact: true }).click();
    await bank().getByRole('button', { name: '展开题目详情和选题篮，已选 2 题', exact: true }).click();
    await nav('组卷').click(); await openBank();
    assert.equal(await basket.locator('[data-basket-id]').count(), 2);
    // Check final geometry, not the intermediate x of the workspace slide.
    await until(() => page.locator('[data-workspace-view="bank"]').evaluate(element => {
      const style = getComputedStyle(element);
      return Number(style.opacity) > .999 && (style.transform === 'none' || Math.abs(new DOMMatrixReadOnly(style.transform).m41) < .1);
    }), 'Workspace transition did not settle');
    const geometry = await page.evaluate(() => { const main = document.querySelector('[data-testid="bank-workspace"]'); const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, bottom: r.bottom }; }; return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, main: rect(main), catalog: rect(main.querySelector('.bank-catalog')), detail: rect(main.querySelector('.bank-detail-pane')) }; });
    assert.ok(geometry.scrollWidth <= geometry.width + 1); assert.ok(geometry.catalog.right <= geometry.detail.x + 1); assert.ok(geometry.detail.right <= geometry.width + 1); assert.ok(geometry.detail.bottom <= geometry.height + 1);
    await page.screenshot({ path: path.join(artifacts, 'bank-workspace-1280.png') });
    checks.push('Basket order, count, score, narrow columns and workspace persistence');

    progress('insert cloned snapshots and create a separate paper');
    const expectedOrder = await basket.locator('[data-basket-id]').evaluateAll(items => items.map(item => item.dataset.basketId));
    await basket.getByRole('button', { name: '加入当前试卷', exact: true }).click();
    await until(async () => (await loadDraft()).exam.sections.flatMap(section => section.questions).length === 3, 'Basket insertion failed');
    const afterInsert = (await loadDraft()).exam.sections[0].questions;
    assert.deepEqual(afterInsert.slice(1).map(question => question.bankOrigin.revisionId), expectedOrder);
    assert.ok(afterInsert.slice(1).every(question => question.id !== 'bank-ui-exam-question'));
    await openBank();
    assert.equal(await basket.locator('[data-basket-id]').count(), 0);
    await until(async () => (await loadBank()).entries.every(item => item.usageCount === 1), 'Usage must increment after insertion');
    await rows().filter({ hasText: '修订题库题' }).getByRole('button', { name: '选题', exact: true }).click();
    await basket.getByRole('button', { name: '选题新建试卷', exact: true }).click();
    await until(async () => (await loadDraft()).exam.title === '题库选题试卷', 'New paper was not created');
    const created = await loadDraft(); assert.equal(created.exam.sections.flatMap(section => section.questions).length, 1); assert.ok(created.history.some(snapshot => snapshot.exam.id === exam.id));
    stored = await loadBank(); assert.equal(stored.entries.filter(item => item.libraryId === libraryId).at(-1).usageCount, 2);
    checks.push('Insertion preserves order/provenance and new paper preserves previous history');
    assert.deepEqual(errors, []); assert.equal(externalRequests, 0);
    report = { passed: true, packaged, checks, geometry, externalRequests, rendererErrors: errors, userData, screenshots: ['bank-editor-1280.png', 'bank-workspace-1280.png'] };
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
    report = { passed: false, stage, error: error.stack || String(error), rendererErrors: errors, externalRequests, userData };
    console.error(JSON.stringify(report, null, 2)); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); if (app) await app.close();
    fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    // Retain isolated temporary data for reproducible diagnostics; never remove unrelated user data.
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
