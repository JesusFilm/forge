# Local PID1 and aggregate PID candidate

These owned-local probes do not certify an OCI image or Railway deployment. Production `verifyExecutionBudget` still requires an enforced cgroup PID ceiling of 128. The candidate diagnostics are deliberately outside the production configuration. The full231-second composition was not rerendered.

## Unmodified production entrypoint

`pid1-rootfs-final.log` runs the current built main as PID1 in a private user/PID/mount/cgroup namespace, with read-only leaf cgroup limits and fixed runtime paths. Limits: 2GiB, no swap, 2CPU, 128tasks, `/work`256MiB tmpfs. A real one-second text composition rendered through Chromium and independently decoded through the pinned FFmpeg verifier:47,471bytes, H264320x180/30frames, AAC48kHzstereo, digest6c00d095dbd13fd714d0baeab5dd8243b525830c087af402954851fe92fe46d9. Elapsed3.428s; memory peak249,122,816bytes; tasks peak112; CPU3.747s; noOOM. Direct SIGTERM to the verified namespacePID1 exited0; all observed descendants were absent.

The rootfs uses host runtime libraries and a read-only local dependency tree. It is not a built image. Earlier owned harness failures remain in `/tmp/forge-studio-460-prep`: mountpoint qualification, stale build artifact, and an incorrect dependency symlink. A separate outer Bubblewrap wrapper could not nest UID-map writes. On this host, a user-systemd service also rejects UID-map writes, while a bounded scope retaining the task's existing AppArmor profile permits them. No policy or sysctl was changed. The successful rootfs launcher uses unshare plus pivot_root; the actual inner Bubblewrap/seccomp launcher is unchanged.

## Hypothesis-only aggregate fallback

`pid1-rootfs-hypothesis.py` applies hard/softRLIMIT_NPROC128 and no_new_privs, then enters a dedicated nonzeroUID namespace before NodePID1. The diagnostic bundle alone permits outer cgroupPIDs1000 to test the hypothesis. It must not be used as production admission.

Real Chromium and independent verification succeeded with identical output:4.749s,250,953,728bytes memory peak,107tasks peak, noOOM, cleanPID1retirement. This is compatibility evidence, not sufficient containment certification.

Mixed pressure uses40 real Node Worker threads in the supervisor and24 pthreads in the filtered child. Forking then stopped at41 children/EAGAIN; the private PID-namespace sampler peaked127tasks under the loose1000 cgroup ceiling. NodePID1 real/effectiveUID1000, Inh/Prm/Eff/Amb capabilities0, NoNewPrivs1, hard/soft128 are recorded. The supervisor bounding set remains nonzero and is recorded explicitly. Child real/effectiveUID1000, all capability sets including bounding0, NoNewPrivs1, hard/soft96 are recorded. UID reset, hard-limit raise, unshare and clone NEWUSER were denied; clone3 returnedENOSYS. Repeated pressure in the same identity recovered. A separate unfiltered descendant-user-namespace test with24 parent threads stopped at102forks, supporting hierarchical accounting. Sampling is observational and does not replace the kernel limit or startup attestation.

## Cancellation, OOM and fresh restart

Detached setsid/double-fork cancellation completed. The subsequent allocator reached2GiB and the local scope's OOMPolicy=stop retired the entire unit. Thus `aggregate-recovery-first.log` is a partial harness, not a passed in-process recovery assertion. The retained journal/state identify kernelOOM,2GiBpeak,4.193s wall/4.914sCPU and the removed control group. No execution-main process survived. A fresh namespace subsequently rendered and verified successfully and exited cleanly (`pid1-after-oom.log`). This is local scope retirement/restart evidence, not Railway OOM-policy proof.

## Reproduction and remaining gates

Build `pnpm --filter @forge/studio-render build`. The outside probes require the owned paths in their source. Run the rootfs proof under `systemd-run --user --scope` with MemoryMax=2G, MemorySwapMax=0, CPUQuota=200%, TasksMax=128; candidate probes explicitly use TasksMax=1000. Pressure bundles use the studio-render package's pinned esbuild. OOM runs have a25-second external timeout. No credentials or provider calls are required.

Remaining: reviewed native startup attestation and identity setup, an actual pinned image, full image/regression validation, and exact deployed private transport/cgroup/PID/OOM/restart evidence. No infrastructure operation or paid provider acceptance is represented here.
