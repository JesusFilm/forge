import { test } from "node:test"
import assert from "node:assert/strict"
import { DockerJobRuntime } from "../src/vm/docker-runtime.mjs"
import { jobIdentity } from "../src/vm/profile.mjs"
const identity = jobIdentity("a".repeat(32)),
  image = "sha256:" + "b".repeat(64),
  cid = "c".repeat(64)
function fixture({ consumed = false, missing = false } = {}) {
  const calls = [],
    events = []
  const journal = {
    beginOperation: async (phase, op) => {
      events.push(op)
      return !consumed
    },
    created: async () => events.push("created"),
    writeOnce: async (name) => {
      events.push(name)
    },
  }
  const run = async (file, args) => {
    calls.push(args)
    if (args[0] === "image") {
      if (missing) throw Error("missing")
      return { stdout: JSON.stringify([{ Id: image, RepoDigests: [] }]) }
    }
    if (args[0] === "create") return { stdout: cid + "\n" }
    if (args[0] === "start")
      return { output: Buffer.from("output"), stderr: "" }
    if (args[0] === "inspect")
      return {
        stdout: JSON.stringify([
          {
            Id: cid,
            Image: image,
            Config: {
              Labels: {
                "io.forge.studio.job": identity.id,
                "io.forge.studio.phase": "render",
              },
            },
            State: { Running: false, ExitCode: 0, OOMKilled: false },
          },
        ]),
      }
    if (args[0] === "rm") return { stdout: cid }
    throw Error("unexpected")
  }
  const runtime = new DockerJobRuntime({
    identity,
    journal,
    gate: { deadlineMs: Number(process.hrtime.bigint() / 1000000n) + 5000 },
    run,
    admit: async () => events.push("gate"),
  })
  return { runtime, calls, events }
}
test("missing approved image fails local preflight without a create or registry pull", async () => {
  const f = fixture({ missing: true })
  await assert.rejects(f.runtime.imagesReady([image]), /missing/)
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0], ["image", "inspect", image])
})
test("consumed operation cannot create/start again; one fresh phase persists fences before calls", async () => {
  const old = fixture({ consumed: true })
  await assert.rejects(old.runtime.phase("render", image), /reconciliation/)
  assert.equal(old.calls.length, 0)
  const f = fixture()
  const output = await f.runtime.phase("render", image)
  assert.equal(output.toString(), "output")
  assert.deepEqual(f.events, [
    "create",
    "gate",
    "created",
    "start",
    "gate",
    "render-exit.json",
    "render-removed.json",
  ])
  assert.ok(f.calls[0].includes("--pull=never"))
  assert.deepEqual(
    f.calls.find((a) => a[0] === "start"),
    ["start", "--attach", cid],
  )
})
test("restart reconciliation retires an exact discovered container but quarantines an unresolved absent create", async () => {
  const writes = [],
    removed = []
  const created = { containerId: cid }
  const journal = {
    read: async (name) =>
      name === "render-create-intent.json"
        ? { phase: "render", operation: "create" }
        : name === "render-created.json"
          ? created
          : null,
    writeOnce: async (name, value) => writes.push([name, value]),
    created: async () => {},
  }
  const run = async (_file, args) => {
    if (args[0] === "ps") return { stdout: cid + "\n" }
    if (args[0] === "inspect")
      return {
        stdout: JSON.stringify([
          {
            Id: cid,
            Image: image,
            Name: `/forge-studio-${identity.id}-render`,
            Config: {
              Labels: {
                "io.forge.studio.job": identity.id,
                "io.forge.studio.phase": "render",
              },
            },
            State: { Running: true },
          },
        ]),
      }
    if (args[0] === "rm") {
      removed.push(args[2])
      return { stdout: cid }
    }
    throw Error("unexpected")
  }
  let scans = 0
  const runtime = new DockerJobRuntime({
    identity,
    journal,
    gate: {},
    barrier: async () => {},
    run: async (file, args) =>
      args[0] === "ps" && scans++ > 0 ? { stdout: "" } : run(file, args),
  })
  await runtime.reconcile({ renderImage: image, verifyImage: image })
  assert.deepEqual(removed, [cid])
  assert.equal(writes.at(-1)[0], "runtime-reconciled.json")
  const uncertain = new DockerJobRuntime({
    identity,
    gate: {},
    barrier: async () => {},
    journal: {
      ...journal,
      read: async (name) =>
        name === "render-create-intent.json"
          ? { phase: "render", operation: "create" }
          : null,
    },
    run: async () => ({ stdout: "" }),
  })
  await assert.rejects(
    uncertain.reconcile({ renderImage: image, verifyImage: image }),
    /Unresolved create/,
  )
})
test("known CID outside the expected label projection cannot be mistaken for retired", async () => {
  const writes = [],
    calls = []
  const journal = {
    read: async (name) =>
      name === "render-create-intent.json"
        ? { phase: "render", operation: "create" }
        : name === "render-created.json"
          ? { containerId: cid }
          : null,
    writeOnce: async (name) => writes.push(name),
  }
  const runtime = new DockerJobRuntime({
    identity,
    journal,
    gate: {},
    barrier: async () => {},
    run: async (_file, args) => {
      calls.push(args)
      return {
        stdout: args.some((value) => value === "id=" + cid) ? cid + "\n" : "",
      }
    },
  })
  await assert.rejects(
    runtime.reconcile({ renderImage: image, verifyImage: image }),
    /Known container/,
  )
  assert.ok(!writes.includes("runtime-reconciled.json"))
  assert.ok(!calls.some((args) => args[0] === "rm"))
})
test("all reconciliation calls retain the same absolute retirement deadline", async () => {
  const end = Number(process.hrtime.bigint() / 1000000n) + 2000,
    seen = []
  const runtime = new DockerJobRuntime({
    identity,
    gate: {},
    journal: { read: async () => null, writeOnce: async () => {} },
    barrier: async (_id, _gate, deadline) => seen.push(deadline),
    run: async (_file, _args, options) => {
      seen.push(options.absoluteDeadlineMs)
      return { stdout: "" }
    },
  })
  await runtime.reconcile({ renderImage: image, verifyImage: image }, end)
  assert.ok(seen.length >= 3)
  assert.ok(seen.every((value) => value === end))
})
test("crash after exact Docker removal recovers the missing removed receipt", async () => {
  const writes = []
  const journal = {
    read: async (name) =>
      name === "render-create-intent.json"
        ? { phase: "render", operation: "create" }
        : name === "render-created.json"
          ? { containerId: cid }
          : null,
    writeOnce: async (name, value) => writes.push([name, value]),
  }
  const runtime = new DockerJobRuntime({
    identity,
    journal,
    gate: {},
    barrier: async () => {},
    run: async () => ({ stdout: "" }),
  })
  await runtime.reconcile({ renderImage: image, verifyImage: image })
  assert.deepEqual(writes[0], ["render-removed.json", { containerId: cid }])
  assert.equal(writes.at(-1)[0], "runtime-reconciled.json")
})
