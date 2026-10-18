# Restore always-on Proxmox Studio worker

Owner decision 2026-10-19: use `forge-render-01`, VM109 on `jfp00`, continuously
running; remove the on-demand monitor and retire the AI guest. Feat-731 owns this
scope. Preserve the production parallel renderer and original failure/data fixes.

## Plan

1. Disable host watcher before any guest operation. Boot the drained AI guest only
   to validate retirement, disable its worker persistently and acquire the exact
   previously published host archive. Keep all journals and disk.
2. Preload the same approved immutable v4 images on the original inactive VM.
   Independently verify the published archive SHA and every installed member;
   preserve the previous config/release, select inactive, then explicitly activate
   only after proving the AI worker disabled and retired. Retain worker credentials
   and logical pool identity; never print credentials or reset canonical leases.
3. Verify original VM autostart, supervisor boot enablement, idle polling and a fresh
   full canonical render. Record exact timings/digests without claiming a new
   five-minute performance guarantee.
4. Remove demand-only Manager route/env/handler/tests and host controller/service/
   installer/tests. Restore future hosted candidate target to the Proxmox target.
   Release source removals by PR/main and normal Manager autodeploy. Revoke/remove
   the demand-only secret from its canonical store and host configuration.
5. Update operator setup records, retire obsolete instructions with dated notes,
   cancel demand-specific follow-ups and preserve historical measurements.

## Operational checkpoint

Watcher disabled and inactive before handover. AI guest had remained stopped
since successful automatic shutdown. Original VM is running, `onboot:1`, 64vCPUs,
65536MiB configured RAM, 60GiB disk; guest sees64 CPUs and65824988kB total RAM.
The old v3 supervisor is disabled/drained and will not be reactivated.

The v4 artifacts were published from reviewed main
`b79a3bc3a8f7d1b0ab3a2238127e80ce6c5383fd`, hosted run39103794388.
Existing candidate is historically bound to the AI target. This owner-authorized
transfer uses the same independently verified images and host archive via the
explicit host install/switch contract; it does not relabel the old candidate or
claim its target changed. Future candidates target `forge-render-proxmox-1`.

Verification and final production evidence pending.
