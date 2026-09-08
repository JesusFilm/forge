import { open, readFile, statfs } from "node:fs/promises"
import { join } from "node:path"
export class StudioContainmentError extends Error {}
/** Read enforced leaf limits, not environment claims or plan maxima. Conservative:
 * refuses a loose leaf even if an ancestor might provide a tighter bound. */
export async function verifyExecutionBudget(directory) {
  const fields = await Promise.all(
    ["memory.max", "memory.swap.max", "pids.max", "cpu.max"].map((name) =>
      readFile(join(directory, name), "utf8"),
    ),
  )
  const values = fields.flatMap((s) => s.trim().split(/\s+/))
  if (values.length !== 5 || values.some((s) => !/^\d+$/.test(s)))
    throw new StudioContainmentError(
      "Studio containment requires finite kernel limits",
    )
  const [memoryBytes, swapBytes, tasks, cpuQuota, cpuPeriod] =
    values.map(Number)
  if (
    !values.every((s) => Number.isSafeInteger(Number(s))) ||
    memoryBytes < 1 ||
    memoryBytes > 2147483648 ||
    swapBytes !== 0 ||
    tasks < 1 ||
    tasks > 128 ||
    cpuQuota < 1 ||
    cpuPeriod < 1 ||
    cpuQuota / cpuPeriod > 2
  )
    throw new StudioContainmentError(
      "Studio containment exceeds approved execution budget",
    )
  return { memoryBytes, swapBytes, tasks, cpuQuota, cpuPeriod }
}
export async function currentCgroupDirectory() {
  const row = (await readFile("/proc/self/cgroup", "utf8"))
    .split("\n")
    .find((line) => line.startsWith("0::"))
  if (!row) throw new StudioContainmentError("Unified cgroup is required")
  const path = row.slice(3)
  if (!path.startsWith("/") || path.split("/").includes(".."))
    throw new StudioContainmentError("Invalid unified cgroup path")
  const directory = join("/sys/fs/cgroup", path).replace(/\/+$/, "")
  // A cgroup.procs file from this process must not be overlaid onto a
  // different bounded cgroup (nor may individual limit files be overlaid).
  // Mountinfo escapes whitespace/backslashes in mountpoint fields.
  const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
    .trim()
    .split("\n")
    .map((line) =>
      line
        .split(" ")[4]
        ?.replace(/\\([0-7]{3})/g, (_, octal) =>
          String.fromCharCode(Number.parseInt(octal, 8)),
        ),
    )
  if (mounts.some((point) => point?.startsWith(`${directory}/`)))
    throw new StudioContainmentError(
      "Studio containment rejects overlaid cgroup files",
    )
  const members = join(directory, "cgroup.procs")
  if ((await statfs(members, { bigint: true })).type !== 0x63677270n)
    throw new StudioContainmentError("Studio containment requires cgroup2")
  const file = await open(members, "r")
  try {
    // cgroup.procs translates IDs into the reader's PID namespace. Compare
    // with this Node process, not an outer/host PID or a launcher assertion.
    const buffer = Buffer.alloc(65537)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (
      bytesRead === buffer.length ||
      !buffer
        .subarray(0, bytesRead)
        .toString("utf8")
        .trim()
        .split(/\s+/)
        .includes(String(process.pid))
    )
      throw new StudioContainmentError(
        "Studio containment cgroup does not contain this process",
      )
  } finally {
    await file.close()
  }
  return directory
}
