#!/usr/bin/env node
// Fails when a pnpm.patchedDependencies key names a version that is no longer
// resolved in the lockfile. pnpm only WARNS on a stale patch key, so a version
// bump silently orphans the patch (e.g. the load-bearing tvOS Datadog/RN-tvos
// patches) and re-breaks the native build far from the causing commit. This
// guard turns that warning into a hard CI failure at the bump commit.
//
// Dependency-free (Node + the two files only) so it runs in an unconditional CI
// job without a workspace install.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
const patched = pkg.pnpm?.patchedDependencies ?? {}
const lock = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8")

// Search only the resolved-package region (packages:/snapshots:), never the
// patchedDependencies mirror above it that echoes the same keys back.
const pkgIdx = lock.indexOf("\npackages:")
if (pkgIdx === -1) {
  console.error(
    "patched-deps guard FAILED — pnpm-lock.yaml has no `packages:` section; " +
      "unexpected lockfile format (refusing to pass rather than search the mirror).",
  )
  process.exit(1)
}
const resolved = lock.slice(pkgIdx)

function resolvedVersions(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Match a package key `name@<version>` (optionally quoted), stopping the
  // version at a quote, colon, or `(` peer/patch-hash suffix.
  const re = new RegExp(`(?:^|\\n)\\s+'?${esc}@([^'":()\\s]+)`, "g")
  const out = new Set()
  let m
  while ((m = re.exec(resolved)) !== null) out.add(m[1])
  return out
}

const mismatches = []
for (const key of Object.keys(patched)) {
  const at = key.lastIndexOf("@") // scoped names keep their leading @
  const name = key.slice(0, at)
  const version = key.slice(at + 1)
  const versions = resolvedVersions(name)
  if (!versions.has(version)) {
    const found = versions.size
      ? [...versions].join(", ")
      : "(not resolved in lockfile)"
    mismatches.push(
      `  ${key} — patch targets ${version}, lockfile resolved: ${found}`,
    )
  }
}

if (mismatches.length > 0) {
  console.error(
    "patched-deps guard FAILED — pnpm.patchedDependencies keys no longer match installed versions:\n" +
      mismatches.join("\n") +
      "\n\nA version bump orphaned a patch. Re-create the patch for the new version " +
      "(`pnpm patch <pkg>` then update the key) or revert the bump.",
  )
  process.exit(1)
}

console.log(
  `patched-deps guard OK — ${Object.keys(patched).length} patch key(s) aligned with the lockfile.`,
)
