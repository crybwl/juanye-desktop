const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron } = require('playwright');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'juanye-columns-dom-'));
  const env = { ...process.env, JUANYE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const helper = buildSync({ entryPoints: [path.join(root, 'src/book-column-pagination.ts')], bundle: true, format: 'iife', globalName: 'BookColumnsTest', write: false }).outputFiles[0].text;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [path.join(__dirname, 'book-columns-host.cjs')], env });
  try {
    const page = await app.firstWindow();
    await page.addScriptTag({ content: helper });
    const result = await page.evaluate(() => {
      const style = document.createElement('style'); style.textContent = '.source{width:600px;position:absolute;left:-10000px;top:0;font:14px/1.6 Arial}.source p{margin:0 0 10px}.book-question{margin-bottom:12px}table{width:100%;border-collapse:collapse}td,th{padding:4px;border:1px solid}'; document.head.append(style);
      const source = document.createElement('div'); source.className = 'source'; document.body.append(source);
      const expected = [];
      function paragraph(value) { const node = document.createElement('p'); node.textContent = value; expected.push(value); return node; }
      const set = document.createElement('section'); set.className = 'book-columns'; set.dataset.columns = '2'; set.dataset.columnGap = '6'; set.dataset.columnRule = 'true'; source.append(set);
      set.append(paragraph('MANUAL_LEFT'));
      const next = document.createElement('div'); next.className = 'book-column-break'; set.append(next);
      set.append(paragraph('MANUAL_RIGHT'));
      const page = document.createElement('div'); page.className = 'book-page-break'; set.append(page);
      set.append(paragraph('FORCED_LEFT'));
      for (let index = 0; index < 30; index++) {
        const item = document.createElement('article'); item.className = 'book-question'; item.dataset.number = String(index);
        item.append(paragraph(`Q${index}: ${'完整题目内容需要顺序保存。'.repeat(12)}`)); set.append(item);
      }
      const large = paragraph('LONG_BEGIN ' + '相同的长段落文字。'.repeat(500) + ' LONG_END'); set.append(large);
      const before = source.textContent.replace(/\s+/g, '');
      const result = BookColumnsTest.materializeBookColumns(source, { usableHeight: 700 });
      const after = source.textContent.replace(/\s+/g, '');
      const locate = value => [...source.querySelectorAll('.book-column-cell')].find(cell => cell.textContent.includes(value));
      return { ...result, same: before === after, rowCount: source.querySelectorAll('.book-column-row').length,
        manual: ['MANUAL_LEFT', 'MANUAL_RIGHT', 'FORCED_LEFT'].map(value => ({ value, column: locate(value)?.dataset.columnIndex, row: locate(value)?.parentElement.dataset.columnRow })),
        overflow: [...source.querySelectorAll('.book-column-row')].some(row => [...row.querySelectorAll('.book-column-cell')].some(cell => cell.getBoundingClientRect().height > row.getBoundingClientRect().height + 1)),
        numbers: [...source.querySelectorAll('.book-question')].map(item => Number(item.dataset.number)),
        preservedLong: source.textContent.includes('LONG_BEGIN') && source.textContent.includes('LONG_END') };
    });
    assert.equal(result.same, true); assert.equal(result.overflow, false); assert.equal(result.preservedLong, true);
    assert.ok(result.rows > 5); assert.deepEqual(result.manual.map(item => item.column), ['1', '2', '1']);
    assert.notEqual(result.manual[1].row, result.manual[2].row);
    assert.deepEqual([...new Set(result.numbers)], Array.from({ length: 30 }, (_, i) => i));
    console.log(JSON.stringify({ passed: true, result }));
  } finally { await app.close(); const resolved = fs.realpathSync(profile); assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase()); assert.ok(path.basename(resolved).startsWith('juanye-columns-dom-')); fs.rmSync(resolved, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
