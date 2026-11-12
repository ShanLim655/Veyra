# Veyra 1.2.0 — Reliability, Security & Experience Update

**Status:** Proposed  
**Version:** 1.2.0  
**Previous Version:** 1.1.8

## Overview

Veyra 1.2.0 focuses on improving reliability, security, performance, and the overall user experience across web, desktop, and Android.

The objective is to strengthen existing functionality, resolve known inconsistencies, improve backend infrastructure, and introduce practical improvements without unnecessarily rewriting existing systems.

This release must prioritize maintainability, reliability, and security over unnecessary architectural complexity.

## 1. Realtime & Presence Improvements

Improve the reliability of Veyra's existing realtime communication system.

- Fix intermittent typing indicators.
- Improve online/offline status synchronization.
- Improve presence synchronization across multiple devices.
- Improve reconnection handling.
- Prevent stale presence information.
- Investigate delayed or missing realtime events.
- Improve message synchronization after reconnecting.
- Ensure consistent realtime behavior across DMs and group conversations.
- Prevent duplicate events and inconsistent message states.

## 2. Messaging Improvements

Improve existing messaging functionality without duplicating features that are already implemented.

- Improve message loading and pagination.
- Improve conversation search.
- Improve notification reliability.
- Polish existing replies, reactions, polls, and attachments.
- Fix inconsistencies between group chats and direct messages.
- Improve message synchronization and delivery behavior.
- Optimize handling of larger conversations.
- Improve message loading performance on slower connections.
- Ensure consistent message behavior across all clients.

## 3. Security & Backend Improvements

Strengthen Veyra's backend security and data protection.

### Authentication & Authorization

- Review authentication and session management.
- Improve session revocation and expiration handling.
- Improve rate limiting using Redis.
- Audit API authorization and permission checks.
- Review sensitive endpoint security.
- Improve error handling and security logging.
- Prevent unauthorized access to conversations and user data.

### Message Encryption

Implement a straightforward, secure, and maintainable encryption system for Veyra's messaging infrastructure.

**IMPORTANT: End-to-end encryption (E2EE) is explicitly OUT OF SCOPE for Veyra 1.2.0.**

Do not implement E2EE, Signal Protocol, Matrix, client-side key exchange, distributed identity verification, or complicated per-device key management.

The goal is to protect messages both during transmission and while stored in the database without introducing unnecessary cryptographic complexity.

#### Encryption Requirements

**1. Transport Encryption**

- Use HTTPS with modern TLS configurations.
- Ensure WebSocket connections use secure WebSocket connections (WSS).
- Protect communication between clients and backend services.
- Never transmit sensitive message data over unencrypted connections.

**2. Database Message Encryption**

- Evaluate AES-256-GCM using a reputable, established cryptographic library.
- Encrypt message content on the backend before storing it in MariaDB.
- Decrypt messages on the backend when authorized users retrieve them.
- Ensure authentication tags are verified during decryption.
- Never implement custom cryptographic algorithms.
- Use secure random nonces/IVs as required by the selected algorithm.
- Never reuse a nonce with the same encryption key.

**3. Encryption Key Management**

- Use server-managed encryption keys.
- Keep encryption keys outside the database.
- Load secrets through environment variables or an appropriate secret-management mechanism.
- Never expose encryption keys through APIs, application logs, or client responses.
- Ensure key rotation can be supported without unnecessarily complicating the initial implementation.
- Do not hardcode encryption keys into application source code.

#### Conversation Compatibility

The encryption system must support:

- **Direct Messages:** Encrypt stored message content.
- **Group Chats:** Encrypt stored message content consistently.
- **Global Chat:** Encrypt stored message content while preserving server-side moderation, reporting, and abuse-prevention functionality.

All three conversation types must use a consistent and maintainable encryption implementation.

Global Chat must remain accessible to the backend for moderation. Do not claim that Global Chat is end-to-end encrypted.

#### Implementation Principles

- Prefer a centralized backend encryption service.
- Use established cryptographic libraries.
- Avoid unnecessary key-management infrastructure.
- Avoid client-side cryptographic complexity.
- Keep encryption and decryption consistent across web, desktop, and Android.
- Consider backward compatibility with existing messages.
- Ensure existing message functionality continues working.
- Handle decryption failures safely without crashing the application.
- Document the actual security properties and limitations.

Before implementation, inspect the existing message storage architecture and determine the safest way to introduce encryption without breaking existing conversations.

Do not encrypt unrelated fields unnecessarily. Focus on protecting sensitive message content.

### Redis & Database

- Improve Redis caching and invalidation.
- Review database query performance.
- Improve backend error handling.
- Preserve MariaDB as the authoritative persistent database.
- Ensure Redis failures do not compromise persistent application data.
- Avoid storing sensitive encryption keys or plaintext messages in Redis unnecessarily.

## 4. Altare Queues Integration (OPTIONAL)

Evaluate and optionally integrate Altare Queues for asynchronous background processing.

**Queues must remain completely optional. Veyra must operate normally without an Altare Queues connection.**

### Environment-Controlled Activation

- Enable or disable Queues through environment variables.
- Queues must remain disabled by default unless explicitly enabled and correctly configured.
- When disabled, Veyra must not attempt to connect to or initialize the queue service.
- When enabled, validate required environment configuration during startup.
- Missing or invalid configuration must produce clear, actionable errors.
- Application startup must never depend on Queues when integration is disabled.
- Provide reliable fallback behavior for supported background operations when Queues are disabled.
- Never silently discard jobs when queue publishing fails.

Use descriptive environment variables following existing project naming conventions.

Document their purpose, defaults, and required values in every relevant environment example.

### Potential Use Cases

- Background notification processing.
- Email delivery.
- Background maintenance tasks.
- Other operations that should not block API requests.

### Reliability Requirements

- Implement retry handling.
- Prevent duplicate processing through idempotent workers.
- Handle failed and delayed jobs.
- Monitor queue processing failures.
- Consider a transactional outbox using MariaDB.
- Keep critical application operations independent of queue availability.
- Ensure graceful shutdown of queue workers.

Only integrate Queues where they provide meaningful improvements.

## 5. Desktop & Android Improvements

Improve the experience and reliability of both standalone applications.

### Desktop

- Redesign the automatic updater experience.
- Display download progress and update status.
- Show useful update information.
- Improve update failure handling.
- Improve installation and restart behavior.
- Investigate ways to reduce application resource consumption.
- Evaluate alternatives to Electron without committing to an unnecessary framework migration.
- Ensure updates cannot leave the application in a broken or unusable state.

### Android

- Improve application stability.
- Improve update reliability.
- Fix platform-specific inconsistencies.
- Improve UI responsiveness and performance.
- Ensure consistent behavior with web and desktop clients.
- Preserve the lightweight nature of the existing Android application.

## 6. Documentation & Environment Configuration

Updating documentation and environment examples is a REQUIRED part of this release.

### Documentation

- Update README.md where necessary.
- Update Releases.md with Veyra 1.2.0 information.
- Update architecture and backend documentation.
- Update API documentation where behavior changes.
- Update Redis documentation if its responsibilities or configuration change.
- Document the message encryption architecture and limitations.
- Document encryption key configuration and management.
- Document optional Altare Queues integration and fallback behavior.
- Update deployment and setup instructions.
- Remove outdated instructions and references.
- Ensure documentation accurately reflects implemented functionality.

### Environment Examples

Review every existing `.env.example`, `.env.template`, and equivalent environment example.

- Add new environment variables introduced in 1.2.0.
- Document optional variables and their defaults.
- Document variables required only when a feature is enabled.
- Update existing variable descriptions if their behavior changes.
- Keep examples consistent with actual application configuration.
- Never include real credentials, API keys, or secrets.
- Ensure a fresh installation can be configured using the updated environment examples.

Do not create unnecessary duplicate environment files. Update existing examples wherever possible.

## 7. Testing & Release Requirements

Before publishing Veyra 1.2.0:

### Application Testing

- Test web, desktop, and Android applications.
- Verify authentication and authorization.
- Test realtime behavior during disconnections and reconnections.
- Verify messaging consistency across supported clients.
- Test conversation search and pagination.
- Verify notification delivery.

### Security Testing

- Verify TLS and secure WebSocket configurations.
- Verify message encryption and decryption.
- Test invalid ciphertext and authentication-tag failures.
- Verify encryption keys are not exposed through logs, APIs, or database records.
- Verify unauthorized users cannot access protected conversations.
- Verify Global Chat moderation continues working.
- Verify existing messages remain accessible after the encryption migration.

### Infrastructure Testing

- Test database migrations.
- Test Redis failure and recovery behavior.
- Test application startup with Queues disabled.
- Test application startup with Queues enabled.
- Verify disabling Queues prevents initialization and connection attempts.
- Test queue retries and recovery if Queues are integrated.

### Release Testing

- Verify desktop release builds.
- Verify Android release builds.
- Ensure CI workflows pass.
- Update all relevant documentation and environment examples.
- Verify that a fresh deployment can follow the updated setup instructions.

## 8. Development Principles

- Preserve existing functionality unless a change is necessary.
- Avoid unnecessary rewrites.
- Prefer maintainable and well-tested implementations.
- Do not introduce unnecessary dependencies.
- Do not implement custom cryptography.
- Do not implement E2EE in this release.
- Keep MariaDB as the primary persistent database.
- Keep Redis for caching and temporary backend operations.
- Keep Supabase Storage unchanged.
- Keep Altare Queues optional and environment-controlled.
- Maintain compatibility across all supported clients.
- Prioritize reliability over adding features for the sake of adding features.
- Follow existing project conventions and architecture.
- Avoid introducing duplicate implementations of existing functionality.

## 9. Implementation Instructions

Before modifying the project:

1. Inspect the entire repository and understand its existing architecture.
2. Identify existing implementations before proposing replacements.
3. Review current database schemas, API endpoints, realtime services, and client integrations.
4. Identify dependencies between web, desktop, Android, and backend components.
5. Identify potential breaking changes and migration requirements.
6. Create or update `Plan.md` with the implementation strategy, affected components, and testing requirements.

Implement the update as a cohesive release rather than making unnecessary isolated changes.

Do not leave requested functionality partially implemented.

Do not replace existing systems without demonstrating a clear technical reason.

After implementation:

- Run relevant tests and builds.
- Fix regressions introduced by the changes.
- Verify CI workflows.
- Update documentation and environment examples.
- Review the final changes for security, consistency, and maintainability.

Do not claim something is implemented or tested unless it actually is.

## Final Goal

Veyra 1.2.0 should be a meaningful improvement to the existing platform.

The release should make Veyra more reliable, secure, responsive, and polished while keeping its architecture manageable for future development.

The encryption implementation must provide strong protection for stored messages and network communication without introducing E2EE complexity.

Optional integrations must never become mandatory dependencies for the core application.