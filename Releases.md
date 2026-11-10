# Veyra Releases

GitHub Releases are the public update source for the Windows desktop and Android apps. A release is created by pushing a semantic version tag in the form `vMAJOR.MINOR.PATCH`, for example `v1.0.0`. The release workflow builds both apps, attaches their installers, generates `latest.json`, and publishes the release. Pull request and branch builds do not publish releases.

## Before the first release

1. In GitHub repository settings, add these Actions secrets from the same Android release keystore: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Create the keystore once and back it up securely; never regenerate it for subsequent releases or commit it to Git. Android only accepts an update when the APK is signed by the same key as the installed app.
2. Make the repository public so installed apps can fetch release metadata and assets without credentials.
3. Confirm the release workflow passes before publishing a version tag. The current PR APK is debug-signed and cannot be upgraded by the release-signed APK; install the first release APK fresh.

## Publish a release

1. Merge the desired code to `main`.
2. Create and push a new tag, such as `v1.0.0`. Tags must increase monotonically; never reuse a published version.
3. Wait for **Publish Veyra release** to finish on GitHub Actions.
4. Open the GitHub Release and confirm it contains exactly the versioned Windows installer, Android APK, and `latest.json`.
5. Install the APK on an Android device and run the Windows installer on a test machine before announcing the release.

```sh
git switch main
git pull
git tag v1.0.0
git push origin v1.0.0
```

## Required assets and metadata

For version `1.0.0`, the release workflow produces:

- `Veyra1.0.0.exe` — Windows x64 NSIS installer.
- `AndroidVeyra1.0.0.apk` — release-signed Android APK.
- `latest.json` — update metadata downloaded by both apps.

Metadata shape:

```json
{
  "version": "1.0.0",
  "tag": "v1.0.0",
  "windows": {
    "file": "Veyra1.0.0.exe",
    "url": "https://github.com/OWNER/REPO/releases/download/v1.0.0/Veyra1.0.0.exe"
  },
  "android": {
    "file": "AndroidVeyra1.0.0.apk",
    "url": "https://github.com/OWNER/REPO/releases/download/v1.0.0/AndroidVeyra1.0.0.apk"
  }
}
```

The workflow generates the metadata URLs from the repository and tag. Do not hand-edit `latest.json` or upload a different asset name. Desktop checks the public latest release on startup and installs a newer version automatically. Android asks before opening the APK download; the user then confirms installation in Android. Choosing **Remind me later** dismisses the prompt for that app run; it checks again next launch.

## Troubleshooting

- If a release build fails before Android signing, verify all four Android signing secrets are present and match the backed-up keystore.
- If Android reports that the update cannot be installed, verify the package ID is unchanged and that the APK uses the original release signing key. A debug APK cannot update a release-signed installation.
- If an app reports no update, verify the GitHub Release is published (not draft), `latest.json` is attached, and both versioned files match its URLs.
- Windows installers are currently unsigned. Windows may show SmartScreen or publisher warnings; code-signing certificates are a separate release prerequisite for trusted publisher presentation.
