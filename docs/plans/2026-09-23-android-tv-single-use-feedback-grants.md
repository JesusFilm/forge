# Android TV verified, daily, single-use feedback QR

Status: the PostgreSQL version was implemented locally in the `codex/tv-beta-feedback` worktree; the replacement design is in the 2026-09-24 Redis plan. Extends feat-551. A native Android build and real verdict test remain open.

## Outcome and limits

Google Play Open Testing users open Feedback on the TV. The feedback server verifies an app-origin proof, issues an expiring QR URL and human-readable reference, and accepts at most one report for that grant. Default policy: one accepted report per installation per UTC day, not one report per human. A household TV may have multiple users; without account authentication there is no reliable per-person identity. Reinstallation, storage clearing, and renewed keys can bypass installation-level limits, so daily rotation must be combined with issuer, claim, upload, and submission limits.

Play Integrity proves app/device/licensing signals. It does not provide a dedicated cryptographic Android TV form-factor verdict, a stable person ID, a stable device ID, or an Open Testing track identifier in the standard verdict. Native TV detection and diagnostics remain client-reported. Verify the actual TV-only package and Play distribution rules; do not equate a JSON field such as platform=android-tv with proof.

## Current code findings

- `apps/tv/src/components/feedback/FeedbackQrScreen.tsx` builds the URL locally from `EXPO_PUBLIC_TV_FEEDBACK_URL`; no issuance request exists.
- `apps/tv/src/lib/feedbackUrl.ts` exposes platform, configured appVersion/build, screen=settings, and selected player in query parameters. These are editable by anyone holding the link.
- `apps/tv/app.json` declares Android package `org.jesusfilm.tv`; the inspected checkout declares versionCode 2. This is source configuration, not verification of the build currently distributed by Play.
- No Play Integrity module or installation identity was found in the inspected TV feedback implementation. Existing local Expo modules provide a pattern for adding Kotlin integration.
- `apps/tv-feedback/src/server/session.ts` provides two-hour cookie sessions, hashed secrets, and an IP-based session-creation limit. These sessions currently do not require a TV-issued grant.
- Upload reservations have file/byte quotas and ownership checks; reports use idempotency and a persistent delivery queue. Those are reusable, but cannot currently prove that a browser came from a real TV app.
- Existing text-only/advanced endpoints must be covered by the new admission rule as well as the new photo flow.

## Data to collect

| Field                                                                          | Source / trust                                             | Purpose                                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Package, signing certificate digest, versionCode                               | Decoded and verified Play Integrity app verdict            | Allow only approved Watch TV app identities/builds                     |
| App recognition, device integrity, licensing verdict                           | Google verification                                        | Admission decision; store minimal verdict summary                      |
| Challenge ID, requestHash, token timestamp                                     | Server challenge plus verified verdict                     | Bind proof to this issuance request and reject stale/replayed requests |
| Random installation ID and public-key fingerprint                              | New app installation identity, bound into attested request | Daily allowance; not a permanent device or person identity             |
| Native TV-mode / leanback detection                                            | Kotlin UiModeManager / PackageManager, client-reported     | TV eligibility signal and diagnostics; not standalone security proof   |
| Manufacturer/model, Android SDK/OS version, native app version, player, screen | Native/app-reported metadata                               | Reproduce problems; label clearly as reported context                  |
| Reference ID, grant state, created/expiry/claim/consume timestamps, report ID  | Server                                                     | One-use enforcement and support lookup                                 |
| IP-derived abuse key with short retention                                      | Trusted ingress headers on server                          | Secondary throttling, not identity; account for shared NAT             |

Do not collect IMEI, serial number, MAC address, advertising ID, or Google email. Do not use a raw Android ID as proof. If a signed-in Watch account is later used, separately decide whether daily quotas should be per account and how guests work.

## 1. Verify the TV app before QR issuance

1. TV creates a random installation ID and an Android Keystore signing key on first use. Keep the private key on the device. Register the public key only through the attested flow; later requests prove possession. Do not embed a shared API secret in the APK or JavaScript bundle.
2. `POST /api/feedback/tv/challenge` returns a short-lived, random server challenge (proposed TTL: two minutes), challenge ID, server UTC day, and an action identifier. Rate-limit this endpoint before expensive work.
3. The native module gathers minimal TV/app context. Use Play Integrity Standard requests and set requestHash to SHA-256 of a canonical payload containing action, challenge ID/value, installation ID, public-key fingerprint, server day, and relevant metadata. Sign the same payload with the installation key.
4. TV calls `POST /api/feedback/tv/grants` with the payload, signature, and integrity token. The server verifies the token server-to-server with Google, checks the exact requestHash and timestamp, and atomically consumes the challenge.
5. Require the expected package, approved Play App Signing certificate digest, approved versionCode policy, PLAY_RECOGNIZED, LICENSED, and MEETS_DEVICE_INTEGRITY. Do not require MEETS_STRONG_INTEGRITY initially; older supported TVs need to remain usable. Test this policy on real supported hardware before enforcing it.
6. If successful, issue the grant and return `{ feedbackUrl, referenceCode, expiresAt, serverTime }`. Package/version values from the verified verdict take precedence over supplied metadata.

Use the Play App Signing certificate, not the upload-key certificate. Link/configure the Play Integrity Cloud project and service-account permissions through the normal console process. Standard verdicts include no testing-track identity: version/package allowlists and Play distribution configuration provide that release policy.

## 2. Daily QR and reference policy

- Generate a cryptographically random 256-bit secret; the readable reference (for example WT-7K9P-2D4R) is for support only and must not authorize a report by itself.
- QR example: `https://feedback.example/tv#grant=<opaque-secret>`. The placeholder domain must be replaced with the approved feedback domain. No raw device identity, email, or integrity token goes in the QR.
- Send the fragment secret in a same-origin POST, then remove it from the browser address using history replacement after a successful claim. Keep it out of access logs/analytics; do not load third-party resources before clearing it.
- Use server UTC date. Expire an unconsumed daily grant at the next UTC midnight; the TV refreshes on screen entry, resume, and expiry while visible. Display remaining validity in the user's local time.
- Enforce one accepted report per installation/day with a database constraint, independent of how many QR replacements or browser sessions exist. Merely changing the token every day does not enforce this.
- Reopening the TV screen returns the existing valid daily grant. Store only its hash for validation; if the TV lost its cached URL, allow a bounded replacement that revokes the previous token without resetting the daily allowance. Proposed maximum: three replacements/day, never after consumption.
- A replacement invalidates old claims and draft upload authorization. Explain that state in the phone UI and preserve the local photo/note for a fresh scan.

## 3. Claim from phone and authorize media

1. Scanning/opening the URL performs no irreversible consumption. Link previews and repeated page loads must not burn a code.
2. An explicit Start feedback POST exchanges the token for a HttpOnly, Secure, SameSite session. Verify expiry, revocation, daily allowance, and Turnstile/risk policy. Bind the grant to one browser session atomically; a second phone cannot claim it concurrently.
3. Repeated claims from the same session are idempotent. If the cookie is lost, the user returns to the TV for a bounded replacement. Do not release a claim solely because a bot requested it repeatedly.
4. The server sets claimed_at once when Start feedback succeeds and sets session_expires_at = min(claimed_at + 30 minutes, grant.expires_at). This is a maximum 30-minute window; a QR claimed close to UTC midnight has less time. Show the actual countdown and warn before expiry. Refreshing, rescanning, reopening the page, and retrying never reset this deadline. Use server time, not the phone/TV clock.
5. At expiry reject new upload reservations, file completion/validation promotion, and final submissions. An upload started before the deadline must not become accepted evidence after it. Cancel processing where practical and clean up private abandoned files. Preserve the browser's photo, marks, and note while the page remains open; a bounded replacement from the TV creates a new authorization, not a reset of the old session.
6. Require the bound, active grant on upload reservation, upload PUT, upload-status read, delete, and final submission. Check before accepting bytes. Apply lifetime byte/reservation limits per grant AND installation/day so replacing a QR or removing/re-uploading files cannot reset the total allowance. Also cap concurrent validation jobs and total service upload volume; pause admission if those budgets are exhausted.
7. Receive media only into private temporary storage. Validate/normalize it before it can be attached to a report. Invalid, expired, or already-used grants create no upload reservation or Linear work.

The scanned URI is a bearer capability: somebody who copies a live QR can race to claim it. Single-use claims contain the damage but do not prove the phone owner is the TV viewer. If this becomes material, add a short confirmation on the TV after scanning; do not burden v1 without evidence.

## 4. Consume once and deliver to Linear

### Required anti-spam controls

1. Validate the grant, bound session, and deadline before accepting any file bytes; recheck before promoting uploaded files to accepted evidence.
2. Enforce cumulative upload attempts and bytes over the grant lifetime and installation/day. Removing files never refunds this abuse budget. Keep this separate from simultaneous attachment slots.
3. Limit QR issuance and replacement per installation/day, with fresh Play Integrity verification and installation-key proof for issuance requests. Replacement never resets daily report or upload budgets.
4. Apply service-wide request-rate, ingress-byte, queue-depth, concurrent-processing, and processing-time limits. Stop admitting new work when the configured budget is reached; expose a retry-later state rather than accumulating unbounded work.
5. Automatically clean up abandoned and expired private uploads with a scheduled cleanup job and a storage lifecycle backstop. Define the retention period before release; never delete evidence belonging to an accepted report that still requires delivery under that retention policy.
6. Atomically verify and consume the grant, consume the daily report allowance, persist the report/attachment manifest, and enqueue delivery. Database uniqueness plus row locks must prevent concurrent requests from producing more than one accepted report per code.

In one database transaction: lock the grant and daily allowance; check the existing idempotency key first; verify the bound session, expiry, and ready owned attachments; create the report and immutable attachment manifest; mark the grant consumed with report_id; consume the daily allowance; enqueue delivery. A unique report/grant constraint ensures two simultaneous Send requests cannot produce two reports.

- Retrying the same accepted submission returns its original receipt, even after the grant was consumed. A changed payload with the same key returns a conflict.
- The worker processes only authorized accepted reports. Check the recorded grant/report relationship before Linear work. No issue or Linear upload occurs from a loose image or an unaccepted form.
- An accepted report may finish delivery after midnight; QR expiry must not cancel already accepted work. Linear failures do not restore the grant or daily allowance.
- Preserve the existing ambiguous-create handling: reconcile an uncertain issue-create response rather than blindly creating another issue. Retry attachment delivery against the persisted issue ID.
- Show Reference and Report saved after local acceptance; show Delivered only after confirmed delivery. Include the reference in the Linear issue for support lookup, without putting bearer secrets or raw integrity tokens in Linear.

## Database and code changes

Local implementation now includes challenge/issuance/claim/status routes, the Play Integrity verification service, installation/day/grant tables, enforcement at session/upload/submission/worker boundaries, 30-minute session binding, global and daily upload limits, abandoned-file cleanup, a phone Start gate, and an Android Expo/Kotlin module. The local QA database migration and synthetic-grant tests passed. A real Google verdict, Play App Signing digest/version allowlist, EAS build, and physical Chromecast/Xiaomi tests are still required before enabling production.

- Add feedback_tv_challenges, feedback_installations (public key/fingerprint), feedback_daily_allowances, and feedback_grants. Store token hashes; index expiry/state; enforce unique installation/day and unique grant/report linkage. Add nullable grant_id to sessions and reports, then enable enforcement through a staged rollout.
- Add `apps/tv/modules/tv-feedback-integrity/` following the existing local Expo module pattern. Fetch runtime version/package/TV-mode in Kotlin, call Play Integrity, and bridge only the necessary results to React Native. This requires a new native Android build; an Expo live update alone cannot add the native module.
- Replace static URL creation in FeedbackQrScreen with loading/verified/expired/used/unavailable states and server-provided URI/reference/expiry. Cache the active grant locally and clear it when consumed or revoked.
- Add issuance and claim services in `apps/tv-feedback/src/server/`; update every existing session/upload/submission entry point to enforce grant ownership. Keep the enforcement policy centralized so Advanced report cannot bypass it.
- Remove arbitrary production browser-session creation as an alternative to a verified grant. Do not let a request switch platform to apple-tv/not-sure to bypass enforcement. Apple TV needs its own issuer policy before enabling the same public path; existing local preview remains isolated and cannot write production reports.
- Add expiry cleanup for abandoned private media/challenges and bounded retention for verification summaries. Never log raw grant or integrity tokens. Monitor issuance failures, claims, accepted reports, throttles, and Linear backlog without logging report content.

## Rollout

1. Real-device feasibility spike: Play-installed builds on Chromecast/Google TV and Xiaomi TV, including the oldest supported Android version. Record real verdicts and signing identity. Official documentation reviewed does not establish a separate Android-TV-specific attestation guarantee; this hardware test is required before selecting hard enforcement.
2. Implement issuance, atomic one-use storage, and browser admission with automated race/retry tests. Add feature flags for observe and enforce modes, controlled server-side.
3. Internal testing through Play: allowed build, sideloaded build, unsupported/unlicensed device, Google service outage, app reinstall, and clock changes. Use a separate authenticated QA path if needed; never silently downgrade to a static public QR.
4. Observe verdict distribution, quota usage, and false rejections on real devices, then enforce before sharing Open Testing broadly. Add a support route for legitimate testers who fail verification.
5. Validate one approved staging Linear issue with photo/video and reference; restart the worker and retry without duplicates. Production release follows reviewed PR-to-main deployment.

## Acceptance cases

- Fake installation IDs, package names, certificates, modified metadata/hash, old challenges, reused integrity tokens, and expired QR secrets are rejected.
- Two phones racing to claim: one session wins. Two simultaneous final submissions: one report and one consumed allowance. Same-request retries return one receipt.
- Link preview/GET does not start the timer. Start feedback sets the deadline once. Refresh, rescan, and retry preserve it; requests at or after the deadline are rejected. Test the shorter window near UTC midnight and uploads/processing that cross the deadline.
- Refreshing the TV or replacing a QR does not grant additional daily submissions. Next UTC day produces a new reference; changing a device clock does not.
- Invalid code is rejected before media bytes are accepted; rejected/removed/retried files cannot reset lifetime quotas.
- Submission accepted just before expiry completes through Linear afterward. An expired draft keeps its local image/note but requires a new valid grant.
- Camera/annotation/upload/retry on real iPhone Safari and Android Chrome remains usable. Real TV remote focus and expiry refresh do not interrupt playback.

## English flow image

See `docs/plans/assets/android-tv-feedback-30-minute-flow.png` and its editable SVG source. The timer and quotas are proposed controls, not claims that enforcement is already implemented.

## Sources

- [Google Play Integrity overview](https://developer.android.com/google/play/integrity/overview)
- [Standard requests and requestHash binding](https://developer.android.com/google/play/integrity/standard)
- [Returned integrity and licensing verdicts](https://developer.android.com/google/play/integrity/verdicts)
- [Play Integrity setup](https://developer.android.com/google/play/integrity/setup)
- [Android TV hardware detection](https://developer.android.com/training/tv/get-started/hardware)
