const { setTimeout, clearTimeout } = globalThis
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"

for (const mode of ["fatal", "shutdown"])
  test(
    `credential-free Node PID1 ${mode} retires detached processes`,
    { timeout: 6000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "studio460-pid1-"))
      let running,
        pids = []
      try {
        const fixture = join(dir, "main.mjs")
        await writeFile(
          fixture,
          `import {createServer} from 'node:http';import {spawn} from 'node:child_process';import {installExecutionLifecycle} from '/runtime/lifecycle.mjs';
if(process.pid!==1)throw new Error('Not private PID1');
const server=createServer((req,res)=>res.end('alive'));
installExecutionLifecycle({server,stop:()=>{}});
const child=spawn('/usr/bin/python3',['-c','import os,signal,time;os.setsid();print("child-ready",flush=True);signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)'],{stdio:['ignore','pipe','ignore']});
child.stdout.once('data',()=>{console.log('ready');setTimeout(()=>${mode === "fatal" ? 'server.emit("isolationLost")' : 'process.kill(1,"SIGTERM")'},200)});
server.listen(0,'127.0.0.1');`,
        )
        running = spawn(
          resolve("apps/studio-render/dist/guard"),
          [
            "2000",
            "4096",
            "1024",
            "--",
            "/usr/bin/bwrap",
            "--unshare-all",
            "--unshare-user",
            "--as-pid-1",
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
            "--ro-bind",
            process.execPath,
            "/runtime/node",
            "--ro-bind",
            fixture,
            "/runtime/main.mjs",
            "--ro-bind",
            resolve("apps/studio-render/src/lifecycle.mjs"),
            "/runtime/lifecycle.mjs",
            "--ro-bind",
            resolve("apps/studio-render/src/budget.mjs"),
            "/runtime/budget.mjs",
            "--",
            "/runtime/node",
            "/runtime/main.mjs",
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        )
        let errors = ""
        running.stderr.on("data", (b) => (errors += b))
        const completed = new Promise((done) =>
          running.once("close", (code, signal) => done({ code, signal })),
        )
        const watchdog = setTimeout(() => running.kill("SIGKILL"), 3500)
        try {
          await new Promise((done, fail) => {
            running.stdout.once("data", done)
            running.once("exit", () => fail(new Error(errors)))
          })
          async function descendants(pid) {
            let children = []
            try {
              children = (
                await readFile(`/proc/${pid}/task/${pid}/children`, "utf8")
              )
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .map(Number)
            } catch {
              /* Teardown may already have reaped this process. */
            }
            const nested = await Promise.all(children.map(descendants))
            return children.concat(...nested)
          }
          pids = await descendants(running.pid)
          assert.ok(pids.length >= 2)
          const result = await completed
          assert.equal(result.signal, null, errors)
          assert.equal(result.code, mode === "fatal" ? 78 : 0, errors)
          for (const pid of pids)
            assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
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
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
