const { URL, setTimeout, clearTimeout } = globalThis
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "studio460-death-"))
  const guard = join(dir, "guard")
  const compiled = spawnSync(
    "cc",
    [
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      fileURLToPath(new URL("../native/guard.c", import.meta.url)),
      "-o",
      guard,
    ],
    { encoding: "utf8" },
  )
  assert.equal(compiled.status, 0, compiled.stderr)
  return { dir, guard }
}
function descendants(pid) {
  let children = []
  try {
    children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
  } catch {
    /* Teardown may already have reaped this process. */
  }
  return children.flatMap((child) => [child, ...descendants(child)])
}
function dead(pids) {
  for (const pid of pids)
    assert.throws(
      () => process.kill(pid, 0),
      { code: "ESRCH" },
      `surviving PID ${pid}`,
    )
}

for (const victim of ["launcher", "namespace-init"])
  test(
    `namespace ${victim} death tears down all descendants before the next job`,
    { timeout: 6000 },
    async () => {
      const { dir, guard } = fixture()
      let running,
        pids = []
      try {
        running = spawn(
          guard,
          [
            "2000",
            "4096",
            "1024",
            "--",
            "/usr/bin/bwrap",
            "--unshare-all",
            "--unshare-user",
            "--die-with-parent",
            "--ro-bind",
            "/usr",
            "/usr",
            "--ro-bind",
            "/lib",
            "/lib",
            "--ro-bind",
            "/lib64",
            "/lib64",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--",
            "/usr/bin/python3",
            "-c",
            `import os,time
p=os.fork()
if not p:
 os.setsid()
 if os.fork(): os._exit(0)
 os.close(1);os.close(2)
 time.sleep(30)
else:
 time.sleep(.1)
 print('ready',flush=True)
 time.sleep(30)`,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        )
        const watchdog = setTimeout(() => {
          for (const pid of [...pids, running.pid])
            try {
              process.kill(pid, "SIGKILL")
            } catch {
              /* Teardown may already have reaped this process. */
            }
        }, 3500)
        try {
          const completion = new Promise((resolve) =>
            running.once("close", (code, signal) => resolve({ code, signal })),
          )
          await new Promise((resolve, reject) => {
            running.stdout.once("data", resolve)
            running.once("exit", () =>
              reject(new Error("launcher exited before fixture readiness")),
            )
          })
          pids = descendants(running.pid)
          assert.ok(
            pids.length >= 3,
            `expected launcher, init and descendants: ${pids}`,
          )
          const target =
            victim === "launcher"
              ? pids[0]
              : pids.find((pid) =>
                  /^NSpid:\s+\d+\s+1\s*$/m.test(
                    readFileSync(`/proc/${pid}/status`, "utf8"),
                  ),
                )
          assert.ok(target, "private namespace init must be observable")
          const start = Date.now()
          process.kill(target, "SIGKILL")
          const result = await completion
          assert.notEqual(result.code, 0)
          assert.equal(result.signal, null)
          assert.ok(Date.now() - start < 2500)
          dead(pids)
          const next = spawnSync(
            guard,
            ["500", "1024", "1024", "--", "/usr/bin/printf", "next-job"],
            { encoding: "utf8", timeout: 1500, killSignal: "SIGKILL" },
          )
          assert.equal(next.status, 0)
          assert.equal(next.stdout, "next-job")
          dead(pids)
        } finally {
          clearTimeout(watchdog)
        }
      } finally {
        for (const pid of [...pids, running?.pid].filter(Boolean))
          try {
            process.kill(pid, "SIGKILL")
          } catch {
            /* Teardown may already have reaped this process. */
          }
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

test(
  "injected parent fcntl setup failure reaps detached descendants within deadline",
  { timeout: 5000 },
  () => {
    const { dir, guard } = fixture()
    try {
      const shim = join(dir, "fcntl.c"),
        library = join(dir, "fcntl.so"),
        pidfile = join(dir, "descendant")
      // Test-only fault injection outside the execution service. Delay the failure
      // until the child has detached, exercising cleanup beyond the direct child.
      writeFileSync(
        shim,
        "#include <errno.h>\n#include <unistd.h>\nint fcntl(int fd,int cmd,...){(void)fd;(void)cmd;usleep(300000);errno=EBADF;return -1;}\n",
      )
      const compile = spawnSync(
        "cc",
        ["-shared", "-fPIC", shim, "-o", library],
        { encoding: "utf8" },
      )
      assert.equal(compile.status, 0, compile.stderr)
      const start = Date.now()
      const result = spawnSync(
        guard,
        [
          "1000",
          "4096",
          "1024",
          "--",
          "/usr/bin/python3",
          "-c",
          `import os,time
if os.fork(): os._exit(0)
os.setsid()
if os.fork(): os._exit(0)
open(${JSON.stringify(pidfile)},'w').write(str(os.getpid()))
os.close(1);os.close(2)
time.sleep(30)`,
        ],
        {
          env: { PATH: "/usr/bin:/bin", LD_PRELOAD: library },
          timeout: 2000,
          killSignal: "SIGKILL",
        },
      )
      const pid = Number(readFileSync(pidfile, "utf8"))
      if (result.error)
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          /* Teardown may already have reaped this process. */
        }
      assert.equal(result.error, undefined)
      assert.equal(result.status, 126)
      assert.ok(Date.now() - start < 1500)
      dead([pid])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
