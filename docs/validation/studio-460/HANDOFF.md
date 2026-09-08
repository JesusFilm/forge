# Feat-460 implementation handoff

Status: local implementation and release preparation; **full feature acceptance remains open**. Ticket remains in progress. No provider spending, production writes, infrastructure changes, registry uploads, push, merge or deployment occurred.

## Runtime evidence correction

Both renderer and worker runtime containment qualification is withdrawn: rootless runc created an unbounded sibling cgroup, while the harness exposed bounded launcher-scope files. Actual worker membership proves the mismatch; renderer used the same pattern and had already exited. Historical startup/module/HTTP results remain observations, not bounded execution proof. Build-driver scope bounds also do not prove Dockerfile executor bounds without membership evidence. See `exact-image/README.md` and `runtime-membership-red.json`. Corrected OCI placement and actual process/ancestor accounting are required; no masks or numeric limits are relaxed.

## Resumed local image work

The authorized local image continuation uses reviewed base `bb6ed63f30b326f468fd7eb8cdf866a022db8ffe`, without replaying earlier prerequisites. Newly installed mapping helpers permit the pinned rootless OCI builder. The execution image now builds and starts under native PID1, but its mounted limits did not prove actual bounded cgroup membership; final renderer/Chromium/codec resolution passes. Signed HTTP rendering fails at the fresh child proc mount, with outer OCI protections preserved. Complete child mask replay is also not established by the existing recipe. See `exact-image/README.md` and its read-only boundary assessment; full exact-image and deployed/provider acceptance remain open.

## Integration base and owned scope

Review base: `4109b02c31242f1b0ca8c4975b6fada0eb2f3d87`. All reviewed prerequisites, including the separately reviewed internal scheduler hook, precede this base and must not be replayed as part of 460. This change owns migrations 0083–0087. Calendar461 owns 0088 onward; do not copy its WIP. Normal integration must union any independently reviewed Admin build-script additions.

The implementation adds a private contained renderer, durable lease/partial-output fencing, independent codec proof, durable signed-only Mux processing, hidden staging, canonical manual/scheduled publication, permanent revocation, real Watch resource playback, cache-safe image paths and durable route invalidation. It also preserves preview seeking after shared composition extraction and fixes atomic missing-track insertion in the editor. The solution document is `docs/solutions/security-issues/studio-contained-render-and-immutable-watch-publication.md`.

## Exact calendar consumer surface

- `@forge/studio-contracts/publication`: `studioApprovedReleaseSchema`, `studioScheduledPublicationPreparationSchema`, `studioPublicationCandidateSchema`.
- Admin `src/services/studio-authoring/scheduled-publication-adapter.ts`: `prepareScheduledStudioPublication(raw, signal?)` and `StudioPublicationPreparationError` (`submission: "not-submitted"`). The adapter calls authenticated Manager `/api/admin-trigger/studio-publication` and only observes an existing asset.
- Admin `src/services/studio-authoring/scheduled-publication-adapter.ts`: `publishPreparedStudioProject(db, servicePrincipal, exactEnvelope, consume)` injects the mandatory real catalog verifier into the same canonical command as manual publication.
- The prior human binding contains exact project/revision/approval/render/release, excluding readiness ID. Fresh preparation never substitutes a release or source. Calendar persists the complete returned envelope before submission; accepted/ambiguous retries use that exact envelope and bypass preparation, even after later unpublish.
- Calendar owns current membership/prior authorization, project-before-slot locking, fresh due/window checks, slot version/cancellation and atomic consumption. Scheduler never synthesizes interactive authority. The real verifier's final synchronous predicate rechecks expiry after waits/writes; void fixture verifiers remain compatible but are not real dispatch acceptance.

`scheduled-adapter` native evidence uses a fixture hook and durable envelope file, not calendar schema acceptance. See `scheduled-adapter/README.md` for the actual HTTP→same-release preparation→publication→unpublish→exact retry result.

## Local evidence and limits

- `full-length`: actual 231-second 1080×1920 composition, independent complete decode/frame/audio/custom checks. Render 622.186 seconds, verifier 30.306 seconds; 652.492 seconds combined in separate measured phases. No repeat of the unchanged full fixture for repackaging byte-identical codec binaries.
- `containment`, `pid1-candidate`, `image-local`: native deadlines/teardown, actual Chromium, cancellation/escape pressure, sealed startup record rejection, local OOM unit retirement and fresh namespace recovery. OOMPolicy=stop retired the local unit; this is not in-process OOM recovery or Railway proof. UID/NPROC fallback is hypothesis evidence only; production cgroup128 gate stays unchanged.
- `preview`, `browser-insertion`: matched preview loading, retained Range/HEAD and nonzero audio trim/gain, atomic matching-track insertion, actual visible-text browser→render→decode. Empty earlier fixtures remain explicitly labeled.
- `watch-browser`: actual built Manager→render→signed loopback protocol readiness→publish→Watch playback, six resource URLs before/after revoke, stale DOM denial, ranges/HEAD/no-store. Protocol fixture is not real Mux acceptance. Delivered bytes cannot be recalled.
- `watch-delivery`: actual receiver→emitter→DB strict receipt handling, partial invalidation/restart/concurrent delivery, current-state revocation and Core route preservation.
- `scheduled-adapter`: trusted same-release preparation, final predicate lock-wait expiry and exact accepted retry after unpublish without repeated consumption.
- `loading`: alternating owned baseline/current Manager and Core Watch measurements. Baseline is the fixed review commit with independent frozen dependencies/builds. Network is restricted to owned loopback. Samples do not claim exhaustive device or production performance.

The full Manager suite passed 1,228 tests (two skips); full Web passed 3,700 (one skip, one todo); packages passed 88 tests; seven affected typechecks passed. Fresh empty database replay through 0087 passed, then 112 tests across Studio and Core refresh passed. Default native suite: 13 plus two startup tests pass, seven explicitly gated tests skipped; the actual bounded HTTP service suite separately passes all three, including stalled-reader cleanup. Full Admin passed 6,172 tests (164 explicit skips, one todo), and all five affected builds passed. Final check and qualification logs are in `final-checks`.

Independent fixed-base Standards and Spec reviews found lease-time, discoverability, typed-error and test-cwd issues. Failure-first actual database tests reproduce the two semantic issues. Follow-up reviewers report no remaining actionable findings. The advisory lifecycle-string suggestion was nonblocking: canonical commands remain typed and enforce authority. Review does not waive external acceptance.

## Proposed external steps — not authorized or performed

1. **Retain the codec:** proposed `JesusFilm/forge` release `studio-render-codec-2026-09-07`, original archive asset, exact SHA256 in `apps/studio-render/IMAGE.md`. Record asset ID/size and independently verify downloaded bytes. Do not rely on BtbN's pruned daily URL. This requires explicit upload/release authorization.
2. **Build without publishing on an OCI-capable Linux amd64 runner:** supply the verified named codec context, build the reviewed commit, record image digest and execute the exact-image containment matrix. Local rootless BuildKit cannot mount devpts gid5 with the available single-ID mapping; privileged mapping helpers are absent. No further local builder alternatives are proposed. Runner build authority is separate from registry push/deployment authority.
3. **Dedicated credential-free execution service:** proposed service name `studio-render` in the existing Forge Railway project `98952497-a4d9-4714-8fe8-0cdbff3147c9`, in an explicitly selected nonproduction environment before production release. No service/environment has been provisioned. Require observed 2CPU/2GiB/no-swap/128 aggregate tasks, one-job concurrency, PID1/namespace lifecycle, fixed read-only image paths and bounded scratch. Existing credential-bearing worker limits do not qualify. If Railway cannot enforce PID128, obtain approval for a reviewed enforceable boundary before enabling any renderer; do not ship a permanently disabled renderer as completion.
4. **Private transport and restart:** on that exact service, verify Manager's 920-second private request and 1200-second durable lease under the 900-second cumulative profile, cancellation, broken connections, output pressure, OOM retirement and fresh-container recovery. Public-edge 15-minute behavior is irrelevant. Record effective runtime/image limits and denied network/credentials/mount escape attempts.
5. **Bounded real Mux acceptance:** only after explicit account/environment and spend-cap authorization, ingest one already-verified owned short output with signed-only policy, observe readiness and exact identity, then exercise canonical publication/Watch playback and permanent unpublish through all media forms. Record accepted/lost-response handling without a second automatic creation. Signing/origin/key configuration must be named and reviewed; the executor receives no provider key. No ElevenLabs/LLM batch is reopened.
6. **Release cutover:** deploy receiver support before strict sender, verify private/no-store behavior at public/service-worker/CDN boundaries and current canonical revocation on previously issued resource URLs. Purge only exact affected Studio optimizer keys/origins if historical copies actually exist in that environment. This implementation has not been deployed to production; no preexisting production Studio cache is asserted. Use normal reviewed PR-to-main deployment flow, never local direct production deployment.

Calendar's actual due dispatch/Watch acceptance and feat-458 creative-quality/ElevenLabs acceptance remain separately open. These proposals do not authorize their execution or mark 460 complete.

Final timing qualification: the single agreed idle Manager follow-up did not reproduce the previous 41 ms increase, but host activity and changed timing direction leave end-to-end latency inconclusive. No speedup/no-regression guarantee is claimed; all three samples, CPU/network/long-task evidence and the pre-navigation ENOSPC qualification are retained in `loading`. No further performance retries were performed.

### Local membership correction follow-up

See [cgroup admission](cgroup-admission/README.md) for the failure-first own/unrelated/overlay tests and rebuilt native-image startup evidence, including the preserved misnamed failing log. Startup now binds the actual process to cgroup2 membership and rejects subordinate overlays. The rebuilt own-leaf service starts, but signed rendering remains HTTP422; functioning execution and external acceptance remain open. See [retained worker image](worker-image/README.md) for corrected actual Node/Chromium membership and both bounded composition stills. This is limited HTTP/module/still qualification, not full-video/codec/audio/production transfer. Historical runtime/build claims remain withdrawn.
