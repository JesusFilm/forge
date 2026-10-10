const { Buffer } = globalThis
import { spawn } from "node:child_process"
import { realpath } from "node:fs/promises"
import { join } from "node:path"

export class StudioExecutionError extends Error {
  constructor(code, detail = "") {
    super(`Studio execution ${code}: ${detail}`)
    this.code = code
  }
}

/** Image-owned paths only. No field in this configuration is supplied by jobs.
 * The service verifies its aggregate cgroup budget before calling this launcher.
 * Local namespace tests exercise this boundary without claiming cgroup proof. */
export async function executeStudioChild(config, signal) {
  signal?.throwIfAborted()
  const stdoutBytes = config.stdoutBytes ?? 134217728
  const timeoutMs = config.timeoutMs ?? 60000
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 3600000 ||
    !Number.isInteger(stdoutBytes) ||
    stdoutBytes < 1 ||
    stdoutBytes > 134217728
  )
    throw new StudioExecutionError("CONFIG")
  if (
    config.deadlineMs !== undefined &&
    (!Number.isSafeInteger(config.deadlineMs) || config.deadlineMs < 1)
  )
    throw new StudioExecutionError("CONFIG")
  const args = [
    "--unshare-all",
    "--unshare-user",
    "--disable-userns",
    "--assert-userns-disabled",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--uid",
    "1000",
    "--gid",
    "1000",
    "--cap-drop",
    "ALL",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/lib64",
    "/lib64",
    "--symlink",
    "usr/bin",
    "/bin",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--size",
    "8388608",
    "--tmpfs",
    "/dev/shm",
    "--size",
    "268435456",
    "--tmpfs",
    "/tmp",
    "--ro-bind",
    await realpath(config.node),
    "/runtime/node",
    "--ro-bind",
    await realpath(config.child),
    "/runtime/child.mjs",
    "--ro-bind",
    await realpath(join(config.nativeDir, "sandbox-init")),
    "/runtime/init",
    "--ro-bind",
    await realpath(config.input),
    "/input",
    "--chdir",
    "/input",
  ]
  // Only these fixed image resources can be added; no arbitrary job bind list.
  if (config.browser)
    args.push(
      "--ro-bind",
      await realpath(join(config.nativeDir, "chrome-launcher")),
      "/runtime/chrome-launcher",
    )
  for (const [key, dest] of [
    ["dependencies", "/deps"],
    ["browser", "/browser"],
    ["bundle", "/bundle"],
    ["codec", "/codec"],
  ]) {
    if (config[key]) args.push("--ro-bind", await realpath(config[key]), dest)
  }
  if (config.renderer) {
    if (!config.renderer.startsWith("/deps/") || config.renderer.includes(".."))
      throw new StudioExecutionError("CONFIG")
    args.push("--symlink", config.renderer, "/runtime/renderer.cjs")
  }
  args.push("--", "/runtime/init")
  return new Promise((done, fail) => {
    const child = spawn(
      join(config.nativeDir, "guard"),
      [
        ...(config.deadlineMs === undefined
          ? [String(timeoutMs)]
          : ["--deadline", String(config.deadlineMs)]),
        String(stdoutBytes),
        "65536",
        "--",
        "/usr/bin/bwrap",
        ...args,
      ],
      { env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"] },
    )
    let size = 0,
      errors = 0,
      overflow = false
    const chunks = [],
      diagnostics = []
    const cancel = () => child.kill("SIGTERM")
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()
    child.stdout.on("data", (chunk) => {
      size += chunk.length
      if (size > stdoutBytes) {
        overflow = true
        cancel()
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on("data", (chunk) => {
      const keep = chunk.subarray(0, Math.max(0, 65536 - errors))
      errors += keep.length
      diagnostics.push(keep)
    })
    child.on("error", (error) => {
      signal?.removeEventListener("abort", cancel)
      fail(error)
    })
    child.on("exit", (code, killedBy) => {
      // A dead supervisor cannot attest that its descendants were reaped.
      // Do not wait for inherited pipes to close, or let cancellation hide a
      // fatal teardown result. The execution service must retire its container.
      if (killedBy || code === 127) {
        signal?.removeEventListener("abort", cancel)
        child.stdout.destroy()
        child.stderr.destroy()
        fail(new StudioExecutionError("ISOLATION_LOST"))
      }
    })
    child.on("close", (code) => {
      signal?.removeEventListener("abort", cancel)
      if (code === 127) return fail(new StudioExecutionError("ISOLATION_LOST"))
      if (signal?.aborted) return fail(new StudioExecutionError("CANCELLED"))
      if (overflow || code !== 0)
        return fail(
          new StudioExecutionError(
            code === 127
              ? "ISOLATION_LOST"
              : code === 124
                ? "TIMEOUT"
                : code === 125 || overflow
                  ? "OUTPUT_LIMIT"
                  : "FAILED",
            Buffer.concat(diagnostics).toString().slice(-2000),
          ),
        )
      done(Buffer.concat(chunks, size))
    })
  })
}
