const { AbortController, setTimeout, clearTimeout } = globalThis
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { executeStudioChild } from "../src/isolation.mjs"

test("execution hides credentials and host files, blocks namespace escape and rejects writable input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio460-isolation-"))
  try {
    const result = spawnSync("pnpm", ["build:native"], {
      cwd: resolve("apps/studio-render"),
      encoding: "utf8",
    })
    assert.equal(result.status, 0, result.stderr)
    const input = join(dir, "input")
    await (await import("node:fs/promises")).mkdir(input)
    await writeFile(join(input, "immutable"), "retained")
    const child = join(dir, "child.mjs")
    await writeFile(
      child,
      `import {existsSync,writeFileSync} from 'node:fs';import{spawnSync}from'node:child_process';
let writable=false;try{writeFileSync('/input/immutable','changed');writable=true}catch{}
const escape=spawnSync('/usr/bin/unshare',['-Urn','true']);
console.log(JSON.stringify({home:existsSync('/home/tataihono'),environment:Object.keys(process.env).sort(),writable,escape:escape.status}));`,
    )
    const output = await executeStudioChild({
      nativeDir: resolve("apps/studio-render/dist"),
      child,
      node: process.execPath,
      input,
      timeoutMs: 3000,
      stdoutBytes: 4096,
    })
    const report = JSON.parse(output)
    assert.deepEqual(report, {
      home: false,
      environment: ["HOME", "PATH", "PWD", "TMPDIR"],
      writable: false,
      escape: 1,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("lost supervisor is fatal even when cancellation raced with teardown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio460-lost-supervisor-"))
  try {
    const { copyFile, chmod } = await import("node:fs/promises")
    await copyFile(
      resolve("apps/studio-render/dist/sandbox-init"),
      join(dir, "sandbox-init"),
    )
    const input = join(dir, "input")
    await (await import("node:fs/promises")).mkdir(input)
    const child = join(dir, "child.mjs")
    await writeFile(child, "")
    for (const mode of ["signal", "cancelled-isolation-loss"]) {
      await writeFile(
        join(dir, "guard"),
        mode === "signal"
          ? "#!/bin/sh\nkill -KILL $$\n"
          : '#!/bin/sh\ntrap "exit 127" TERM\nwhile :; do :; done\n',
      )
      await chmod(join(dir, "guard"), 0o700)
      const controller = new AbortController()
      const execution = executeStudioChild(
        {
          nativeDir: dir,
          node: process.execPath,
          child,
          input,
          timeoutMs: 1000,
        },
        controller.signal,
      )
      const timer =
        mode === "cancelled-isolation-loss"
          ? setTimeout(() => controller.abort(), 100)
          : undefined
      try {
        await assert.rejects(execution, { code: "ISOLATION_LOST" })
      } finally {
        clearTimeout(timer)
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("render libraries see at most two CPUs and children cannot widen their inherited affinity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio460-affinity-"))
  try {
    const child = join(dir, "child.mjs")
    await writeFile(
      child,
      `import {availableParallelism} from 'node:os';import{spawnSync}from'node:child_process';
const widening=spawnSync('/usr/bin/python3',['-c','import os; os.sched_setaffinity(0, set(range(1024)))']);
console.log(JSON.stringify({cpus:availableParallelism(),widened:widening.status===0}));`,
    )
    const output = await executeStudioChild({
      nativeDir: resolve("apps/studio-render/dist"),
      child,
      node: process.execPath,
      input: dir,
      timeoutMs: 3000,
      stdoutBytes: 4096,
    })
    const report = JSON.parse(output)
    assert.ok(
      report.cpus >= 1 && report.cpus <= 2,
      `visible CPUs: ${report.cpus}`,
    )
    assert.equal(report.widened, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
