// Plain JS (like the other guard suites): the RN tsconfig has no Node types,
// and this guard needs fs and path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard: on Android, React Native draws a named family in Regular or Bold
// only, so weight 500 or 600 with `fontFamily: "System"` draws Regular. With
// no family, iOS draws the same system font and Android keeps the weight.
const MOBILE_ROOT = path.join(__dirname, "..", "..", "..")
const ROOTS = ["app", "src"]
const SYSTEM_FAMILY = /fontFamily:\s*["']System["']/

function sourceFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name)) files.push(full)
  }
  return files
}

describe("the system font family", () => {
  const files = ROOTS.flatMap((root) =>
    sourceFiles(path.join(MOBILE_ROOT, root)),
  )

  it("scans the app's source", () => {
    // Anti-vacuous: a wrong root would find no files and pass.
    expect(files).toContain(
      path.join(MOBILE_ROOT, "src", "components", "watch", "PlaybackHost.tsx"),
    )
    expect(files).toContain(
      path.join(MOBILE_ROOT, "app", "watch", "[slug].tsx"),
    )
  })

  it('is never named: no style sets fontFamily "System"', () => {
    const offenders = files
      .filter((file) => SYSTEM_FAMILY.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(MOBILE_ROOT, file))
    expect(offenders).toEqual([])
  })
})
