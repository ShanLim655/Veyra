# Veyra Releases

GitHub Releases are the public update source for the Windows desktop and Android apps. A release is created by pushing a semantic version tag in the form `vMAJOR.MINOR.PATCH`, for example `v1.2.0`. The release workflow builds both apps, attaches their installers, generates `latest.json`, and publishes the release. Pull request and branch builds do not publish releases.

## Veyra 1.2.0 — Reliability & Experience Update

**Status:** In development. The newest code and platform workflows are queued or running; earlier successful builds do not certify the current head. No release has been published.

### Included in the current development branch

- Shared Redis-backed authentication rate limits for signup, login, password recovery, Google sign-in, native pairing, email verification, and password changes, including per-account limits for signup, login, and recovery, with bounded process-local fallback when Redis is unavailable.
- Session hardening: password changes revoke other sessions, password resets revoke all sessions, and password updates/session revocation run in a MariaDB transaction.
- Improved global presence channel lifecycle so it is released when no listeners remain and stale online state is cleared after channel failures.
- Deterministic message pagination, stale conversation-fetch protection, and progressive loading of older messages during message search.
- Transient notification retries, digest cooldown updates only after successful delivery, strict HTTPS ntfy host/port validation, and redirect blocking to prevent notification requests from being redirected to untrusted destinations.
- Updated application and lockfile version metadata to 1.2.0.
- Documentation for the message-encryption security model and the requirements that must pass before E2EE can be enabled.
- Desktop now downloads updates in the background while the app remains usable, offers Restart now/Later, installs deferred updates on the next launch, validates the exact Veyra release URL and redirect hosts, and verifies the installer SHA-256 before saving it. Android validates the exact Veyra release URL and version before opening the APK.
- Optional MariaDB-backed notification outbox with transactional message-insert triggers, adaptive skip-locked claims, two-minute worker leases renewed every 30 seconds during delivery, bounded retries, 30-day completed-job retention, and disabled-by-default activation. Direct notification delivery is suppressed while the worker is enabled to prevent duplicate sends. Shutdown drains HTTP requests before stopping the worker.
- Group management hardening: group names and member IDs are validated, group batches are capped at 256 members, membership changes are transactional, blocked users cannot be added, owners cannot be removed, and admins cannot remove peer admins.
- Data API authorization hardening: non-super-admins cannot mutate role records; group membership writes are routed through authorized RPCs; private poll votes and reactions are membership-scoped; single-choice poll voting is serialized transactionally; admin audit logs are append-only; generic upserts are restricted to client-owned workflows; and deletes correctly preserve composite primary keys.
- Notification hardening: only HTTPS ntfy endpoints are accepted, shared-topic digest cooldowns are updated for every subscriber, and direct delivery is suppressed when the outbox worker is active.
- Added automated coverage for group input validation, sensitive data API policies, transactional poll voting, composite-key deletes, notification worker claiming/completion/retry/terminal failure/lease renewal, shared-topic digest delivery, safe upload MIME handling, strict ntfy endpoint validation, exact desktop release URL/version/checksum validation, and self-hosted SPA routing.
- Conversation presence state is cleared when the active conversation changes or the hook loses its user/conversation context.
- The self-hosted Node API binds to `0.0.0.0` by default for container deployments, serves the production SPA before its API fallback routes, supports an explicit trusted reverse-proxy hop count, and shuts down after draining HTTP requests. CI cancels superseded branch runs without allowing push and pull-request runs to cancel each other.
- E2EE research now records OpenE2EE as a proof-of-concept candidate, including its protocol compatibility boundary, runtime gaps, and lack of independent security audit.

### Automated validation observed for the current PR head

The latest implementation is the current PR head. CI and platform workflows are queued/in progress as of 2026-11-11; earlier successful runs do not certify the current head.

Earlier branch commits completed the web test/build and Windows/Android build workflows. The newest CI workflow runs MariaDB schema migration, database-backed outbox integration tests (including transaction rollback, concurrent claims, lease recovery, retry/terminal failure, and retention), the full Node test suite, targeted ESLint for changed client hooks, Node syntax checks for server and desktop entry files, and the production web build.

An exploratory repository-wide `npm run lint` reported 119 existing lint errors, mostly `@typescript-eslint/no-explicit-any`, plus a small number of other rule violations. The blocking CI workflow therefore retains targeted lint checks rather than suppressing or mass-rewriting the legacy codebase. Repository-wide lint remains a known cleanup item.

### Not yet complete / release gates

- Private-message E2EE is not implemented. The encryption document evaluates OpenE2EE as a possible cross-client proof of concept, but independent audit status and Capacitor Android storage/key-custody compatibility are not sufficient for production approval. No private-message path is currently ciphertext-only.
- Global Chat remains server-readable for moderation and is not E2EE.
- A MariaDB-backed notification worker is implemented and remains disabled by default. It does not depend on an undocumented Altare-managed queue API. CI now tests the worker against MariaDB 11.4; the target deployment's MariaDB version and actual Altare configuration still need confirmation before enabling it.
- Supabase Storage bucket-level MIME allowlists must be configured for chat media buckets; API response normalization alone cannot constrain a client that uploads directly with a signed token.
- Physical-device testing remains outstanding for Windows updater installation/recovery, Android update installation/deep links/auth persistence, and application lifecycle/realtime recovery.
- Full authentication/session, realtime, message synchronization, pagination/search, notification, Redis outage/recovery, and concurrency coverage remains a release gate beyond the currently passing unit/build checks.
- The background notification worker now has MariaDB integration coverage for trigger atomicity, concurrent claims, lease recovery, completion, retries, terminal failures, and completed-job retention. The latest run must pass before treating this as verified.
- The current CI workflow runs targeted ESLint on selected changed client files; it does not establish that repository-wide `npm run lint` is clean.

Do not publish the `v1.2.0` tag until the remaining release gates have been tested and the release workflow is green. The release assets will use `Veyra1.2.0.exe`, `AndroidVeyra1.2.0.apk`, and `latest.json` if the existing workflow's naming convention remains unchanged.

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
2. Create and push the next unused semantic version tag, such as `v1.2.0`. Tags must increase monotonically; never reuse a published version.
3. Wait for **Publish Veyra release** to finish on GitHub Actions.
4. Open the GitHub Release and confirm it contains exactly the versioned Windows installer, Android APK, and `latest.json`.
5. Install the APK on an Android device and run the Windows installer on a test machine before announcing the release.

```sh
git switch main
git pull
git tag v1.2.0
git push origin v1.2.0
```

## Required assets and metadata

For version `1.2.0`, the release workflow is expected to produce:

- `Veyra1.2.0.exe` — Windows x64 NSIS installer.
- `AndroidVeyra1.2.0.apk` — release-signed Android APK.
- `latest.json` — update metadata downloaded by both apps.

Metadata shape (the release workflow calculates the SHA-256 values from the built assets):

```json
{
  "version": "1.2.0",
  "tag": "v1.2.0",
  "windows": {
    "file": "Veyra1.2.0.exe",
    "url": "https://github.com/OWNER/REPO/releases/download/v1.2.0/Veyra1.2.0.exe",
    "sha256": "<64-character SHA-256 hex digest>"
  },
  "android": {
    "file": "AndroidVeyra1.2.0.apk",
    "url": "https://github.com/OWNER/REPO/releases/download/v1.2.0/AndroidVeyra1.2.0.apk",
    "sha256": "<64-character SHA-256 hex digest>"
  }
}
```

The workflow generates the metadata URLs and SHA-256 digests from the repository, tag, and built assets. Do not hand-edit `latest.json` or upload a different asset name. Desktop downloads a newer installer while the app remains usable, verifies its checksum, and asks whether to restart now or later. A deferred update is installed before the app opens on the next launch. Android asks before opening the APK download; the user then confirms installation in Android. Choosing **Remind me later** dismisses the prompt for that app run; it checks again next launch.

## Troubleshooting

- If a release build fails before Android signing, verify all four Android signing secrets are present and match the backed-up keystore.
- If Android reports that the update cannot be installed, verify the package ID is unchanged and that the APK uses the original release signing key. A debug APK cannot update a release-signed installation.
- If an app reports no update, verify the GitHub Release is published (not draft), `latest.json` is attached, and both versioned files match its URLs.
- Windows installers are currently unsigned. Windows may show SmartScreen or publisher warnings; code-signing certificates are a separate release prerequisite for trusted publisher presentation.
