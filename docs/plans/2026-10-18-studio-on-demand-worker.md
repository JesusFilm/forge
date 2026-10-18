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
Production acceptance remains outstanding; this record does not claim cold-start
or full-render timing results.

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
