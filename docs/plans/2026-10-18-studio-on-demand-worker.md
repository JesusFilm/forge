# On-demand Studio worker on jfpai01

Owner authorized this rollout: host polls canonical queue demand, starts
`forge-render-ai01`, and gracefully shuts down after ten idle minutes. Existing
AI services and worker execution limits stay unchanged. The 300s full-flow target
remains feat-725; wake latency is included in a cold production request.

## Plan and boundaries

1. Add a separate Manager GET demand route using a distinct read-only token. It
   calls only the existing canonical `pending` scan; never claims or prepares.
   Return fixed pool/worker/profile identity and booleans, without project data.
2. Add a standard-library Python host controller and guest journal gate. Fixed
   commands target only `forge-render-ai01`; no shell interpolation of remote data.
   Existing host operator retains its trusted LXD administrator authority; the
   service introduces no public management listener and receives no render key.
3. Keep the VM running on invalid/stale/failed reads. On idle timeout create the
   guest drain flag; wait for supervisor drained/inactive, zero unfinished
   assignment journals and zero job containers; recheck queue before graceful
   stop. Never force shutdown or discard recovery state. On demand boot the VM,
   wait for guest Docker/agent readiness, clear only this controller's drain flag
   and start the installed supervisor. Manual drains remain authoritative.
4. Test failures/races and normal checks; PR/main before production configuration.
   Install immutable reviewed controller source as a user service on `jfpai01`.
   Set a new independent demand key without printing it. Measure startup and
   canonical request-to-retained-output; wait for real ten-minute idle shutdown.
5. Record exact source, host service settings, timings, memory and recovery
   evidence. Keep force-free recovery and coordinated manual rollback documented.

## Review questions

A queue error is not an empty queue. A live lease is not idle. A completed render
is not a complete assignment until retention/Mux/journal retirement finishes.
Use host monotonic time for idle intervals; a controller restart resets the idle
window. Duplicate controllers must be excluded by a lock. The trusted LXD
operator already has host-wide authority; fixed-target code is not OS-enforced
per-instance authorization, and must not be described as such.

## Implementation review (2026-10-18)

The Compound Engineering review command is unavailable in this environment.
Reviewed the implementation against security, adversarial, correctness and
reliability concerns before shipping; independent multi-agent review was not run.

- Security: separate bounded demand bearer; reject worker/capability/Manager key
  reuse; no job identifiers returned; no redirects or remote command arguments.
  Existing LXD administrator authority is explicitly documented.
- Adversarial: malformed/oversized/duplicate-field/wrong-identity responses fail
  closed; manual drains cannot be adopted; stale status cannot prove retirement.
- Correctness: drain races recheck demand, stopped containers and unfinished
  assignments block stop, and graceful-stop uncertainty preserves recovery.
- Reliability fixes applied during review: record recovery before the first queue
  read/start; boot interrupted work even while demand is unavailable; retain
  readiness tracking across guest startup; require a healthy controller cycle
  before changing VM autostart. Idle restarts never reuse an old timer.

Local validation: 21 host-controller tests, four guest-gate tests, 16 Manager
render-demand/auth/HTTP tests, Manager type check and scoped ESLint passed.
The production acceptance measurements below supersede the initial local-only checkpoint.

## Production edge qualification correction

After PR #2795 deployed successfully, the actual host demand read returned HTTP
403 before reaching Manager. A client/route comparison reproduced the same edge
rejection on the existing render-pool route with Python's default user agent.
Changing only the user agent to the honest `Forge-Studio-OnDemand/1` identity
reached Manager and returned its expected unauthenticated HTTP401. The installed
worker's Node client also reached both routes. This rules out a missing route
exception and application bearer failure.

Add the explicit service identity to the actual Python client, cover its outgoing
request contract, then acquire the corrected controller from reviewed main. No
Cloudflare policy is relaxed. The deployed Manager endpoint remains compatible;
controller and Manager source identities are recorded separately. VM autostart
remains enabled until the corrected controller passes a real healthy cycle.

## Production measurements

Manager endpoint source: `0a505503b86531c166b348272b677a4409e0b8a3` (PR #2795),
normal deployment `eaf8def5-cd36-4148-99c0-34c4a626e1c4`, healthy at
2026-10-18T09:33:42Z. Corrected controller source:
`591f6e5acd736743ccb45fe297e9679d79f00516` (PR #2796). Its actual host
`Demand.read()` passes; installer confirms active/enabled service and changes
VM `boot.autostart=false` only after its healthy cycle. Lingering is enabled.
Manager's watch paths exclude this Python-only follow-up; its existing reviewed
endpoint contract remains deployed. Guest bundle remains
`b98e696bf1a698f6efe7d13d7d9b30799443cce5bda553d2f9155c24e9e84ec2`.

The operator invoked the reviewed guest drain action to stage the initial cold
test. This initial stop is not the automatic 600-second idle acceptance. QEMU is
absent before submission; host MemAvailable rises from53.36GB to77.96GB (about
22.9GiB released). Existing VM disk/config/journals remain intact.

Fresh canonical SYSTEM request, stable idempotency key
`on-demand-ai01-qualification-20261018`, creates attempt
`cmvdn6d2y0001not28ojfrv0x` for the unchanged draft revision21/8856-frame clip:

| Event                    | UTC time / measurement                                  |
| ------------------------ | ------------------------------------------------------- |
| Request                  | 09:47:30.206                                            |
| First canonical lease    | 09:47:50.097 — **19.891s cold request-to-worker claim** |
| Retained execution       | 09:54:22.785 — **412.579s (6m52.579s)**                 |
| Terminal guest journal   | 09:54:35.447                                            |
| Controller observes idle | 09:54:36.668                                            |

Separate canonical storage readback confirms SUCCEEDED/nonstale/DRAFT at revision21,
one admitted execution,106338671 output bytes, SHA256
`34cf0a3f605000a73a070fa25970f97c7e5fe6f176b8992ebf9a3e3111d5afad`.
Both native exits are0. Aggregate peak17.27GiB/1819 tasks, with no memory-limit or
OOM events. The supervisor returns idle with0 restarts,0 job containers and0
unfinished assignments; all15 existing host service identities/start times/restart
counts match the baseline. Watcher snapshot is about14MiB and one task.

The cold full-flow result fails the separate <=300s target; feat-725 stays open
on the AI host. Automatic idle stop and independent media verification passed:

- Actual automatic graceful stop: **10:04:45.907Z**, **609.239s** after idle
  began; the 600s policy includes the subsequent probe and graceful-stop time.
- Final VM state STOPPED, QEMU absent, recovery marker safely cleared;
  controller remains enabled/active with lingering and zero restarts.
- Available host RAM rises by **21,029,482,496 bytes (19.59GiB)** after this
  render's shutdown. Watcher resident/cgroup snapshot is **12.95MiB**, one task.
- Independent complete-media verification decodes **8856** H264 frames at
  1080x1920/30fps, video295.2s, AAC295.253333s. Complete AAC SHA256 matches
  `3e23235b65ae98c7eb218cbd85028cab37b0b1b422ad1b6941da9aaee1786e44`.
- All15 existing AI service identities/start times/restart counts match baseline.
  Installed four-file payload hashes match reviewed controller main exactly.

The operator bundle `forge-render-ai01-setup/on-demand/evidence/summary.json`
contains the asserted qualification result. It includes no demand key or worker
credential. This closes feat-729's normal cold-start/render/idle lifecycle;
additional distributed-failure injection is recorded in feat-730. The full-flow
five-minute performance objective remains open in feat-725.
