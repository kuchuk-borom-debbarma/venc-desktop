let encFile = null; // { path, name, size }
let decFile = null;
let decLastResult = null; // { outPath, ext } of most recent decrypt

function switchTab(mode) {
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active',
        (i === 0 && mode === 'encrypt') || (i === 1 && mode === 'decrypt')));
    document.getElementById('panel-encrypt').classList.toggle('active', mode === 'encrypt');
    document.getElementById('panel-decrypt').classList.toggle('active', mode === 'decrypt');
}

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

function setStatus(prefix, type, msg) {
    const el = document.getElementById(prefix + '-status');
    el.className = 'status' + (type ? ' ' + type : '');
    el.textContent = msg;
    el.style.display = type ? 'block' : 'none';
}

function setProgress(prefix, pct) {
    const bar = document.getElementById(prefix + '-prog');
    const fill = document.getElementById(prefix + '-prog-fill');
    bar.style.display = pct !== null ? 'block' : 'none';
    if (pct !== null) fill.style.width = pct + '%';
}

function setActions(prefix, show) {
    document.getElementById(prefix + '-actions').style.display = show ? 'flex' : 'none';
}

function setFileUI(prefix, f) {
    document.getElementById(prefix + '-fname').textContent = f.name;
    document.getElementById(prefix + '-fsize').textContent = fmtSize(f.size);
    document.getElementById(prefix + '-info').style.display = 'flex';
    document.getElementById(prefix + '-drop').style.display = 'none';
    setStatus(prefix, '', '');
    setActions(prefix, false);
}

function clearFile(prefix) {
    if (prefix === 'enc') encFile = null; else { decFile = null; decLastResult = null; }
    document.getElementById(prefix + '-info').style.display = 'none';
    document.getElementById(prefix + '-drop').style.display = 'block';
    setStatus(prefix, '', '');
    setActions(prefix, false);
}

async function pickEncryptFile() {
    const f = await window.api.pickEncryptFile();
    if (!f) return;
    encFile = f;
    setFileUI('enc', f);
}

async function pickDecryptFile() {
    const f = await window.api.pickDecryptFile();
    if (!f) return;
    decFile = f;
    decLastResult = null;
    setFileUI('dec', f);
}

async function doEncrypt() {
    if (!encFile) return setStatus('enc', 'error', 'No file selected.');
    const pw = document.getElementById('enc-pw').value;
    const pw2 = document.getElementById('enc-pw2').value;
    if (!pw) return setStatus('enc', 'error', 'Password is required.');
    if (pw !== pw2) return setStatus('enc', 'error', 'Passwords do not match.');

    const btn = document.getElementById('enc-btn');
    btn.disabled = true;
    setActions('enc', false);
    setStatus('enc', 'working', 'Encrypting…');
    setProgress('enc', 1);

    try {
        const result = await window.api.encryptFile(encFile.path, pw);
        if (result.canceled) {
            setStatus('enc', '', '');
        } else {
            encLastOutPath = result.outPath;
            setStatus('enc', 'success', `Encrypted → ${result.outPath}\nThis file cannot be played. Keep your password safe.`);
            setActions('enc', true);
        }
    } catch (e) {
        setStatus('enc', 'error', 'Encryption failed: ' + e.message);
    } finally {
        btn.disabled = false;
        setTimeout(() => setProgress('enc', null), 800);
    }
}

let encLastOutPath = null;

async function doDecryptOpen() {
    if (!decFile) return setStatus('dec', 'error', 'No file selected.');
    const pw = document.getElementById('dec-pw').value;
    if (!pw) return setStatus('dec', 'error', 'Password is required.');

    const openBtn = document.getElementById('dec-open-btn');
    const saveBtn = document.getElementById('dec-save-btn');
    openBtn.disabled = true;
    saveBtn.disabled = true;
    setActions('dec', false);
    setStatus('dec', 'working', 'Decrypting…');
    setProgress('dec', 1);

    try {
        const result = await window.api.decryptAndPlay(decFile.path, pw);
        decLastResult = result;
        setProgress('dec', 100);
        setStatus('dec', 'success',
            `Decrypted → opened in your system’s default app.\n(Temp file: ${result.outPath})`);
        setActions('dec', true);
    } catch (e) {
        setStatus('dec', 'error', e.message || 'Decryption failed.');
    } finally {
        openBtn.disabled = false;
        saveBtn.disabled = false;
        setTimeout(() => setProgress('dec', null), 800);
    }
}

async function doDecryptSave() {
    if (!decFile) return setStatus('dec', 'error', 'No file selected.');
    const pw = document.getElementById('dec-pw').value;
    if (!pw) return setStatus('dec', 'error', 'Password is required.');

    const openBtn = document.getElementById('dec-open-btn');
    const saveBtn = document.getElementById('dec-save-btn');
    openBtn.disabled = true;
    saveBtn.disabled = true;
    setActions('dec', false);
    setStatus('dec', 'working', 'Decrypting…');
    setProgress('dec', 1);

    try {
        const result = await window.api.decryptAndSave(decFile.path, pw);
        if (result.canceled) {
            setStatus('dec', '', '');
        } else {
            decLastResult = { outPath: result.outPath, ext: result.outPath.slice(result.outPath.lastIndexOf('.')) };
            setProgress('dec', 100);
            setStatus('dec', 'success', `Saved → ${result.outPath}`);
            setActions('dec', true);
        }
    } catch (e) {
        setStatus('dec', 'error', e.message || 'Decryption failed.');
    } finally {
        openBtn.disabled = false;
        saveBtn.disabled = false;
        setTimeout(() => setProgress('dec', null), 800);
    }
}

async function saveCopy() {
    if (!decLastResult) return;
    try {
        const result = await window.api.saveCopy(decLastResult.outPath, decLastResult.ext);
        if (!result.canceled) {
            setStatus('dec', 'success', `Saved a permanent copy → ${result.outPath}`);
        }
    } catch (e) {
        setStatus('dec', 'error', 'Could not save copy: ' + e.message);
    }
}

async function showInFolder(prefix) {
    if (prefix === 'enc' && encLastOutPath) {
        await window.api.showInFolder(encLastOutPath);
    } else if (prefix === 'dec' && decLastResult) {
        await window.api.showInFolder(decLastResult.outPath);
    }
}

window.api.onEncryptProgress((pct) => setProgress('enc', pct));
window.api.onDecryptProgress((pct) => setProgress('dec', pct));
