# Studio execution image

The Dockerfile is a reviewable recipe, not a deployed or certified image. Build from the repository root with BuildKit and an explicit codec context. Execution must remain credential-free, private, one job at a time and container PID1. The current admission gate still requires actual cgroup CPU≤2, memory≤2GiB, swap=0 and tasks≤128. The tested UID/NPROC fallback is not enabled by this recipe.

```sh
node apps/studio-render/scripts/stage-codec.mjs /retained/ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz /tmp/studio-codec-context
docker build --platform linux/amd64 --build-context studio_codec=/tmp/studio-codec-context -f apps/studio-render/Dockerfile -t studio-render:review .
```

The context script and Dockerfile accept only original archive SHA256 `da49baa2fd544ac090fa8adac19d2d6d1f781e75556c4f95dcc0a4f2dd22b1a6` or the byte-identical-binary versioned archive SHA256 `e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4` below. The Dockerfile selects the exact corresponding member paths and independently verifies both extracted binary hashes before copying them into the final image. No automatic codec/hash update is allowed.

The original download was BtbN's `latest` artifact. Its versioned counterpart is [autobuild-2026-09-07-15-39](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-07-15-39), archive `ffmpeg-n9.0.1-27-g9b0578816c-linux64-gpl-9.0.tar.xz`, SHA256 `e414c137c7d6ed089c75d0887165f9a5fc1feb38bb6883f31d27fef0c00a03e4`. The archive bytes differ, but both extracted binaries are identical to the reviewed original:

- ffmpeg: `bf626ef18ccc5b1c8d26e2e046a90b998d1554d2bde0dcac0d497ad1886e9aa6`
- ffprobe: `c7a58858f84f56ce52fee2d09d1c8a56fbd4226e15be15c8c8fe88da395d3a1c`

The versioned URL is not a durable supply guarantee: [upstream retains only the latest14 daily builds](https://github.com/BtbN/FFmpeg-Builds#release-retention-policy), plus month-end builds for two years. Neither upstream URL is the normal CI input.

## Required retained supply before release

This is a proposed release dependency; no asset has been uploaded or published.

Retain the **original** verified archive in repository `JesusFilm/forge`, proposed release tag `studio-render-codec-2026-09-07`, asset `ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz`. Bind the release/tag to the reviewed commit during the normal release flow, disallow replacement/deletion in operational ownership, and record its asset ID, size and digest in final deployment evidence. The previously owned original archive disappeared during the host-tooling pause and is no longer available at its recorded `/tmp` path. The pinned versioned archive was downloaded again and verified for resumed local image work; independently preserved binaries also match the hashes above. Durable supply remains an external release dependency: the proposed original asset cannot be uploaded unless its exact bytes are recovered. Alternatively, explicitly authorize retention of the verified versioned asset with its own recorded identity and digest; do not relabel or fabricate an original archive. Neither local preservation nor upstream availability completes durable release supply.

Normal CI supply then downloads that exact retained asset **before** Docker build (for a private repository, use CI's scoped read credential outside Docker), runs `stage-codec.mjs`, and supplies the validated directory as the `studio_codec` named context. For example, after the proposed release actually exists:

```sh
gh release download studio-render-codec-2026-09-07 --repo JesusFilm/forge --pattern ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz --dir "$RUNNER_TEMP/studio-codec-download"
node apps/studio-render/scripts/stage-codec.mjs "$RUNNER_TEMP/studio-codec-download/ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz" "$RUNNER_TEMP/studio-codec-context"
docker build --platform linux/amd64 --build-context "studio_codec=$RUNNER_TEMP/studio-codec-context" -f apps/studio-render/Dockerfile -t studio-render:review .
```

CI must fail if the retained asset is absent or has a different digest. Do not pass GitHub/provider credentials as Docker build args or executor environment. Configure the normal image-build/release workflow only after review and explicit authorization; no push, release creation, upload or deployment is performed by these preparation commands.

## Local build qualification

The bounded local rootless BuildKit v0.33.0 attempt reached its OCI worker and downloaded the Dockerfile frontend, then failed before any Dockerfile `RUN`: runc could not mount `devpts` with `gid=5` (`invalid argument`). At that time, the task's unprivileged namespace mapped only one UID/GID and the host lacked `newuidmap` and `newgidmap`, despite allocated subordinate ranges. Task-local unprivileged copies cannot provide those helpers' privileged mapping authority. No host configuration or privilege changes were made, and the task-owned daemon was stopped. Further builder alternatives are out of scope for this probe.

This is a local build-tooling limitation, separate from execution containment. A proposed next step is an explicitly authorized Linux amd64 OCI-capable runner with BuildKit and the checksum-verified codec context above: build without pushing, retain the image digest, and run the exact-image render/codec/cancellation/OOM/restart/escape matrix under the declared limits. Such a runner and its build do not by themselves establish Railway's effective cgroup, namespace, PID1 or private-transport behavior. No remote runner execution is authorized or claimed here.

The resumed local attempt uses the newly installed privileged mapping helpers and a full subordinate UID/GID range. The historical failure above remains valid for its earlier environment; the new devpts gid5 probe succeeds. Build-only limits are 2CPU, 2GiB, no swap and 512 tasks; production execution still requires 128 tasks. BuildKit and runc runtime sockets/state stay in task-owned rootfs paths. Exact-image results are recorded separately from the historical native harness and future deployed-container acceptance.

## Runtime admission

The native PID1 entrypoint accepts only the broker public key and port, creates the dedicated user/mount context, applies hardNPROC128, mounts `/work` as256MiB tmpfs, removes capabilities and sets no_new_privs before Node. A sealed memfd record and independently checked current UID/capability/limit/environment/mount state guard startup. The record is not cryptographic proof of launcher identity; the exact reviewed image and entrypoint are trusted deployment configuration. The inner executable retains96tasks, native cumulative deadlines and network/filesystem isolation.

The resumed local OCI build succeeded with manifest `sha256:e56e7028a265aa550d51fb19991ff889d400c262f2c31f7182f58814b3a77d70`. Native PID1 startup passed with the actual bounded cgroup leaf mounted read-only; renderer module, Chromium and exact codec resolution passed. Actual signed HTTP rendering failed before authored code because mounting fresh child proc returned `EPERM`. Outer OCI masks/read-only paths remain intact. This is build/startup/dependency evidence, **not functioning exact-image render acceptance**.

The current `isolation.mjs` fresh `--proc /proc` does not explicitly replay every OCI proc file/directory mask or read-only path. Bubblewrap's partial built-in restrictions are not equivalent to the complete outer policy. Earlier unmasked host namespace tests therefore do not prove OCI-equivalent child proc protections. Any future child-private proc arrangement must apply and verify the complete applicable policy before authored code, exclude ancestor PIDs, and prevent remount/unmask escape. The read-only assessment records a required trusted bootstrap ordering capability that has not been established on Railway; no exposure change or alternate architecture is implemented.

Still required: resolution of the fresh-proc failure without weakening protections and exact-image render/codec/cancel/OOM/restart/escape tests; any independently reviewed PID fallback before changing the strict128 cgroup gate; observed deployed limits and PID1 behavior; and920-second private execution transport verification. Public edge timeouts are not the transport contract. No functioning deployed renderer or actual provider acceptance is claimed here.
