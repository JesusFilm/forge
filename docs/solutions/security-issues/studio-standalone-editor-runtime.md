---
module: Studio
problem_type: integration
tags: [studio, nle, remotion, isolation, revisions, interactive-authority]
---

# Standalone Studio operator runtime

Validation and reproducible harnesses: `docs/validation/studio-456/README.md`.

## Trust boundaries

Manager's same-origin cookie endpoint accepts a bounded strict command envelope.
It obtains the human user from authenticated transport, signs the exact UTF-8
request digest with a 60-second Ed25519 assertion, and sends it to Admin's
`/api/studio/interactive`. Admin verifies issuer, audience, environment, key ID,
lifetime and digest, then loads current operator membership. The resulting
`Principal.studioAuthority = interactive` is internal; payload flags and
user-owned delegated OAuth tokens cannot set it. Human attribution stays separate
from review authority for approval, unpublish, experiment admission and internal
publication. Hosted/tool adapters must consume the same canonical commands with
delegated authority, never this session issuer's signing key.

## Source admission and reuse

Canonical source selection pins video, dub, edition, language, subtitle track,
selected full-resolution download and immutable asset identities. A descriptor
has no byte proof. The Manager broker stages overlapping HLS segments from the
canonical allowlisted catalog URL, verifies codec/dimensions with ffprobe and
decodes the selected bounded media with FFmpeg 7.0.2. It registers both preview
and full-resolution manifests before trusted Admin materialization. No MP4 render
or whole-film download is required for preview.

Materialization produces a new immutable snapshot. Its manifest refers to the
original admission snapshot; reuse resolves that canonical parent and compares
catalog digest, selected download and exact source identity. Registered codec
provenance alone is human-writable, so reusable proofs carry an HMAC over the
manifest digest and canonical proof metadata. Changing the dedicated broker key
requires re-verification. Preview playlist and segment bytes are hash-read from
registered storage for every session. Aggregate transfer accounting includes
image, audio and component bytes. The broker admits one preparation per process,
bounds segment counts and transfers, and times out fetches and codec commands.

Canonical VTT bytes remain unchanged. Selected-range parsing accepts the actual
catalog's one-digit hour form, rejects unsupported markup within the used range,
and ignores distant cue markup. Admin's canonical source resolver digest-reads
the retained track and validates every range for create/apply/render admission;
expansion through an agent or render path cannot bypass validation by avoiding
preview. The real-PostgreSQL regression covers unchanged digest, valid admission,
and rejection through apply and render-source resolution.

## Preview deployment contract

Build/start `@forge/studio-preview` on a dedicated HTTPS registrable site, different
from Manager. A Manager subdomain or srcdoc is insufficient. Configure
`STUDIO_PREVIEW_PUBLIC_ORIGIN`, `STUDIO_MANAGER_ORIGIN`, and its dedicated
`STUDIO_PREVIEW_API_KEY`; configure matching Manager public/service URLs and key.
The iframe uses only `allow-scripts`, an opaque sandbox origin and no-referrer.
The preview host serves a fixed compiler/Player bundle and bounded session files.
Generated TSX runs only in the iframe, with the proof's exact React, Remotion,
Sucrase and HLS versions and closed import surface. No server eval is used.
CSP permits only staged media and fixed origin resources; parent messages are
source-bound and parent watchdog removes unresponsive frames. Authenticated Manager requests renew active sessions every five minutes and on
visibility return; failed renewal restages without resetting the editing state.
Replacement, aborted staging, navigation and failure paths release sessions;
fifteen-minute expiry remains the fallback for abandoned clients. Storage/request
counts stay bounded (eight sessions, one staging writer). Local equivalent uses
`studio456.localhost:3456` and `127.0.0.1:3460`.

Production render launcher/resource isolation/export verification is feat-460.
Provision Manager's explicit codec binary paths before deploying this preview
integration. No deployment or production provider/storage writes are part of456.

## Editing and reconciliation

The local editor owns selection/playhead and undo/redo, while canonical Admin
commands persist revision-checked snapshots. A failed network save retries the
same idempotency key and payload, even if later local edits exist. A conflict
shows the saved version; replacement uses the revision actually reviewed. If a
third writer saves meanwhile, replacement conflicts again. Session recovery is
validated before replay. Delayed preview results attach only when the full
requested source identity still matches, preserving subsequent canvas edits.

## Runtime recovery and audio

Only referenced component versions enter a preview session or compile map.
The same active-version identity participates in Manager's preparation signature:
deleting a broken item recovers preview, and Undo/history restoration restages
its code. Declared property edits retain the existing frame and update props.
Compile errors, render errors and the heartbeat watchdog preserve the parent UI.

Remotion 4.0.475's shared audio tag pool compares URLs against `window.origin`,
which is `null` in the opaque sandbox. Set Player `numberOfSharedAudioTags={0}`;
stock Html5Audio then owns its tag and works without weakening iframe isolation.
The fixed runtime bundle is gzip-compressed and content-versioned. Cross-origin
Resource Timing reports zero body sizes without TAO; those zeros are not evidence
of a cache hit. Record encoded response sizes separately.

## Isolated fixture discipline

The existing Admin storage unit suites delete worktree-local `.tmp/media-assets`
and `.tmp` object fixtures. Run full suites before seeding the browser fixture,
or preserve its media separately. The final browser fixture uses its own
`forge_studio_456_browser` database on the task-owned PostgreSQL port 55456;
Studio database regressions use `forge_studio_456_test` on that same disposable
instance. No shared or production database is used for Studio verification.
The pre-existing Redis fallback test assumes loopback 6379 is unavailable; run
that test in an isolated network namespace on hosts with Redis, never stop the
host's Redis to satisfy the test.

Abrupt test-browser termination can bypass unload delivery and retain sessions
until expiry. Final performance fixtures navigate out of the editor and observe
DELETE before closing contexts, outside measured windows. Preserve quota failures
as evidence; after cleanup, an authenticated capacity probe admitted all eight
slots before the ninth returned 429. The native HTTP test verifies expiry with a
clock preload scoped to its own child, leaving production TTL/cap unchanged.
