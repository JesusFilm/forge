# TV beta feedback: Railway + Redis + Linear

Status: plan approved in principle; implementation and deployment pending. Supersedes the PostgreSQL/private-bucket/worker architecture in the 2026-09-23 TV feedback plans. Do not treat the current local `apps/tv-feedback` code as deployment-ready: it still requires PostgreSQL, S3, and a worker.

## Decisions

- Source: `apps/tv-feedback` (`@forge/tv-feedback`) in JesusFilm/forge. `apps/tv/app/feedback.tsx` remains the TV QR screen. No cross-imports between apps.
- Host one web service named `watch-tv-feedback` and one Redis service in a Railway staging environment. Use the Railway HTTPS domain for the QR and API. No custom domain, PostgreSQL, private bucket, or separate delivery worker.
- Deliver reports and final annotated photos/videos to Linear only: Jesus Film Project workspace, TV (`TV`) subteam of Forge, [TV Beta Feedback](https://linear.app/jesus-film-project/project/tv-beta-feedback-0b56740fdc10/overview) project, and the team issue label `TV Beta Feedback`. Use a dedicated key scoped to issue creation and the TV team; the existing `JFP Linear` key is read-only and cannot serve this app.
- Support both Apple TV and Android TV. Require a short description; optional final media, name, and email. Include app/platform/build/device diagnostics, clearly identified as client-reported where applicable.
- One QR authorizes one report. Claim starts a 30-minute phone session; scanning or opening the page does not. Allow three successfully delivered reports per installation per server UTC day. A new QR does not reset the allowance. Installation identity is not person identity and reinstalling can reset it.
- Per report: at most three photos (10 MB each) and one video (50 MB), with a 60 MB total byte ceiling. Drawing/redaction is supported for photos; only the final annotated image leaves the phone. Removed or failed uploads do not refund lifetime byte quotas. Keep minimal reference, claim, quota, and delivery metadata in Redis for seven days; never keep media in Redis.
- If delivery fails, keep the draft on the phone and offer retry. Show `Feedback received` only after the Linear issue and requested attachments are confirmed. No Slack notification in v1.

## Flow and failure semantics

1. TV asks the Railway server for a QR. Android obtains a Play Integrity Standard token bound to a server challenge and installation key; server checks app package, Play signing certificate, allowed build, recognized app, licensing, device verdict, request hash, and freshness. Play Console is linked to `jesus-film-stage` (project number `412620661851`); the dedicated `watch-tv-feedback-integrity` service-account key was verified locally. A new native Android build is required.
2. Apple TV gets a separate issuer. First test DeviceCheck/App Attest availability on the physical tvOS models and TestFlight builds. If unavailable, document the weaker proof and use bounded, signed installation requests plus strict issuer/claim/rate caps; never label those requests as Apple-attested. Do not enable anonymous static QR issuance as a public fallback.
3. Server returns an opaque, random bearer URL and a non-authorizing human reference. The URL carries no Google/Apple token or private device data. Redis stores only a hash of the bearer. Unclaimed QR expires at the next UTC midnight; the TV rotates it once per server day. Claim is atomic and binds one browser session to the QR for 30 minutes.
4. Phone edits its local draft and finalizes annotations before upload. Each upload is checked against grant/session, count, size, content type, and service-wide concurrency/rate limits **before reading file bytes**. Stream allowed bytes through the Railway server into Linear's `fileUpload` signed PUT. Do not expose the Linear key or signed PUT to the browser. Reject oversized/mismatched media and cap process memory, request duration, and concurrent media work.
5. Record each confirmed Linear asset URL and checksum against the grant in Redis; then create the issue with a unique reference in its description and attach only those confirmed assets. The final submission is an atomic Redis transition from ready to creating, guarded by an idempotency key and the daily allowance. All entry points, including Advanced report, must share this gate.
6. On a definite Linear failure, release the in-flight lock for a same-report retry without granting another report or refunding upload bytes. On an ambiguous issue-create response, reconcile by reference before any retry; if the outcome cannot be determined, mark `needs_review` and do not blindly create another issue. A server crash after media reaches Linear but before issue creation may leave an unattached Linear asset; bounded cleanup/reconciliation or manual review is required.
7. Return the existing issue/receipt for the same idempotency key. A changed payload or second phone must not create another issue. Expired drafts retain local text/annotated images while the browser tab remains open; a new grant is needed to send them. This local draft is not a durable cross-device backup.

## Redis design

- Keys: challenge, installation public key and quota, daily grant allowance, grant state, claim session, upload ledger, submission idempotency and delivery result, short-lived IP/service rate counters. Hash secrets; use TTLs and minimize stored diagnostics.
- Use Redis Lua or equivalent atomic server-side operations for challenge consumption, one-phone claim, byte/count reservation, daily three-report cap, final submission transition, and retry outcome. Test concurrent requests against a real Redis instance, not only a mock.
- Configure persistence and `noeviction`; an eviction/restart that loses grant or submission state must fail closed until state is restored. Monitor memory, failed scripts, and quota use. At seven days, expire reference/delivery records; daily quotas need only survive their UTC window plus retry/reconciliation margin.
- The HTTP service is the only media processor. No standalone worker is required; unfinished submissions cannot be promised background delivery after a browser/server failure.

## Code and deployment work

1. Replace `apps/tv-feedback/src/server/{db,storage,repository,uploads,session,tvGrant}.ts`, route SQL transactions, migrations, and worker calls with Redis-backed state and direct Linear delivery. Remove PostgreSQL/S3/worker dependencies, environment variables, Railway worker config, and health gates after the replacement passes behavior tests. Keep existing form/annotation UI.
2. Update `apps/tv-feedback/railway.toml` for monorepo-root build, `@forge/tv-feedback`, Railway `PORT`, and `/api/health`. Configure Redis URL, Linear destination/key, session secret, Turnstile, Play Integrity verification, allowed Android versions, and Apple issuer settings as server-only Railway variables. Avoid secrets in `.env.example`, QR URLs, logs, and TV bundles.
3. Keep `apps/tv/.env.example` limited to public project number and HTTPS feedback URL. Add native tvOS issuer only after device feasibility is known. Maintain TV remote focus and player behavior.
4. Use the repo roadmap/process: `docs/roadmap/platform/feat-551-tv-beta-qr-feedback-linear.md` replaces the colliding local feat-533 ID (main already uses 533). Keep this work scoped to one feedback PR, run format/typecheck/lint/build plus relevant browser/device checks, and deploy through the normal PR-to-main flow. Staging can be configured before production release.
5. Create the dedicated Linear API key and verify it can create one TV-team issue and upload/attach both a marked photo and a bounded video. Record exact team/project/label IDs as protected Railway variables; do not use the existing read-only `JFP Linear` key.

## Acceptance checks

- Apple TV and Play-installed Android TV each show a working QR; a non-Play Android build, tampered request, stale challenge, wrong signing identity, expired QR, and unsupported Apple attestation path fail according to the documented issuer policy.
- Claim races yield one browser winner; three delivered reports are allowed per installation per UTC day and the fourth is rejected. New QR/reload/device clock changes do not reset the cap. Installation reset limitations are documented.
- A malformed/expired grant cannot send file bytes; byte/count limits are lifetime limits, including rejected and removed media. Flood limits bound Google/Apple verification calls, Linear uploads, and total service workload.
- A marked photo and a MOV/MP4 arrive as private Linear assets on exactly one issue in the TV Beta Feedback project with reference and platform diagnostics. No original unredacted image is sent.
- Timeout/restart/concurrent Send cases produce one issue or a visible `needs_review` state, never an unverified success screen or automatic duplicate. Retry of the same submission returns its receipt.
- On iPhone Safari and Android Chrome, photo capture/selection, drawing, moving/deleting marks, video selection, retry, and phone-sized layout remain usable. Test real Apple TV and Android TV hardware before enabling public QR issuance.

## References

- [Linear upload API](https://linear.app/developers/how-to-upload-a-file-to-linear): signed upload URL and PUT must be handled server-side for a web form.
- [Linear API key permissions](https://linear.app/docs/api-and-webhooks): keys can be restricted to issue actions and teams.
- [Google Play Integrity setup](https://developer.android.com/google/play/integrity/setup).
- [Apple DeviceCheck](https://developer.apple.com/documentation/devicecheck) and [App Attest support check](https://developer.apple.com/documentation/devicecheck/dcappattestservice/issupported).
