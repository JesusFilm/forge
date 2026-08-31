import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"

type Metadata = { token: string; pid: number; createdAt: string }
export type OwnedFileLockOptions = {
  retryMs?: number
  timeoutMs?: number
  staleMs?: number
  now?: () => number
  afterStaleRead?: () => void | Promise<void>
}

const coded = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === code
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
const parse = (raw: string): Metadata | null => {
  try {
    const value = JSON.parse(raw) as Partial<Metadata>
    return typeof value.token === "string" &&
      Number.isSafeInteger(value.pid) &&
      typeof value.createdAt === "string"
      ? (value as Metadata)
      : null
  } catch {
    return null
  }
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return coded(error, "EPERM")
  }
}

async function guarded<T>(
  lock: string,
  deadline: number,
  now: () => number,
  retryMs: number,
  action: () => Promise<T>,
): Promise<T> {
  const guard = `${lock}.guard`
  for (;;) {
    try {
      await mkdir(guard)
      break
    } catch (error) {
      if (!coded(error, "EEXIST") || now() >= deadline) throw error
      await sleep(retryMs)
    }
  }
  try {
    return await action()
  } finally {
    await rm(guard, { recursive: true, force: true })
  }
}

async function staleOwner(
  lock: string,
  staleMs: number,
  now: number,
): Promise<Metadata | null | false> {
  try {
    const [details, raw] = await Promise.all([
      stat(lock),
      readFile(lock, "utf8"),
    ])
    if (now - details.mtimeMs < staleMs) return false
    const owner = parse(raw)
    return owner && alive(owner.pid) ? false : owner
  } catch (error) {
    if (coded(error, "ENOENT")) return false
    throw error
  }
}

/** Exclusive owner-token lock with guarded, identity-checked stale recovery. */
export async function withOwnedFileLock<T>(
  lock: string,
  action: () => Promise<T>,
  options: OwnedFileLockOptions = {},
): Promise<T> {
  const retryMs = options.retryMs ?? 10
  const timeoutMs = options.timeoutMs ?? 10_000
  const staleMs = options.staleMs ?? 60_000
  const now = options.now ?? Date.now
  const deadline = now() + timeoutMs
  const token = randomUUID()
  const contents = JSON.stringify({
    token,
    pid: process.pid,
    createdAt: new Date(now()).toISOString(),
  } satisfies Metadata)

  for (;;) {
    const acquired = await guarded(lock, deadline, now, retryMs, async () => {
      try {
        await writeFile(lock, contents, { flag: "wx", mode: 0o600 })
        return true
      } catch (error) {
        if (!coded(error, "EEXIST")) throw error
        return false
      }
    })
    if (acquired) break

    const observed = await staleOwner(lock, staleMs, now())
    if (observed !== false) {
      await options.afterStaleRead?.()
      const recovered = await guarded(
        lock,
        deadline,
        now,
        retryMs,
        async () => {
          const current = await staleOwner(lock, staleMs, now())
          if (
            current === false ||
            current?.token !== observed?.token ||
            (current === null) !== (observed === null)
          )
            return false
          const quarantine = `${lock}.stale-${randomUUID()}`
          await rename(lock, quarantine)
          await rm(quarantine, { force: true })
          return true
        },
      )
      if (recovered) continue
    }
    if (now() >= deadline)
      throw new Error(
        `timed out after ${timeoutMs}ms waiting for lock ${lock}; if no command is running, remove the stale lock and retry`,
      )
    await sleep(retryMs)
  }

  try {
    return await action()
  } finally {
    await guarded(lock, deadline, now, retryMs, async () => {
      try {
        if (parse(await readFile(lock, "utf8"))?.token === token)
          await rm(lock, { force: true })
      } catch (error) {
        if (!coded(error, "ENOENT")) throw error
      }
    })
  }
}
