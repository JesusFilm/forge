# Demand-driven AI render VM

Host: `jfpai01`; fixed local/default-project VM: `forge-render-ai01`.
Poll every5s, shut down after600 idle seconds. No new renderer/profile/image is
introduced. Guest journals and normal canonical leases still govern execution.
The current 40GiB guest allocation is not all physically resident; stopping the
VM releases its remaining resident memory.

## Trust and failure behavior

Manager's `GET /api/shorts/render-demand` accepts an independent
`STUDIO_RENDER_DEMAND_KEY`. It returns only pool/worker/profile identity, enabled
and pending booleans. This key cannot claim, finish, read assets or author projects.
The host receives neither a render worker key nor a canonical Admin assertion.

The controller runs as the existing trusted LXD administrator `tataihono`, uses
only fixed local VM commands, and exposes no listener. This account already has
host-wide LXD authority: fixed-target code is **not** an OS permission boundary.
A compromised host administrator can manage other instances. Do not claim this
service has an LXD-enforced start/stop-only credential. Its snap client requires
`snap-confine` capabilities, so `NoNewPrivileges=true` prevents the client running.
No new user is added to the LXD group and no privileged container is created.

On missing/invalid/failed queue or guest reads, keep the VM running. Manual drains
are never cleared. To stop automatically, write the recognizable controller drain
flag, let the supervisor finish its current assignment and exit, validate every
journal with the installed `VmJournal`/`readCycleState`, require zero job containers
(including stopped ones) and zero job scopes, then recheck the queue. Stop with
`lxc stop --timeout=30` and never `--force`. A job arriving after that final read
stays queued and starts the VM on the next poll. Unknown retirement blocks stop.

Durable `recovery.json` is true before starting the VM and cleared only after
proven graceful idle shutdown. After host/controller failure it starts the VM even
if a still-active lease is absent from the pending scan. Idle timers use monotonic
host time and reset on errors, activity or controller restart. Logs contain state
transitions and safe error classes, never response bodies or credentials.

## Reviewed release and install

1. Merge the reviewed PR through normal CI/main. Acquire these four files from
   that exact main commit: `controller.py`, `guest.mjs`,
   `forge-studio-on-demand.service`, `install.py`. Preserve source SHA and file
   SHA256 inventory. Never install local unmerged worktree code in production.
2. Configure a fresh random independent `STUDIO_RENDER_DEMAND_KEY` in the Manager
   production secret store, then let its normal source/config deployment finish.
   Verify the running source and authenticated endpoint. Never print the key.
3. On the host, write `~/.config/forge-studio-on-demand/config.json` owner-only:

```json
{
  "version": 1,
  "endpoint": "https://manager.jesusfilm.org/api/shorts/render-demand",
  "key": "REPLACE_WITH_THE_INDEPENDENT_DEMAND_SECRET",
  "poolId": "forge-proxmox",
  "workerId": "forge-render-1",
  "profileId": "studio-render-4/3600s-180prep-24cpu-32g-4096p-4096child-128m",
  "idleSeconds": 600,
  "pollSeconds": 5
}
```

4. `loginctl enable-linger tataihono` must succeed, and
   `loginctl show-user tataihono -p Linger` must report `yes`, before enabling a
   user service that must survive logout and start at boot. If host policy requires
   interactive authorization, the host owner must perform that command; no root
   workaround is allowed. Run `python3 install.py --source <40-character-main-sha>`.
   The installer validates the config, demand read, fixed VM identity and linger,
   preserves source by commit, enables the service, waits for its first healthy
   queue/guest cycle and then disables guest
   autostart. Persistent recovery takes over host-reboot startup when necessary.
5. Measure real queued request to worker readiness, complete retained output,
   real ten-minute idle shutdown, and memory release. An11s guest boot observation
   alone is not a cold VM/worker readiness measurement. Keep feat-729 in progress
   until live acceptance passes; the full <=300s goal remains feat-725.

## Inspect, maintenance and rollback

```bash
systemctl --user status forge-studio-on-demand
journalctl --user -u forge-studio-on-demand --since '1 hour ago'
lxc info forge-render-ai01
```

For maintenance **stop the watcher first** so queue demand cannot restart the VM:
`systemctl --user stop forge-studio-on-demand`. Do not delete recovery records or
assignment journals. To restore always-on operation, disable the watcher, set
`lxc config set forge-render-ai01 boot.autostart true`, start the VM, and run the
reviewed guest `wake` action through the LXD agent to clear only its owned drain.
A manual drain requires the operator's separate explicit maintenance decision.

## Validation

```bash
python3 -B -m unittest discover -s apps/studio-render/test -p test_on_demand.py
node --test apps/studio-render/test/on-demand.test.mjs
pnpm --filter @forge/manager exec vitest run src/services/studio-render-demand.test.ts
```

[LXD graceful-stop options](https://canonical.com/lxd/docs/default/reference/manpages/lxc/stop/)
and [systemd lingering](https://www.freedesktop.org/software/systemd/man/257/loginctl.html)
describe the platform behavior used here.
