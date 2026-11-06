// Isolated synthetic renderer host; no access to application draft or model IPC.
const { app, BrowserWindow } = require('electron');
if (process.env.JUANYE_TEST_USER_DATA) app.setPath('userData', process.env.JUANYE_TEST_USER_DATA);
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.setPosition(-16000, -16000); win.showInactive();
  const renderer = process.argv.find(value => /book-renderer\.html$/.test(value));
  if (renderer) win.loadFile(renderer); else win.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
