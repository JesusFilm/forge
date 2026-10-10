import { VmInvariantError } from "./errors.mjs"
import { spawn } from "node:child_process"

export class HostCommandError extends Error {
  constructor({ pid, clientStopped, reason }) {
    super(`Host command unsuccessful: ${reason}`)
    this.pid = pid ?? null
    this.clientStopped = clientStopped
    // Killing docker CLI says nothing about the daemon's create/start operation.
    this.runtimeRetired = false
  }
}

/** Trusted fixed-command adapter, never accepts authored command strings/env.
 * Caller owns durable operation intent and runtime reconciliation. */
export async function runHostCommand(
  file,
  args,
  {
    timeoutMs,
    absoluteDeadlineMs,
    signal,
    outputBytes = 1048576,
    errorBytes = 65536,
    text = true,
    onOutput,
  } = {},
) {
  if (
    !file.startsWith("/") ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string") ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 920000 ||
    !Number.isSafeInteger(outputBytes) ||
    outputBytes < 1 ||
    outputBytes > 134217728 ||
    !Number.isSafeInteger(errorBytes) ||
    errorBytes < 1 ||
    errorBytes > 65536
  )
    throw new VmInvariantError("Invalid host command bounds")
  if (
    absoluteDeadlineMs !== undefined &&
    (!Number.isSafeInteger(absoluteDeadlineMs) ||
      absoluteDeadlineMs <= Number(process.hrtime.bigint() / 1000000n))
  )
    throw new HostCommandError({
      clientStopped: true,
      reason: "absolute deadline",
    })
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: "/",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
        DOCKER_HOST: "unix:///var/run/docker.sock",
        DOCKER_CONFIG: "/var/lib/forge-studio/docker-client",
      },
    })
    const output = [],
      errors = []
    let size = 0,
      errorSize = 0,
      reason,
      killTimer,
      terminalTimer,
      absoluteTimer,
      settled = false
    const finish = (stopped, code) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(killTimer)
      clearTimeout(terminalTimer)
      clearTimeout(absoluteTimer)
      signal?.removeEventListener("abort", cancel)
      if (reason || code !== 0 || !stopped) {
        reject(
          new HostCommandError({
            pid: child.pid,
            clientStopped: stopped,
            reason: reason ?? "exit",
          }),
        )
      } else {
        const bytes = Buffer.concat(output, size)
        resolve({
          output: bytes,
          stdout: text ? bytes.toString("utf8") : null,
          stderr: Buffer.concat(errors, errorSize).toString("utf8"),
          pid: child.pid,
          clientStopped: true,
        })
      }
    }
    const stop = (why) => {
      if (reason || settled) return
      reason = why
      child.kill("SIGTERM")
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000)
      terminalTimer = setTimeout(() => {
        child.stdout.destroy()
        child.stderr.destroy()
        finish(false)
      }, 2000)
    }
    const cancel = () => stop("cancelled")
    const deadline = setTimeout(() => stop("deadline"), timeoutMs)
    if (absoluteDeadlineMs !== undefined)
      absoluteTimer = setTimeout(
        () => {
          reason = "absolute deadline"
          child.kill("SIGKILL")
          child.stdout.destroy()
          child.stderr.destroy()
          finish(false)
        },
        Math.max(
          1,
          absoluteDeadlineMs - Number(process.hrtime.bigint() / 1000000n),
        ),
      )
    child.stdout.on("data", (chunk) => {
      if (reason) return
      size += chunk.length
      if (size > outputBytes) {
        stop("output limit")
        return
      }
      output.push(chunk)
      onOutput?.(chunk)
    })
    child.stderr.on("data", (chunk) => {
      if (reason) return
      errorSize += chunk.length
      if (errorSize > errorBytes) {
        stop("diagnostic limit")
        return
      }
      errors.push(chunk)
    })
    child.once("error", () => {
      reason = "spawn"
      finish(true)
    })
    child.once("close", (code) => finish(true, code))
    signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) cancel()
  })
}
