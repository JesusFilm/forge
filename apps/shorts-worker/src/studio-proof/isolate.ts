import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { realpath } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { StudioProofError } from "@forge/shorts-compositions/studio-proof/manifest"

// Local Linux feasibility only. Not wired into the authenticated worker.
// Fail closed if namespace creation, mounts, or resource limits fail.
export async function executeIsolated(options: {
  jobDir: string
  browserDir: string
  script: string
  timeoutMs?: number
}): Promise<string> {
  const deps = await realpath(
    resolve(
      fileURLToPath(new URL("../../../../node_modules", import.meta.url)),
    ),
  )
  const renderer = await realpath(
    fileURLToPath(import.meta.resolve("@remotion/renderer")),
  )
  const rendererInSandbox = renderer.replace(deps, "/deps")
  if (!rendererInSandbox.startsWith("/deps/"))
    throw new StudioProofError(
      "Renderer must resolve inside isolated dependency mount",
    )
  const node = await realpath(process.execPath)
  const args = [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/lib64",
    "/lib64",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--ro-bind",
    node,
    "/runtime/node",
    "--ro-bind",
    deps,
    "/deps",
    "--ro-bind",
    await realpath(options.browserDir),
    "/browser",
    "--ro-bind",
    await realpath(options.script),
    "/runtime/child.mjs",
    "--bind",
    await realpath(options.jobDir),
    "/job",
    "--ro-bind",
    "/etc/fonts",
    "/etc/fonts",
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
    "--chdir",
    "/job",
    "--",
    "/usr/bin/prlimit",
    "--cpu=45",
    "--fsize=134217728",
    "--nofile=256",
    "--",
    "/runtime/node",
    "--max-old-space-size=256",
    "/runtime/child.mjs",
    rendererInSandbox,
  ]
  return new Promise((done, fail) => {
    const unit = `forge-studio-proof-${randomUUID()}`
    const env = {
      PATH: "/usr/bin:/bin",
      XDG_RUNTIME_DIR: `/run/user/${process.getuid!()}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid!()}/bus`,
    }
    const child = spawn(
      "systemd-run",
      [
        "--user",
        "--quiet",
        "--wait",
        "--pipe",
        "--collect",
        `--unit=${unit}`,
        "-p",
        "MemoryMax=2G",
        "-p",
        "MemorySwapMax=0",
        "-p",
        "TasksMax=128",
        "-p",
        "CPUQuota=200%",
        "-p",
        "OOMPolicy=kill",
        "-p",
        `RuntimeMaxSec=${(options.timeoutMs ?? 60_000) / 1000}`,
        "/usr/bin/bwrap",
        ...args,
      ],
      {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    )
    let output = Buffer.alloc(0)
    let terminating = false
    let exceeded = false
    const kill = () => {
      if (terminating) return
      terminating = true
      // Kill the whole cgroup, including Chromium grandchildren. Killing only
      // systemd-run would leave the service alive until RuntimeMaxSec.
      const stopper = spawn(
        "systemctl",
        [
          "--user",
          "kill",
          "--kill-whom=all",
          "--signal=SIGKILL",
          `${unit}.service`,
        ],
        { env, stdio: "ignore" },
      )
      stopper.on("error", () => {
        /* RuntimeMaxSec remains the independent backstop. */
      })
    }
    const timer = setTimeout(() => {
      exceeded = true
      kill()
    }, options.timeoutMs ?? 60_000)
    const collect = (chunk: Buffer) => {
      if (exceeded) return
      const remaining = 65_536 - output.byteLength
      output = Buffer.concat([output, chunk.subarray(0, remaining)])
      if (chunk.byteLength > remaining) {
        exceeded = true
        kill()
      }
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    child.on("error", (error) => {
      clearTimeout(timer)
      fail(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (exceeded)
        fail(
          new StudioProofError(
            "Isolated execution exceeded deadline or output limit",
          ),
        )
      else if (code !== 0)
        fail(
          new StudioProofError(
            `Isolated execution failed (${code}): ${output.toString().slice(-2000)}`,
          ),
        )
      else done(output.toString())
    })
  })
}

export const proofChildPath = fileURLToPath(
  new URL("../../scripts/studio-proof/child.mjs", import.meta.url),
)
export const browserDirectory = (executable: string) => dirname(executable)
