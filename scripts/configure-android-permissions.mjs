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

let manifest = await readFile(manifestPath, 'utf8');
const missing = REQUIRED_PERMISSIONS.filter(
  (permission) => !manifest.includes(`android:name="${permission}"`),
);
if (!missing.length) {
  console.log('Android permissions already configured.');
} else {
  const insert = missing.map((permission) => `    <uses-permission android:name="${permission}" />`).join('\n');
  const anchor = manifest.match(/<uses-permission[^>]*\/>/);
  if (!anchor) throw new Error(`Could not find a uses-permission element in ${manifestPath}.`);
  manifest = manifest.replace(anchor[0], `${anchor[0]}\n${insert}`);
  await writeFile(manifestPath, manifest);
  console.log(`Added Android permissions: ${missing.join(', ')}.`);
}
