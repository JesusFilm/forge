import { test } from "node:test"
import assert from "node:assert/strict"
import { runHostCommand } from "../src/vm/host-command.mjs"
test("host commands return bounded output and explicit unsuccessful exits", async () => {
  assert.equal(
    (
      await runHostCommand(
        process.execPath,
        ["-e", "process.stdout.write('ok')"],
        { timeoutMs: 1000 },
      )
    ).stdout,
    "ok",
  )
  await assert.rejects(
    runHostCommand(process.execPath, ["-e", "process.exit(2)"], {
      timeoutMs: 1000,
    }),
    /unsuccessful/,
  )
})
test("overflow and caller cancellation terminate the exact client and never report runtime retirement", async () => {
  await assert.rejects(
    runHostCommand(
      process.execPath,
      [
        "-e",
        "process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000)",
      ],
      { timeoutMs: 1000, outputBytes: 64 },
    ),
    (error) => error.clientStopped === true && error.runtimeRetired === false,
  )
  const stop = new AbortController()
  const command = runHostCommand(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)",
    ],
    { timeoutMs: 5000, signal: stop.signal, onOutput: () => stop.abort() },
  )
  const start = performance.now()
  await assert.rejects(
    command,
    (error) => error.clientStopped === true && error.runtimeRetired === false,
  )
  assert.ok(performance.now() - start < 2000)
})
test("absolute retirement deadline includes client termination and cannot reset a further cleanup window", async () => {
  const start = Number(process.hrtime.bigint() / 1000000n)
  await assert.rejects(
    runHostCommand(
      process.execPath,
      ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      { timeoutMs: 10000, absoluteDeadlineMs: start + 200 },
    ),
    (error) => error.runtimeRetired === false,
  )
  assert.ok(Number(process.hrtime.bigint() / 1000000n) - start < 700)
})
