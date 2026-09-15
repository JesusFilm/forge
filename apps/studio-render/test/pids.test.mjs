import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { executeStudioChild } from "../src/isolation.mjs"

test(
  "UID process-limit hypothesis denies forks and privilege changes below the loose outer PID ceiling",
  { skip: process.env.STUDIO_PID_HYPOTHESIS !== "1", timeout: 10000 },
  async () => {
    const { currentCgroupDirectory } = await import("../src/budget.mjs")
    const cg = await currentCgroupDirectory()
    const ceiling = Number(
      (await readFile(join(cg, "pids.max"), "utf8")).trim(),
    )
    assert.ok(
      ceiling >= 1000,
      "must not mistake the outer128 PID limit for UID containment",
    )
    const dir = await mkdtemp(join(tmpdir(), "studio460-pids-"))
    try {
      const child = join(dir, "child.mjs")
      await writeFile(
        child,
        `import{execFileSync}from'node:child_process';process.stdout.write(execFileSync('/usr/bin/python3',['-c',${JSON.stringify(`import os,resource,json,errno,signal
children=[]
denied={}
for name,operation in [('root',lambda:os.setuid(0)),('raise',lambda:resource.setrlimit(resource.RLIMIT_NPROC,(1000,1000)))]:
 try: operation();denied[name]=False
 except (OSError,ValueError): denied[name]=True
try:
 while len(children)<200:
  try: pid=os.fork()
  except OSError as e:
   denied['fork']=e.errno==errno.EAGAIN;break
  if not pid:
   os.setsid()
   signal.pause()
   os._exit(0)
  children.append(pid)
 print(json.dumps({'uid':os.getuid(),'limit':resource.getrlimit(resource.RLIMIT_NPROC),'children':len(children),'denied':denied}),flush=True)
finally:
 for pid in children:os.kill(pid,signal.SIGKILL)
 for pid in children:os.waitpid(pid,0)`)}],{timeout:3000,maxBuffer:4096}));`,
      )
      const report = JSON.parse(
        await executeStudioChild({
          nativeDir: resolve("apps/studio-render/dist"),
          node: process.execPath,
          child,
          input: dir,
          timeoutMs: 5000,
          stdoutBytes: 4096,
        }),
      )
      console.log({ outerPidsMax: ceiling, ...report })
      assert.equal(report.uid, 1000)
      assert.deepEqual(report.limit, [96, 96])
      assert.deepEqual(report.denied, { root: true, raise: true, fork: true })
      assert.ok(report.children > 32 && report.children < 96)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
