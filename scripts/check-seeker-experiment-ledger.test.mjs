import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { findLedgerViolations } from "./check-seeker-experiment-ledger.mjs"

const experiment = "2026-08-10-001-seeker-prompt"
const manifest = `${experiment}/experiment.json`
const attempt = `${experiment}/attempts/attempt-001`

function entries(values) {
  return new Map(Object.entries(values))
}

function violations(base, head) {
  return findLedgerViolations(entries(base), entries(head))
}

// A new experiment is mutable within its originating PR and becomes immutable
// only after those bytes reach the base branch.
assert.deepEqual(
  violations(
    {},
    {
      [manifest]: "head-manifest",
      [`${attempt}/answers.json`]: "head-answers",
    },
  ),
  [],
)

// Root documentation and the authoring template are not historical evidence.
assert.deepEqual(
  violations(
    { "README.md": "old", "experiment.template.json": "old" },
    { "README.md": "new", "experiment.template.json": "new" },
  ),
  [],
)

for (const [label, head] of [
  ["modified", { [manifest]: "changed" }],
  ["deleted", {}],
  ["renamed", { [`${experiment}/renamed.json`]: "manifest" }],
]) {
  const result = violations({ [manifest]: "manifest" }, head)
  assert.ok(result.length >= 1, `${label} historical files must fail`)
  const historical = result.find((value) =>
    value.includes("historical experiment file"),
  )
  assert.match(historical, new RegExp(manifest.replaceAll(".", "\\.")))
}

// A retry is append-only: a genuinely new attempt ID is allowed while adding
// bytes to an attempt that already exists on the base branch is not.
assert.deepEqual(
  violations(
    { [manifest]: "manifest", [`${attempt}/diagnostic.json`]: "diagnostic" },
    {
      [manifest]: "manifest",
      [`${attempt}/diagnostic.json`]: "diagnostic",
      [`${experiment}/attempts/attempt-002/diagnostic.json`]: "retry",
    },
  ),
  [],
)
assert.match(
  violations(
    { [manifest]: "manifest", [`${attempt}/diagnostic.json`]: "diagnostic" },
    {
      [manifest]: "manifest",
      [`${attempt}/diagnostic.json`]: "diagnostic",
      [`${attempt}/completion.json`]: "late-completion",
    },
  )[0],
  /existing attempt/,
)

for (const invalidAttemptId of [
  "Attempt-002",
  ".attempt",
  "attempt..002",
  "attempt-",
]) {
  assert.match(
    violations(
      { [manifest]: "manifest" },
      {
        [manifest]: "manifest",
        [`${experiment}/attempts/${invalidAttemptId}/diagnostic.json`]: "retry",
      },
    )[0],
    /unexpected addition/,
  )
}

// A terminal verdict may be added once. Once it exists on the base branch the
// whole experiment is sealed, including new attempt IDs.
assert.deepEqual(
  violations(
    { [manifest]: "manifest", [`${attempt}/completion.json`]: "complete" },
    {
      [manifest]: "manifest",
      [`${attempt}/completion.json`]: "complete",
      [`${experiment}/verdict.json`]: "verdict",
    },
  ),
  [],
)
assert.match(
  violations(
    {
      [manifest]: "manifest",
      [`${attempt}/completion.json`]: "complete",
      [`${experiment}/verdict.json`]: "verdict",
    },
    {
      [manifest]: "manifest",
      [`${attempt}/completion.json`]: "complete",
      [`${experiment}/verdict.json`]: "verdict",
      [`${experiment}/attempts/attempt-002/diagnostic.json`]: "retry",
    },
  )[0],
  /terminal verdict/,
)

// Existing experiment roots accept only new attempts or the one terminal
// verdict, never arbitrary sidecars.
assert.match(
  violations(
    { [manifest]: "manifest" },
    { [manifest]: "manifest", [`${experiment}/notes.md`]: "notes" },
  )[0],
  /unexpected addition/,
)

// Exercise the real Git-tree boundary, not only the pure policy function.
{
  const root = mkdtempSync(join(tmpdir(), "seeker-ledger-guard-"))
  const script = fileURLToPath(
    new URL("./check-seeker-experiment-ledger.mjs", import.meta.url),
  )
  const ledger = join(root, "apps/mastra/evals/experiments")
  const baseManifest = join(ledger, experiment, "experiment.json")
  const newManifest = join(
    ledger,
    "2026-08-11-001-seeker-new-prompt",
    "experiment.json",
  )
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "ignore" })
  try {
    git("init", "-b", "main")
    git("config", "user.email", "guard@example.invalid")
    git("config", "user.name", "Ledger Guard Test")
    mkdirSync(dirname(baseManifest), { recursive: true })
    writeFileSync(baseManifest, '{"id":"base"}\n')
    git("add", ".")
    git("commit", "--no-gpg-sign", "-m", "base experiment")
    git("tag", "ledger-base")

    mkdirSync(dirname(newManifest), { recursive: true })
    writeFileSync(newManifest, '{"id":"new"}\n')
    git("add", ".")
    git("commit", "--no-gpg-sign", "-m", "add experiment")
    const allowed = spawnSync(
      process.execPath,
      [script, "--base=ledger-base", "--head=HEAD"],
      { cwd: root, encoding: "utf8" },
    )
    assert.equal(allowed.status, 0, allowed.stderr)

    writeFileSync(baseManifest, '{"id":"rewritten"}\n')
    git("add", ".")
    git("commit", "--no-gpg-sign", "-m", "rewrite history")
    const rejected = spawnSync(
      process.execPath,
      [script, "--base=ledger-base", "--head=HEAD"],
      { cwd: root, encoding: "utf8" },
    )
    assert.equal(rejected.status, 1)
    assert.match(rejected.stderr, /modified historical experiment file/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

console.log("check-seeker-experiment-ledger.test.mjs: all assertions passed")
