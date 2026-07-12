// Plain JS (like plugins/*.test.js): the RN tsconfig has no Node types, and
// this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard (todo 016): expo-video's raw useVideoPlayer stays behind one adapter.
// The two allowlisted exceptions own deliberately different player policies.
const ALLOWED = new Set([
  "src/hooks/useManagedVideoPlayer.ts",
  // AE3: the home hero runs a bespoke serialized swap engine + videoReady
  // latch that the shared adapter's semantics would break.
  "src/components/home/HomeHeroPager.tsx",
  // SDUI hero renderer: viewport-pause/mute policy; follow-up candidate.
  "src/components/sections/VideoHeroRenderer.tsx",
])

function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe("single expo-video adapter", () => {
  it("no raw useVideoPlayer( call outside the adapter + allowlist", () => {
    const root = path.resolve(__dirname, "../../..")
    const files = [
      ...collectSourceFiles(path.join(root, "src")),
      ...collectSourceFiles(path.join(root, "app")),
    ]
    const offenders = files.filter((file) => {
      const relative = path.relative(root, file)
      if (ALLOWED.has(relative)) return false
      return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .some(
          (line) =>
            !/^\s*(\/\/|\*|\/\*)/.test(line) && /useVideoPlayer\(/.test(line),
        )
    })
    expect(offenders.map((file) => path.relative(root, file))).toEqual([])
  })
})
