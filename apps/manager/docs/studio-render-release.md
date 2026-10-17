# Release the Studio render control plane

Manager, Admin and the hosted VM must agree on the current immutable profile in
`packages/studio-contracts/src/render.ts`. A healthy Admin deployment alone does
not prove that Manager has the matching contract. Railway watches
`apps/manager/**` and `packages/admin-graphql/**` for this service; verify the
actual deployed main commit and imported profile before admitting a new render.

## Normal release sequence

1. Drain the existing VM through the trusted switcher documented in
   [`apps/studio-render/ops/README.md`](../../studio-render/ops/README.md).
   Preserve outstanding assignment journals and confirm physical retirement.
2. Merge reviewed source through normal PR/main checks. Wait for healthy
   production Admin and Manager deployments. Confirm the current profile,
   completed retention migration and current project revision using read-only
   checks. A skipped deployment does not establish the new service version.
3. Build and publish the exact merged main commit through
   [`studio-release.yml`](../../../.github/workflows/studio-release.yml).
   Follow the [host release contract](../../studio-render/ops/release/README.md)
   to verify candidate/bundle digests and select the VM release inactive.
4. Activate the selected matching VM through the existing trusted switcher.
   Request a fresh render through `StudioDraftRenderService.request`, using the
   current expected revision and a new idempotency key. Never reset the deadline
   of an old assignment or relabel a failed attempt.
5. Require canonical success, admitted execution, the retained render manifest
   and an independent codec proof. Confirm complete frame count, dimensions,
   frame rate, audio duration and matching output digests. Read the retained
   output through the verified asset service before closing the incident.

Production source changes remain on the normal PR/main path. A failed CI attempt
can leave a Railway deployment skipped even after the CI retry succeeds; verify
the actual deployment rather than assuming that a green retry restarted it.

## Full-project qualification

The v3 profile is
`studio-render-3/3600s-180prep-2cpu-2g-128p-96child-128m`: 180 seconds for
preparation, 3600 seconds cumulative execution and a 3900-second lease. Physical
resource and byte limits are unchanged. Exact historical v1/v2 receipts remain
readable; new execution requires v3.

For `widow-vertical-components-20261016`, the repaired draft is revision 21 and
requires 8856 frames at 1080x1920 and 30fps (295200ms). Code and regression
validation are recorded in PR #2771. Complete production render qualification
is tracked in feat-715, feat-716, feat-721 and feat-722; a successful hosted build
or source repair alone does not complete those acceptance checks.

See the [incident measurements and fixes](../../../docs/solutions/performance-issues/studio-full-render-source-preparation.md)
for source-duration, preparation, ownership contention and frame-buffer evidence.
