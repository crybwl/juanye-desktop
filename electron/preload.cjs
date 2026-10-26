const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('juanye', Object.freeze({
  platform: process.platform,
  renderDrawing: code => ipcRenderer.invoke('diagram:render', code),
  setAppearance: appearance => ipcRenderer.invoke('appearance:set', appearance),
  windowControl: action => ipcRenderer.send('window:control', action),
  exportPdf: options => ipcRenderer.invoke('document:pdf', options),
  saveText: options => ipcRenderer.invoke('document:text', options),
  loadDraft: () => ipcRenderer.invoke('draft:load'),
  saveDraft: draft => ipcRenderer.invoke('draft:save', draft),
  getModel: () => ipcRenderer.invoke('model:get'),
  saveModel: config => ipcRenderer.invoke('model:save', config),
  testModel: config => ipcRenderer.invoke('model:test', config),
  recognize: options => ipcRenderer.invoke('model:recognize', options),
  cancelRecognition: () => ipcRenderer.invoke('model:cancel'),
  generateQuestion: options => ipcRenderer.invoke('model:generate', options),
  bankLoad: () => ipcRenderer.invoke('bank:load'),
  bankSave: options => ipcRenderer.invoke('bank:save', options),
  bankDelete: ids => ipcRenderer.invoke('bank:delete', ids),
  bankRestore: () => ipcRenderer.invoke('bank:restore'),
  exportDocx: options => ipcRenderer.invoke('document:docx', options),
}));
