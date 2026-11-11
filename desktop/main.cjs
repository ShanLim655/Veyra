const { app, BrowserWindow, shell, dialog, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const APP_URL = 'https://veyra-pink-mu.vercel.app';
const APP_ORIGIN = new URL(APP_URL).origin;
const RELEASE_METADATA = 'https://github.com/ShanLim655/Veyra/releases/latest/download/latest.json';
const SESSION_PATH = path.join(app.getPath('userData'), 'session.dat');
const UPDATE_DIRECTORY = path.join(app.getPath('userData'), 'updates');
const PENDING_UPDATE_PATH = path.join(UPDATE_DIRECTORY, 'pending.json');
const MAX_UPDATE_BYTES = 500 * 1024 * 1024;
const { compareVersions, isReleaseVersion, isReleaseAssetUrl, isFinalAssetUrl, isSha256 } = require('./update-utils.cjs');
let mainWindow = null;
let updateWindow = null;
let updateWindowReady = false;
let updateWindowDismissed = false;
let updateState = null;

function renderUpdateProgress() {
  if (!updateWindow || updateWindow.isDestroyed() || !updateWindowReady || !updateState) return;
  const { version, status, progress, detail } = updateState;
  const script = "window.setUpdateState && window.setUpdateState(" + [version, status, progress, detail].map((value) => JSON.stringify(value)).join(",") + ")";
  void updateWindow.webContents.executeJavaScript(script).catch(() => undefined);
}

function showUpdateProgress(version, status, progress = null, detail = "") {
  if (updateWindowDismissed) return;
  updateState = { version, status, progress, detail };
  if (!updateWindow || updateWindow.isDestroyed()) {
    updateWindowReady = false;
    updateWindow = new BrowserWindow({
      width: 440,
      height: 230,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      resizable: false,
      minimizable: true,
      maximizable: false,
      closable: true,
      autoHideMenuBar: true,
      title: "Veyra Update",
      backgroundColor: "#101010",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    updateWindow.on("closed", () => {
      updateWindow = null;
      updateWindowReady = false;
      updateWindowDismissed = true;
    });
    updateWindow.webContents.once("did-finish-load", () => {
      updateWindowReady = true;
      renderUpdateProgress();
    });
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Veyra Update</title><style>body{margin:0;padding:30px;background:#101010;color:#f5f5f5;font:14px system-ui,sans-serif}h1{font-size:19px;margin:0 0 8px}p{color:#aaa;margin:0 0 22px}#status{margin-bottom:10px}#detail{font-size:12px;color:#888;margin-top:12px}progress{width:100%;height:9px;accent-color:#fff}</style></head><body><h1>Updating Veyra</h1><p id="version"></p><div id="status">Preparing update…</div><progress id="progress" max="100" value="0"></progress><div id="detail"></div><script>window.setUpdateState=(version,status,progress,detail)=>{document.getElementById('version').textContent='Version '+version;document.getElementById('status').textContent=status;document.getElementById('progress').hidden=progress===null;document.getElementById('progress').value=progress??0;document.getElementById('detail').textContent=detail;};</script></body></html>`;
    void updateWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  }
  renderUpdateProgress();
}
const queuedPairCallbacks = [];
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (hasSingleInstanceLock) {
  const initialPairCallback = process.argv.map(getPairCallback).find(Boolean);
  if (initialPairCallback) queuedPairCallbacks.push(initialPairCallback);
}

function getPairCallback(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'veyra:' && url.hostname === 'pair' && url.searchParams.has('code') ? url.toString() : null;
  } catch {
    return null;
  }
}

function deliverPairCallback(value) {
  const url = getPairCallback(value);
  if (!url) return;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    queuedPairCallbacks.push(url);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('veyra:pair-callback', url);
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const pairUrl = commandLine.map(getPairCallback).find(Boolean);
    if (pairUrl) deliverPairCallback(pairUrl);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliverPairCallback(url);
  });
}

function readSessionToken() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(fs.readFileSync(SESSION_PATH));
  } catch {
    return null;
  }
}

ipcMain.handle('veyra:get-session-token', () => readSessionToken());
ipcMain.handle('veyra:set-session-token', (_event, token) => {
  if (typeof token !== 'string' || token.length < 32 || token.length > 512) throw new Error('Invalid Veyra session token.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable.');
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, safeStorage.encryptString(token));
});
ipcMain.handle('veyra:clear-session-token', () => {
  try { fs.unlinkSync(SESSION_PATH); } catch {}
});
ipcMain.handle('veyra:open-external', async (_event, target) => {
  const url = new URL(String(target));
  if (url.origin !== APP_ORIGIN || url.protocol !== 'https:') throw new Error('Only Veyra sign-in links can be opened.');
  await shell.openExternal(url.toString());
});

function closeUpdateProgress() {
  if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
  else updateWindowDismissed = true;
}

function removePendingUpdate(version) {
  if (isReleaseVersion(version)) {
    try { fs.rmSync(path.join(UPDATE_DIRECTORY, `Veyra-${version}.exe`), { force: true }); } catch {}
  }
  try { fs.rmSync(PENDING_UPDATE_PATH, { force: true }); } catch {}
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function launchInstaller(installer, version) {
  showUpdateProgress(version, 'Starting installer…', 100, 'Veyra will close while the update is installed.');
  const child = spawn(installer, ['/S'], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  app.quit();
}

async function installPendingUpdate() {
  if (!app.isPackaged || process.platform !== 'win32' || !fs.existsSync(PENDING_UPDATE_PATH)) return false;
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(PENDING_UPDATE_PATH, 'utf8'));
  } catch {
    removePendingUpdate();
    return false;
  }
  if (!isReleaseVersion(pending.version)) {
    removePendingUpdate();
    return false;
  }
  const installer = path.join(UPDATE_DIRECTORY, `Veyra-${pending.version}.exe`);
  if (compareVersions(app.getVersion(), pending.version) >= 0 || !fs.existsSync(installer)) {
    removePendingUpdate(pending.version);
    return false;
  }
  updateWindowDismissed = false;
  try {
    if (!isSha256(pending.sha256) || await sha256File(installer) !== pending.sha256.toLowerCase()) {
      removePendingUpdate(pending.version);
      return false;
    }
    await launchInstaller(installer, pending.version);
    return true;
  } catch (error) {
    closeUpdateProgress();
    console.warn('Could not start the pending Veyra update:', error.message);
    await dialog.showMessageBox({ type: 'warning', title: 'Veyra update could not start', message: 'The downloaded update could not be started. Veyra will open normally and retry on the next launch.', detail: error.message });
    return false;
  }
}

async function checkForUpdate() {
  if (!app.isPackaged || process.platform !== 'win32' || fs.existsSync(PENDING_UPDATE_PATH)) return;
  let partialInstaller = null;
  let releaseVersion = null;
  try {
    const response = await fetch(RELEASE_METADATA, { signal: AbortSignal.timeout(7000), headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const release = await response.json();
    if (!isReleaseVersion(release.version) || compareVersions(release.version, app.getVersion()) <= 0 || !release.windows?.url) return;
    releaseVersion = release.version;
    const installerUrl = new URL(release.windows.url);
    if (!isReleaseAssetUrl(installerUrl.toString())) throw new Error('The release metadata contains an unsupported installer URL.');
    updateWindowDismissed = false;
    showUpdateProgress(release.version, 'Preparing download…');
    fs.mkdirSync(UPDATE_DIRECTORY, { recursive: true });
    const installer = path.join(UPDATE_DIRECTORY, `Veyra-${release.version}.exe`);
    partialInstaller = `${installer}.part`;
    const download = await fetch(installerUrl, { signal: AbortSignal.timeout(600000) });
    if (!download.ok || !download.body) throw new Error('Could not download the installer.');
    if (!isFinalAssetUrl(download.url)) throw new Error('The installer download resolved to an unsupported host.');
    const totalBytes = Number(download.headers.get('content-length')) || 0;
    if (totalBytes > MAX_UPDATE_BYTES) throw new Error('The installer exceeds the maximum supported download size.');
    let downloadedBytes = 0;
    const progressStream = new (require('node:stream').Transform)({
      transform(chunk, encoding, callback) {
        downloadedBytes += chunk.length;
        if (downloadedBytes > MAX_UPDATE_BYTES) return callback(new Error('The installer exceeds the maximum supported download size.'));
        const percent = totalBytes > 0 ? Math.min(100, Math.floor(downloadedBytes / totalBytes * 100)) : null;
        showUpdateProgress(release.version, 'Downloading update…', percent, totalBytes > 0 ? `${(downloadedBytes / 1048576).toFixed(1)} MB of ${(totalBytes / 1048576).toFixed(1)} MB` : `${(downloadedBytes / 1048576).toFixed(1)} MB downloaded`);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(download.body), progressStream, fs.createWriteStream(partialInstaller));
    if (!isSha256(release.windows.sha256)) throw new Error('The release metadata is missing a valid installer checksum.');
    const installerHash = await sha256File(partialInstaller);
    if (installerHash !== release.windows.sha256.toLowerCase()) throw new Error('The downloaded installer checksum does not match the release metadata.');
    fs.rmSync(installer, { force: true });
    fs.renameSync(partialInstaller, installer);
    partialInstaller = null;
    fs.writeFileSync(PENDING_UPDATE_PATH, JSON.stringify({ version: release.version, sha256: installerHash }), { mode: 0o600 });
    showUpdateProgress(release.version, 'Update ready to install', 100, 'You can keep using Veyra until you choose to restart.');
    const { response: choice } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 1,
      cancelId: 1,
      title: 'Veyra update ready',
      message: `Veyra ${release.version} is ready to install.`,
      detail: 'Restart now to install the update, or choose Later to keep using Veyra. The update will install the next time you open the app.',
    });
    if (choice === 0) await launchInstaller(installer, release.version);
    else closeUpdateProgress();
  } catch (error) {
    if (partialInstaller) {
      try { fs.rmSync(partialInstaller, { force: true }); } catch {}
    }
    closeUpdateProgress();
    console.warn('Veyra update check failed; continuing with the current version:', error.message);
    if (releaseVersion) await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Veyra update failed', message: 'The latest Veyra update could not be downloaded. You can keep using the current version.', detail: error.message });
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 850,
    minHeight: 600,
    backgroundColor: '#0b0b0b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.webContents.once('did-finish-load', () => {
    while (queuedPairCallbacks.length) window.webContents.send('veyra:pair-callback', queuedPairCallbacks.shift());
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) event.preventDefault();
  });
  void window.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (!app.isDefaultProtocolClient('veyra')) app.setAsDefaultProtocolClient('veyra');
  if (await installPendingUpdate()) return;
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  void checkForUpdate();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
