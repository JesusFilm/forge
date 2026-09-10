import assert from "node:assert/strict"
import test from "node:test"
import { containerArguments, jobIdentity } from "../src/vm/profile.mjs"

const identity = jobIdentity("a".repeat(32))
const image = "sha256:" + "b".repeat(64)
const job = { identity, image, deadlineMs: 123456789, phase: "render" }
test("disposable render has only exact readonly input and no runtime authority", () => {
  const args = containerArguments(job)
  for (const expected of [
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--user=1000:1000",
    "--pids-limit=128",
    "--cpus=2",
    "--memory=2147483648",
    "--memory-swap=2147483648",
    "--restart=no",
    "--log-driver=none",
  ])
    assert.ok(args.includes(expected), expected)
  assert.ok(
    args.includes(
      `--mount=type=bind,source=${identity.directory}/render-input,target=/input,readonly`,
    ),
  )
  assert.equal(
    args.some((arg) =>
      /docker.sock|--privileged|--publish|--env|unconfined|\/proc:/.test(arg),
    ),
    false,
  )
  assert.deepEqual(args.slice(-7), [
    image,
    "--deadline",
    "123456789",
    "134217728",
    "65536",
    "--",
    "/runtime/init",
  ])
})
test("verifier gets a separate input inventory and the unchanged deadline", () => {
  const args = containerArguments({ ...job, phase: "verify" })
  assert.ok(
    args.includes(
      `--mount=type=bind,source=${identity.directory}/verify-input,target=/input,readonly`,
    ),
  )
  assert.equal(
    args.some((arg) => arg.includes("render-input")),
    false,
  )
  assert.deepEqual(args.slice(-7), [
    image,
    "--deadline",
    "123456789",
    "8192",
    "65536",
    "--",
    "/runtime/init",
  ])
})
test("mutable image refs, arbitrary identities and unknown phases fail closed", () => {
  for (const id of ["../other", "", "a".repeat(33)])
    assert.throws(() => jobIdentity(id))
  for (const change of [
    { image: "renderer:latest" },
    { phase: "shell" },
    { deadlineMs: 0 },
    { identity: { ...identity, directory: "/etc" } },
  ])
    assert.throws(() => containerArguments({ ...job, ...change }))
})
