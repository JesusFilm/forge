import { spawnSync } from "node:child_process"
import { open, readFile } from "node:fs/promises"
import { StudioContainmentError } from "./budget.mjs"

/** Sealed startup record plus independently checked current kernel state.
 * The record is not cryptographic proof of launcher identity: the exact image
 * and entrypoint remain part of the trusted deployment configuration. This does not
 * replace the aggregate cgroup PID gate until the fallback is independently
 * reviewed. No request or environment field can supply startup evidence. */
export async function verifyNativeStartup() {
  let descriptor
  try {
    const verified = spawnSync(
      "/opt/studio-render/native/entrypoint",
      ["--verify-record"],
      {
        stdio: ["ignore", "ignore", "ignore", 3],
        timeout: 1000,
      },
    )
    if (verified.status !== 0)
      throw new StudioContainmentError("Invalid sealed startup record")
    if (
      Object.keys(process.env).some(
        (name) => !["PORT", "STUDIO_RENDER_BROKER_PUBLIC_KEY"].includes(name),
      )
    )
      throw new StudioContainmentError("Unexpected execution environment")
    descriptor = await open("/proc/self/fd/3", "r")
    const info = await descriptor.stat()
    if (!info.isFile() || info.size < 1 || info.size > 128)
      throw new StudioContainmentError("Invalid startup descriptor")
    const evidence = JSON.parse(await descriptor.readFile("utf8"))
    const [status, limits, mapping] = await Promise.all([
      readFile("/proc/self/status", "utf8"),
      readFile("/proc/self/limits", "utf8"),
      readFile("/proc/self/uid_map", "utf8"),
    ])
    if (
      process.pid !== 1 ||
      process.getuid() !== 1000 ||
      process.geteuid() !== 1000 ||
      evidence.version !== 1 ||
      evidence.aggregateTasks !== 128 ||
      evidence.uid !== 1000 ||
      !/^Max processes\s+128\s+128\s+processes[ \t]*$/m.test(limits) ||
      !/^NoNewPrivs:\s+1$/m.test(status) ||
      !/^\s*1000\s+\d+\s+1\s*$/.test(mapping) ||
      !["CapInh", "CapPrm", "CapEff", "CapAmb"].every(
        (name) =>
          status
            .split("\n")
            .find((line) => line.startsWith(name + ":"))
            ?.split(":")[1]
            ?.trim() === "0000000000000000",
      )
    )
      throw new StudioContainmentError("Invalid startup kernel state")
    return { version: 1, aggregateTasks: 128, uid: 1000 }
  } catch {
    throw new StudioContainmentError(
      "Native execution startup attestation required",
    )
  } finally {
    await descriptor?.close()
  }
}
