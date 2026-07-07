// Dependency-free test for the pure findPatchMismatches branches (aligned,
// version-bump mismatch, unresolved key, peer-suffix match, missing packages:
// section). Run: node scripts/check-patched-deps.test.mjs
import assert from "node:assert/strict"
import { findPatchMismatches } from "./check-patched-deps.mjs"

// Minimal lockfile: patchedDependencies mirror on top, resolved packages below.
const LOCK = [
  "patchedDependencies:",
  "  foo@1.0.0:",
  "    hash: abc",
  "packages:",
  "  'foo@1.0.0':",
  "    resolution: {}",
  "  'bar@2.0.0(react@19)':",
  "    resolution: {}",
  "",
].join("\n")

// aligned key -> ok
assert.deepEqual(
  findPatchMismatches({ "foo@1.0.0": "patches/foo.patch" }, LOCK),
  {
    status: "ok",
    mismatches: [],
  },
)

// bumped version -> mismatch naming both target and resolved
{
  const r = findPatchMismatches({ "foo@9.9.9": "patches/foo.patch" }, LOCK)
  assert.equal(r.status, "mismatch")
  assert.ok(
    r.mismatches[0].includes("9.9.9") && r.mismatches[0].includes("1.0.0"),
  )
}

// key absent from lockfile -> mismatch (not resolved)
{
  const r = findPatchMismatches({ "baz@1.0.0": "patches/baz.patch" }, LOCK)
  assert.equal(r.status, "mismatch")
  assert.ok(r.mismatches[0].includes("not resolved"))
}

// peer/patch-hash suffix still matches the version prefix -> ok
assert.equal(
  findPatchMismatches({ "bar@2.0.0": "patches/bar.patch" }, LOCK).status,
  "ok",
)

// no packages: section -> fatal, must NOT false-pass off the patchedDependencies mirror
assert.equal(
  findPatchMismatches(
    { "foo@1.0.0": "x" },
    "patchedDependencies:\n  foo@1.0.0: {}\n",
  ).status,
  "no-packages-section",
)

console.log("check-patched-deps.test.mjs: all assertions passed")
