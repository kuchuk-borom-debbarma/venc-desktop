// ---- State ----
let encFiles = [];  // [{ path, name, size }]
let decFiles = [];  // [{ path, name, size }]

// ---- Tabs ----
function switchTab(mode) {
    document.querySelectorAll('.tab').forEach((t, i) =>
        t.classList.toggle('active',
            (i === 0 && mode === 'encrypt') || (i === 1 && mode === 'decrypt')));
    document.getElementById('panel-encrypt').classList.toggle('active', mode === 'encrypt');
    document.getElementById('panel-decrypt').classList.toggle('active', mode === 'decrypt');
}

// ---- Helpers ----
function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
}

function togglePw(id, btn) {
    const el = document.getElementById(id);
    const shown = el.type === 'text';
    el.type = shown ? 'password' : 'text';
    btn.textContent = shown ? 'show' : 'hide';
}

function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setStatus(prefix, type, msg) {
    const el = document.getElementById(prefix + '-status');
    el.className = 'status' + (type ? ' ' + type : '');
    el.textContent = msg;
    el.style.display = type ? 'block' : 'none';
}

function setProgress(prefix, pct, label) {
    const bar = document.getElementById(prefix + '-prog');
    const fill = document.getElementById(prefix + '-prog-fill');
    const labelEl = document.getElementById(prefix + '-batch-label');
    bar.style.display = pct !== null ? 'block' : 'none';
    if (pct !== null) fill.style.width = pct + '%';
    if (labelEl) labelEl.textContent = (pct !== null && label) ? label : '';
}

// ---- File list rendering ----
function renderFileList(prefix, files) {
    const list = document.getElementById(prefix + '-file-list');
    const wrap = document.getElementById(prefix + '-file-list-wrap');
    const drop = document.getElementById(prefix + '-drop');
    list.innerHTML = '';
    if (files.length === 0) {
        wrap.style.display = 'none';
        drop.style.display = 'flex';
        return;
    }
    wrap.style.display = 'block';
    drop.style.display = 'none';
    files.forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'flist-row';
        row.innerHTML = `
            <span class="flist-name" title="${esc(f.name)}">${esc(f.name)}</span>
            <span class="flist-size">${fmtSize(f.size)}</span>
            <button class="flist-remove" onclick="removeFile('${prefix}', ${i})">✕</button>
        `;
        list.appendChild(row);
    });
}

function removeFile(prefix, index) {
    if (prefix === 'enc') {
        encFiles.splice(index, 1);
        renderFileList('enc', encFiles);
    } else {
        decFiles.splice(index, 1);
        renderFileList('dec', decFiles);
    }
}

// ---- Pick files ----
async function pickEncryptFiles(addMore = false) {
    const picked = await window.api.pickEncryptFile();
    if (!picked || !picked.length) return;
    if (addMore) {
        encFiles.push(...picked);
    } else {
        encFiles = [...picked];
        document.getElementById('enc-result-list').innerHTML = '';
        setStatus('enc', '', '');
    }
    renderFileList('enc', encFiles);
}

async function pickDecryptFiles(addMore = false) {
    const picked = await window.api.pickDecryptFile();
    if (!picked || !picked.length) return;
    if (addMore) {
        decFiles.push(...picked);
    } else {
        decFiles = [...picked];
        document.getElementById('dec-result-list').innerHTML = '';
        setStatus('dec', '', '');
    }
    renderFileList('dec', decFiles);
}

// ---- Encrypt all ----
async function doEncryptAll() {
    if (!encFiles.length) return setStatus('enc', 'error', 'No files selected.');
    const pw = document.getElementById('enc-pw').value;
    const pw2 = document.getElementById('enc-pw2').value;
    if (!pw) return setStatus('enc', 'error', 'Password is required.');
    if (pw !== pw2) return setStatus('enc', 'error', 'Passwords do not match.');

    // Ask user to pick output directory
    const outputDir = await window.api.pickOutputDir();
    if (!outputDir) return;

    const btn = document.getElementById('enc-btn');
    btn.disabled = true;
    document.getElementById('enc-result-list').innerHTML = '';
    setStatus('enc', 'working', 'Encrypting…');
    setProgress('enc', 1, `0 / ${encFiles.length} files`);

    try {
        const inputPaths = encFiles.map(f => f.path);
        const results = await window.api.encryptFilesToDir(inputPaths, pw, outputDir);
        setProgress('enc', null);
        const errCount = results.filter(r => r.error).length;
        if (errCount === 0) {
            setStatus('enc', 'success', `✓ ${results.length} file(s) encrypted → ${outputDir}`);
        } else {
            setStatus('enc', 'error', `${results.length - errCount} succeeded, ${errCount} failed.`);
        }
        renderEncResults(results);
    } catch (e) {
        setProgress('enc', null);
        setStatus('enc', 'error', 'Encryption failed: ' + e.message);
    } finally {
        btn.disabled = false;
    }
}

function renderEncResults(results) {
    const list = document.getElementById('enc-result-list');
    list.innerHTML = '';
    if (!results.length) return;
    results.forEach(r => {
        const row = document.createElement('div');
        row.className = 'result-row' + (r.error ? ' result-row--err' : '');
        if (r.error) {
            row.innerHTML = `
                <span class="result-icon">✗</span>
                <span class="result-name">${esc(r.inputName)}</span>
                <span class="result-err">${esc(r.error)}</span>`;
        } else {
            const p = r.outPath;
            row.innerHTML = `
                <span class="result-icon ok">✓</span>
                <span class="result-name">${esc(r.inputName)}</span>
                <div class="result-btns">
                    <button class="btn-secondary sm" onclick="showInFolderPath(${JSON.stringify(p)})">Show</button>
                </div>`;
        }
        list.appendChild(row);
    });
}

function showInFolderPath(p) { window.api.showInFolder(p); }

// ---- Decrypt all ----
async function doDecryptAll() {
    if (!decFiles.length) return setStatus('dec', 'error', 'No files selected.');
    const pw = document.getElementById('dec-pw').value;
    if (!pw) return setStatus('dec', 'error', 'Password is required.');

    const btn = document.getElementById('dec-btn');
    btn.disabled = true;
    document.getElementById('dec-result-list').innerHTML = '';
    setStatus('dec', 'working', 'Decrypting…');
    setProgress('dec', 1, `0 / ${decFiles.length} files`);

    try {
        const inputPaths = decFiles.map(f => f.path);
        const results = await window.api.decryptFiles(inputPaths, pw);
        setProgress('dec', null);
        const errCount = results.filter(r => r.error).length;
        if (errCount === 0) {
            setStatus('dec', 'success', `✓ All ${results.length} file(s) decrypted. Open or save each below.`);
        } else {
            setStatus('dec', 'error', `${results.length - errCount} succeeded, ${errCount} failed.`);
        }
        renderDecResults(results);
    } catch (e) {
        setProgress('dec', null);
        setStatus('dec', 'error', e.message || 'Decryption failed.');
    } finally {
        btn.disabled = false;
    }
}

function renderDecResults(results) {
    const list = document.getElementById('dec-result-list');
    list.innerHTML = '';
    if (!results.length) return;
    results.forEach(r => {
        const row = document.createElement('div');
        row.className = 'result-row' + (r.error ? ' result-row--err' : '');
        if (r.error) {
            row.innerHTML = `
                <span class="result-icon">✗</span>
                <span class="result-name">${esc(r.inputName)}</span>
                <span class="result-err">${esc(r.error)}</span>`;
        } else {
            const p = r.outPath;
            const ext = r.ext;
            row.innerHTML = `
                <span class="result-icon ok">✓</span>
                <span class="result-name">${esc(r.inputName)}</span>
                <div class="result-btns">
                    <button class="btn-secondary sm" onclick="openResultPath(${JSON.stringify(p)})">Open</button>
                    <button class="btn-secondary sm" onclick="saveResultPath(${JSON.stringify(p)}, ${JSON.stringify(ext)})">Save As…</button>
                </div>`;
        }
        list.appendChild(row);
    });
}

function openResultPath(p) { window.api.openPath(p); }

async function saveResultPath(p, ext) {
    try {
        await window.api.saveCopy(p, ext);
    } catch (e) {
        setStatus('dec', 'error', 'Save failed: ' + e.message);
    }
}

// ---- Progress listeners ----
window.api.onEncryptProgress((data) => {
    if (typeof data === 'number') {
        setProgress('enc', data);
    } else {
        const overall = Math.min(99, Math.round((data.index * 100 + data.pct) / data.total));
        setProgress('enc', overall, `File ${data.index + 1} of ${data.total}: ${data.file}`);
    }
});

window.api.onDecryptProgress((data) => {
    if (typeof data === 'number') {
        setProgress('dec', data);
    } else {
        const overall = Math.min(99, Math.round((data.index * 100 + data.pct) / data.total));
        setProgress('dec', overall, `File ${data.index + 1} of ${data.total}: ${data.file}`);
    }
});
