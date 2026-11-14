import { readFile, writeFile } from 'node:fs/promises';

// Voice messages use getUserMedia() inside the Capacitor WebView. Android only
// shows the runtime microphone prompt when RECORD_AUDIO is declared in the
// manifest — without it the WebView denies capture immediately and the app
// never appears under Settings → Permissions.
const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const REQUIRED_PERMISSIONS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
];

const original = await readFile(manifestPath, 'utf8');
let manifest = original;
const changes = [];

// Keep app data (including the stored session token) out of Android cloud
// backups — a backed-up token would let anyone restore a signed-in session.
// The Capacitor template ships allowBackup="true", so force it off.
if (/android:allowBackup="true"/.test(manifest)) {
  manifest = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  changes.push('android:allowBackup="false"');
} else if (!/android:allowBackup="false"/.test(manifest)) {
  manifest = manifest.replace('<application', '<application android:allowBackup="false" android:fullBackupContent="false"');
  changes.push('android:allowBackup="false"');
}

const missing = REQUIRED_PERMISSIONS.filter(
  (permission) => !manifest.includes(`android:name="${permission}"`),
);
if (missing.length) {
  const insert = missing.map((permission) => `    <uses-permission android:name="${permission}" />`).join('\n');
  const anchor = manifest.match(/<uses-permission[^>]*\/>/);
  if (!anchor) throw new Error(`Could not find a uses-permission element in ${manifestPath}.`);
  manifest = manifest.replace(anchor[0], `${anchor[0]}\n${insert}`);
  changes.push(...missing);
}

if (manifest !== original) {
  await writeFile(manifestPath, manifest);
  console.log(`Android manifest updated: ${changes.join(', ')}.`);
} else {
  console.log('Android manifest already configured.');
}
