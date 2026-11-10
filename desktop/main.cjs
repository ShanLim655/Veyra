const { app, BrowserWindow, shell, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const APP_URL = 'https://veyra-pink-mu.vercel.app';
const APP_ORIGIN = new URL(APP_URL).origin;
const RELEASE_METADATA = 'https://github.com/ShanLim655/Veyra/releases/latest/download/latest.json';
let updateInstalling = false;

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
