"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The one lock for each Mac user (KTD13): run, session, record-search, and
// setup take it. A pid alone is not proof, because macOS reuses pids, so the
// lock also holds the process start time that `ps` reports.

const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")

const { run } = require("./proc")

const LOCK_FILE = "lock.json"
const PS_TIMEOUT_MS = 10_000
// A fixed locale keeps the `lstart` text the same for the writer and the reader.
const PS_ENV = Object.freeze({ PATH: "/usr/bin:/bin", LC_ALL: "C" })

class LockError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "LockError"
    this.code = code
  }
}

function lockPath(home) {
  return path.join(home, LOCK_FILE)
}

/** The `ps -o lstart=` text of a live pid, or null when no process has it. */
async function processStart(pid, { runChild = run } = {}) {
  const result = await runChild(
    "/bin/ps",
    ["-o", "lstart=", "-p", String(pid)],
    { env: PS_ENV, timeoutMs: PS_TIMEOUT_MS },
  )
  const text = result.code === 0 ? result.stdout.trim() : ""
  return text === "" ? null : text
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

function isLockRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.processStart === "string" &&
    typeof value.mode === "string"
  )
}

/** `{ state: "free" | "held" | "stale", lock, reason, text }`, and no write. */
async function inspectLock(home, options = {}) {
  let text
  try {
    text = fs.readFileSync(lockPath(home), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") {
      return { state: "free", lock: null, reason: null, text: null }
    }
    throw error
  }
  let lock = null
  try {
    lock = JSON.parse(text)
  } catch {
    lock = null
  }
  if (!isLockRecord(lock)) {
    return { state: "stale", lock: null, reason: "unreadable", text }
  }
  const alive = options.isAlive ?? isAlive
  if (!alive(lock.pid)) {
    return { state: "stale", lock, reason: "pid_ended", text }
  }
  const started = await (options.processStart ?? processStart)(
    lock.pid,
    options,
  )
  if (started !== lock.processStart) {
    return { state: "stale", lock, reason: "pid_reused", text }
  }
  return { state: "held", lock, reason: null, text }
}

// A link fails when the target exists, and the linked file is already whole,
// so no reader can see a half-written lock.
function createExclusive(file, text) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  fs.writeFileSync(temp, text, { flag: "wx" })
  try {
    fs.linkSync(temp, file)
    return true
  } catch (error) {
    if (error.code === "EEXIST") return false
    throw error
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

// Two runners can find the same stale lock. Each moves the file aside and
// keeps it only when it is the lock it judged stale.
function takeOver(file, staleText, pid) {
  const aside = `${file}.${pid}.stale`
  try {
    fs.renameSync(file, aside)
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
  const moved = fs.readFileSync(aside, "utf8")
  if (moved !== staleText) {
    try {
      fs.linkSync(aside, file)
    } catch {
      // A third runner wrote a new lock; that lock wins.
    }
  }
  fs.rmSync(aside, { force: true })
  return moved === staleText
}

function sameLock(a, b) {
  return (
    isLockRecord(a) &&
    a.pid === b.pid &&
    a.processStart === b.processStart &&
    a.mode === b.mode &&
    a.runId === b.runId
  )
}

/** Removes the lock only while it is still this holder's lock. */
function releaseLock(home, lock) {
  const file = lockPath(home)
  let current
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return false
  }
  if (!sameLock(current, lock)) return false
  fs.rmSync(file, { force: true })
  return true
}

// Resolves `{ ok: true, lock, replaced, release }`, or `{ ok: false, lock }`
// when a live process holds it. `replaced` is the stale lock it took over.
async function acquireLock(home, options) {
  const { mode, runId = null, pid = process.pid } = options
  fs.mkdirSync(home, { recursive: true })
  const file = lockPath(home)
  const started = await (options.processStart ?? processStart)(pid, options)
  if (started === null) {
    throw new LockError(
      "process_start_unreadable",
      `ps does not give a start time for pid ${pid}`,
    )
  }
  const lock = { pid, processStart: started, mode, runId }
  const text = `${JSON.stringify(lock)}\n`
  let replaced = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (createExclusive(file, text)) {
      return {
        ok: true,
        lock,
        replaced,
        release: () => releaseLock(home, lock),
      }
    }
    const current = await inspectLock(home, options)
    if (current.state === "held") return { ok: false, lock: current.lock }
    if (current.state === "stale" && takeOver(file, current.text, pid)) {
      replaced = current.lock
    }
  }
  throw new LockError(
    "lock_contended",
    `${file} changed three times while this runner tried to take it`,
  )
}

module.exports = {
  LOCK_FILE,
  LockError,
  acquireLock,
  inspectLock,
  isAlive,
  lockPath,
  processStart,
  releaseLock,
}
