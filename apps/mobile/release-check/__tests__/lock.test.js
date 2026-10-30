/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// KTD13: one lock for each Mac user covers run, session, record-search, and
// setup. A lock whose process ended, or whose pid now names another process,
// is stale, and the next run takes it over.
const childProcess = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const {
  acquireLock,
  inspectLock,
  lockPath,
  processStart,
  releaseLock,
} = require("../lib/lock")

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-lock-"))
  tempDirs.push(dir)
  return dir
}

// spawnSync waits for the child, so its pid names no process afterwards.
function endedPid() {
  return childProcess.spawnSync("/usr/bin/true").pid
}

function writeLock(home, lock) {
  fs.writeFileSync(lockPath(home), `${JSON.stringify(lock)}\n`)
}

describe("processStart", () => {
  it("reads the start time of a live process and gives null for an ended one", async () => {
    const own = await processStart(process.pid)
    expect(own).toMatch(/\d{2}:\d{2}:\d{2} \d{4}$/)
    expect(await processStart(process.pid)).toBe(own)
    expect(await processStart(endedPid())).toBeNull()
  })
})

describe("acquireLock", () => {
  it("writes pid, process start, mode, and run id, and refuses a second taker", async () => {
    const home = tempHome()
    const first = await acquireLock(home, { mode: "run", runId: "r1" })
    expect(first.ok).toBe(true)
    expect(JSON.parse(fs.readFileSync(lockPath(home), "utf8"))).toEqual({
      pid: process.pid,
      processStart: await processStart(process.pid),
      mode: "run",
      runId: "r1",
    })

    const second = await acquireLock(home, { mode: "setup", runId: null })
    expect(second.ok).toBe(false)
    expect(second.lock).toMatchObject({ mode: "run", runId: "r1" })
    expect((await inspectLock(home)).state).toBe("held")

    first.release()
    expect(fs.existsSync(lockPath(home))).toBe(false)
    expect((await inspectLock(home)).state).toBe("free")
  })

  it("takes over a lock whose pid ended and returns the stale lock", async () => {
    const home = tempHome()
    const dead = {
      pid: endedPid(),
      processStart: "x",
      mode: "run",
      runId: "r0",
    }
    writeLock(home, dead)
    expect(await inspectLock(home)).toMatchObject({
      state: "stale",
      reason: "pid_ended",
    })

    const taken = await acquireLock(home, { mode: "run", runId: "r1" })
    expect(taken.ok).toBe(true)
    expect(taken.replaced).toEqual(dead)
    expect(JSON.parse(fs.readFileSync(lockPath(home), "utf8")).runId).toBe("r1")
  })

  it("treats a live pid with another start time as stale", async () => {
    const home = tempHome()
    writeLock(home, {
      pid: process.pid,
      processStart: "Thu Jan  1 00:00:00 1970",
      mode: "run",
      runId: "r0",
    })
    expect(await inspectLock(home)).toMatchObject({
      state: "stale",
      reason: "pid_reused",
    })
    expect((await acquireLock(home, { mode: "run", runId: "r1" })).ok).toBe(
      true,
    )
  })
})

describe("releaseLock", () => {
  it("leaves a lock that another runner took over", async () => {
    const home = tempHome()
    const mine = await acquireLock(home, { mode: "run", runId: "r1" })
    const other = { ...mine.lock, runId: "r2" }
    writeLock(home, other)
    expect(releaseLock(home, mine.lock)).toBe(false)
    expect(JSON.parse(fs.readFileSync(lockPath(home), "utf8"))).toEqual(other)
  })
})
