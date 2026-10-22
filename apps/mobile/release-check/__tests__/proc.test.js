/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, afterAll, describe, expect, it, jest, require, setTimeout */
// Every child of the runner (simctl, adb, builds, Maestro) goes through run().
// A hung `simctl listapps` held a device for 20 hours in the U1 spike.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { activeChildCount, run, stopAll } = require("../lib/proc")

// These tests start real shells; on a Mac at load 86, one passed the 5 s
// default limit. The checks do not change, only the time each may take.
jest.setTimeout(20000)

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-proc-"))
  tempDirs.push(dir)
  return dir
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// An ended orphan stays a zombie until launchd reaps it, and kill(pid, 0)
// still succeeds on a zombie.
async function waitUntilGone(pid, limitMs) {
  const end = Date.now() + limitMs
  while (isAlive(pid) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !isAlive(pid)
}

describe("run", () => {
  it("returns the exit code and the output of a child that ends", async () => {
    const result = await run(
      "/bin/sh",
      ["-c", "echo out; echo err >&2; exit 3"],
      {
        timeoutMs: 5000,
        env: { PATH: "/usr/bin:/bin" },
      },
    )
    expect(result).toMatchObject({ code: 3, timedOut: false })
    expect(result.stdout).toBe("out\n")
    expect(result.stderr).toBe("err\n")
  })

  it("gives the child only the environment that the caller builds", async () => {
    process.env.RELEASE_CHECK_PROC_LEAK = "leaked"
    const result = await run(
      "/bin/sh",
      ["-c", 'echo "[$RELEASE_CHECK_PROC_LEAK][$ONLY]"'],
      {
        timeoutMs: 5000,
        env: { PATH: "/usr/bin:/bin", ONLY: "given" },
      },
    )
    delete process.env.RELEASE_CHECK_PROC_LEAK
    expect(result.stdout).toBe("[][given]\n")
  })

  it("gives the child an empty stdin", async () => {
    const result = await run("/bin/cat", [], {
      timeoutMs: 5000,
      env: { PATH: "/usr/bin:/bin" },
    })
    expect(result).toMatchObject({ code: 0, timedOut: false, stdout: "" })
  })

  it("stops the child and its own children at the deadline", async () => {
    const dir = tempDir()
    const pidFile = path.join(dir, "grandchild.pid")
    const started = Date.now()
    const result = await run(
      "/bin/sh",
      ["-c", `sleep 30 & echo $! > ${pidFile}; wait`],
      { timeoutMs: 400, env: { PATH: "/usr/bin:/bin" } },
    )
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(10000)
    const grandchild = Number(fs.readFileSync(pidFile, "utf8"))
    expect(await waitUntilGone(grandchild, 10000)).toBe(true)
  }, 20000)

  it("writes all output to the log file and keeps only a tail in memory", async () => {
    const logFile = path.join(tempDir(), "child.log")
    const result = await run(
      "/bin/sh",
      ["-c", "i=0; while [ $i -lt 2000 ]; do echo line-$i; i=$((i+1)); done"],
      {
        timeoutMs: 5000,
        env: { PATH: "/usr/bin:/bin" },
        logFile,
        tailBytes: 64,
      },
    )
    expect(result.code).toBe(0)
    expect(fs.readFileSync(logFile, "utf8").split("\n")).toHaveLength(2001)
    expect(result.stdout.length).toBeLessThanOrEqual(64)
    expect(result.stdout.endsWith("line-1999\n")).toBe(true)
  })

  it("finishes the log file before it resolves", async () => {
    const logFile = path.join(tempDir(), "flush.log")
    for (let round = 0; round < 5; round++) {
      fs.rmSync(logFile, { force: true })
      await run(
        "/bin/sh",
        ["-c", "i=0; while [ $i -lt 3000 ]; do echo $i; i=$((i+1)); done"],
        {
          timeoutMs: 5000,
          env: { PATH: "/usr/bin:/bin" },
          logFile,
        },
      )
      expect(fs.readFileSync(logFile, "utf8").split("\n")).toHaveLength(3001)
    }
  })

  it("reports a log file that cannot open, without a crash or a hang", async () => {
    const result = await run("/bin/echo", ["hi"], {
      timeoutMs: 5000,
      env: { PATH: "/usr/bin:/bin" },
      logFile: path.join(tempDir(), "no-such-dir", "child.log"),
    })
    expect(result.code).toBe(0)
    expect(result.logError).toMatch(/ENOENT/)
  })

  it("reports a command that cannot start, without a throw", async () => {
    const result = await run("/no/such/command", [], {
      timeoutMs: 5000,
      env: { PATH: "/usr/bin:/bin" },
    })
    expect(result.code).toBeNull()
    expect(result.error).toMatch(/ENOENT/)
  })

  it("reports a spawn that throws at once, without a throw", async () => {
    const result = await run("/bin/echo", ["x"], {
      timeoutMs: 5000,
      env: { PATH: "/usr/bin:/bin" },
      cwd: 42,
    })
    expect(result.code).toBeNull()
    expect(result.error).toMatch(/cwd/)
  })

  it("requires a deadline", async () => {
    await expect(
      run("/bin/true", [], { env: { PATH: "/usr/bin:/bin" } }),
    ).rejects.toThrow(/timeoutMs/)
  })
})

describe("abort signal", () => {
  it("stops one child when its signal aborts", async () => {
    const controller = new AbortController()
    const pending = run("/bin/sleep", ["30"], {
      timeoutMs: 60000,
      env: { PATH: "/usr/bin:/bin" },
      signal: controller.signal,
    })
    controller.abort()
    const result = await pending
    expect(result).toMatchObject({ stopped: true, timedOut: false })
  })

  it("does not start a child when the signal has already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await run("/bin/sleep", ["30"], {
      timeoutMs: 60000,
      env: { PATH: "/usr/bin:/bin" },
      signal: controller.signal,
    })
    expect(result).toMatchObject({ code: null, stopped: true })
    expect(activeChildCount()).toBe(0)
  })
})

describe("stopAll", () => {
  it("stops every child that is still running", async () => {
    const pending = run("/bin/sleep", ["30"], {
      timeoutMs: 60000,
      env: { PATH: "/usr/bin:/bin" },
    })
    expect(activeChildCount()).toBe(1)
    await stopAll()
    const result = await pending
    expect(result.stopped).toBe(true)
    expect(activeChildCount()).toBe(0)
  })
})
