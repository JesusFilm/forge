# Studio rendering and immutable Watch publication

Implementation base: `4ee4f716` (reviewed root `424de1de`, patch-equivalent).
Ticket: `docs/roadmap/media-generation/feat-460-studio-render-publication-watch.md`.

## Scope and verification boundaries

1. Dedicated credential-free execution service: immutable bounded inputs, fixed
   runtime, real composition export, kernel resource limits, process-tree cleanup,
   cancellation and restart. Test its native supervisor and HTTP job boundary with
   actual processes and Chromium; generated code never runs in the broker.
2. Admin canonical render admission, durable leases/fencing, retained results and
   verified output identity. Test through public services against an owned local
   PostgreSQL instance on port 55460, never sibling or shared databases.
3. Signed-only Mux reconciliation and hidden catalog staging, followed by one
   publication command for manual and scheduled invocation. Project then slot is
   the lock order. The trusted schedule hook checks immutable prior human
   authorization, current membership/revocation, due instant, version, binding,
   cancellation and consumption in the publication transaction. Calendar schema
   remains feat-461. Provider work never holds a database transaction.
4. Permanent first-publication latch, immutable catalog content, unpublish-only
   lifecycle, real Watch route/playback and revocation. Test public reads and
   playback access independently of stale page caches and already-issued tokens.
5. Production builds, browser/performance evidence, appropriate full suites and
   independent fixed-base Standards/Spec review before hooks-enabled commits.

The ticket and release explicitly authorize these TDD seams. Develop one failing
behavior and implementation slice at a time. Do not substitute metadata-only or
mock provider evidence for actual output or deployed containment acceptance.

## External acceptance boundary

No provider spending, shared/production writes, provisioning, deployment, support
messages, push or merge are authorized. Prepare exact bounded external steps while
completing independent local implementation. A disabled renderer is not completion.
Actual Railway containment and Mux playback/revocation require separate authorized
execution. Feat-458 creative-quality/ElevenLabs acceptance remains outstanding.

Use the reviewed FFmpeg archive SHA-256
`da49baa2fd544ac090fa8adac19d2d6d1f781e75556c4f95dcc0a4f2dd22b1a6`,
version `n9.0.1-27-g9b0578816c-20260907`; preserve historical 456 evidence.
Detailed earlier preparation: `/tmp/forge-studio-460-prep/handoff.md`.

Reviewed prerequisite alignment during WIP: root `89c1eed0` then `44e3d36e`
incorporated as `5db44190` and `d3ec2edd`. Later reviewed prerequisites and the
separately reviewed internal scheduler hook are also incorporated. The final
independent 460 review base is **4109b02c31242f1b0ca8c4975b6fada0eb2f3d87**.
Exclude all those prerequisites from the final implementation sequence. Uncommitted
work was preserved; no sibling WIP was imported.
