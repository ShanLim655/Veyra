// Copies the Veyra launcher icons from resources/android-icons/ into the
// generated Capacitor Android project. Run after `npx cap add android` /
// `npx cap sync android` because the android/ directory is gitignored and is
// recreated from the Capacitor template on clean checkouts.
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'resources', 'android-icons');
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res');

if (!existsSync(path.join(resDir, 'mipmap-mdpi'))) {
  console.error('Android resources not found. Run `npx cap add android` and `npx cap sync android` first.');
  process.exit(1);
}
if (!existsSync(sourceDir)) {
  console.error(`Icon source not found: ${sourceDir}`);
  process.exit(1);
}

for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  const src = path.join(sourceDir, `mipmap-${density}`);
  const dest = path.join(resDir, `mipmap-${density}`);
  cpSync(src, dest, { recursive: true });
  console.log(`Configured launcher icons for ${density}.`);
}
