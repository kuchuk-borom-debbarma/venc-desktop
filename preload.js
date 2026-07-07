const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickEncryptFile: () => ipcRenderer.invoke('pick-encrypt-file'),
  pickDecryptFile: () => ipcRenderer.invoke('pick-decrypt-file'),

  encryptFile: (inputPath, password) => ipcRenderer.invoke('encrypt-file', { inputPath, password }),
  decryptAndPlay: (inputPath, password) => ipcRenderer.invoke('decrypt-and-play', { inputPath, password }),
  decryptAndSave: (inputPath, password) => ipcRenderer.invoke('decrypt-and-save', { inputPath, password }),

  saveCopy: (tempPath, ext) => ipcRenderer.invoke('save-copy', { tempPath, ext }),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),

  onEncryptProgress: (cb) => ipcRenderer.on('encrypt-progress', (_e, pct) => cb(pct)),
  onDecryptProgress: (cb) => ipcRenderer.on('decrypt-progress', (_e, pct) => cb(pct)),
});
