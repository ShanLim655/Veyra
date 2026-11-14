const { app, BrowserWindow, shell, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');

const APP_URL = 'https://veyra-pink-mu.vercel.app';
const APP_ORIGIN = new URL(APP_URL).origin;
// Proxied through the Veyra API so the check works even when GitHub release
// downloads are unreachable or redirect in ways fetch cannot follow.
const RELEASE_METADATA = `${APP_ORIGIN}/api/app-version`;
const SESSION_PATH = path.join(app.getPath('userData'), 'session.dat');
const UPDATE_PAGE = path.join(__dirname, 'update.html');
let updateInstalling = false;
let mainWindow = null;
let updateWindow = null;
let pendingInstallerPath = null;
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

function compareVersions(left, right) {
  // Leading digits only, so '1.2.3-beta' compares as 1.2.3.
  const parse = (value) => String(value).replace(/^v/, '').split('.').map((part) => Number.parseInt(String(part).match(/^\d+/)?.[0] ?? '', 10));
  const a = parse(left); const b = parse(right);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((part) => !Number.isInteger(part) || part < 0)) return 0;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

let lastUpdateState = null;

function sendUpdateState(state) {
  lastUpdateState = state;
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('veyra:update-state', state);
  }
}

function ensureUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) return updateWindow;
  updateWindow = new BrowserWindow({
    width: 480,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0b',
    title: 'Veyra Update',
    webPreferences: {
      preload: path.join(__dirname, 'update-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  updateWindow.on('closed', () => { updateWindow = null; });
  void updateWindow.loadFile(UPDATE_PAGE);
  // States emitted while the page was still loading are replayed once the
  // renderer is ready so rapid transitions (available -> downloading) are not lost.
  updateWindow.webContents.once('did-finish-load', () => {
    if (lastUpdateState) updateWindow?.webContents.send('veyra:update-state', lastUpdateState);
  });
  return updateWindow;
}

async function downloadInstaller(url, destination, onProgress) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`The update download failed (HTTP ${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    onProgress(received, total);
  });
  await pipeline(source, fs.createWriteStream(destination));
  const size = fs.statSync(destination).size;
  if (total > 0 && size !== total) {
    try { fs.unlinkSync(destination); } catch {}
    throw new Error('The update download was incomplete. Please try again.');
  }
  if (size <= 0) throw new Error('The update download was empty. Please try again.');
}

async function runDownload(release) {
  const installer = path.join(os.tmpdir(), `Veyra-${release.version}-setup.exe`);
  pendingInstallerPath = installer;
  try {
    await downloadInstaller(release.windows.url, installer, (received, total) => {
      sendUpdateState({
        stage: 'downloading',
        version: release.version,
        received,
        total,
        percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
      });
    });
    // When the release metadata carries a sha256 checksum, verify the
    // downloaded installer before offering to run it.
    const expectedHash = String(release.windows.sha256 || '').trim().toLowerCase();
    if (expectedHash) {
      const actualHash = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
      if (actualHash !== expectedHash) {
        try { fs.unlinkSync(installer); } catch {}
        throw new Error('The downloaded update failed its integrity check. Please try again.');
      }
    }
    // Re-open the update window if the user dismissed it mid-download so the
    // "Restart to update" prompt is never silently lost.
    ensureUpdateWindow();
    sendUpdateState({ stage: 'ready', version: release.version, notes: release.notes || release.name || null });
  } catch (error) {
    pendingInstallerPath = null;
    try { fs.unlinkSync(installer); } catch {}
    sendUpdateState({ stage: 'error', version: release.version, message: error instanceof Error ? error.message : 'Download failed.' });
  }
}

let pendingRelease = null;

async function checkForUpdates() {
  if (!app.isPackaged || process.platform !== 'win32' || updateInstalling) return;
  let release;
  try {
    const response = await fetch(RELEASE_METADATA, { signal: AbortSignal.timeout(7000), headers: { accept: 'application/json' } });
    if (!response.ok) return;
    release = await response.json();
  } catch {
    return;
  }
  if (!release?.version || !release.windows?.url || compareVersions(release.version, app.getVersion()) <= 0) return;

  pendingRelease = release;
  ensureUpdateWindow();
  // Discord-style flow: start downloading immediately and let the window show
  // live progress instead of waiting for a click.
  void runDownload(release);
}

function installPendingUpdate() {
  if (!pendingInstallerPath || !fs.existsSync(pendingInstallerPath)) {
    sendUpdateState({ stage: 'error', message: 'The downloaded update is no longer available. Please check for updates again.' });
    return;
  }
  updateInstalling = true;
  const child = spawn(pendingInstallerPath, ['/S'], { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    updateInstalling = false;
    sendUpdateState({ stage: 'error', message: 'Could not start the installer. Please download the update manually.' });
  });
  child.unref();
  app.quit();
}

ipcMain.on('veyra:update-action', (_event, action) => {
  if (action === 'later') {
    if (updateWindow && !updateWindow.isDestroyed()) updateWindow.close();
  } else if ((action === 'download' || action === 'retry') && pendingRelease) {
    void runDownload(pendingRelease);
  } else if (action === 'install') {
    installPendingUpdate();
  }
});

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
  createWindow();
  // Update checks run in the background so a slow or unreachable release
  // feed can never block or break app startup. Re-check every 6 hours so a
  // release published while Veyra stays open is still picked up.
  void checkForUpdates();
  const updateTimer = setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000);
  updateTimer.unref?.();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
