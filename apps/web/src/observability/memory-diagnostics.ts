import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const DEFAULT_INTERVAL_MS = 60_000
const MIN_INTERVAL_MS = 10_000
const MAX_PROCESSES = 8
const BYTE_PATHS = {
  cgroupV1Limit: "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  cgroupV1Usage: "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  cgroupV2Limit: "/sys/fs/cgroup/memory.max",
  cgroupV2Usage: "/sys/fs/cgroup/memory.current",
} as const

type ProcessSummary = {
  args: string
  command: string
  pid: number
  ppid: number
  rssBytes: number
  vszBytes: number
}

let started = false

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "")
}

function intervalMs(value: string | undefined): number {
  if (!value) return DEFAULT_INTERVAL_MS
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS

  return Math.max(MIN_INTERVAL_MS, Math.trunc(parsed))
}

async function readByteFile(path: string): Promise<number | undefined> {
  try {
    const value = (await fs.readFile(path, "utf8")).trim()
    if (value === "max") return undefined

    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function cgroupMemory(): Promise<{
  limitBytes?: number
  usageBytes?: number
}> {
  const [v2Usage, v2Limit] = await Promise.all([
    readByteFile(BYTE_PATHS.cgroupV2Usage),
    readByteFile(BYTE_PATHS.cgroupV2Limit),
  ])
  if (v2Usage !== undefined || v2Limit !== undefined) {
    return { limitBytes: v2Limit, usageBytes: v2Usage }
  }

  const [v1Usage, v1Limit] = await Promise.all([
    readByteFile(BYTE_PATHS.cgroupV1Usage),
    readByteFile(BYTE_PATHS.cgroupV1Limit),
  ])
  return { limitBytes: v1Limit, usageBytes: v1Usage }
}

async function directoryBytes(path: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync("du", ["-sb", path], {
      timeout: 5_000,
    })
    const [bytes] = stdout.trim().split(/\s+/, 1)
    const parsed = Number(bytes)
    return Number.isFinite(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function topProcesses(): Promise<ProcessSummary[]> {
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-eo", "pid,ppid,rss,vsz,comm,args", "--sort=-rss"],
      { timeout: 5_000 },
    )
    return stdout
      .trim()
      .split("\n")
      .slice(1, MAX_PROCESSES + 1)
      .map((line) => {
        const match = line
          .trim()
          .match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
        if (!match) return undefined

        const [, pid, ppid, rssKb, vszKb, command, args] = match
        return {
          args,
          command,
          pid: Number(pid),
          ppid: Number(ppid),
          rssBytes: Number(rssKb) * 1024,
          vszBytes: Number(vszKb) * 1024,
        }
      })
      .filter((summary): summary is ProcessSummary => summary !== undefined)
  } catch {
    return []
  }
}

async function sampleMemoryDiagnostics(): Promise<void> {
  const [cgroup, tmpBytes, nextCacheBytes, processes] = await Promise.all([
    cgroupMemory(),
    directoryBytes("/tmp"),
    directoryBytes(".next/cache"),
    topProcesses(),
  ])

  console.info("[memory-diagnostics] sample", {
    cgroup,
    disk: {
      nextCacheBytes,
      tmpBytes,
    },
    process: {
      memoryUsage: process.memoryUsage(),
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
    },
    topProcesses: processes,
  })
}

export function startMemoryDiagnostics(): void {
  if (started || !enabled(process.env.FORGE_MEMORY_DIAGNOSTICS_ENABLED)) return
  started = true

  let sampling = false
  const run = () => {
    if (sampling) return
    sampling = true
    sampleMemoryDiagnostics()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[memory-diagnostics] sample failed: ${message}`)
      })
      .finally(() => {
        sampling = false
      })
  }

  run()
  setInterval(
    run,
    intervalMs(process.env.FORGE_MEMORY_DIAGNOSTICS_INTERVAL_MS),
  ).unref()
}
