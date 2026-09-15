# feat-462 legacy Shorts retirement slice

Fixed review base: `aa4fc3d8a7989f2e809decfe63c2ace2f22aa51f`.
Root explicitly released this reversible local implementation slice on 2026-09-08.

## Scope

Remove the unused Manager `features/shorts`, `/api/shorts`, legacy Shorts workflows,
client and exclusive helpers. Preserve `/dashboard/shorts`, its navigation and all
`features/video-studio`. Remove legacy worker prepare/render admission and execution;
extract the shared Remotion engine for active devotional consumers. Preserve shared
queues, auth, storage, transfer, compositions and fonts. Remove only reference-free
legacy configuration/provisioning and narrowly obsolete guidance.

Shared-file edits are limited to legacy Shorts hunks in Manager state/types/Mux/env
and worker routes/queue/types/env/build configuration. No calendar, Studio dispatch,
Prisma, new publication/runtime or Admin build-verifier edits. Coordinate any newly
required overlap with root/461 before editing. Root received this initial edit map.

## Verification seams

The authorized behavior-boundary tests cover authenticated HTTP rejection of retired
prepare/render jobs without queue admission, continued devotional admission/dedupe/
cancel/auth behavior, and production startup without retired Whisper/Shorts bundles.
Preserve devotional engine/byte-transfer coverage. Run red before changing these
boundaries, then focused green checks, affected typechecks/builds and final affected
full suites. Tests and temporary files use an owned rootfs TMPDIR; no shared databases,
default Redis, credentials or providers. Deleting unreachable UI modules leaves the
new editor unchanged; assess frontend loading from production route/bundle output
and measure if rendering/hydration/media initialization changes are needed.

Use fixed-base independent Standards and Spec reviewers, resolve actionable findings,
record validation and durable lessons, and commit locally with normal hooks enabled.

## Acceptance remains open

This slice does not complete feat-462. Reviewed final calendar integration, creative
quality, real ElevenLabs, actual image/deployed containment/Mux/Claude Code/Lyuba
operator acceptance, frontend release performance and normal release remain gates.
No paid batches reopen. No stored data or original assets are deleted, no archive
migration or invented compatibility path, no upload/push/PR/deployment. Historic
unperformed acceptance remains unperformed even when a feature is superseded.
