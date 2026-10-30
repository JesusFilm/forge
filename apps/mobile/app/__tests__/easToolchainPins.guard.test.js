// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs/path to read the config files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: the EAS builder toolchain pins in eas.json stay equal to the repo's
// own pins, and every build profile inherits them. A stale pin does not fail
// locally; it fails on the next EAS build. See CLAUDE.md "EAS builder toolchain pins".
const MOBILE_DIR = path.resolve(__dirname, "..", "..")
const REPO_ROOT = path.resolve(MOBILE_DIR, "..", "..")

const eas = JSON.parse(
  fs.readFileSync(path.join(MOBILE_DIR, "eas.json"), "utf8"),
)
const rootPackage = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
)
const nvmrc = fs.readFileSync(path.join(REPO_ROOT, ".nvmrc"), "utf8").trim()
const base = eas.build.base

// `.nvmrc` may hold `24`, `v24`, or a full version; only the major is pinned.
const nvmrcMajor = nvmrc.replace(/^v/, "").split(".")[0]

function resolvesToBase(name, seen = new Set()) {
  if (name === "base") return true
  const profile = eas.build[name]
  if (!profile || !profile.extends || seen.has(name)) return false
  seen.add(name)
  return resolvesToBase(profile.extends, seen)
}

describe("eas.json builder toolchain pins", () => {
  it("pins pnpm to the root packageManager version, character for character", () => {
    const [, version] = rootPackage.packageManager.split("@")
    expect(base.pnpm).toBe(version)
  })

  it("pins node to a full semver on the .nvmrc major", () => {
    expect(base.node).toMatch(/^\d+\.\d+\.\d+$/)
    expect(base.node.split(".")[0]).toBe(nvmrcMajor)
  })

  it("makes sharp use its prebuilt binary on the builder", () => {
    expect(base.env.SHARP_IGNORE_GLOBAL_LIBVIPS).toBe("1")
  })

  it("has every build profile extend base, directly or through another profile", () => {
    const profiles = Object.keys(eas.build).filter((name) => name !== "base")
    // Floor so a renamed or emptied `build` block cannot pass vacuously.
    expect(profiles.length).toBeGreaterThanOrEqual(3)
    const unresolved = profiles.filter((name) => !resolvesToBase(name))
    expect(unresolved).toEqual([])
  })

  it("keeps base a template, not a build target", () => {
    expect(base.channel).toBeUndefined()
    expect(base.environment).toBeUndefined()
    expect(base.distribution).toBeUndefined()
  })
})
