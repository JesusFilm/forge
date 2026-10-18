// Trusted LXD guest agent input, never mounted into authored containers.
import { readFile, open, unlink, readdir } from "node:fs/promises"
import { constants } from "node:fs"
import { execFileSync } from "node:child_process"
export function retirementClear(cycles, containers, cgroups) {
  return (
    cycles.every((s) => !s.assignment || s.complete) &&
    !containers.trim() &&
    !cgroups.some((name) => /^forge-studio-j[a-f0-9]{32}\.slice$/.test(name))
  )
}
export async function inspectGate(port) {
  const owner = await port.owner()
  if (owner === "manual") return "blocked"
  const { state, active } = await port.status()
  if (owner === "none") {
    if (active === "active" && state === "idle") return "idle"
    if (active === "active" && ["assigned", "settled"].includes(state))
      return "working"
    return "busy"
  }
  if (state !== "drained" || active !== "inactive") return "draining"
  return (await port.retired()) ? "safe" : "blocked"
}
async function main() {
  const watchdog = setTimeout(() => {
    console.error("Guest gate timed out")
    process.exit(1)
  }, 20000)
  watchdog.unref()
  const { VmJournal } = await import("/opt/forge-studio/current/vm/journal.mjs")
  const { readCycleState } =
    await import("/opt/forge-studio/current/vm/cycle-state.mjs")
  const { loadHostConfig } =
    await import("/opt/forge-studio/current/vm/config.mjs")
  const action = process.argv[2]
  const drain = "/var/lib/forge-studio/drain"
  const marker = "forge-studio-on-demand/1\n"
  const system = (...args) =>
    execFileSync("/usr/bin/systemctl", args, {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  async function drainOwner() {
    try {
      const file = await open(drain, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const stat = await file.stat()
        if (
          !stat.isFile() ||
          stat.uid !== 0 ||
          stat.nlink !== 1 ||
          stat.mode & 0o077 ||
          stat.size > 128
        )
          return "manual"
        return (await file.readFile("utf8")) === marker
          ? "controller"
          : "manual"
      } finally {
        await file.close()
      }
    } catch (error) {
      if (error.code === "ENOENT") return "none"
      throw error
    }
  }
  async function inspect() {
    return inspectGate({
      owner: drainOwner,
      status: async () => ({
        state: JSON.parse(
          await readFile("/var/lib/forge-studio/status.json", "utf8"),
        ).state,
        active: system(
          "show",
          "forge-studio-supervisor",
          "--property=ActiveState",
          "--value",
        ),
      }),
      retired: async () => {
        const cycles = []
        for (const entry of await readdir("/var/lib/forge-studio/poll", {
          withFileTypes: true,
        })) {
          if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name))
            throw Error("Unexpected journal")
          cycles.push(
            await readCycleState(
              new VmJournal("/var/lib/forge-studio/poll/" + entry.name),
            ),
          )
        }
        const containers = execFileSync(
          "/usr/bin/docker",
          ["ps", "-aq", "--filter", "label=io.forge.studio.job"],
          { encoding: "utf8", timeout: 10000 },
        )
        const cgroups = await readdir(
          "/sys/fs/cgroup/forge.slice/forge-studio.slice",
        ).catch((error) => {
          if (error.code === "ENOENT") return []
          throw error
        })
        return retirementClear(cycles, containers, cgroups)
      },
    })
  }
  async function syncDirectory() {
    const f = await open("/var/lib/forge-studio", "r")
    try {
      await f.sync()
    } finally {
      await f.close()
    }
  }

  try {
    if (process.getuid() !== 0 || !["probe", "drain", "wake"].includes(action))
      throw Error("Refused")
    if (!(await loadHostConfig()).enabled) throw Error("Disabled worker")
    const owner = await drainOwner()
    if (action === "drain" && owner === "none") {
      const f = await open(drain, "wx", 0o600)
      try {
        await f.writeFile(marker)
        await f.sync()
      } finally {
        await f.close()
      }
      await syncDirectory()
    }
    if (action === "wake") {
      if (owner === "manual") throw Error("Manual drain")
      if (owner === "controller") {
        await unlink(drain)
        await syncDirectory()
      }
      system("start", "docker.service")
      system("start", "forge-studio-supervisor.service")
    }
    console.log(JSON.stringify({ version: 1, state: await inspect() }))
  } catch {
    console.error("Guest readiness or retirement unconfirmed")
    process.exitCode = 1
  }
}
if (process.argv[1] === "-") await main()
