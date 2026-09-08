# Resumed local exact-image validation

Base: `bb6ed63f30b326f468fd7eb8cdf866a022db8ffe`. The user authorized local builds/tests and installed uidmap. No image push, asset upload, remote runner, provider call or deployment occurred. Feat-460 remains in progress.

## Execution image result

**Build, native PID1 startup and runtime dependency resolution passed. Actual signed HTTP rendering failed before authored execution.** The fresh child proc mount returned `EPERM`; this is not a functioning contained renderer. The exact-image output/codec/cancellation/OOM/recovery matrix remains open behind that failure. Earlier native and full-length proofs remain historical evidence, not substitutes for this matrix.

The exported linux/amd64 manifest is `sha256:e56e7028a265aa550d51fb19991ff889d400c262f2c31f7182f58814b3a77d70`; config is `sha256:0f45dabfcf52eb3a63b341e058104b497ad8f03a356926643d8661bcdc37f3b7`. `image-archive.sha256`, `image-manifest.json`, `image-config.json` and `unpack-image.log` bind the export and independently verified layers. OCI extraction used the same subordinate user mapping as the builder.

`build-owned-runc.log` records the complete successful build. Preserve its missing `.bin` deployment-target and existing peer warnings. `image-module-resolution.log` independently resolves the final renderer APIs, Chromium149 and the two exact reviewed codec binaries. It establishes those required runtime resolutions, not every optional dependency or a render pass.

## Codec supply

The historical original archive and `/tmp` runtime disappeared during the tooling pause. Copies of the retained public codec binaries were read without modifying the calendar task, then hash-verified. The authorized versioned BtbN archive was downloaded and independently extracted: its archive SHA differs from the missing original, while both executable SHAs match. No latest upgrade, fabricated archive or automatic hash replacement occurred.

`versioned-stage-red.log` records rejection by the previous original-only staging code. `versioned-stage-green.log`, `versioned-binary-hashes.log` and `unreviewed-stage-rejected.log` cover the narrow two-digest adaptation, executable equality and rejection/cleanup of unreviewed input. The Dockerfile independently verifies both extracted executable hashes. `supply-review.md` records independent fixed-base reviews. Upstream14-day retention is insufficient for normal release supply; `apps/studio-render/IMAGE.md` preserves that separate, unperformed release dependency.

## Local mapping, budgets and qualifications

`subordinate-mapping.log` proves full subordinate mappings and devpts gid5 with the newly installed helpers. Earlier single-ID mapping failure is preserved in `image-local`; it is not the current environment. The resumed build uses the same pinned BuildKit0.33.0 and bundled runc, ordinary OCI process sandbox and native snapshotter. No alternate builder, no-process-sandbox flag or host policy change was used.

The first resumed daemon launch failed in a user service namespace. A user scope preserved the caller context; later attempts exposed default OTEL and runc state paths under unwritable `/run`. Owned paths corrected those local tooling issues. `buildkit-*.log`, `build-first.log` and `build-mapped.log` preserve those failures. The runc wrapper changes only its state root.

Build-only limits:2CPU,2GiB, no swap,512tasks. `build-budget-final.json` records no OOM kills; the kernel memory peak slightly exceeds the nominal limit during accounting/reclaim. This does not change the production execution task limit. Native execution requires2CPU,2GiB, no swap,128aggregate tasks and the unchanged900s profile.

An unsupported local systemd `MemoryOOMGroup` property rejected the first runtime launch. The next launch correctly failed closed because default rootless cgroup mounting exposed ancestor `max` files. Mounting the actual owned bounded leaf read-only made the native checks pass (`image-health2.log`). No synthetic budget files or relaxed admission checks were used. This local runtime configuration must not be assumed to match Railway.

## Proc boundary remains unresolved

`image-render-strace.log` records successful namespace creation and preceding mounts, followed by the fresh proc `EPERM`. `http-render-first-red.json` preserves the first HTTP422 result. The traced repeat is separate. Outer OCI masked and read-only paths remain intact (`image-proc-masks.log`). No untrusted child executed.

The current inner `--proc /proc` recipe has **no explicit complete OCI mask replay**. Bubblewrap's partial conditional read-only restrictions omit full file/directory masks and explicit `/proc/fs` coverage. Earlier unmasked namespace tests do not prove equivalent child protections. `proc-boundary-assessment.md` identifies required complete mask/read-only verification before authored execution, ancestor PID exclusion and remount/unmask denial. It is a read-only assessment, not implementation or deployment proof. No outer unmasking, supervisor-proc binding, changed-exposure experiment or external per-job OCI redesign was performed.

Raw logs are preserved. The owned OCI archives, binaries and rootfs are outside the repository under `/home/tataihono/.cache/forge-studio-460-image-runtime`; local presence is not durable release storage.
