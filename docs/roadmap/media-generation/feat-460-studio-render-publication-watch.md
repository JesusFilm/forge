---
id: "feat-460"
title: "Studio render and immutable Watch publication"
owner: "tataihono"
priority: "P1"
status: "in-progress"
start_date: "2026-09-07"
duration: 5
depends_on:
  - "feat-456"
  - "feat-458"
  - "feat-459"
blocks:
  - "feat-461"
tags:
  - "ai-pipeline"
  - "manager"
---

## Problem

Rendered media must become an approved immutable catalog item visible on Watch, with no stale-render or alternate-mutation path around publication rules.

## Entry Points — Read These First

1. `docs/plans/2026-09-07-001-feat-studio-video-authoring-plan.md` — full contract, rollout and verification design.
2. `apps/shorts-worker/src/`
3. `apps/manager/src/workflows/shortsStudio.ts`
4. `apps/admin/src/services/studio-authoring/ (proposed)`
5. `apps/admin/src/services/revalidate-webhook.ts`
6. `apps/web/src/`

Paths marked proposed do not exist yet. Frontmatter dates/durations are planning placeholders, not delivery commitments.

## Grep These

- `propsHash|renderMedia|mux_processing|publishedAt|restrictViewPlatforms|revalidate`

## What To Build

1. Render an immutable input snapshot with versioned code, exact asset dependencies, verified bytes and retryable job identity; reconcile Mux processing separately from MP4 completion.
2. Stage hidden catalog records and use a durable publication intent plus atomic Admin revision/approval/readiness checks to publish once. Do not hold DB transactions during external calls.
3. Allow all pre-publication edits and invalidate stale release approvals/results. Permanently deny edits, correction clones, replacements and republishing after first publication, including generic Admin routes.
4. Implement unpublish-only post-release behavior and update Watch/cache/search/route-manifest visibility and source-related reads. Add a usable Watch destination, not only a database row.
5. Keep draft playback/download authorized and prove generated-output playback policy respects unpublication; never persist expiring signed playback URLs as canonical identifiers.

6. Revalidate referenced source access/platform restrictions at publication so generated Video identities cannot make restricted source material publicly watchable.

## Constraints

- No direct social posting or mobile UI work in this release.
- Job completed, Mux ready and published are distinct states.
- Do not revive the legacy date-keyed Workspace workflow as the new product authority.

## Verification

- Real worker container render -> verified storage -> Mux readiness -> Forge -> Watch smoke with matching source metadata and audio/subtitles.
- Race edit versus publish; duplicate callbacks/retries; restart recovery; cross-route immutable edits and unpublish public access checks.
- Watch production build, visual playback smoke and page-load performance measurements.

## Implementation checkpoint (2026-09-08)

Local implementation, independent fixed-base review and validation are documented
in `docs/validation/studio-460/HANDOFF.md`. Migrations0083–0087, final same-release
scheduled adapter and canonical manual publication are owned here; calendar owns
0088 onward. Follow-up reviews resolved the lease lock-wait expiry and actual
search-projection discoverability findings. Existing Watch/preview behavior and
loading have matched local evidence.

Status remains in progress: exact OCI-image/deployed containment and real Mux
acceptance require separately authorized external steps. The local rootless image
builder's missing privileged UID/GID mapping helpers do not waive runtime proof.
No provider, infrastructure or production operation is authorized by this entry.

## Dedicated VM checkpoint (2026-09-09)

The user selected and authorized the dedicated Proxmox VM at10.2.1.100. The
outbound scoped pool gateway extends canonical leases with reserved migration0093;
calendar ownership remains0088–0091. The VM runs one credential-free disposable
render container and a separate verifier under the original cumulative deadline.
Actual render/retention/finish, cancellation, supervisor restart, OOM recovery,
watchdog expiry restart and drain/update/rollback evidence is recorded in
`docs/validation/studio-460/vm-execution/README.md`. Installation and future
PR-to-main release inputs are in `apps/studio-render/ops/README.md`.

The earlier OCI nested-proc failure remains historical evidence; the selected VM
uses outer OCI namespaces and preserves masks. Production connection, durable
codec publication/storage qualification and actual provider acceptance remain
open. This checkpoint does not mark full460 complete or authorize production.

## Hosted release preparation checkpoint (2026-09-09)

The default-disabled hosted candidate/publisher workflow and trusted root-selected
inactive VM update/rollback tools are specified in
`apps/studio-render/ops/release/README.md`. Local focused validation and independent
review are recorded in `docs/validation/studio-460/hosted-release/README.md`.
Actual environment/reviewer setup, durable codec supply, hosted image/bundle
qualification, publication and named VM/production activation remain external
gates. Source preparation does not waive full460 provider/storage/public-release
acceptance or mark this ticket complete.
