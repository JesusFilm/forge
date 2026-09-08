> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Startup cgroup membership correction

Review base `407851c06fb492960858c2fa47a93c93f8e1881b`. Historical containment qualification remains withdrawn; this directory records the focused admission correction and new verification separately. No proc masks, numeric runtime limits, provider permissions or deployment gates are relaxed.

## Failure-first startup seam

The tracked `apps/studio-render/test/budget-membership.test.mjs` is run in a real OCI PID namespace, using the unchanged retained worker image only as a Node22.22.3 runtime for this development test. The harness embeds the actual budget module and test source as a data URL; it does not replace kernel filesystem responses. This is not the rebuilt execution image's entrypoint proof.

- `budget-membership-red.log`: the previous implementation incorrectly accepts unrelated bounded cgroup files, so the expected-rejection test fails.
- `budget-membership-overlay-red.log`: after adding self-membership, overlaying the actual cgroup.procs onto a different bounded directory still bypasses that first fix.
- **`budget-membership-overlay-green.log` also failed**, despite its premature filename. A root-mounted directory retained a trailing slash and the nested-mount prefix acquired two slashes. Preserve the contents as failed evidence.
- `budget-membership-overlay-final.log`: with the normalized directory, the actual overlay test passes.
- `budget-membership-own-normalized.log` and `budget-membership-unrelated-normalized.log`: the current implementation accepts its own bounded leaf and rejects the unrelated one. The own case runs as PID1 and verifies a write to its cgroup.procs fails EROFS.

Each OCI case runs one matching test; the other scenario tests are explicitly skipped. The default host unit run does not constitute these namespace tests. Existing numeric-limit parser coverage remains unchanged.

The resolved directory now rejects descendant mount overlays, requires the membership file to be on cgroup2, and finds the actual Node PID in cgroup.procs using the reader's PID-namespace semantics. Membership reading is bounded and the descriptor closes in finally. This establishes current startup membership, not a defense against a privileged host changing mounts afterward. Descendant inheritance and actual runtime resources require independent observation.

## Independent review

Fixed-base Standards and Spec reviews found no further actionable issues after trailing-separator normalization. Standards explicitly read the final overlay result rather than relying on its older filename. The final evidence follow-up also found no actionable Spec issues. Standards found a task-local bearer accidentally retained in the new sanitized worker config; it was replaced with a placeholder before staging/commit. The focused recheck confirmed the placeholder and found no occurrence of that bearer in either copied evidence directory, including harnesses. Both review axes are now clear. Exact-image rebuild and runtime evidence follow below; the source-level namespace tests are not substituted for that proof.

## Builder qualification

Pinned BuildKit0.33.0's [rootless spec conversion](https://raw.githubusercontent.com/moby/buildkit/v0.33.0/util/rootless/specconv/specconv_linux.go) clears cgroup configuration. Historical driver-scope counters do not prove actual executor bounds and remain withdrawn.

The new task-local runc adapter sets only linux.cgroupsPath to a child of the current verified bounded driver scope. It refuses unexpected input cgroup configuration and does not change mounts, namespaces, capabilities or sandbox mode. The controlled RUN probe observes the actual executor via /proc and runc state beneath that ancestor. Driver controls are2CPU,2GiB,no swap,512tasks; runtime service limits remain128tasks. The first short probe completed before the monitor started and is explicitly labeled unobserved; the second probe ran with observation already active.

This proves that new local builder placement, not historical builds or a deployed runtime. The subsequent incremental image build may reuse earlier cached layers; only newly executed work can receive the new membership qualification. No broad cold rebuild is claimed.

## Rebuilt native image

The incremental rebuild exported manifest `sha256:9788c4ba7a86505b6998064299f679bd185a2a35444979d1996fe1df68d53d95`, config `sha256:7b267b419f7673ba351f016c31d7d8224bc75fc4ddde76e3529a0e9e99e59d46`. The unpacker independently verified every config/layer digest. Existing packaging warnings remain in `build-membership-image.log`; no dependency upgrades were made. `builder-full-membership-observed.json` samples five actual RUN executor init processes below the bounded driver ancestor with no sampled mismatch. This is an incremental build with reused historical layers, not a cold-build resource qualification.

Through the actual baked native entrypoint, `render-unrelated-startup.log` rejects an unrelated bounded mount and `render-overlaid-startup.log` rejects an overlaid membership file. The own-leaf instance starts with the unchanged 900-second profile and returns healthy over HTTP. `render-membership-observed.json` independently binds Node PID1 and its 11 sampled threads to the actual 2CPU/2GiB/no-swap/128task leaf. The brief request's transient guard/launcher processes were not captured by the 50ms sampler; this does not establish their observed membership or Chromium/verifier execution.

The signed source/custom/caption/audio fixture still returns HTTP422 (`http-render-membership.json` and `.log`); no output was produced. The earlier traced fresh-proc EPERM remains an unresolved boundary finding; this rerun is not a new syscall trace. Masks/read-only paths were preserved, and no exposure workaround was applied. Actual functioning contained rendering, adversarial full-image execution and deployed/provider acceptance remain open.

The final builder monitor originally wrote the generic outside filename `builder-membership-observed.json`; its full-build result was preserved separately as `builder-full-membership-observed.json`. The earlier controlled-probe record was already copied here and remains unchanged. Monitor filenames alone are not proof labels.
