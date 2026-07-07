const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

// File format (identical to the web version, so .venc files are interchangeable):
// MAGIC(5="VENC2") | salt(16) | iv(12) | extLen(2, big-endian) | ext(extLen) | ciphertext | authTag(16)
const MAGIC = Buffer.from('VENC2', 'utf8');
const ITER = 250000;
const KEYLEN = 32;
const SALTLEN = 16;
const IVLEN = 12;
const TAGLEN = 16;
const FIXED_HEADER_LEN = MAGIC.length + SALTLEN + IVLEN + 2; // 35

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640,
    height: 820,
    minWidth: 480,
    minHeight: 640,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITER, KEYLEN, 'sha256');
}

function getExt(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i);
}

function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? name : name.slice(0, i);
}

function guessMime(ext) {
  const map = {
    // Video
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.m4v': 'video/mp4', '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv', '.3gp': 'video/3gpp',
    // Audio
    '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.flac': 'audio/flac', '.wav': 'audio/wav',
    '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.opus': 'audio/opus',
    // Images
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    // Documents
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Archives
    '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
    '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

// ---- Core streaming crypto (handles multi-GB files without loading them into memory) ----

function encryptToFile(inputPath, password, outPath, onProgress) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALTLEN);
    const iv = crypto.randomBytes(IVLEN);
    const key = deriveKey(password, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const inName = path.basename(inputPath);
    const extBuf = Buffer.from(getExt(inName), 'utf8');
    const extLenBuf = Buffer.alloc(2);
    extLenBuf.writeUInt16BE(extBuf.length, 0);
    const header = Buffer.concat([MAGIC, salt, iv, extLenBuf, extBuf]);

    const total = fs.statSync(inputPath).size || 1;
    let processed = 0;

    const outStream = fs.createWriteStream(outPath);
    const inStream = fs.createReadStream(inputPath);

    outStream.on('error', reject);
    inStream.on('error', reject);

    outStream.write(header);

    inStream.on('data', (chunk) => {
      processed += chunk.length;
      const enc = cipher.update(chunk);
      if (enc.length) {
        const ok = outStream.write(enc);
        if (!ok) inStream.pause();
      }
      onProgress(Math.min(90, Math.round((processed / total) * 90)));
    });

    outStream.on('drain', () => inStream.resume());

    inStream.on('end', () => {
      const finalChunk = cipher.final();
      if (finalChunk.length) outStream.write(finalChunk);
      const tag = cipher.getAuthTag();
      outStream.end(tag, () => {
        onProgress(100);
        resolve(outPath);
      });
    });
  });
}

function readVencHeader(inputPath) {
  const fd = fs.openSync(inputPath, 'r');
  try {
    const fixed = Buffer.alloc(FIXED_HEADER_LEN);
    fs.readSync(fd, fixed, 0, FIXED_HEADER_LEN, 0);

    if (fixed.subarray(0, MAGIC.length).toString('utf8') !== 'VENC2') {
      throw new Error('Not a valid .venc file — wrong format or corrupted.');
    }

    const salt = Buffer.from(fixed.subarray(5, 21));
    const iv = Buffer.from(fixed.subarray(21, 33));
    const extLen = fixed.readUInt16BE(33);

    const extBuf = Buffer.alloc(extLen);
    fs.readSync(fd, extBuf, 0, extLen, FIXED_HEADER_LEN);
    const ext = extBuf.toString('utf8');

    const headerTotalLen = FIXED_HEADER_LEN + extLen;
    const fileSize = fs.statSync(inputPath).size;
    const tagOffset = fileSize - TAGLEN;
    if (tagOffset < headerTotalLen) throw new Error('File is too short / corrupted.');

    const tag = Buffer.alloc(TAGLEN);
    fs.readSync(fd, tag, 0, TAGLEN, tagOffset);

    return { salt, iv, ext, tag, payloadStart: headerTotalLen, payloadEnd: tagOffset };
  } finally {
    fs.closeSync(fd);
  }
}

function decryptToFile(inputPath, password, outPath, onProgress) {
  return new Promise((resolve, reject) => {
    let meta;
    try {
      meta = readVencHeader(inputPath);
    } catch (e) {
      return reject(e);
    }

    const key = deriveKey(password, meta.salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, meta.iv);
    decipher.setAuthTag(meta.tag);

    const total = Math.max(1, meta.payloadEnd - meta.payloadStart);
    let processed = 0;
    let failed = false;

    const outStream = fs.createWriteStream(outPath);
    const inStream = fs.createReadStream(inputPath, { start: meta.payloadStart, end: meta.payloadEnd - 1 });

    outStream.on('error', reject);
    inStream.on('error', reject);

    inStream.on('data', (chunk) => {
      if (failed) return;
      processed += chunk.length;
      try {
        const dec = decipher.update(chunk);
        if (dec.length) {
          const ok = outStream.write(dec);
          if (!ok) inStream.pause();
        }
      } catch (e) {
        failed = true;
        inStream.destroy();
        fs.unlink(outPath, () => {});
        reject(new Error('Decryption failed — wrong password or corrupted file.'));
        return;
      }
      onProgress(Math.min(90, Math.round((processed / total) * 90)));
    });

    outStream.on('drain', () => { if (!failed) inStream.resume(); });

    inStream.on('end', () => {
      if (failed) return;
      let finalChunk;
      try {
        finalChunk = decipher.final();
      } catch (e) {
        fs.unlink(outPath, () => {});
        return reject(new Error('Decryption failed — wrong password or corrupted file.'));
      }
      if (finalChunk.length) outStream.write(finalChunk);
      outStream.end(() => {
        onProgress(100);
        resolve({ outPath, ext: meta.ext });
      });
    });
  });
}

// ---- IPC handlers ----

ipcMain.handle('pick-encrypt-file', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return [];
  return r.filePaths.map(p => ({ path: p, name: path.basename(p), size: fs.statSync(p).size }));
});

ipcMain.handle('pick-decrypt-file', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'VENC files', extensions: ['venc'] }]
  });
  if (r.canceled || !r.filePaths.length) return [];
  return r.filePaths.map(p => ({ path: p, name: path.basename(p), size: fs.statSync(p).size }));
});

ipcMain.handle('pick-output-dir', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose output folder for encrypted files'
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle('encrypt-files-to-dir', async (event, { inputPaths, password, outputDir }) => {
  const results = [];
  for (let i = 0; i < inputPaths.length; i++) {
    const inputPath = inputPaths[i];
    const inName = path.basename(inputPath);
    const outPath = path.join(outputDir, stripExt(inName) + '.venc');
    try {
      await encryptToFile(inputPath, password, outPath, (pct) => {
        event.sender.send('encrypt-progress', { index: i, total: inputPaths.length, file: inName, pct });
      });
      results.push({ inputName: inName, outPath });
    } catch (e) {
      results.push({ inputName: inName, error: e.message });
    }
  }
  return results;
});

ipcMain.handle('decrypt-files', async (event, { inputPaths, password }) => {
  const results = [];
  for (let i = 0; i < inputPaths.length; i++) {
    const inputPath = inputPaths[i];
    const inName = path.basename(inputPath);
    let meta;
    try {
      meta = readVencHeader(inputPath);
    } catch (e) {
      results.push({ inputName: inName, error: e.message });
      continue;
    }
    const tmpName = `venc-preview-${Date.now()}-${i}`;
    const outPath = path.join(os.tmpdir(), tmpName + meta.ext);
    try {
      await decryptToFile(inputPath, password, outPath, (pct) => {
        event.sender.send('decrypt-progress', { index: i, total: inputPaths.length, file: inName, pct });
      });
      results.push({ inputName: inName, outPath, ext: meta.ext });
    } catch (e) {
      results.push({ inputName: inName, error: e.message });
    }
  }
  return results;
});

ipcMain.handle('encrypt-file', async (event, { inputPath, password }) => {
  const inName = path.basename(inputPath);
  const saveResult = await dialog.showSaveDialog({
    defaultPath: stripExt(inName) + '.venc',
    filters: [{ name: 'VENC file', extensions: ['venc'] }]
  });
  if (saveResult.canceled || !saveResult.filePath) return { canceled: true };

  const outPath = saveResult.filePath;
  await encryptToFile(inputPath, password, outPath, (pct) => {
    event.sender.send('encrypt-progress', pct);
  });
  return { canceled: false, outPath };
});

// Decrypts straight to a temp file and opens it in the OS's default video app —
// this is what makes "always plays" true: we hand off to native OS codecs
// (QuickTime, Movies & TV, VLC, etc.) instead of relying on Chromium's decoder.
ipcMain.handle('decrypt-and-play', async (event, { inputPath, password }) => {
  const tmpName = `venc-preview-${Date.now()}`;
  let meta;
  try {
    meta = readVencHeader(inputPath);
  } catch (e) {
    throw e;
  }
  const outPath = path.join(os.tmpdir(), tmpName + meta.ext);

  await decryptToFile(inputPath, password, outPath, (pct) => {
    event.sender.send('decrypt-progress', pct);
  });

  const openErr = await shell.openPath(outPath);
  return { outPath, ext: meta.ext, openError: openErr || null };
});

ipcMain.handle('decrypt-and-save', async (event, { inputPath, password }) => {
  let meta;
  try {
    meta = readVencHeader(inputPath);
  } catch (e) {
    throw e;
  }
  const inName = path.basename(inputPath);
  const extNoDot = meta.ext.replace('.', '') || 'bin';
  const saveResult = await dialog.showSaveDialog({
    defaultPath: stripExt(inName) + meta.ext,
    filters: [
      { name: extNoDot.toUpperCase() + ' File', extensions: [extNoDot] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (saveResult.canceled || !saveResult.filePath) return { canceled: true };

  const outPath = saveResult.filePath;
  await decryptToFile(inputPath, password, outPath, (pct) => {
    event.sender.send('decrypt-progress', pct);
  });
  return { canceled: false, outPath };
});

ipcMain.handle('save-copy', async (event, { tempPath, ext }) => {
  const extNoDot = ext.replace('.', '') || 'bin';
  const saveResult = await dialog.showSaveDialog({
    defaultPath: 'decrypted' + ext,
    filters: [
      { name: extNoDot.toUpperCase() + ' File', extensions: [extNoDot] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (saveResult.canceled || !saveResult.filePath) return { canceled: true };
  await fs.promises.copyFile(tempPath, saveResult.filePath);
  return { canceled: false, outPath: saveResult.filePath };
});

ipcMain.handle('show-in-folder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('open-path', async (event, filePath) => {
  return shell.openPath(filePath);
});
