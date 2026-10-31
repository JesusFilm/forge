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

## Qualified operational handover

Fresh canonical SYSTEM request `always-on-proxmox-qualification-20261019`, attempt
`cmvdqe8bm0001no0bc4biokrc`, unchanged draft revision21 /8856frames:

| Measurement                    | Result                          |
| ------------------------------ | ------------------------------- |
| Request to first lease         | 1.090s                          |
| Source preparation after lease | 58.332s                         |
| Native render                  | 652.040s (10m52.040s)           |
| Independent native verifier    | 83.974s                         |
| Request to retained output     | 852.889s (14m12.889s)           |
| Aggregate memory peak          | 17,226,264,576 bytes (16.04GiB) |
| Aggregate peak tasks sampled   | 1782                            |

Both native exits0, no OOM/memory-limit events. Separate canonical full-byte
readback confirms SUCCEEDED/nonstale/DRAFT revision21, one admitted execution,
106343457 bytes, SHA256
`af1903aef5ac49659bec5ca65f517f61c02bd07c3ceb5361168ac63286631ba5`.
Independent operator verification decodes all8856 H264 frames at1080x1920/30fps,
video295.2s and full AAC295.253333s. Complete AAC matches
`3e23235b65ae98c7eb218cbd85028cab37b0b1b422ad1b6941da9aaee1786e44`.

Original worker returns idle, enabled/active, zero restarts/containers/unfinished
assignments. All92 assigned journals are complete. AI worker is persistently
disabled, boot startup disabled, all assignments complete, VMSTOPPED and QEMU
absent. Monitor unit is not-found; its host payload/config/state/cache are removed.
Demand-only secret is deleted from canonical Doppler and Railway settings.
All15 existing AI services retain their exact identities/start times/restarts.
Every installed host payload hash matches the selected reviewed archive.

This fresh comparison demonstrates a material CPU speed difference: the same v4
clip took380.478s warm /412.579s cold on the AI host, versus852.889s on Proxmox.
The earlier conversational suggestion that there was little demonstrated speed
advantage is corrected by these measurements. Owner-selected placement remains
always-on jfp00; the300s target is unmet and stays feat-725.

## Source retirement release

PR #2798 passes29 checks and merges as
`5f11c9d70db79ac13ac31f85682cd18be3cb62b4`. It removes the demand endpoint/env/
handler/tests, host controller/gate/installer/service/tests, restores future
hosted candidate target and adds dated historical supersession notes. Superseded
AI-cutover documentation PR #2794 and monitor documentation PR #2797 are closed.
Local Manager type check/scoped ESLint/Prettier,9 pool gateway tests,36 release
tests and full worker command (121 passed,10 explicitly skipped) pass.
Required whole-repo pre-commit formatting passes; no hooks are skipped.

Normal Manager deployment `6d06afd9-eb22-4305-a9d1-ed5ffe2758a5` succeeds from
reviewed main5f11c9d70db79ac13ac31f85682cd18be3cb62b4. All28 main checks finish
successfully/neutral/skipped. Readback confirms this exact running source,
absent demand route in the built app manifest, absent demand key and enabled
normal pool. Live unauthenticated route changes from401 before rollout to404
afterward. Original supervisor remains active/enabled following deployment.
Feat-731 is complete.
No local source publication, forced retirement or journal/lease reset occurs.

Operator artifacts are in `forge-render-proxmox-setup/` in the task artifact
root; the historical `forge-render-ai01-setup` README is explicitly retired.
The new full video is `widow-r21-proxmox-restored-production.mp4`. The bundles
include no private credentials. Deployment/readback/endpoint evidence is included in that checksum-verified
bundle on jfp00. Trusted release tools are updated from reviewed main5f11c9d,
with all13 file hashes verified and old tools preserved privately. The worker
is not restarted for that tool update. Its qualified runtime bundle stays b79a3bc.

No gate is bypassed: the rollout waits for both security analysis and an
unrelated Dependabot maintenance check. The existing feat-728 follows that
separate delivery delay; it does not change render timing or host capacity.

Superseded placement: the owner subsequently selects always-on jfpai01 in
feat-732 after this measured comparison. Keep this completed handover as history;
the monitor retirement and renderer fixes remain in effect.
