> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Idle worker TERM diagnosis

Exact unchanged worker manifest20854aca5ebd7ad6f8335bc1b2396f309a5154a8ff89ea7caabc19b3a5d09961. No product edit/rebuild/provider request. Actual leaf2CPU/2GiB/no swap/128 with original masks. Only health used for each worker.

## Observed cause

Idle PID175733 was PID1, exact starttime/namespaces/status/cgroup captured in worker-idle4-before.json. Health200. TERM left it alive after5.05seconds. A persistent tracer observed SIGTERM at that exact process; sender trace shows successful pidfd_send_signal(SIGTERM). The initial caught-signal mask4602 becomes0602 (TERM handler removed). This rules out wrong target and demonstrates default-handler behavior rather than an application drain being awaited.

The same baked worker server as non-PID1 child177348, same namespace/limits and only a distinct local port, answered health and exited50.8ms after TERM. A controlled launch of the SAME image/server as PID1 with a diagnostic explicit handler (prints marker, exits0) answered health, printed the handler marker, and exited50.2ms after runcTERM; its leaf disappeared. No application files were modified. This control is not a production shutdown policy.

Pinned Node22.22.3 source src/node.cc installs SignalExit with reset_handler=true for TERM; SignalExit resets stdio then raises the signal. https://raw.githubusercontent.com/nodejs/node/v22.22.3/src/node.cc. The observed mask reset and non-PID1/explicit-handler comparison support the concrete cause: default Node signal re-raise does not terminate this namespace PID1. Active-work shutdown was not exercised or diagnosed.

## Preserved harness qualifications

First new bundle referenced relative rootfs and failed before startup; worker-idle4-bundle-path-red.log preserved, then resolved exact retained rootfs. Initial short-lived tracer subprocess ended with its tool wrapper; subsequent collection hit ProcessLookupError and wrote no terminal result. Persistent tracer and separate sender trace supply actual evidence; no initial delivery claim. Detached child runc exec inherited captured output descriptors, causing the caller communicate timeout despite successful child startup; child pidfile, actual status, health and terminal result establish its execution. These are harness failures, not worker failures.

Failed idle PID1 was manually removed by verified owned cgroup.kill AFTER all observations; worker-idle4-cleanup.json records absence. Explicit-handler control exited naturally. No automatic retirement claim.

## Smallest proposed product scope, awaiting coordinator decision

Give server.ts explicit lifecycle ownership of its Server and JobQueue, register SIGTERM/SIGINT once, and make repeated shutdown idempotent. Stop new job admission immediately and mark health unavailable; preserve authenticated polling for a short bounded grace if needed for terminal outcomes. Add a narrow queue shutdown operation that stops scheduling queued entries, cancels queued/running work through existing AbortControllers and awaits tracked running promises/cleanup within grace. Existing devotional-render cancellation already propagates and closes Chromium; verify it through the actual lifecycle rather than assuming it.

Do not use the diagnostic unconditional process.exit as the active-work fix. Define a fixed grace (propose5s within deployment drain budget), then forced process exit only after bounded cleanup failure, recording unsuccessful drain. Node PID1 exit must leave no child under the owned kernel boundary; exact-image regression verifies idle and one local active operation. In-memory receipts cannot be promised durable across worker termination; caller reconciliation must classify cancelled/interrupted/unknown, never success. No new durable registry proposed in this narrow fix.

Affected files should stay server.ts/jobs.ts and focused lifecycle/queue tests, plus necessary exact-image verification evidence. Preserve retired routes and retained devotional contracts. No production changes until scope/active-work semantics agreed.
