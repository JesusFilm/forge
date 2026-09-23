# External-agent workflow release checklist

This is an operator checklist for the normal reviewed PR-to-main release. No
deployment, production migration, paid provider call, or production merge was
performed by the local qualification harness. Current production configuration
has not been certified here.

## Before enabling the workflow

- Require passing final-commit CI, independent review, schema drift checks, and
  the client/UI qualification record. Keep unsupported Claude or browser steps
  explicitly open; a local JSON-RPC probe cannot close them.
- Back up Admin before normal migration deployment. Preserve existing migration
  bytes and apply in order: 0099 render retention profile, 0100 delegated narration,
  0101 immutable render preparation, 0102 immutable render inspection. These
  extend the prior schema; they are not substitutes for earlier migrations.
  Generate Prisma normally. This workflow adds no Pothos schema fields; if the
  final release includes other Pothos changes, regenerate both Admin SDL and
  `packages/admin-graphql` before release.
- Apply the reviewed Auth app/resource/scope seed through its normal process.
  The `shorts-mcp` app/environment, OAuth resource audience, issuer and Manager
  `STUDIO_ENVIRONMENT` must agree. Verify the actual registered client IDs against
  `STUDIO_MCP_CLIENT_IDS` when configured. Require current Operator membership.
- Consent separately to `shorts:read`, `shorts:edit`, `shorts:render`,
  `shorts:narration`, and optional `shorts:instructions:read`. Hosted `shorts:chat`
  is independent and unnecessary for the portable external-agent workflow.
  Existing read/edit tokens do not acquire narration or rendering authority.
- Verify Manager's server-only Ed25519 key ID/private key and Admin's matching
  public keyring. Keep these and backend service credentials out of browsers,
  portable skills, prompts and client configuration. Verify the protected-resource
  metadata advertises the correct issuer/audience.
- Verify durable asset storage and canonical source eligibility. The local
  qualification uses LOCAL files; production storage availability and retention
  must be checked independently. Verify existing voice registrations and music
  provenance; qualification fixture assets must never enter production.

## Runtime and spending controls

- Manager needs actual Next request lifecycle support for narration `after()`.
  Its configured render service URL and private admission key enable the existing
  durable dispatcher. Do not substitute the raw local route host for Next.
- Provision FFmpeg and FFprobe for narration measurement, canonical source
  preparation and lazy rendered inspection. Root Nixpacks supplies the ordinary
  binaries; use the documented explicit `STUDIO_FFMPEG_PATH` and
  `STUDIO_FFPROBE_PATH` when pinned source-proof/runtime requirements apply.
  Missing binaries produce incomplete/unsupported evidence, not audiovisual
  qualification. Verify the configured binaries in the released runtime.
- Verify the existing renderer's admitted profile and deployment qualification:
  2 GiB memory, zero swap, two CPUs, 128 tasks, native isolation, independent
  codec verification, sealed PID1 startup and bounded volatile staging. The local
  exported-service launcher proves render behavior but does not replace the
  image's startup or hosted acceptance checks. This feature does not authorize
  a renderer deployment or a direct Railway release.
  A [local rebuilt-image probe](rebuilt-renderer-image.md) executed both named
  targets against the original composition with unchanged resource bounds and
  independent decoding. Its rootless `runc` environment is distinct from
  Docker-default seccomp and a hosted dedicated VM; carry the image digests into
  normal release validation rather than treating the local probe as a deploy.
- Rebuild and independently qualify the renderer image containing the pinned
  `@remotion/renderer` patch and child startup opt-in. Intermediate audio codecs
  now use one decoder, encoder and filter thread within the existing process
  limits. The Dockerfile copies patches before its frozen install and deploys
  those dependencies, but local native success is not proof of the rebuilt
  sealed image. Record the new image and runtime artifact digests, and rerun
  containment, recovered-browser cleanup and exact codec verification in that
  image. Include simultaneous narration and music in image smoke tests.
- Configure production narration only after explicit operator authorization.
  `STUDIO_PRODUCTION_ENABLED` controls admission; a real ElevenLabs key is a
  spending capability. One initial and one correction pass apply per project
  authoring cycle, with unchanged audio reuse. Extra passes require interactive
  authorization; new music and voice identity work remain separate approvals.
  Missing/unverified rate-card information must remain unknown, never zero.
- Keep publication and Mux ingestion under existing independent controls. Agent
  tools never approve or publish; draft rendering/inspection must work without
  publication or Mux release readiness.

## Smoke, observation and rollback

- In a configured reachable test environment, connect each supported actual
  client through OAuth, install the shipped portable package, and complete a
  brief, render, sampled inspection, exact human handoff and conversation revision.
  Record version, scopes, project/revision/attempt/output identities and modality
  limitations. Paid smoke calls require separate authorization.
- Check disconnect/resume, expired capabilities, stale revision conflicts,
  preservation of human edits, and denied agent approval/publication. A human
  must review the exact output and effective script/voice before approval.
- Record output-ready, evidence-ready, client interpretation and handoff timing
  separately. Rendering and any permitted single repair render are separate.
  Use representative vertical output and disclose cache/network conditions.
- Observe canonical narration admissions/provider claims, unresolved ambiguous
  calls, render leases/terminal outcomes, retained output and inspection cache.
  Do not blindly replay ambiguous paid calls or delete retained evidence.
- If release smoke fails, stop new client admissions using the existing consent/
  client controls and coordinate draining admitted work before reverting code or
  disabling execution settings. Preserve receipts, immutable revisions, render
  leases, assets and migrations. Use the normal rollback/revert PR and deployment
  process; never downgrade by dropping the new tables or rewriting migrations.
