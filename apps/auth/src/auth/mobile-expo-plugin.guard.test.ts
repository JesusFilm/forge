import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { describe, expect, it } from "vitest"

// mobile-expo-plugin.ts mirrors the vendor proxy's rules by hand. Pin the
// installed dist so a bump fails HERE and forces a re-diff of the mirror;
// update both pins only after re-verifying mobile-expo-plugin.ts against it.
const PINNED_VERSION = "1.7.1"
const PINNED_DIST_SHA256 =
  "86b4cdc9bf5be678162493c7b3d558324321999a9f7a08243c46b3530c8e4352"

const nodeRequire = createRequire(import.meta.url)
const distPath = nodeRequire.resolve("@better-auth/expo")

describe("mobileAwareExpoPlugin vendor drift guard", () => {
  it("runs against the exact vendor version the mirror was diffed on", () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(distPath), "..", "package.json"), "utf8"),
    ) as { name: string; version: string }
    expect(manifest.name).toBe("@better-auth/expo")
    expect(manifest.version).toBe(PINNED_VERSION)
  })

  it("pins the dist that carries the proxy the mirror reimplements", () => {
    const dist = readFileSync(distPath)
    // The proxy must live in THIS file, or the hash guards the wrong artifact.
    expect(dist.toString("utf8")).toContain("expo-authorization-proxy")
    expect(createHash("sha256").update(dist).digest("hex")).toBe(
      PINNED_DIST_SHA256,
    )
  })
})
