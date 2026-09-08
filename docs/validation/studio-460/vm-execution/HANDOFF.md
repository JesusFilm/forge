# VM execution handoff

Status: local implementation and review in final validation; full feat-460 remains in progress. Fixed base `5f460b6daf3b7f43b389925e25604babcb43099a`, root-equivalent `f9e7165c358dbd622429ba94f663a9f0b9dc02b2`. No predecessor commits belong in this implementation sequence.

## Changed seams

- `apps/admin/prisma/migrations/0093_studio_render_worker_assignment` and existing render jobs/RPC: immutable dispatch/pool/worker assignment, transactional single-worker admission, exact historical lookup and replay. Schema generated normally; no GraphQL schema change.
- `apps/manager/src/app/api/studio/render-pool/[action]/route.ts` and `studio-render-pool-*`: dedicated worker authentication, canonical claim/input/owns, bounded retained output, signed exact terminal record, finish and read-only receipt. Generic auth never grants pool authority. Existing asset registration/retention and lease evidence are reused.
- `apps/studio-render/src/vm/*`, `native/vm-watchdog.c`: host-only poller/controller, durable journal and original boot/deadline, one-time Docker operations, exact retirement before API recovery, separate verifier and bounded retained output. No nested proc mount or container credentials/network.
- `apps/studio-render/Dockerfile`: `render-job` and `verify-job` targets reuse exact reviewed codec/runtime bytes. Legacy default remains distinct. Host installation/update/rollback scripts are in `ops/`; these do not publish or enable production.

Manual/scheduled publication and calendar interfaces are unchanged by this VM phase. Mux readiness stays separate from render completion. Production control remains default-off, and no new publication authority is created.

## Evidence and validation

See README for exact image/bundle identities, successful versus failed intermediates, live membership and cancellation/restart/OOM/update qualifications. Existing full231s proof is not silently relabeled as a new VM run. Current final bundle was started idle, rolled back idle and left selected/drained; actual composition evidence uses its preceding host bundle with unchanged container images. Review fixes have separate focused actual watchdog and syscall evidence.

Independent Standards and Spec reviewed the entire WIP against the fixed base, including new files, then cleared targeted recovery fixes. Spec also cleared final evidence/runbook claims. The source used typed retries and shared final settlement authorization after review. No visibility/source/member/provider acceptance was replaced with callback tests.

Completed tests: Manager964 pass/2 skipped; Admin6175 pass/190 skipped/1 todo with two fixture-environment failures and three blocked telemetry errors, then affected76 pass with corrected owned configuration; renderer startup2 pass, node45 pass/10 skipped with two legacy guard-mount qualification failures, then focused2 pass; VM34 pass; contracts20 pass; installer bundle2 pass. Admin/Manager/contracts typechecks and changed TypeScript lint pass. Migration0093 applied to the fresh owned through0092 database; assignment/lease tests include15-pass final log. Manager production build passed, including `/api/studio/render-pool/[action]`, after the explicitly documented generated-worker guard qualifications. Admin production build passed, including both recommendation and calendar workflow verifiers. Authoritative Manager session45669 exit0; Admin session24791 exit0. The intentionally stopped compiler qualification sessions19581 and14983 exited143; they are not successful builds. The implementation commit uses normal repository hooks; final SHA and hook outcome are supplied with the handoff.

## Current owned state and external gates

Dedicated VM `forge@10.2.1.100`; pinned SSH remains intact. Docker has no TCP listener. Final bundle `cedd3e68111bdc2361de8a5ecd53ffa3d8fc588f76ffd31034f5977a8e18fe48` selected, service drained/inactive/disabled for boot, no remaining job containers. The stopped `/buildx_buildkit_studio4600` builder remains retained (PID0); it is not an executing job. Configuration is owned loopback fixture only; not enabled for boot/production. Retained fixture videos are Admin local `.tmp/media-assets`; no production bucket qualification follows.

Preserve `/home/tataihono/.cache/forge-studio-460-vm` and the active worktree `/home/tataihono/.cache/forge-studio-460-image-worktree`, VM releases/images and owned databases. Small journals intentionally remain; unresolved journals must never be deleted to admit work.

Next named production steps require root/user release coordination: durable codec supply; reviewed hosted CI build/publish workflow and approved digests; approved outbound VM pull and host bundle installation; scoped HTTPS endpoint/key configuration and real transport/deadline qualification; durable Admin bucket write/read-after-restart; explicit activation/rollback; actual Mux/readiness/public Watch acceptance. Normal release is PR-to-main. No image publication, paid provider call, production connection, Railway change, support contact, push or merge occurred in this phase.

The user's requested hosted CI/release integration remains part of the overall
goal, not delivered by this runtime handoff. Only `ci.yml`, `issue-labels.yml` and
`rag-pages.yml` currently exist. After this handoff, prepare the concrete reviewed
image/bundle publishing and VM release integration as a separate bounded change;
external publish, registry push, production pull/configuration and enable actions
remain held until named approval. This final build cycle does not implement CI.
