import { VmInvariantError } from "./errors.mjs"
/** Fixed host-owned layout. Neither a project nor a polling response supplies
 * image selection, mounts, Docker flags or shell commands. */
export function jobIdentity(id) {
  if (!/^[a-f0-9]{32}$/.test(id))
    throw new VmInvariantError("Invalid local job identity")
  const slice = `forge-studio-j${id}.slice`
  return Object.freeze({
    id,
    slice,
    directory: `/var/lib/forge-studio/jobs/${id}`,
    cgroup: `/sys/fs/cgroup/forge.slice/forge-studio.slice/${slice}`,
  })
}

export function containerArguments({ identity, image, deadlineMs, phase }) {
  const expected = jobIdentity(identity.id)
  if (
    Object.keys(identity).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([key, value]) => identity[key] !== value) ||
    !/^(?:[a-z0-9][a-z0-9./_-]*@)?sha256:[a-f0-9]{64}$/.test(image) ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    !["render", "verify"].includes(phase)
  )
    throw new VmInvariantError("Invalid fixed execution configuration")
  return [
    "create",
    "--pull=never",
    `--name=forge-studio-${identity.id}-${phase}`,
    `--label=io.forge.studio.job=${identity.id}`,
    `--label=io.forge.studio.phase=${phase}`,
    `--cgroup-parent=${identity.slice}`,
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=1000:1000",
    "--cgroupns=private",
    "--pids-limit=128",
    "--cpus=2",
    "--memory=2147483648",
    "--memory-swap=2147483648",
    "--ulimit=nproc=128:128",
    "--ulimit=nofile=256:256",
    "--ulimit=fsize=134217728:134217728",
    "--ulimit=core=0:0",
    "--restart=no",
    "--log-driver=none",
    "--shm-size=8388608",
    // Retained HLS, Remotion's local copy, and Chrome's unlinked buffers share
    // this mount. Its pages still count toward the unchanged 2 GiB memory cap.
    `--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${phase === "render" ? 1073741824 : 268435456},uid=1000,gid=1000,mode=700`,
    `--mount=type=bind,source=${identity.directory}/${phase}-input,target=/input,readonly`,
    "--workdir=/input",
    "--entrypoint=/runtime/guard",
    image,
    "--deadline",
    String(deadlineMs),
    phase === "render" ? "134217728" : "8192",
    "65536",
    "--",
    "/runtime/init",
  ]
}
