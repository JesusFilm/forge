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

## Bounded full-output retention

PR #2775 adds `retain-part` uploads for the 128MiB output budget. The VM sends
at most eight 16MiB parts through Manager's normal asset broker. Each private
archive records the exact issued attempt/lease/input/profile, whole output
digest/size, ordered index/count and the persisted absolute transfer deadline.
Admin grants expire at that same deadline; storage assembly requires all parts
to agree and uses their remaining allowance for reads and registrations. Neither
later parts nor retries receive a fresh upload window.

Final retention sends references and codec proof only. Admin verifies immutable
part bytes internally and normally registers the render, proof and manifest.
A partial result becomes a failed settlement preserving registered references.
Read-only receipt recovery can return the exact already committed execution
before the local window check; it cannot record another execution or renew a
lease. Keep unresolved worker journals and output until canonical receipt and
publication upload outcome are confirmed.

The complete revision-21 output is now independently decoded and canonically
retained: attempt `cmvbzdb8z0001rut7o9g83y4u`, 8856 frames, 295200ms video,
complete 48kHz stereo AAC and 106,963,325 bytes. Mux upload completed. Its first
single-request upload hit Cloudflare HTTP 413, so the exact verified bytes were
recovered through normal canonical services during the original issued lease.
That operator recovery qualifies the renderer and repaired source data; it does
not qualify automatic bounded transport. For transport-only changes, replay the
captured verified bytes through the actual public bounded path as a separately
retained artifact, verify its complete digest internally, and confirm the
original successful execution and revision remain unchanged. Do not finish
another result against that original lease or reset its journal/window.

If a main CI failure leaves Manager's Railway deployment `SKIPPED`, a successful
retry does not revive that deployment. Preserve the failure evidence, resolve or
revalidate its cause, and use a reviewed normal PR/main delivery touching this
service's watched source/runbook. Confirm the resulting deployment's actual
commit and health. Direct Railway redeploys and local source publication remain
outside the normal release path.
