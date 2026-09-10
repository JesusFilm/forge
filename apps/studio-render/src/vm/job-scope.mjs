import { VmInvariantError } from "./errors.mjs"
import { mkdir, readFile, writeFile, stat } from "node:fs/promises"
import { jobIdentity } from "./profile.mjs"
import { runHostCommand } from "./host-command.mjs"
const boot = async () =>
  (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()
const now = () => Number(process.hrtime.bigint() / 1000000n)
const unitBody =
  "[Unit]\nDescription=Studio immutable bounded execution\nStopWhenUnneeded=no\n[Slice]\nCPUQuota=200%\nMemoryMax=2147483648\nMemorySwapMax=0\nTasksMax=128\n"
const system = (args, absoluteDeadlineMs) =>
  runHostCommand("/usr/bin/systemctl", args, {
    timeoutMs: 10000,
    absoluteDeadlineMs,
  })
async function exclusive(path, body) {
  try {
    await writeFile(path, body, { flag: "wx", mode: 0o600 })
  } catch (error) {
    if (error.code !== "EEXIST" || (await readFile(path, "utf8")) !== body)
      throw error
  }
}
export async function createJobScope(id, record, journal, watchdogPath) {
  if (
    process.getuid() !== 0 ||
    !/^\/opt\/forge-studio\/releases\/[a-f0-9]{64}\/vm-watchdog$/.test(
      watchdogPath,
    )
  )
    throw new VmInvariantError("Trusted installed watchdog required")
  if (record.binding.bootId !== (await boot()) || record.deadlineMs <= now())
    throw new VmInvariantError("Original boot/deadline is no longer usable")
  const identity = jobIdentity(id)
  const existing = await journal.read("scope.json")
  if (existing) {
    // A previous scope must still be exactly the issued inode. Never recreate a
    // missing path and reinterpret a persisted readiness record as current.
    const current = await stat(identity.cgroup, { bigint: true })
    if (String(current.ino) !== existing.cgroupInode)
      throw new VmInvariantError(
        "Issued cgroup changed; reconciliation required",
      )
    return existing
  }
  await mkdir(identity.directory, { recursive: true, mode: 0o700 })
  await exclusive(`/run/systemd/system/${identity.slice}`, unitBody)
  await system(["daemon-reload"])
  await system(["start", identity.slice])
  const inode = String((await stat(identity.cgroup, { bigint: true })).ino)
  const gate = {
    bootId: record.binding.bootId,
    deadlineMs: record.deadlineMs,
    cgroupInode: inode,
  }
  const saved = await journal.writeOnce("scope.json", gate)
  if (JSON.stringify(saved.value) !== JSON.stringify(gate))
    throw new VmInvariantError("Changed cgroup admission binding")
  await runHostCommand(
    "/usr/bin/systemd-run",
    [
      `--unit=forge-studio-watchdog-${id}`,
      "--property=Type=notify",
      "--property=NotifyAccess=main",
      `--property=Requires=${identity.slice}`,
      `--property=After=${identity.slice}`,
      "--property=Restart=on-failure",
      "--property=RestartSec=100ms",
      "--property=MemoryMax=32M",
      "--property=TasksMax=8",
      "--property=CPUQuota=5%",
      watchdogPath,
      id,
      gate.bootId,
      String(gate.deadlineMs),
      gate.cgroupInode,
    ],
    { timeoutMs: Math.max(1, Math.min(10000, gate.deadlineMs - now())) },
  )
  return gate
}

/** Called only after exact runtime identity reconciliation and controller exit.
 * Merely seeing an empty cgroup is never sufficient to invoke this function. */
export async function retireJobScope(id, journal, until = now() + 2000) {
  const identity = jobIdentity(id),
    gate = await journal.read("scope.json")
  const reconciled = await journal.read("runtime-reconciled.json")
  if (!reconciled || reconciled.id !== id || reconciled.complete !== true)
    throw new VmInvariantError("Runtime reconciliation required")
  if (gate && gate.bootId === (await boot())) {
    if (
      String((await stat(identity.cgroup, { bigint: true })).ino) !==
      gate.cgroupInode
    )
      throw new VmInvariantError("Issued cgroup changed")
    if (
      (await readFile(identity.cgroup + "/cgroup.events", "utf8")).includes(
        "populated 1",
      )
    )
      throw new VmInvariantError("Job descendants remain")
    await exclusive(identity.directory + "/retired", "")
    for (;;) {
      const state = (
        await system(
          [
            "show",
            `forge-studio-watchdog-${id}`,
            "--property=ActiveState",
            "--value",
          ],
          until,
        )
      ).stdout.trim()
      if (state === "inactive") break
      if (now() >= until)
        throw new VmInvariantError("Watchdog retirement unconfirmed")
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await system(["stop", identity.slice], until)
  }
  await journal.writeOnce("retired.json", { id, complete: true })
}
export async function cancelJobScope(id) {
  // Native deadline owner notices this independently of any Node event loop.
  await exclusive(jobIdentity(id).directory + "/cancelled", "")
}

export async function assertRetirementBarrier(id, gate, until = now() + 2000) {
  const identity = jobIdentity(id)
  if (!gate || gate.bootId !== (await boot()))
    throw new VmInvariantError("Original retirement scope unavailable")
  for (;;) {
    if (
      String((await stat(identity.cgroup, { bigint: true })).ino) !==
      gate.cgroupInode
    )
      throw new VmInvariantError("Retirement cgroup changed")
    const state = (
      await system(
        ["show", identity.slice, "--property=ActiveState", "--value"],
        until,
      )
    ).stdout.trim()
    if (state !== "active")
      throw new VmInvariantError("Pinned retirement slice is not active")
    if (
      (await readFile(identity.cgroup + "/cgroup.freeze", "utf8")).trim() ===
        "1" &&
      /(^|\n)frozen 1(\n|$)/.test(
        await readFile(identity.cgroup + "/cgroup.events", "utf8"),
      )
    )
      return
    if (now() >= until)
      throw new VmInvariantError("Native retirement barrier unconfirmed")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
