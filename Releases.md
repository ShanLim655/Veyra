# Veyra Releases

GitHub Releases are the public update source for the Windows desktop and Android apps. A release is created by pushing a semantic version tag in the form `vMAJOR.MINOR.PATCH`, for example `v1.2.0`. The release workflow builds both apps, attaches their installers, generates `latest.json`, and publishes the release. Pull request and branch builds do not publish releases.

## Veyra 1.2.1 (upcoming)

Hotfix release on top of 1.2.0:

- **Android update checker:** release metadata is now fetched through the Veyra API (`GET /api/app-version`) instead of directly from GitHub, fixing "Veyra could not reach the release server" caused by CORS-blocked release download redirects in the Android WebView. The desktop updater uses the same endpoint.
- **Announcement polls:** fixed poll creation in Announcements (channel naming mismatch rejected by the backend) and polls now update live for all viewers.
- **Poll display:** hardened date parsing so polls and messages no longer show "Invalid Date", and polls that cannot be loaded show a clear unavailable state instead of loading forever.
- **Faster polls:** poll creation is a single transactional API call instead of 4–5 sequential requests.
- **Faster chat loading:** media URLs in a message page are signed with one batched request instead of one request per message.
- **Desktop updater:** updates now download automatically with live progress (Discord-style), re-prompt if the window was closed mid-download, and re-check every 6 hours.

### Downloads (once published)

- Windows: `Veyra1.2.1.exe`
- Android: `AndroidVeyra1.2.1.apk`
- Update metadata: `latest.json`

## Veyra 1.2.0 (upcoming)

Reliability, security, and experience update. Highlights:

- **Message encryption at rest:** message content in DMs, group chats, Global Chat, and announcements is encrypted with AES-256-GCM before storage in MariaDB (`MESSAGE_ENCRYPTION_KEY`). This is not end-to-end encryption; see `docs/message-encryption.md`.
- **Redis rate limiting:** auth endpoint limits are shared across API instances when `REDIS_URL` is configured, with in-memory fallback.
- **Session management:** users can list and revoke sessions (`GET /api/auth/sessions`, `POST /api/auth/sessions/revoke`); password changes now revoke all sessions.
- **Optional Altare Queues:** environment-gated background job publishing for notifications, disabled by default with inline fallback (`docs/queues.md`).
- **Realtime resilience:** clients resync conversation history when the realtime channel recovers, and presence heartbeats keep online/typing state fresh.
- **Desktop updater:** non-blocking update check with a dedicated progress window, download status, and retry/failure handling instead of a silent startup install.
- **Android updater:** update prompt now shows release details and surfaces check/download failures.
- **CI:** pull requests run lint, server tests, and a production build.

### Downloads (once published)

- Windows: `Veyra1.2.0.exe`
- Android: `AndroidVeyra1.2.0.apk`
- Update metadata: `latest.json`

## Veyra 1.1.8

This is a maintenance release that fixes Google OAuth callback error handling.

### Authentication

- Fix the callback's `returnTo` variable scope so database, token-exchange, and profile errors can reach the intended OAuth error handler without triggering `ReferenceError: returnTo is not defined`.
- Preserve the original destination when Google sign-in rejects an unsupported email address.

The reported `ECONNREFUSED` error was caused by the MariaDB service being offline, not by the OAuth callback. MariaDB must be running and reachable for account creation and session operations to succeed.

### Downloads

- Windows: `Veyra1.1.8.exe`
- Android: `AndroidVeyra1.1.8.apk`
- Update metadata: `latest.json`


## Release prerequisites

1. In GitHub repository settings, add these Actions secrets from the same Android release keystore: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Create the keystore once and back it up securely; never regenerate it for subsequent releases or commit it to Git. Android only accepts an update when the APK is signed by the same key as the installed app.
2. Make the repository public so installed apps can fetch release metadata and assets without credentials.
3. Confirm the release workflow passes before publishing a version tag. Keep using the same Android release keystore for every version so existing installations can update in place.

## Publish a release

1. Merge the desired code to `main`.
2. Create and push the next unused semantic version tag, such as `v1.1.8`. Tags must increase monotonically; never reuse a published version.
3. Wait for **Publish Veyra release** to finish on GitHub Actions.
4. Open the GitHub Release and confirm it contains exactly the versioned Windows installer, Android APK, and `latest.json`.
5. Install the APK on an Android device and run the Windows installer on a test machine before announcing the release.

```sh
git switch main
git pull
git tag v1.1.8
git push origin v1.1.8
```

## Required assets and metadata

For version `1.1.8`, the release workflow produces:

- `Veyra1.1.8.exe` — Windows x64 NSIS installer.
- `AndroidVeyra1.1.8.apk` — release-signed Android APK.
- `latest.json` — update metadata downloaded by both apps.

Metadata shape:

```json
{
  "version": "1.1.8",
  "tag": "v1.1.8",
  "windows": {
    "file": "Veyra1.1.8.exe",
    "url": "https://github.com/OWNER/REPO/releases/download/v1.1.8/Veyra1.1.8.exe"
  },
  "android": {
    "file": "AndroidVeyra1.1.8.apk",
    "url": "https://github.com/OWNER/REPO/releases/download/v1.1.8/AndroidVeyra1.1.8.apk"
  }
}
```

The workflow generates the metadata URLs from the repository and tag. Do not hand-edit `latest.json` or upload a different asset name. Desktop shows a dedicated update window after launch: it reports the available version, downloads with live progress, and only installs after the user chooses **Restart to update**; failures offer retry or defer to the next launch. Android shows release details and opens the APK download after confirmation; the user then confirms installation in Android. Choosing **Later** dismisses the prompt; both apps check again on the next launch.

## Troubleshooting

- If a release build fails before Android signing, verify all four Android signing secrets are present and match the backed-up keystore.
- If Android reports that the update cannot be installed, verify the package ID is unchanged and that the APK uses the original release signing key. A debug APK cannot update a release-signed installation.
- If an app reports no update, verify the GitHub Release is published (not draft), `latest.json` is attached, and both versioned files match its URLs.
- Windows installers are currently unsigned. Windows may show SmartScreen or publisher warnings; code-signing certificates are a separate release prerequisite for trusted publisher presentation.
