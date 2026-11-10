import { readFile, writeFile } from 'node:fs/promises';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let manifest = await readFile(manifestPath, 'utf8');
const activityPattern = /<activity\b(?=[^>]*\bandroid:name="[^"]*MainActivity")[^>]*>[\s\S]*?<\/activity>/;
const match = manifest.match(activityPattern);
if (!match) throw new Error(`Could not find the Capacitor MainActivity in ${manifestPath}.`);

let activity = match[0];
const openingTag = activity.match(/^<activity\b[^>]*>/)?.[0];
if (!openingTag) throw new Error('Could not parse the Capacitor MainActivity element.');
if (!openingTag.includes('android:launchMode=')) {
  activity = activity.replace(openingTag, openingTag.replace(/>$/, ' android:launchMode="singleTask">'));
}
if (!activity.includes('android:scheme="veyra"')) {
  activity = activity.replace('</activity>', `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="veyra" android:host="pair" />
            </intent-filter>
        </activity>`);
}
manifest = manifest.replace(activityPattern, activity);
await writeFile(manifestPath, manifest);
console.log('Configured the Veyra Android pairing callback.');
