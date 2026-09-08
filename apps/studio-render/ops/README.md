# Dedicated VM installation and release contract

This host supervisor is trusted and holds Docker authority plus one scoped worker key. Renderer and verifier containers receive neither. The selected model is outbound HTTPS polling from the dedicated VM; no public/LAN listener, Docker TCP socket, host proc bind or nested proc mount is required.

## Release inputs

A reviewed PR merged to main must produce two approved linux/amd64 OCI images from the `render-job` and `verify-job` Dockerfile targets, plus a host bundle. The source-only hosted workflow is prepared in `.github/workflows/studio-release.yml` and defaults disabled. `release/README.md` defines its exact candidate approval, durable supply, host acquisition and inactive selection contract. No hosted run or artifact publication is established by that preparation. Do not install a self-hosted arbitrary PR runner on the rendering VM.

The image recipe requires the checksum-verified retained codec context described in `apps/studio-render/IMAGE.md`. The original archive is absent; the supported versioned archive has a 14-day upstream retention policy. A durable approved CI artifact supply remains a release dependency; the prepared workflow requires an explicitly provisioned immutable codec OCI digest and has no expiring-URL fallback. Never silently substitute latest or a different codec. VM registry credentials are used only by an approved host release operation and must stay outside authored jobs. The separate hosted codec-reader and publisher jobs use their scoped CI package permissions.

Build the host bundle with `package-supervisor.py --node <reviewed-linux-node> --watchdog <compiled-vm-watchdog> --output <archive>`. Compile `native/vm-watchdog.c` with `gcc -O2 -Wall -Wextra -Werror`. Record source commit, toolchain, archive SHA256, manifest and image digests together. The packager performs no publication, image pull or activation.

## Install without dispatch

Install Docker from its verified official Ubuntu repository on the dedicated VM. Keep its Unix socket root-only, no TCP listener, and use bounded logs. Preserve pinned SSH access. The VM requires unified cgroup v2 with writable trusted host control, systemd, no swap, and sufficient space for bounded job files and two approved image releases. Jobs remain 2 CPU, 2 GiB memory, zero swap, 128 aggregate tasks and 96 untrusted child tasks.

Preload only approved image digests as an explicit release step, then verify their local identities. Execution uses `--pull=never`; missing images refuse admission. Do not perform registry acquisition during a claim.

Run `sudo python3 install-supervisor.py <bundle> <approved-sha256>`. It verifies one bounded immutable archive snapshot, validates every member, writes an inactive root-owned release under `/opt/forge-studio/releases/<sha>`, and fsyncs files/directories. Installation does not enable or start the service.

Create `/etc/forge-studio/worker.json`, root-owned mode0600, with exactly these fields: `version:1`, `enabled:false`, `endpoint`, `token`, `poolId`, `workerId`, `fixtureHttp:false`, `renderImage`, `verifyImage`. The endpoint is the approved HTTPS Manager origin plus `/api/studio/render-pool`; redirects are refused. The sole HTTP exception is explicit fixture configuration on literal127.0.0.1. Never put configuration secrets in shell arguments, evidence or images.

Manager requires `STUDIO_RENDER_POOL_ID`, `STUDIO_RENDER_WORKER_ID`, a dedicated `STUDIO_RENDER_WORKER_KEY`, and a separate `STUDIO_RENDER_CAPABILITY_KEY`. `STUDIO_RENDER_POOL_ENABLED` defaults false; Admin production controls remain canonical. Generic Manager keys, user OAuth and browser cookies do not grant pool authority. Migration `0094_studio` extends existing issued leases; it does not create a second job registry. Apply it through the reviewed normal release process before enabling new assignments.

## Drain, update and rollback

`sudo python3 switch-supervisor.py <installed-approved-sha>` verifies installed bytes and locally available images, durably requests drain, waits for the old daemon, validates all assignment journals are complete, then switches the current symlink and service unit. It leaves the service inactive and drained. The drain wait is bounded1200s; unconfirmed work refuses switching. Adding `--activate` is an explicit configured-worker activation, not permission to connect production.

Rollback uses the same command with the prior approved installed SHA. Keep old releases and exact image digests available until all issued work and rollback requirements are satisfied. A running assignment retains its original digest, boot identity, lease and absolute deadline. Updating must not reset its900s allowance. Successful switching alone does not authorize enabling boot startup or production controls.

The daemon owns an exclusive flock. Before configuration/API access on restart it reconciles exact labeled container identities, physically retires work and preserves uncertain operations. A native systemd-owned watchdog survives daemon death. Its precreated pinned cgroup cannot be recreated after readiness; expired restarts remain frozen until trusted retirement. VM reboot quarantines old monotonic deadlines. Never delete malformed/torn journals to regain capacity.

## Settlement and operational limits

Render and separate verifier share the original900s cumulative execution deadline. Input preparation is bounded90s; upload10s; post-execution retention45s and terminal recording15s share one persisted60s window inside the1200s lease. The verifier receives only the admitted bounded MP4 and immutable expected metadata. Native cleanup1s and host retirement2s are explicit bounds, not new execution time.

Canonical cancellation or reassignment prevents output admission. Known partial/late assets remain attached to their exact issued lease. A signed terminal record is persisted before finish; lost responses recover through exact receipt reads without re-rendering or re-registering. `execute:true` on claim replay means eligibility to resume the same assignment, never permission for another container start. Unconfirmed settlement preserves journals and closes admission. Key rotation must retain terminal-signature verification compatibility; ordinary code rollout must not invalidate historical receipts.

Large local job artifacts are pruned only after exact physical retirement and canonical receipt. Small immutable journals are retained for reconciliation; monitor disk and use a separately reviewed archival policy before storage is exhausted. Failed or unresolved work is not success. Manual cleanup is never automatic timeout proof.

## Gates still requiring named production approval

The owned VM fixture is not a production deployment. Before production: provide durable codec supply, reviewed hosted CI publication and immutable digest approvals, approved VM image pull/bundle installation, scoped HTTPS endpoint/key provisioning, durable Admin bucket write/read-after-restart verification, and named activation/rollback checks. The existing `RAILWAY_S3_BUCKET` stores originals at `media-assets/{assetId}/original/{filename}`; absent bucket uses local `.tmp/media-assets`, as the fixture does.

Actual Mux/provider readiness, public publication/Watch acceptance and the remaining creative/ElevenLabs gates stay distinct. No paid calls, production connection, image publication, Railway changes or support contact were performed by these scripts or the VM qualification.
