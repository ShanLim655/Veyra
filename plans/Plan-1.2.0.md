# Veyra 1.2.0 — Reliability & Experience Update

**Status:** Proposed  
**Version:** 1.2.0  
**Previous Version:** 1.1.8

## Overview

Veyra 1.2.0 focuses on improving reliability, security, performance, and the overall user experience across web, desktop, and Android applications.

The goal is to strengthen existing functionality, fix known inconsistencies, improve backend infrastructure, and introduce practical improvements without unnecessarily rewriting existing systems.

## 1. Realtime & Presence Improvements

Improve the reliability of Veyra's existing realtime communication system.

- Fix intermittent typing indicators.
- Improve online/offline status synchronization.
- Improve presence synchronization across multiple devices.
- Improve reconnection handling.
- Prevent stale presence information.
- Investigate delayed or missing realtime events.
- Improve message synchronization after reconnecting.
- Ensure existing realtime functionality behaves consistently across DMs and group conversations.

## 2. Messaging Improvements

Improve existing messaging functionality without duplicating features that are already implemented.

- Improve message loading and pagination.
- Improve conversation search.
- Improve notification reliability.
- Polish existing replies, reactions, polls, and attachments.
- Fix inconsistencies between group chats and direct messages.
- Improve message synchronization and delivery behavior.
- Optimize handling of larger conversations.

## 3. Security & Backend Improvements

Strengthen Veyra's backend security and data protection.

### Authentication & Authorization

- Review authentication and session management.
- Improve session revocation and expiration handling.
- Improve rate limiting using Redis.
- Audit API authorization and permission checks.
- Review sensitive endpoint security.
- Improve error handling and security logging.

### Message Encryption

Introduce message encryption for Veyra's communication system.

Encryption must account for all three conversation types:

- **Direct Messages:** Protect private conversations.
- **Group Chats:** Protect messages shared between group members.
- **Global Chat:** Protect messages in transit and stored data while preserving necessary server-side moderation functionality.

Design requirements:

- Use established, audited cryptographic libraries.
- Avoid implementing custom cryptographic algorithms.
- Keep the architecture straightforward and maintainable.
- Avoid introducing Matrix or a Matrix-style protocol.
- Avoid unnecessary infrastructure and complicated key-management systems.
- Ensure encryption and decryption work consistently across web, desktop, and Android.
- Protect encryption keys and avoid exposing them through logs, APIs, or databases.
- Consider future compatibility with additional clients.

Encryption architecture must be evaluated before implementation. Clearly distinguish transport encryption, encryption at rest, and end-to-end encryption.

For private conversations, evaluate a practical E2EE approach that does not require building an entire distributed messaging protocol.

For Global Chat, retain the server-side functionality required for moderation and abuse prevention. Do not claim that Global Chat is end-to-end encrypted if the server must access plaintext messages.

Document the security properties and limitations of the selected approach.

### Redis & Database

- Improve Redis caching and invalidation.
- Review database query performance.
- Improve backend error handling.
- Preserve MariaDB as the authoritative persistent database.
- Ensure Redis failures do not compromise persistent application data.

## 4. Altare Queues Integration (OPTIONAL)

Evaluate and optionally integrate Altare Queues for asynchronous background processing.

**Queues must be completely optional.** Veyra must operate normally without an Altare Queues connection.

### Environment-controlled activation

- Enable or disable Queues through environment variables.
- Queues must remain disabled by default unless explicitly enabled and correctly configured.
- When disabled, Veyra must not attempt to connect to or initialize the queue service.
- When enabled, validate the required environment configuration during startup.
- Missing or invalid configuration must produce clear, actionable errors.
- Do not make application startup dependent on Queues when the integration is disabled.
- Provide a reliable fallback for supported background operations when Queues are disabled.
- Do not silently discard jobs when queue publishing fails.

Use descriptive environment variables, following the existing project naming conventions. Document their purpose, defaults, and required values in every relevant environment example.

### Potential use cases

- Background notification processing.
- Email delivery.
- Background maintenance tasks.
- Other operations that should not block API requests.

### Reliability requirements

- Implement retry handling.
- Prevent duplicate processing through idempotent workers.
- Handle failed and delayed jobs.
- Monitor queue processing failures.
- Consider a transactional outbox using MariaDB.
- Keep critical application operations independent of queue availability.
- Ensure graceful shutdown of queue workers.

Only introduce Queues where they provide a meaningful improvement.

## 5. Desktop & Android Improvements

Improve the experience and reliability of both standalone applications.

### Desktop

- Redesign the automatic updater experience.
- Display download progress and update status.
- Show useful update information.
- Improve update failure handling.
- Improve installation and restart behavior.
- Investigate ways to reduce application resource consumption.
- Evaluate alternatives to Electron without committing to a framework migration unnecessarily.

### Android

- Improve application stability.
- Improve update reliability.
- Fix platform-specific inconsistencies.
- Improve UI responsiveness and performance.
- Ensure consistent behavior with web and desktop clients.

## 6. Documentation & Environment Configuration

Update all relevant project documentation and environment examples to reflect Veyra 1.2.0.

This is a required part of the release, not an optional cleanup task.

### Documentation

- Update README.md where necessary.
- Update Releases.md with Veyra 1.2.0 information.
- Update architecture and backend documentation.
- Update API documentation where behavior changes.
- Update Redis documentation if its responsibilities or configuration change.
- Document the message encryption architecture and its limitations.
- Document optional Altare Queues integration and its fallback behavior.
- Update deployment and setup instructions.
- Remove outdated instructions and references.
- Ensure documentation accurately reflects implemented functionality.

### Environment examples

- Review every existing `.env.example`, `.env.template`, and equivalent environment example.
- Add new environment variables introduced in 1.2.0.
- Document optional variables and their defaults.
- Document which variables are required only when a feature is enabled.
- Update existing variable descriptions if their behavior changes.
- Keep examples consistent with actual application configuration.
- Never include real credentials, API keys, or secrets.
- Ensure a fresh installation can be configured using the documented environment examples.

Do not create unnecessary duplicate environment files. Update the existing examples wherever possible.

## 7. Release Requirements

Before publishing Veyra 1.2.0:

- Test web, desktop, and Android applications.
- Verify authentication and authorization.
- Test realtime behavior during disconnections and reconnections.
- Verify message encryption and decryption across supported clients.
- Test group membership and encryption key changes where applicable.
- Verify Global Chat moderation continues working as intended.
- Test database migrations.
- Test Redis failure and recovery behavior.
- Test application startup with Queues disabled.
- Test application startup with Queues enabled.
- Verify that disabling Queues prevents queue initialization and connections.
- Test queue retries and recovery if Queues are integrated.
- Verify desktop and Android release builds.
- Ensure CI workflows pass.
- Update all relevant documentation and environment examples.
- Verify that a fresh deployment can follow the updated setup instructions.

## Development Principles

- Preserve existing functionality unless a change is necessary.
- Avoid unnecessary rewrites.
- Prefer maintainable and well-tested implementations.
- Do not introduce unnecessary dependencies.
- Do not implement custom cryptography.
- Keep MariaDB as the primary persistent database.
- Keep Redis for caching and temporary backend operations.
- Keep Supabase Storage unchanged.
- Keep Altare Queues optional and environment-controlled.
- Maintain compatibility across all supported clients.
- Prioritize reliability over adding features for the sake of adding features.

## Final Goal

Veyra 1.2.0 should be a meaningful improvement to the existing platform.

The release should make Veyra more reliable, secure, responsive, and polished while keeping its architecture manageable for future development.

Optional integrations must never become mandatory dependencies for the core application.