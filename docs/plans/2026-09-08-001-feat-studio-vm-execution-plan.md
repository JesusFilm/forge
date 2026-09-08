# Studio disposable execution on the dedicated VM

Status: implementation in progress; feat-460 remains in progress.
Fixed review base: `5f460b6daf3b7f43b389925e25604babcb43099a`, tree `f561c5fa53feca45150150b3182b31ffb848cdfc` (root equivalent `f9e7165c358dbd622429ba94f663a9f0b9dc02b2`). Preserve existing work/artifacts; no prerequisite duplication.

## Authorized target and boundary

Dedicated Ubuntu24.04 VM `forge@10.2.1.100`:4vCPU,8GB,60GB, cgroupv2, no swap. SSH is pinned with the supplied known-hosts file; private key contents never enter tools, image or evidence. Runtime installation and owned fixture testing are authorized. No public/LAN listeners, production API connection, provider calls, Railway changes or image publishing. Production release remains normal PR-to-main.

The VM hosts a trusted supervisor and Docker Engine from Docker's signed official Ubuntu repository. Docker uses a local Unix socket only. Fixed binaries/configuration under `/opt/forge-studio`; root-owned job work and state under `/var/lib/forge-studio`; bounded logs under the journal/owned evidence. Runtime authority and narrowly scoped polling credentials stay on the host, outside every authored-code container. Initial API is an owned loopback fixture; production outbound HTTPS configuration remains disabled.

## Execution changes

1. Replace nested Bubblewrap execution for this selected runtime with one disposable render container. OCI supplies private PID/mount/network namespaces and complete default masks/read-only controls before code. No inner fresh-proc mount, ancestor proc bind, privileged mode or mask removal. Fixed image resources only; read-only exact input, bounded output/work tmpfs, no host runtime socket or credentials. Drop capabilities, prohibit privilege acquisition and namespace escape, use nonroot child execution and hard limits.
2. Preserve2CPU/2GiB/no-swap/128aggregate tasks,96child PID bound,128MiB input/output, one job concurrency. Prove actual host membership and effective hierarchy for init/Node/Chromium/codec processes. Use independent native/runtime watchdog enforcement and confirmed whole-container cleanup for cancellation, timeout, OOM and supervisor restart; a stopped client is not proof the container stopped.
3. Run the unchanged independent pinned codec verifier in a separate fresh credential-free container after render exit, receiving only exact output bytes and immutable expected dimensions/duration. Render and verification share the original900-second monotonic execution deadline, including staging and delivery; no fresh verifier allowance. Preserve native1-second cleanup/2-second retirement policy and explicit unsuccessful cleanup. Existing231-second evidence is historical and does not establish a changed container boundary.
4. Adapt existing canonical Admin render enqueue/claim/owns/finish and registration bindings for **outbound polling**, not a second job registry. Manager remains the trusted source-byte/preparation and retention broker. A narrowly authenticated job API exposes only render work; no generic service assertion or authoring/publication capability is issued to the VM. Preserve1200-second lease,90-second preparation,45-second retention plus15-second terminal recording, exact hashes, issued lease fencing, cancellation, lost-response reconciliation and retained partial/late results. Polling records cannot mint canonical attempts or approve/publish.
5. Initial end-to-end tests use owned synthetic/retained assets and an owned fixture API only. Later production wiring needs separately reviewed named configuration and release authorization.

## Failure-first validation and handoff

Use existing render input/execution/runner and canonical job seams for tests. Add container-adapter and narrow polling protocol tests for immutable binding, cumulative deadline, cancellation, ambiguous settlement and restart; do not duplicate publication or Mux authority. On this exact VM/image prove real source/custom/caption/audio render and independent decode, masks/credentials/network/mount exclusions, resource membership, bounded timeout/cancel/escape/descendant cleanup and fresh-instance recovery. Only affected source suites/typechecks and necessary image builds; no unrelated UI/performance repetitions.

Independent fixed-base Standards and Spec reviews, durable exact evidence/runbook, normal hooks and implementation-only commit follow. This completes the VM execution implementation only when actual contained rendering works; remaining actual Mux/production deployment acceptance is separately tracked and never inferred from local fixtures.

## Pinned early lifecycle/API decisions

Docker29.8.0/containerd2.3.4 are installed from the fingerprint-verified signed Docker repository. Runtime has only Unix sockets; no containers or production polling started during inventory. Root independently confirmed network listeners.

Before Docker operations, atomically persist job UUID, boot ID, original monotonic deadline, pool/worker/exact canonical lease and image identity. Arm a separately supervised native watchdog outside the job's OOM domain and require readiness acknowledgement. A persistent aggregate slice contains the job's host transfer/controller work and sequential render/verifier containers. At timeout/cancel, freeze the slice before killing it, permanently fencing late create/start attachment; retain its tombstone and independent watchdog until outstanding Docker operations are resolved and exact containers are stopped/deleted. Empty membership alone never proves retirement. Watchdog restart retains the original deadline; VM boot change means retirement, not renewed execution. Restart reconciliation completes before another claim.

The outbound API uses worker/pool-scoped claim authentication and an exact signed lease capability for download/owns/settlement. It does not expose generic Admin service tokens or arbitrary asset registration. Test cancellation/reassignment while download/upload waits and replay of an exact finish after a lost committed response. The verifier sees a fresh readonly directory with admitted MP4 and immutable expected metadata only.

Migration `0094_studio` extends the existing immutable lease with nullable pool/worker/dispatch fields; legacy unassigned leases remain valid. A dispatch UUID is persisted on the VM before network activity. The canonical broker atomically issues that dispatch once; changed pool, worker or attempt binding rejects, and expired/completed dispatches cannot become fresh work. Claim replay `execute: true` means the same assignment remains eligible to resume, **not permission for a new execution**. The VM's durable create/start intents admit each operation once; an uncertain operation requires exact runtime-identity reconciliation. A duplicate response preserves the original deadline. A new boot invalidates the monotonic clock and quarantines the old assignment; it never grants another 900 seconds. Torn or incomplete journal records remain preserved and refuse execution. The combined daemon evidence now exercises these journal primitives through the owned outbound API, actual containers and canonical settlement; reboot/torn-write refusal remains covered by focused journal regressions.

Installation/update/rollback scripts preserve SSH and keep production dispatch disabled; actual owned active-drain update and idle rollback are recorded in docs/validation/studio-460/vm-execution. Planned release is reviewed PR-to-main, hosted CI build, approved immutable image digest, VM outbound pull, drain, then switch; running jobs retain their recorded digest and the old version remains available for rollback. No renderer publishing workflow currently exists. No publishing or self-hosted arbitrary PR runner is authorized; workflow preparation follows the final packaging contract.

## Outbound gateway and retained-output protocol

The Manager route is `/api/studio/render-pool/{claim,input,owns,retain,finish,receipt}`.
`STUDIO_RENDER_POOL_ENABLED` defaults to false and controls **new assignment
selection**, while configured credentials continue to serve previously issued
assignments and terminal receipts. Admin's production control remains the
canonical admission gate. The configured pool/worker pair and dedicated worker
key cannot be supplied by request bodies. Manager's separate capability signing
key never leaves Manager. Neither key enters a render or verifier container.

Claim returns the exact historical assignment plus a signed lease/input-hash
transport capability. `execute: true` is eligibility to resume the original
assignment, not a second execution permit. Input delivery checks canonical
assigned eligibility before and after preparation; the legacy job-row-only
`owns` check is insufficient for attempt/revision invalidation. Retention and
finish deliberately remain possible for losing, expired and completed leases.

`retain` accepts only bounded output bytes/proof or a fixed failed/cancelled
outcome. Manager registers the existing three canonical assets and signs the
exact terminal record; partial registration retains its original lease edges.
The VM persists the signed record before `finish`. Restart retries those exact
bytes, without another retention request, render or verifier. Manager verifies
both the transport capability and terminal signature against the immutable
assignment/input before calling the existing canonical finish command. The
terminal signature does not expire independently of receipt history; it grants
no execution authority. Signing-key replacement must therefore retain replay
verification compatibility and is not part of an ordinary code rollout.

Input preparation is bounded to 90 seconds. Retention upload/registration and
signed-record delivery fit within 45 seconds, reserving the final 5 seconds of
that window for delivering a partial record after cooperative transfer timeout.
Upload itself is capped at 10 seconds. Terminal recording has at most 15 seconds
inside the host's original 60-second retention window; retries cannot reset that
window. Canonical asset edges remain reconciliation evidence if a response is
lost before the VM obtains the signed record. Unconfirmed recording is never
reported as successful finalization. Noncancellable underlying HTTP work retains
its process-local capacity slot after the bounded response ends.

The owned VM gateway replay reused the existing output: first finish response
dropped after canonical acceptance; a fresh process read the persisted signed
record, skipped retention, and recovered `admitted: true` with `execute: false`.
Canonical state remained one execution, three retained assets and the original
successful attempt. This is a real gateway/VM/owned-DB receipt proof, not a new
render, uninterrupted production-profile run or production deployment.

Production retained originals require verified durable Admin storage:
`RAILWAY_S3_BUCKET` and the existing `media-assets/{assetId}/original/{filename}`
path. With no bucket, Admin falls back to `.tmp/media-assets`; the owned fixture
uses that local fallback. A successful fixture does not qualify production
storage. Verify the named production bucket, permissions and restart/readback
through the approved release process; no storage implementation or external
operation is included in this checkpoint.

## Combined daemon checkpoint (owned VM and database)

The host-only bundle `d0c00b9a005f5e3bddf1873466f2127d145b350cd450937ec4a71d7d531d8cd8`
ran against the pinned SSH loopback fixture. It uses the already-loaded renderer
`sha256:1f5545cad34fdfb4945bae4fce19322037366ee43fadf7555dcf3e9cdc61bcbb`
and verifier
`sha256:75f306ada316ce00494423b37edd371dc663ffd4f72a20248edd81b6b8342182`.
No registry acquisition occurs during claims or execution.

The first daemon activation selected older pending assignment-test compositions
in the owned database. Its first empty composition completed successfully; this
is not visible-text evidence. The first sampler retained actual process
memberships but overwrote live resource counters after cgroup removal, so its
final empty counter snapshot does not establish resource maxima. These original
outputs remain distinct. The fixture was then constrained to its intended
canonical text attempt, and the sampler preserved its final live counters.

Text dispatch `7ebc07ec-21ec-4d96-a53f-e203108dbbb6` completed actual rendering,
separate verification, canonical retention and finish. The gateway deliberately
dropped the accepted finish response; the daemon recovered the read-only receipt
without repeating execution or retention. Canonical state is SUCCEEDED/COMPLETED,
generation 1, three retained assets. Retained MP4 SHA256 is
`56111a6d7101c8b33e1e93345edf4f912ae026c80f5a6f8be427739c74696c9c`;
independent full decode passed and its frame visibly reads “VM daemon fixture”.

The sampler observed 31 process identities, each with actual `/proc/PID/cgroup`
membership under the exact bounded ancestor. Preserved limits are CPU
200000/100000, memory 2147483648, swap 0 and PIDs 128; memory peak 177684480,
CPU usage 3491912 microseconds, no OOM or PID maximum events. These are sampled
membership observations, not a claim that polling saw every transient process.
After drain, the service was inactive with MainPID 0, Docker had no running
containers, the job cgroup was absent and every sampled original PID/starttime
was gone. Large staging/output files were pruned only after physical retirement
and canonical receipt; originals remain in canonical fixture storage.

Host packaging scripts under `apps/studio-render/ops` install a verified inactive
release and separately drain/select/optionally activate it. Rollback selects an
older approved installed SHA through the same drain path. Installer input is one
bounded byte snapshot used for both approved SHA verification and extraction;
file and directory durability precedes activation. The worker config and registry
credentials stay outside the bundle and authored containers. No publishing
workflow exists yet; these scripts do not publish, pull, enable boot startup or
connect a production pool by themselves. Production storage, CI artifact supply,
release approval and provider acceptance remain separate open gates.

Cancellation while input preparation waited was observed end to end: canonical
CANCELLED preceded transfer abort; no render create/start intent was issued.
The losing execution was retained as FAILED with `admitted: false`, leaving the
cancelled attempt/job unchanged. A dropped finish response was recovered through
the same receipt path.

Supervisor SIGKILL was delivered only after its exact render container was
observed running. Systemd restarted the supervisor once after five seconds;
recovery retained the original assignment and monotonic deadline, retired the
old runtime and recorded FAILED, generation 1, assets 0. `admitted: true` in this
case means canonical acceptance of failure, not successful video generation.

The first memory-pressure fixture failed before rendering because its fixture
HTTP server lacked the retained asset GET route. Its 17,215,488-byte peak and
zero OOM counters are explicitly not memory-exhaustion proof. The corrected
`daemon-oom-transfer-*` fixture used the existing canonical download service and
actual custom code: memory peak reached 2147483648, with `oom 1`, `oom_kill 1`
and no swap. Automatic retirement recorded FAILED/COMPLETED, generation 1 and
no retained output assets. A subsequent fresh text job completed successfully
with three assets (`daemon-after-oom-*`), then drained normally. These fixture
qualifications leave the production connection and provider gates unchanged.
