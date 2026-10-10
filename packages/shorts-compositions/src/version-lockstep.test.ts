// Remotion throws at render time when remotion/@remotion/* versions
// mismatch, and caret drift fails in production Docker — not CI (plan arch
// P2-1). This test asserts every remotion-family dependency across the three
// packages that will hold them is the SAME exact pin. Packages/dep sections
// that don't exist yet are skipped, so the test tightens automatically as
// later phases add apps/shorts-worker and apps/manager deps.
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const PACKAGE_JSON_URLS = [
  new URL("../package.json", import.meta.url),
  new URL("../../../apps/shorts-worker/package.json", import.meta.url),
  new URL("../../../apps/manager/package.json", import.meta.url),
]

type PackageManifest = {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const REMOTION_DEP_PATTERN = /^remotion$|^@remotion\//
const EXACT_PIN_PATTERN = /^\d+\.\d+\.\d+$/

const collectRemotionDeps = (): Array<{
  source: string
  dependency: string
  version: string
}> => {
  const collected: Array<{
    source: string
    dependency: string
    version: string
  }> = []
  for (const url of PACKAGE_JSON_URLS) {
    let raw: string
    try {
      raw = readFileSync(url, "utf8")
    } catch {
      continue // package does not exist yet — tolerated
    }
    const manifest = JSON.parse(raw) as PackageManifest
    const sections = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
    ]
    for (const section of sections) {
      if (!section) continue
      for (const [dependency, version] of Object.entries(section)) {
        if (REMOTION_DEP_PATTERN.test(dependency)) {
          collected.push({
            source: manifest.name ?? url.pathname,
            dependency,
            version,
          })
        }
      }
    }
  }
  return collected
}

describe("remotion version lockstep", () => {
  it("finds remotion deps in this package (sanity)", () => {
    const deps = collectRemotionDeps()
    expect(deps.length).toBeGreaterThanOrEqual(3)
  })

  it("pins every remotion-family dependency exactly (no ^ or ~)", () => {
    for (const { source, dependency, version } of collectRemotionDeps()) {
      expect(
        EXACT_PIN_PATTERN.test(version),
        `${source} -> ${dependency}@${version} is not an exact pin`,
      ).toBe(true)
    }
  })

  it("uses one identical version across all packages", () => {
    const versions = new Set(
      collectRemotionDeps().map(({ version }) => version),
    )
    expect(
      versions.size,
      `expected a single remotion version, found: ${[...versions].join(", ")}`,
    ).toBe(1)
  })
})
