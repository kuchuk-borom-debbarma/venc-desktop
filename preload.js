const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickEncryptFile: () => ipcRenderer.invoke('pick-encrypt-file'),
  pickDecryptFile: () => ipcRenderer.invoke('pick-decrypt-file'),
  pickOutputDir: () => ipcRenderer.invoke('pick-output-dir'),

  encryptFile: (inputPath, password) => ipcRenderer.invoke('encrypt-file', { inputPath, password }),
  encryptFilesToDir: (inputPaths, password, outputDir) =>
    ipcRenderer.invoke('encrypt-files-to-dir', { inputPaths, password, outputDir }),

  decryptFiles: (inputPaths, password) =>
    ipcRenderer.invoke('decrypt-files', { inputPaths, password }),
  decryptAndPlay: (inputPath, password) => ipcRenderer.invoke('decrypt-and-play', { inputPath, password }),
  decryptAndSave: (inputPath, password) => ipcRenderer.invoke('decrypt-and-save', { inputPath, password }),

  saveCopy: (tempPath, ext) => ipcRenderer.invoke('save-copy', { tempPath, ext }),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),

  onEncryptProgress: (cb) => ipcRenderer.on('encrypt-progress', (_e, data) => cb(data)),
  onDecryptProgress: (cb) => ipcRenderer.on('decrypt-progress', (_e, data) => cb(data)),
});

