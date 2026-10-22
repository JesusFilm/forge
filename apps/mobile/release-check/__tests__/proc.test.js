/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require, setTimeout */
// Every child of the runner (simctl, adb, builds, Maestro) goes through run().
// A hung `simctl listapps` held a device for 20 hours in the U1 spike.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { activeChildCount, run, stopAll } = require("../lib/proc")

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
    expect(Date.now() - started).toBeLessThan(5000)
    const grandchild = Number(fs.readFileSync(pidFile, "utf8"))
    expect(await waitUntilGone(grandchild, 2000)).toBe(true)
  })

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

  it("reports a command that cannot start, without a throw", async () => {
    const result = await run("/no/such/command", [], {
      timeoutMs: 5000,
      env: { PATH: "/usr/bin:/bin" },
    })
    expect(result.code).toBeNull()
    expect(result.error).toMatch(/ENOENT/)
  })

  it("requires a deadline", async () => {
    await expect(
      run("/bin/true", [], { env: { PATH: "/usr/bin:/bin" } }),
    ).rejects.toThrow(/timeoutMs/)
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
