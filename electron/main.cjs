const { app, BrowserWindow, ipcMain, dialog, safeStorage, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DEFAULT_MODEL, requestModel } = require('./model.cjs');
const { createModelStore } = require('./model-store.cjs');
const { DEFAULT_APPEARANCE, checkedAppearance, applyWindowAppearance } = require('./appearance.cjs');
const { createDiagramService } = require('./diagram.cjs');
const diagrams = createDiagramService();

app.setName('Juanye');
if (process.env.JUANYE_TEST_USER_DATA && path.isAbsolute(process.env.JUANYE_TEST_USER_DATA)) app.setPath('userData', process.env.JUANYE_TEST_USER_DATA);
let mainWindow;
let recognition;
let writeQueue = Promise.resolve();
const indexPath = path.join(__dirname, '../dist/index.html');
const filePath = name => path.join(app.getPath('userData'), name);

async function readJson(name, fallback) {
  try { return JSON.parse(await fs.readFile(filePath(name), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`本地${name === 'draft.json' ? '草稿' : '配置'}无法读取；原文件已保留，请先备份后再恢复`);
  }
}
function writeJson(name, value) {
  const job = async () => {
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content) > 100 * 1024 * 1024) throw new Error('草稿超过 100 MB，请另存项目并减少历史图片');
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    const target = filePath(name);
    const temporary = filePath(`${name}.tmp`);
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    if (name === 'draft.json') {
      try { await fs.copyFile(target, filePath('draft.backup.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fs.rename(temporary, target);
  };
  const result = writeQueue.then(job);
  writeQueue = result.catch(() => {});
  return result;
}
function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('请求来源无效');
  if (event.senderFrame.url !== pathToFileURL(indexPath).toString()) throw new Error('仅允许本地应用访问');
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => { trusted(event); return callback(...args); });
}
const modelStore = createModelStore({ safeStorage, read: () => readJson('model.json', DEFAULT_MODEL), write: value => writeJson('model.json', value) });
async function modelWithKey(override) {
  return modelStore.resolve(override);
}
function cleanName(value, suffix) {
  return String(value || '未命名试卷').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100).replace(/[. ]+$/, '') + suffix;
}
function installHandlers() {
  handle('diagram:render', code => diagrams.render(code));
  handle('appearance:set', async value => {
    const appearance = checkedAppearance(value);
    const result = applyWindowAppearance(mainWindow, appearance);
    await writeJson('appearance.json', appearance);
    return result;
  });
  ipcMain.on('window:control', (event, action) => {
    trusted(event);
    if (action === 'min') mainWindow.minimize();
    else if (action === 'max') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === 'close') mainWindow.close();
  });
  handle('draft:load', () => readJson('draft.json', null));
  handle('draft:save', draft => {
    if (!draft || draft.version !== 1 || !draft.exam || !draft.layout || !Array.isArray(draft.history)) throw new Error('草稿格式无效');
    return writeJson('draft.json', draft);
  });
  handle('model:get', () => modelStore.get());
  handle('model:save', value => modelStore.save(value));
  handle('model:test', async config => {
    const start = Date.now();
    await requestModel(await modelWithKey(config), { test: true });
    return { latencyMs: Date.now() - start };
  });
  handle('model:recognize', async options => {
    if (recognition) throw new Error('识别任务仍在进行，请稍候或取消');
    const controller = new AbortController();
    recognition = controller;
    try { return await requestModel(await modelWithKey(), { ...options, signal: controller.signal }); }
    finally { if (recognition === controller) recognition = undefined; }
  });
  handle('model:cancel', () => { recognition?.abort(); recognition = undefined; });
  handle('document:text', async options => {
    if (!options || typeof options.content !== 'string' || options.content.length > 100 * 1024 * 1024) throw new Error('导出内容无效或过大');
    const ext = ['tex', 'juanye', 'json', 'md'].includes(options.extension) ? options.extension : 'txt';
    const target = await dialog.showSaveDialog(mainWindow, { defaultPath: cleanName(options.name, `.${ext}`), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (target.canceled || !target.filePath) return { canceled: true };
    await fs.writeFile(target.filePath, options.content, 'utf8');
    return { canceled: false, path: target.filePath };
  });
  handle('document:pdf', async options => {
    if (!options || !Number.isFinite(options.widthMm) || !Number.isFinite(options.heightMm) || options.widthMm < 80 || options.widthMm > 500 || options.heightMm < 80 || options.heightMm > 500) throw new Error('纸张尺寸无效');
    const target = await dialog.showSaveDialog(mainWindow, { defaultPath: cleanName(options.name, '.pdf'), filters: [{ name: 'PDF 试卷', extensions: ['pdf'] }] });
    if (target.canceled || !target.filePath) return { canceled: true };
    const bytes = await mainWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, margins: { top: 0, bottom: 0, left: 0, right: 0 }, pageSize: { width: options.widthMm, height: options.heightMm } });
    await fs.writeFile(target.filePath, bytes);
    return { canceled: false, path: target.filePath };
  });
}
async function createWindow() {
  const appearance = await readJson('appearance.json', DEFAULT_APPEARANCE).then(checkedAppearance).catch(() => DEFAULT_APPEARANCE);
  mainWindow = new BrowserWindow({
    width: 1500, height: 980, minWidth: 1000, minHeight: 700,
    frame: false, transparent: false, backgroundColor: '#08090c', title: '卷页',
    show: false,
    icon: path.join(__dirname, '../dist/juanye-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  applyWindowAppearance(mainWindow, appearance);
  if (!process.env.JUANYE_TEST_USER_DATA) mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  // Allow the renderer to finish its debounced save before a normal window close.
  let closing = false;
  mainWindow.on('close', event => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    mainWindow.webContents.executeJavaScript('window.dispatchEvent(new Event("juanye:flush")); true').catch(() => {});
    setTimeout(async () => {
      await writeQueue;
      mainWindow?.destroy();
      app.quit();
    }, 900);
  });
  await mainWindow.loadFile(indexPath);
}
app.whenReady().then(async () => { Menu.setApplicationMenu(null); installHandlers(); await createWindow(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { recognition?.abort(); diagrams.dispose(); });
