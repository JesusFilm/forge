---
title: "Watch TV beta feedback through QR, mobile evidence, and Linear"
type: feat
status: proposed
date: 2026-09-23
roadmap: feat-551
scope: "New standalone feedback app and a small apps/tv QR entry point"
---

# Watch TV beta feedback plan

## Decision summary

Build a separate, mobile-first feedback website inspired by the existing Watch feedback form. A tester scans a QR code on Apple TV or Android TV, describes the feedback, optionally attaches photos or a short video, marks an image, and submits. The team receives a Linear issue with the approved evidence and TV context. Testers do not need a Linear account or a Watch sign-in.

**Recommended deployment:** a new `apps/tv-feedback` Next.js app on Railway behind Cloudflare, at a dedicated hostname such as `feedback.<approved-domain>/tv`. This is a proposed hostname, not a provisioned address. Keep the existing Watch website, its feedback modal, and player layouts unchanged.

Implementation began in the isolated `codex/tv-beta-feedback` worktree after the user requested it. Deployment, storage provisioning, and real Linear submissions remain separate from local implementation and verification.

## 1. Findings from the existing implementation

The [live Watch page](https://www.jesusfilm.org/watch) has a **Share feedback** form. Its first screen was inspected without submitting anything. It shows five steps and four categories: Problem, Confusing, Idea, and Praise.

| Existing source                                                   | Reusable behavior                                                                                                              | Change needed for TV beta feedback                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `apps/web/src/components/FeedbackLauncher.tsx`                    | Lazy loading and focus restoration                                                                                             | The phone gets a standalone page instead of a floating modal                                    |
| `apps/web/src/components/FeedbackModal.tsx`                       | Category, description, context, review/contact, translated copy                                                                | Replace DOM element selection with photo upload and annotation                                  |
| `apps/web/src/lib/feedback.ts`                                    | Bounded context types                                                                                                          | Separate affected TV details from the submitting phone                                          |
| `apps/web/src/lib/feedback-linear.ts`                             | Server-only Linear issue creation, Markdown escaping, 6-second metadata timeout, 64 KiB response cap, opaque follow-up receipt | Add durable delivery and evidence transport, using separate service credentials                 |
| `apps/web/src/lib/feedback-action-core.ts`                        | Validation and honeypot                                                                                                        | Its process-local rate-limit map is insufficient for public media upload and multiple instances |
| `apps/web/messages/en.json` and sibling catalogs                  | Existing feedback vocabulary and categories                                                                                    | Own a small English/Thai catalog for the new form                                               |
| `apps/tv/src/components/home/QrPanel.tsx`, `profile/SignInQr.tsx` | Existing TV-compatible QR rendering, integer module sizing, four-module quiet zone                                             | A dedicated feedback QR, not the beta-enrollment or sign-in QR                                  |
| `apps/tv/src/components/settings/SettingsScreen.tsx`              | D-pad navigation and focus restoration                                                                                         | Add a Help / Send feedback entry without changing player controls                               |

**The existing Watch form already has a Linear integration.** Its inspected submission schema has no image/video attachments or image annotation. Selecting a DOM element on a website is not the same as marking a photo of a TV.

Source baseline matters: the local checkout is `fc7ffe77e`, while inspected `origin/main` is `0f7bbe195`. The newer feedback contract makes both name and email optional; the older local file still requires a name. Start implementation from a current, isolated branch, not by resetting this dirty checkout or copying stale validation.

Prior roadmap references: `feat-399-watch-native-linear-feedback` and `feat-411-watch-feedback-completion-recovery`. They are completed antecedents, not evidence that this new media/QR flow exists.

## 2. User experience

```text
TV Settings / Help
  → Send feedback
  → QR code + readable short URL
  → Phone form
  → Describe → Add evidence / mark photo → TV context → Review and send
  → Receipt
  → Team receives a Linear issue and approved attachments
```

### TV entry

- Add **Send feedback** under Settings / Help for Apple TV and Android TV/Google TV.
- Show a black-on-white QR with the existing quiet-zone and couch-distance sizing rules, plus a short URL for people who cannot scan.
- Back closes the QR screen and restores focus to the feedback entry. Opening feedback must not clear playback progress or replace Native A, Native B, or the Android player.
- Keep a direct form link in the tester guide/release instructions for cases where the TV app cannot launch. Adding it is a later approved content update, not an automatic Slack announcement.
- Do not replace the existing beta-signup QR. Keep signup and feedback distinct.

### Phone form: four short steps

| Step          | Contents                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. Tell us    | Problem / Confusing / Idea / Praise; what happened; optional expected behavior and whether playback was blocked        |
| 2. Evidence   | Take a photo, choose photos, or choose/record a short video; preview, remove, retry; optional image markup             |
| 3. TV context | Confirm platform and version; affected feature; optional film title, audio language, subtitles, and reproduction steps |
| 4. Review     | Review exactly what will be sent; optional name/email; technical-detail consent; submit                                |

Allow text-only feedback. Attachments and drawing must never be mandatory. Preserve entered text when the user moves between steps or an upload fails. On success, show a generic receipt, not an internal Linear link.

Suggested fields:

- Required: feedback category and description, 10–2,000 characters.
- Platform: Apple TV, Android TV / Google TV, or Not sure. Prefer QR prefill, but allow correction.
- Affected feature: Home, Search, Playback, Audio, Subtitles, My List, Interactive, Other.
- Optional: expected result, reproducibility, film title, timestamp in film, affected language, device model/OS, name, reply email.
- Show condition-specific prompts instead of making all optional fields visible at once.
- Reuse Watch's dark styling and red action color, with large touch targets. The editor should use the phone screen fully, not nest a small canvas inside a modal.

## 3. QR context and identity

Use a stable, short HTTPS feedback URL. Optional query parameters are a strict allowlist of non-secret values: `platform`, `appVersion`, `build`, `screen`, and `player`. Unknown, malformed, and oversized values are discarded. All QR-provided values are **client-reported**, not trusted attestations.

Do not put account IDs, email, access tokens, device-grant codes, watch history, raw errors, or arbitrary diagnostic JSON in the QR URL. Prefer manual film/language context on the phone in v1. A future richer handoff can use an expiring opaque reference, but it is not required to ship the first version.

Keep two context objects:

- `tvContext`: the affected platform/build/player, supplied by the QR or tester.
- `phoneContext`: browser/OS details of the phone used to submit, optional and consented.

Do not label the phone's Safari version, viewport, or operating system as the TV's environment. Missing/old QR parameters must leave the form usable. Use `Referrer-Policy: no-referrer`, no session replay, and no query-string or form-body analytics.

## 4. Photos, videos, and annotation

### Proposed beta limits

These are application policy proposals, **not claimed Linear limits**. Confirm them during the integration spike.

- Up to 3 images, 10 MiB per source image.
- Up to 1 video, 100 MiB and 60 seconds.
- Maximum combined source bytes: 130 MiB per report.
- Images: JPEG, PNG, WebP. Prove HEIC conversion in the deployment image before advertising HEIC support; otherwise provide an explicit JPEG conversion/reselection path.
- Videos: MP4 and MOV. Probe the actual codec and duration. Verify a representative iPhone HEVC MOV and Android H.264 MP4. A bounded worker produces a portable H.264/AAC MP4 when needed; no video editing UI is required.
- Normalize image orientation and strip EXIF/GPS. Limit editor images to a 2,048-pixel long edge. Validate source dimensions before decode and give conversion workers explicit pixel, time, CPU, and memory limits.

### Image editor

Support freehand drawing, arrows, rectangles/circles, and text labels. Include color selection, Undo/Redo, delete selected mark, zoom/pan, and Save/Cancel. Add opaque redaction rectangles so a tester can cover personal information. Avoid blur as a promise of irreversible redaction.

### Mobile mark selection and editing

Make **Draw on photo** a prominent action beside each photo thumbnail. Opening a photo shows it large with a compact toolbar. Tapping a mark selects it and shows a visible outline plus **Move** and **Delete** actions. Dragging the selected mark moves it; dragging on empty photo space while a drawing tool is active creates a new mark. A freehand stroke moves as one object. Text labels can also be edited after selection. Keep **Undo**, **Redo**, **Cancel**, and **Save changes** visible; confirmation returns to a preview of the exact flattened image that will be submitted.

Store marks separately from the source photo while editing, in image-relative coordinates. Pointer/touch hit areas should be at least 44 points, with a larger invisible target around thin lines and arrowheads. Selection must not draw a new mark. Prevent accidental page scrolling while drawing, but allow normal scrolling outside the editor. Before upload, Save replaces the pending image; reopening the editor must retain movable marks until submission. After upload, either permit re-editing by replacing the reserved upload safely or explicitly keep the photo in local draft state until the user confirms it. Never offer a misleading Edit button that cannot preserve movement/deletion.

Acceptance on an iPhone: add three different marks, select the middle one, move it, delete it, undo and redo those changes, then save. The review preview and the final approved JPEG must match. Repeat with a long Thai text label, screen rotation, and a redaction box covering identifying information.

Use a lazy-loaded `react-konva` editor as the initial candidate. Its documented touch/free-drawing primitives fit this scope. Text entry must use a real HTML textarea overlay, including Thai keyboard/IME handling, rather than emulate a text cursor inside canvas. Confirm the dependency version, license, and compatibility with the app's React version before adopting it. Do not build a general design editor.

Store marks in normalized image coordinates during editing, so phone rotation and zoom do not move annotations. Bound point counts, text length, undo history, and decoded dimensions. Open only one full-resolution editing surface at a time.

The preview must show the **flattened, final image** that will enter Linear. Send that version by default, not the original and annotation JSON. Keep a normalized unmarked image as the approved final version when no edits are made. Raw originals stay private during preparation and never go to Linear automatically.

For HEIC normalization and video inspection, temporary server upload may precede editing. Explain this before upload: the file is private temporary processing material, not yet shared with the team. Preserve the distinction between upload consent and the final Send action.

Out of scope for v1: drawing on moving video, screen recording from the TV, automatic screenshot capture across devices, AI analysis of attachments, and automatic duplicate merging.

## 5. Recommended architecture and boundaries

```text
apps/tv: QR screen
             ↓
apps/tv-feedback: mobile form + session/validation endpoints
             ↓                   ↓
      private Railway bucket     feedback Postgres
      temporary media            report + attachment manifest + outbox
             └─────────────┬─────┘
                     bounded worker
                           ↓
                   Linear issue + files
```

- New `apps/tv-feedback`, package `@forge/tv-feedback`, with its own Next.js configuration, environment validation, tests, `AGENTS.md`, `CLAUDE.md`, and Railway configuration. Do not copy Watch's `/watch` basePath/proxy assumptions.
- The new app owns its report/attachment persistence. No change to the admin content GraphQL schema is required. Optional content search can be a follow-up; v1 accepts a typed film title and language.
- Port the small, relevant validation/Linear patterns with source attribution and contract tests. Do not cross-import `apps/web` internals, expose its credentials, copy the entire 1,000+ line modal, or refactor production Watch just to support this feature. A shared package is a later extraction only if both apps need maintained common behavior.
- Use private Railway S3-compatible storage for temporary uploads and normalization. Browser-to-bucket upload is distinct from browser-to-Linear upload.
- Keep an upload/normalization and delivery worker as a separate process from the same app package. A small Postgres outbox and lease-based worker are sufficient; no additional message-broker platform or admin dashboard is needed for v1.
- Read-only settings/schema validation happens at startup. Missing storage/Linear configuration disables submission safely. A public deployment must never silently fall back to local temporary files or an in-memory queue.

## 6. Upload and delivery lifecycle

1. The phone obtains an anonymous, host-only secure HttpOnly session after server-side anti-bot validation. A public QR URL is not an authorization credential.
2. The server reserves bounded upload slots for that session. It issues short-lived, object-specific upload permissions only after checking file counts, declared sizes, quotas, and rate limits. Allow CORS only from the feedback origin. A presigned PUT alone does not prove a hard byte limit: the spike must verify a provider-enforced signed length/policy. If the selected bucket cannot enforce it, use a byte-counted streaming upload endpoint that aborts over-limit bodies instead. Confirm the real edge/proxy limits and lower the advertised file cap if necessary; do not rely solely on checking size after storage has already accepted an oversized object.
3. The phone uploads one file at a time with progress, cancellation, and retry of that file. Do not send media as base64 inside JSON or enlarge Next Server Action limits to carry video. A failed upload must not restart successful files.
4. The backend verifies actual bytes/type/size, malware result, dimensions/duration and normalized output. Do not trust extensions or browser MIME. Serve no unvalidated file as an active document. Use private storage and safe response headers.
5. Seal the verified object under a new server-owned key/version that the upload URL cannot overwrite. Store checksums and the server-owned attachment manifest. Rendering, validation, and delivery must all read the same sealed object, not an object an unexpired upload URL can replace.
6. The tester edits photos and reviews final evidence. Final edited uploads undergo the same validation. Removed attachments become inaccessible to the report and enter cleanup.
7. Send commits the report and outbox job in one transaction. Enforce a session-bound idempotency key and payload hash. Repeating the same request returns the same receipt; reusing its key for a different payload is rejected.
8. The worker creates the Linear issue, saves the issue ID, then uploads/attaches the approved files. It persists each successful asset/attachment before proceeding. Retrying a failed file never creates another issue.
9. The UI distinguishes **Received / processing evidence**, **Delivered**, and **Needs attention**. Received means our durable store accepted it, not that Linear already has every attachment. Do not silently drop a failed file or show full delivery while media remains pending.
10. The worker and cleanup jobs recover after restart. Use bounded retries with jitter, provider rate-limit signals, lease ownership, and explicit retry exhaustion. Alert on stale queued work; a healthy web process alone does not prove delivery is running.

### Linear-specific requirements

The official upload guide documents `fileUpload`, followed by a **server-side PUT** using all returned upload headers. The resulting `assetUrl` can be referenced in the issue's Markdown. Do not give a phone a Linear API key or promise direct browser-to-Linear PUT support. Linear's stored files require authentication; keep private issue IDs/URLs and asset URLs out of public receipts.

Create one issue per submitted report in an approved TV beta project, with a title such as `[TV beta][Apple TV][Subtitles] English captions disappear after seeking`. Include category, actual/expected behavior, reproduction context, approved TV details, separately labelled phone details, approved evidence, and optional reply address. Team/project/labels are server-controlled, never request parameters. Let humans assign severity and consolidate duplicates.

Distinguish an uploaded binary from an external-link attachment. Use private `fileUpload` assets for evidence. Where `attachmentCreate` is used, reuse the same asset URL and issue ID so retries update the same attachment, as documented by Linear.

**Ambiguous issue creation is not an ordinary retry.** If Linear may have created an issue before a timeout or worker crash, mark `delivery_unknown` and reconcile the persisted report reference before creating again. Prove client-assigned issue IDs in the current schema during the spike if choosing that strategy. Otherwise, hold ambiguous creation for bounded lookup/manual resolution. Do not claim exactly-once external writes based only on a local database key.

## 7. Proposed service contracts

These paths are provisional and owned only by the new service. Route Handlers are justified here by media/session transport and explicit mobile/TV boundaries; they are not a broad migration of existing Watch Server Actions.

| Endpoint                                  | Purpose                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `POST /api/feedback/session`              | Verify anti-bot token and establish a bounded anonymous upload session     |
| `POST /api/feedback/uploads`              | Reserve a slot and return a short-lived upload permission                  |
| `POST /api/feedback/uploads/:id/complete` | Verify ownership and schedule validation/normalization                     |
| `GET /api/feedback/uploads/:id`           | Owner-only processing state and permitted preview                          |
| `DELETE /api/feedback/uploads/:id`        | Remove a draft attachment and schedule private cleanup                     |
| `POST /api/feedback/submissions`          | Validate and atomically accept one report and its frozen evidence manifest |
| `GET /api/feedback/receipts/:ref`         | Owner-scoped generic delivery status, never internal Linear details        |
| `GET /api/health`                         | Deployment health without reporting secrets or queue contents              |

Suggested persisted records: `FeedbackReport`, `FeedbackAttachment`, `FeedbackDeliveryJob`. Draft attachments belong to the anonymous session until submission atomically binds them to one report. Record normalization work durably as well as delivery work; a restart must not strand a file at “processing.” Keep reporter content out of job logs; store identifiers/checksums/status separately. Upload IDs belong to one session/report and cannot be swapped between reports. A receipt reference alone must not enumerate reports or fetch private media.

## 8. Privacy, spam protection, and retention

- Server-validate Cloudflare Turnstile tokens. They expire after five minutes and are single-use, so use an upload session after initial validation and a fresh token at final submission instead of reusing an old token throughout a long edit.
- Add persistent, atomic request limits and byte budgets per session, trusted client-IP bucket, and globally. Account for shared/carrier IPs. Bound concurrent uploads and processing jobs; pause new media admission when the budget is exhausted, with a clear message.
- Preserve the honeypot as an additional layer. It is not sufficient protection for file upload.
- Apply exact-origin/CSRF checks, host-only SameSite cookies, strict CORS, bounded input, Markdown escaping, and no user-chosen Linear destination or arbitrary URL fetching.
- Only the server/worker holds Linear and bucket credentials. Use dedicated least-privilege beta integration credentials; no secrets in `NEXT_PUBLIC_*`, QR data, telemetry, source maps, or mobile bundles.
- No SVG, HTML, executable, or archive uploads. Validate content signatures and decode in a restricted, resource-bounded worker. Check upload limits at authorization, storage completion, and before processing.
- No session replay or analytics that collect text, email, image contents, signed URLs, or upload tokens. Record only safe status, latency, count, and byte metrics.
- Proposed retention, requiring owner approval: abandoned uploads expire within 24 hours; delete source originals after an approved flattened replacement and successful processing, with a 24-hour backstop; successful staging copies expire within 24 hours of confirmed Linear delivery; failed delivery evidence is retained at most 7 days for recovery. Keep receipt metadata for 30 days after the beta. Linear's own copies follow an explicitly approved workspace retention/deletion process and do not disappear when the staging copy is deleted.
- Add a short privacy notice and optional reply permission. Explain who reviews the feedback and discourage photos containing people, private conversations, or account details. Do not promise an automatic email reply in v1.

## 9. Implementation slices

| Slice                           | Work                                                                                                                                           | Exit evidence                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0. Design and integration spike | Review mobile wireframes, domain/Linear destination, actual upload limits, codec support, editor touch behavior, and ambiguous-create handling | Approved form flow; a fixture attachment visible to the intended team in a non-production Linear project |
| 1. Standalone form              | New app and local conventions; four-step English/Thai form; safe QR parameter parser; optional identity; text-only receipt flow                | Mobile form works without Watch or Linear credentials in the browser                                     |
| 2. Private evidence and editor  | Upload sessions, quotas, validation, normalization, annotation, flattened preview, cleanup                                                     | iPhone and Android photos/video survive upload and retry; image text/marks export correctly              |
| 3. Durable Linear delivery      | Report/outbox, worker lease/retry/reconciliation, approved issue mapping, media upload                                                         | Issue, images, and playable video verified after a worker restart and a simulated provider failure       |
| 4. TV entry and release QA      | Settings QR in both TV apps; Back/focus behavior; no player-layout changes; feature switch                                                     | Physical Apple TV and Chromecast/Android TV QR scans open the correct form on real phones                |
| 5. Limited beta                 | Approved deployment through PR-to-main, small tester cohort, retention and alert checks                                                        | Real report receipts reconcile with Linear; no missing evidence or duplicate retry issues                |

Internal text-only slices are milestones, not a substitute for the requested photo/video/annotation release. Estimated effort: roughly 10–15 engineering days for one engineer, including integration and physical-device QA, excluding waits for accounts, review, domain provisioning, or unexpected codec/provider limitations. Re-estimate after slice 0.

Suggested file map:

```text
apps/tv-feedback/src/app/tv/page.tsx
apps/tv-feedback/src/app/api/feedback/...
apps/tv-feedback/src/components/FeedbackWizard.tsx
apps/tv-feedback/src/components/EvidencePicker.tsx
apps/tv-feedback/src/components/ImageAnnotationEditor.tsx
apps/tv-feedback/src/lib/contracts.ts
apps/tv-feedback/src/lib/qr-context.ts
apps/tv-feedback/src/server/{session,rate-limit,storage,linear,repository}.ts
apps/tv-feedback/src/worker/{delivery,normalize,cleanup}.ts
apps/tv-feedback/prisma/schema.prisma
apps/tv-feedback/railway.toml
apps/tv/app/feedback.tsx
apps/tv/src/lib/feedbackUrl.ts
apps/tv/src/components/feedback/FeedbackQrScreen.tsx
apps/tv/src/components/settings/SettingsScreen.tsx
```

No app files listed above are created by this plan. Implementation should add app-specific CI commands, update the lockfile, and verify Railway's actual Config-as-code Path. Production publication stays on the normal reviewed PR-to-main path.

## 10. Acceptance and test plan

- A real Apple TV and a connected Chromecast/Android TV display a scannable QR at couch distance. Remote Back restores Settings focus. No simulator-only sign-off.
- iPhone Safari and Android Chrome finish the form in portrait and landscape, with an open keyboard, large text, safe-area insets, and a slow/mobile connection.
- A QR's TV platform/build survives opening on a different phone OS. Tampered context does not affect authorization, attachment ownership, or Linear routing.
- Camera, photo library, MP4, MOV, orientation metadata, unsupported HEIC/codec, oversize, corrupt, renamed executable, and invalid duration each have explicit outcomes.
- Thai text annotations retain composition, positions, and font rendering after export. Rotate/zoom, draw, move, undo, cancel, reopen, and submit the exact reviewed image.
- Redacted evidence sent to Linear contains no unredacted original or editable layer that restores the hidden pixels.
- Text-only submission works. Failure to upload one file does not lose text or other files. User removal excludes that file from the frozen submission.
- Double tap, back/retry, offline recovery, expired anti-bot token, reused upload ID, cross-session file access, and overwritten upload key are covered.
- Worker crash before/after issue creation, lost Linear response, `429`/GraphQL rate-limit response, expired signed URL, partial attachments, and unavailable storage/DB preserve honest receipt states without blind duplicate creation.
- A received receipt is backed by durable data. A delivered receipt requires confirmed issue creation and all accepted attachments. Private Linear files remain accessible to the intended team, not anonymously.
- Measure phone form load and editor lazy-loading. Proposed target: initial form LCP at or below 2.5 seconds under an agreed mobile test profile; no editor chunk or media request before user intent. The existing Watch page must gain no new initial-load cost.
- Run colocated unit/integration tests, Playwright mobile/desktop flows, production build, lint/typecheck/format, and new TV QR/focus tests. Use local/mocked providers first and an explicitly approved non-production Linear project for end-to-end delivery; never submit synthetic reports to the live Watch form.

Expected commands after scaffolding: `pnpm --filter @forge/tv-feedback test`, `typecheck`, `lint`, and `build`; a scoped Playwright suite for the new app; existing TV test commands for the QR integration. Do not claim these ran during planning.

## 11. Decisions before implementation

1. Confirm the separate app/hostname and who owns its Railway/Cloudflare configuration.
2. Select the Linear team/project, triage owner, labels, and a non-production test destination.
3. Approve the media limits, HEIC/HEVC behavior, and retention policy including Linear copies.
4. Confirm whether anonymous access is acceptable for public beta. Recommended default: no login, optional contact, strong upload admission controls. A QR alone does not restrict access to invited testers.
5. Review the mobile form/editor design before coding. Initial UI languages proposed: English and Thai.

## 12. Research and references

API review on 2026-09-23: Linear's current docs still document the proposed upload and attachment flow. No sunset notice for those operations was found on the reviewed pages. Its GraphQL schema evolves without REST-style versioning; verify deprecations and exact mutation inputs again in slice 0 rather than assuming undocumented fields.

Primary sources:

- [Existing Watch page](https://www.jesusfilm.org/watch)
- [Linear upload flow](https://linear.app/developers/how-to-upload-a-file-to-linear)
- [Linear private file authentication](https://linear.app/developers/file-storage-authentication)
- [Linear attachments and URL-based attachment idempotency](https://linear.app/developers/attachments)
- [Linear rate limits](https://linear.app/developers/rate-limiting)
- [Linear deprecations](https://linear.app/developers/deprecations)
- [Cloudflare Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Railway private storage buckets](https://docs.railway.com/storage-buckets)
- [Konva touch/free drawing](https://konvajs.org/docs/react/Free_Drawing.html) and [DOM-based text editing](https://konvajs.org/docs/sandbox/Editable_Text.html)
- [OWASP file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

Repository learnings applied:

- `docs/solutions/integration-issues/public-watch-server-actions-require-post-aware-edge-routing.md`: a working page GET does not prove form POST or upload ingress works. Verify the real feedback hostname's POST/PUT/CORS path.
- `docs/solutions/platform/yt-video-mapper-backend-app-durable-match-job-upload-poll-process-pattern.md`: uploads need durable state, a running consumer, cleanup, and explicit terminal states. Use the pattern, not a cross-app import or the mapper's buffered-upload shortcut.
- `docs/solutions/integration-issues/yt-video-mapper-multipart-upload-empty-complete-polling-contract.md`: transport envelopes are not media bytes; use explicit status and enforce actual byte limits.
- `docs/solutions/platform/adding-new-apps.md`: workspace globs already include a new app; Railway must actually use the service's declared config path.
- The skill's expected `docs/solutions/patterns/critical-patterns.md` file is absent in this checkout. Existing app/root conventions and the relevant documented solutions above were used instead.
