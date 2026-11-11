# Veyra message encryption architecture

## Current security model

Veyra currently relies on HTTPS/TLS for network transport. Authentication tokens are stored as hashes in MariaDB, but application message bodies are stored as ordinary database values and are available to the API and authorized moderation paths. This is not end-to-end encryption.

Transport encryption protects traffic between clients and services. Database or disk encryption at rest protects stored media and database files from certain forms of physical or storage-layer access. End-to-end encryption (E2EE) prevents the service from reading message plaintext. These protections solve different problems and must not be described interchangeably.

Global Chat must remain readable to trusted server-side moderation and abuse-prevention code. It therefore cannot be E2EE while those moderation requirements remain server-side.

## Private conversation evaluation

A private-chat E2EE system needs more than encrypting a message string in the browser. It must authenticate device identities, establish keys between devices, support multiple devices per account, handle offline devices, rotate or replace keys after membership changes, and make old-message access behavior explicit.

The appropriate protocol family to evaluate is the Signal Protocol, using a maintained implementation rather than implementing its primitives or ratchet logic in Veyra. It is designed for asynchronous messaging and provides session establishment and forward-secrecy properties that a simple shared conversation key does not. Veyra should not adopt a hand-built AES/X25519 envelope scheme as a substitute: that would create a new, unaudited messaging protocol and leave difficult device and group-key lifecycle problems to Veyra.

The main implementation risk is client compatibility. Veyra's web app, Electron renderer, and Android WebView share a web frontend, but the supported Signal implementation and its bindings must be verified for all three runtimes before selecting it. The selected implementation must have a supported browser/WASM path or a maintained bridge with compatible cryptographic behavior. Do not ship a Node-only binding to browser clients.

## Cross-client library compatibility review

The official Signal `libsignal` repository exposes Java, Swift, and TypeScript APIs, but its published Node package uses native bindings for Node runtimes and the project explicitly says third-party use is unsupported. The official package documentation lists native Node binaries for Windows, macOS, and Debian-flavored Linux; the Android integration is a separate Java library. This does not provide one supported browser/WebView implementation for Veyra's shared web frontend.

The older `libsignal-protocol-javascript` browser package is archived and unmaintained, so it is not an acceptable production dependency. Veyra must not combine an official native implementation on desktop/Android with an unmaintained browser fork and assume the result is one compatible protocol implementation.

Sources reviewed on 2026-11-11:
- [Signal libsignal repository](https://github.com/signalapp/libsignal)
- [Official Signal libsignal-client package](https://www.npmjs.com/package/@signalapp/libsignal-client)
- [Archived JavaScript implementation](https://github.com/signalapp/libsignal-protocol-javascript)

## Cross-client candidate identified for a proof of concept

A maintained third-party candidate now exists: [OpenE2EE Signal Protocol SDK](https://github.com/open-e2ee/signal-protocol-js), published as `@open-e2ee/signal-protocol-sdk`. Its current published package (14.4.0, checked 2026-11-11) documents browser and Node support, multi-device and group messaging, a browser SQLite store using OPFS, and a Node/Electron store using a local encrypted SQLite database and an Electron `safeStorage` vault. Its license is MIT OR Apache-2.0.

This is not the official Signal implementation. It implements an independently versioned profile based on selected Signal Protocol specifications and explicitly is not wire-compatible with Signal Messenger or official libsignal. That is not inherently a blocker for Veyra, but it must be an explicit product decision and documented compatibility boundary.

The candidate is not approved for production use yet:

- Its own security documentation says it has not been audited by an independent security firm; its engineering tests are private.
- Its JavaScript runtime cannot guarantee machine-level constant-time execution or reliable zeroization.
- Its documented Android WebView checks are for Tauri, not Capacitor. Veyra must prove that OPFS, WASM/CSP requirements, durable storage, process restarts, and key custody work inside its actual Capacitor WebView build.
- The browser store's default key custody is same-origin/co-located. That is not equivalent to an OS-backed device key. Veyra must select and verify a stronger adapter or explicitly document the browser threat model.
- Electron requires a main-process storage integration and safeStorage-backed vault; using a browser renderer store without a reviewed key-custody design is not acceptable.
- A Veyra-owned relay adapter is still required. MariaDB can store public device/prekey metadata and opaque message envelopes, but the adapter must authenticate each device, enforce recipient and group membership, consume prekeys atomically, limit abuse, and never expose private keys or plaintext to the API.

The candidate is therefore the preferred subject for an isolated cross-client proof of concept, not a dependency to add blindly to the 1.2.0 release. The proof of concept must pass browser, Electron Windows, and Capacitor Android storage/restart tests; two-device and offline delivery; group add/remove and key rotation; identity-change verification; lost-device/recovery behavior; ciphertext-only server storage; and a review of the SDK's protocol deviations and security limits. Independent cryptographic review remains a release requirement.

Sources reviewed on 2026-11-11:
- [OpenE2EE SDK repository](https://github.com/open-e2ee/signal-protocol-js)
- [OpenE2EE security model](https://github.com/open-e2ee/signal-protocol-js/blob/main/docs/SECURITY.md)
- [OpenE2EE assurance and test limits](https://github.com/open-e2ee/signal-protocol-js/blob/main/docs/ASSURANCE.md)
- [OpenE2EE runtime support matrix](https://docs.open-e2ee.dev/reference/runtime-support)

The current release branch does not add this dependency or write encrypted-message rows. It keeps the existing message format until the proof of concept and security review pass.

## Proposed private-chat design

If a supported implementation passes a cross-client proof of concept:

1. Each installation receives a distinct cryptographic device identity. Private identity material remains on that device and is never sent to MariaDB, Redis, logs, or ordinary API responses.
2. The API stores public device identity and prekey material, device status, and signed public-key metadata. The API must not receive private identity keys or message plaintext.
3. Clients establish per-device sessions using the selected protocol implementation. Messages are encrypted on the sender and decrypted only on authorized recipient devices.
4. Group messages use the implementation's supported group-messaging mechanism. Membership changes must trigger the protocol's required sender-key/session rotation; removing a member must prevent access to future messages, while access to already received plaintext cannot be revoked.
5. A new device must be explicitly linked and provisioned. Message-history transfer must be an authenticated, end-to-end protected device-to-device operation or an explicitly user-approved secure backup; the server must not silently recover private keys.
6. Clients must detect identity/key changes and provide a clear verification or safety-number experience before treating a changed identity as trusted.

The protocol implementation, version, wire format, device lifecycle, migration behavior, and recovery behavior must be recorded before production rollout. Message envelopes need a version field so future clients can negotiate or reject unsupported formats safely.

## Global Chat and moderation

Global Chat remains server-readable. Protect it with HTTPS/TLS in transit, database/storage encryption at rest where supported by the deployment, encrypted backups, strict API authorization, and limited operational access. Moderation, reporting, and abuse-prevention workflows continue to operate on server-visible content.

Do not label Global Chat end-to-end encrypted. If product requirements later demand private user-to-user content inside Global Chat, that content must use a separate E2EE conversation type and must not be presented as moderation-readable.

## Key storage

- Android: use Android Keystore-backed secure storage through the existing native secure-storage integration.
- Windows desktop: use Electron `safeStorage` for local secret material.
- Web: use browser platform cryptography and origin-bound local storage with a documented recovery limitation. A non-extractable browser key is not a substitute for device identity verification or secure backup.
- Never store private keys in MariaDB, Redis, Supabase Storage, analytics, crash reports, or application logs.

## Release gate

E2EE is not implemented by the current 1.2.0 branch. Do not enable encrypted-message writes or claim E2EE until a cross-client proof of concept and security review pass. Required tests include two-device sessions, offline delivery, reconnects, group add/remove, key rotation, identity changes, lost-device recovery, old-client compatibility, and ciphertext-only server storage. Global Chat moderation must be tested independently and remain functional.

Until those gates pass, the existing message format remains in use. This avoids silently stranding users with incompatible ciphertext or shipping an incomplete security protocol.
