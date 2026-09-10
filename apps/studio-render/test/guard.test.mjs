const { URL, setTimeout, clearTimeout, performance } = globalThis
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

test("native supervisor enforces wall deadline and combined child output budgets", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio460-guard-"))
  try {
    const binary = join(dir, "guard")
    const compiled = spawnSync(
      "cc",
      [
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("../native/guard.c", import.meta.url)),
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    )
    assert.equal(compiled.status, 0, compiled.stderr)
    const started = Date.now()
    const hung = spawnSync(
      binary,
      ["150", "4096", "1024", "--", "/usr/bin/sleep", "30"],
      { timeout: 2000 },
    )
    assert.equal(hung.status, 124)
    assert.ok(Date.now() - started < 1500)
    const flood = spawnSync(
      binary,
      ["1000", "4096", "1024", "--", "/usr/bin/yes"],
      { maxBuffer: 20000, timeout: 2000 },
    )
    assert.equal(flood.status, 125)
    assert.ok(flood.stdout.length <= 4096)
    const ok = spawnSync(
      binary,
      ["1000", "4096", "1024", "--", "/usr/bin/printf", "retained-result"],
      { encoding: "utf8", timeout: 2000 },
    )
    assert.equal(ok.status, 0)
    assert.equal(ok.stdout, "retained-result")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test(
  "teardown reaps double-forked descendants even after setsid and closed pipes",
  { timeout: 5000 },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "studio460-teardown-"))
    try {
      const binary = join(dir, "guard")
      assert.equal(
        spawnSync("cc", [
          "-O2",
          fileURLToPath(new URL("../native/guard.c", import.meta.url)),
          "-o",
          binary,
        ]).status,
        0,
      )
      const child = `import os,time
p=os.fork()
if p: os._exit(0)
os.setsid()
p=os.fork()
if p: os._exit(0)
print(os.getpid(),flush=True)
os.close(1);os.close(2)
time.sleep(30)`
      const started = Date.now()
      const run = spawnSync(
        binary,
        ["250", "4096", "1024", "--", "/usr/bin/python3", "-c", child],
        { encoding: "utf8", timeout: 2000, killSignal: "SIGKILL" },
      )
      // If the old supervisor stalls, terminate the disposable descendant too.
      const pid = Number(run.stdout.trim())
      if (run.error && pid > 0) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          /* Teardown may already have reaped this process. */
        }
      }
      assert.equal(run.error, undefined)
      assert.ok(Date.now() - started < 1500)
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test(
  "blocked consumer and missing executable cannot hold teardown open",
  { timeout: 5000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio460-backpressure-"))
    try {
      const binary = join(dir, "guard")
      assert.equal(
        spawnSync("cc", [
          "-O2",
          fileURLToPath(new URL("../native/guard.c", import.meta.url)),
          "-o",
          binary,
        ]).status,
        0,
      )
      const blocked = spawn(
        binary,
        ["150", "268435456", "1024", "--", "/usr/bin/yes"],
        { stdio: ["ignore", "pipe", "pipe"] },
      )
      const watchdog = setTimeout(() => blocked.kill("SIGKILL"), 2000)
      const code = await new Promise((resolve) => blocked.once("exit", resolve))
      clearTimeout(watchdog)
      blocked.stdout.destroy()
      blocked.stderr.destroy()
      assert.equal(code, 124)
      const missing = spawnSync(
        binary,
        ["250", "4096", "1024", "--", "/does-not-exist"],
        { timeout: 2000, killSignal: "SIGKILL" },
      )
      assert.equal(missing.status, 126)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test("absolute deadline remains enforced while the caller event loop is blocked", async () => {
  const dir = mkdtempSync(join(tmpdir(), "studio460-absolute-deadline-"))
  try {
    const binary = join(dir, "guard"),
      marker = join(dir, "escaped-deadline")
    assert.equal(
      spawnSync("cc", [
        "-O2",
        fileURLToPath(new URL("../native/guard.c", import.meta.url)),
        "-o",
        binary,
      ]).status,
      0,
    )
    const deadline = Number(process.hrtime.bigint() / 1000000n) + 150
    const child = spawn(binary, [
      "--deadline",
      String(deadline),
      "4096",
      "1024",
      "--",
      "/usr/bin/python3",
      "-c",
      `import time;time.sleep(.25);open(${JSON.stringify(marker)},'w').write('too late')`,
    ])
    const completed = new Promise((done) => child.once("close", done))
    const until = performance.now() + 350
    while (performance.now() < until) {
      /* Deliberately block the parent event loop. */
    }
    assert.equal(await completed, 124)
    const { existsSync } = await import("node:fs")
    assert.equal(existsSync(marker), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
