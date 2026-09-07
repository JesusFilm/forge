import { readFile } from "node:fs/promises"
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
  return join("/sys/fs/cgroup", path)
}
