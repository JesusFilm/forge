"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global clearTimeout, module, require, setTimeout */
// The one way the runner starts a child (KTD13): a deadline, its own process
// group, an empty stdin, and only the environment the caller builds. macOS has
// no GNU `timeout`, and a hung `simctl` call can hold a device for hours.

const { spawn } = require("node:child_process")
const fs = require("node:fs")

const KILL_GRACE_MS = 2000
const DEFAULT_TAIL_BYTES = 64 * 1024

const active = new Set()

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    // The group has already ended.
  }
}

function stopChild(entry, reason) {
  if (entry.reason) return
  entry.reason = reason
  signalGroup(entry.child, "SIGTERM")
  entry.killTimer = setTimeout(
    () => signalGroup(entry.child, "SIGKILL"),
    KILL_GRACE_MS,
  )
}

function appendTail(tail, chunk, limit) {
  const next = tail + chunk
  return next.length > limit ? next.slice(next.length - limit) : next
}

/**
 * Runs `command` and resolves with `{ code, signal, timedOut, stopped,
 * stdout, stderr, durationMs, error }`. It never rejects for a child failure.
 */
function run(command, args, options) {
  const {
    cwd,
    env,
    timeoutMs,
    logFile,
    tailBytes = DEFAULT_TAIL_BYTES,
  } = options ?? {}
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error("run() needs a positive timeoutMs"))
  }
  if (!env) return Promise.reject(new Error("run() needs an explicit env"))

  const started = Date.now()
  const log = logFile ? fs.createWriteStream(logFile, { flags: "a" }) : null
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      log?.end()
      resolve(result(null, null, error))
      return
    }
    const entry = { child, reason: null, killTimer: null }
    let stdout = ""
    let stderr = ""
    let settled = false

    function result(code, signal, error) {
      return {
        code,
        signal,
        timedOut: entry?.reason === "timeout",
        stopped: entry?.reason === "stopped",
        stdout,
        stderr,
        durationMs: Date.now() - started,
        error: error ? String(error.message ?? error) : null,
      }
    }

    function settle(code, signal, error) {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(entry.killTimer)
      active.delete(entry)
      log?.end()
      resolve(result(code, signal, error))
    }

    active.add(entry)
    const deadline = setTimeout(() => stopChild(entry, "timeout"), timeoutMs)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      log?.write(chunk)
      stdout = appendTail(stdout, chunk, tailBytes)
    })
    child.stderr.on("data", (chunk) => {
      log?.write(chunk)
      stderr = appendTail(stderr, chunk, tailBytes)
    })
    child.on("error", (error) => settle(null, null, error))
    child.on("close", (code, signal) => settle(code, signal, null))
  })
}

/** Stops every running child, for the end path of a run (R38). */
async function stopAll() {
  const entries = [...active]
  const closed = entries.map(
    (entry) => new Promise((resolve) => entry.child.once("close", resolve)),
  )
  for (const entry of entries) stopChild(entry, "stopped")
  await Promise.all(closed)
}

function activeChildCount() {
  return active.size
}

module.exports = { activeChildCount, run, stopAll }
