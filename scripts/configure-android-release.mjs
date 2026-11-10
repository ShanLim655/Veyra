import { readFile, writeFile } from 'node:fs/promises';

const gradlePath = 'android/app/build.gradle';
const versionName = String(process.env.RELEASE_VERSION || '').replace(/^v/, '');
const versionCode = Number(process.env.ANDROID_VERSION_CODE);
if (!/^\d+\.\d+\.\d+$/.test(versionName || '') || !Number.isSafeInteger(versionCode) || versionCode < 1) {
  throw new Error('RELEASE_VERSION and a positive ANDROID_VERSION_CODE are required.');
}

let gradle = await readFile(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+['"][^'"]+['"]/, `versionName "${versionName}"`);
if (!gradle.includes('signingConfigs {')) {
  gradle = gradle.replace(/buildTypes\s*\{/, `signingConfigs {
        release {
            storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
    }

    buildTypes {`);
}
gradle = gradle.replace(/buildTypes\s*\{\s*release\s*\{/, (match) => `${match} signingConfig signingConfigs.release`);
await writeFile(gradlePath, gradle);
