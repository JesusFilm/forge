> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Studio render containment — work in progress

These local Linux probes are **not Railway containment acceptance**. Production
release still requires a functioning credential-free executor with effective
aggregate CPU, memory, PID, time and output limits and verified retirement.

## Teardown regression (2026-09-08)

The original guard's final blocking `waitpid` could hang after the direct child
exited while a detached double-fork descendant closed its output pipes. The guard
now uses subreaping, nonblocking reap and repeated adopted-child discovery under
an independent one-second monotonic cleanup deadline. Both the normal path and
parent `fcntl` setup failure use this cleanup. Unconfirmed cleanup returns 127;
the service must retire the entire execution container before accepting another
job. Process-group kills alone do not establish cleanup.

`test/teardown.test.mjs` runs the actual native guard and Bubblewrap namespaces.
It separately kills the launcher and private PID-namespace init, records every
host descendant PID, requires each PID to be absent before a subsequent successful
job, and checks absence again afterward. A test-only shared-library interceptor
injects parent `fcntl` failure after a child detaches. Independent harness
watchdogs kill disposable fixture processes if the guard regresses. The retained
`teardown-targeted.log` records all three passing tests. Existing guard tests
cover detached descendants with closed pipes and blocked output consumers.

`supervisor-loss-red.log` records the additional failure where abnormal supervisor
death was treated as an ordinary failed job. The launcher now reports fatal
isolation loss on guard signal death or status 127, before waiting for inherited
pipes. Cancellation cannot mask status 127. `supervisor-loss-green.log` records
both conditions passing after this change. These injected status tests verify the
service boundary classification; they do not substitute for actual namespace
cleanup or container retirement tests.

Run from the repository root:

```sh
node --test apps/studio-render/test/teardown.test.mjs
node --test --test-name-pattern='lost supervisor' apps/studio-render/test/isolation.test.mjs
```

Outstanding: actual container PID1 retirement/restart, OOM, complete Chromium
source/audio/custom-code and escape probes, aggregate supervisor accounting, and
an approved production boundary. Local user-systemd cgroups are writable; the
observed Railway worker cgroup is read-only with substantially larger limits.
Neither `unshare` nor the UID-bound RLIMIT_NPROC hypothesis independently proves
those missing production limits.
