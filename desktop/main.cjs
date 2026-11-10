const { app, BrowserWindow, shell, dialog, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const APP_URL = 'https://veyra-pink-mu.vercel.app';
const APP_ORIGIN = new URL(APP_URL).origin;
const RELEASE_METADATA = 'https://github.com/ShanLim655/Veyra/releases/latest/download/latest.json';
const SESSION_PATH = path.join(app.getPath('userData'), 'session.dat');
let updateInstalling = false;

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
  const parse = (value) => String(value).replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10));
  const a = parse(left); const b = parse(right);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((part) => !Number.isInteger(part) || part < 0)) return 0;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

async function updateBeforeLaunch() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    const response = await fetch(RELEASE_METADATA, { signal: AbortSignal.timeout(7000), headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const release = await response.json();
    if (!release.version || compareVersions(release.version, app.getVersion()) <= 0 || !release.windows?.url) return;

    const download = await fetch(release.windows.url, { signal: AbortSignal.timeout(120000) });
    if (!download.ok || !download.body) throw new Error('Could not download the installer.');
    const installer = path.join(os.tmpdir(), `Veyra${release.version}.exe`);
    await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(installer));
    const child = spawn(installer, ['/S'], { detached: true, stdio: 'ignore' });
    child.on('error', () => { try { fs.unlinkSync(installer); } catch {} });
    child.unref();
    updateInstalling = true;
    app.quit();
  } catch (error) {
    console.warn('Veyra update check failed; starting current version:', error.message);
    await dialog.showMessageBox({ type: 'warning', title: 'Veyra update failed', message: 'Could not install the latest Veyra update. Starting the current version.', detail: error.message });
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
  await updateBeforeLaunch();
  if (updateInstalling) return;
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
