import { VmInvariantError } from "./errors.mjs"
import { execFile } from "node:child_process"
import { readFile, stat, statfs, lstat } from "node:fs/promises"
import { promisify } from "node:util"
import { jobIdentity } from "./profile.mjs"

const run = promisify(execFile)
const monotonic = () => Number(process.hrtime.bigint() / 1000000n)

/** The host launcher calls this immediately before both Docker create and
 * start, after recording the immutable operation intent. The active required
 * slice must stay pinned throughout unresolved Docker operations. This check
 * does not make removal/recreation of that slice during an operation safe. */
export async function assertLaunchable(id, recorded) {
  const identity = jobIdentity(id)
  if (
    !Number.isSafeInteger(recorded.deadlineMs) ||
    recorded.deadlineMs <= monotonic() ||
    !/^[0-9]+$/.test(recorded.cgroupInode) ||
    !/^[a-f0-9-]{36}$/.test(recorded.bootId)
  )
    throw new VmInvariantError("Closed execution deadline")
  const boot = (
    await readFile("/proc/sys/kernel/random/boot_id", "utf8")
  ).trim()
  if (boot !== recorded.bootId)
    throw new VmInvariantError("Execution boot changed")
  for (const name of ["cancelled", "expired", "retired"]) {
    try {
      await lstat(`${identity.directory}/${name}`)
    } catch (error) {
      if (error.code === "ENOENT") continue
      throw error
    }
    throw new VmInvariantError("Execution retired or cancelled")
  }
  const group = await stat(identity.cgroup, { bigint: true })
  if (
    String(group.ino) !== recorded.cgroupInode ||
    (await statfs(identity.cgroup)).type !== 0x63677270
  )
    throw new VmInvariantError("Execution cgroup identity changed")
  for (const unit of [identity.slice, `forge-studio-watchdog-${id}.service`]) {
    const { stdout } = await run(
      "/usr/bin/systemctl",
      ["show", "--property=ActiveState", "--value", unit],
      {
        timeout: Math.max(1, Math.min(5000, recorded.deadlineMs - monotonic())),
        maxBuffer: 4096,
      },
    )
    if (stdout.trim() !== "active")
      throw new VmInvariantError("Execution guard unavailable")
  }
  // Unit queries can wait. This is the final launch decision, not a guarantee
  // that a later Docker operation will complete before the independent guard.
  if (
    monotonic() >= recorded.deadlineMs ||
    String((await stat(identity.cgroup, { bigint: true })).ino) !==
      recorded.cgroupInode ||
    (await readFile(`${identity.cgroup}/cgroup.freeze`, "utf8")).trim() !== "0"
  )
    throw new VmInvariantError("Execution launch closed")
  return identity
}
