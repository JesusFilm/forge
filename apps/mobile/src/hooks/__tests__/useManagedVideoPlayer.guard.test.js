// Plain JS (like plugins/*.test.js): the RN tsconfig has no Node types, and
// this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Guard (todo 016): both expo-video player-creation APIs stay behind one
// adapter. The allowlisted heroes own deliberately different player policies.
const ALLOWED = new Set([
  "src/hooks/useManagedVideoPlayer.ts",
  // AE3: the home hero runs a bespoke serialized swap engine + videoReady
  // latch that the shared adapter's semantics would break.
  "src/components/home/HomeHeroPager.tsx",
  // SDUI hero renderer: viewport-pause/mute policy; follow-up candidate.
  "src/components/sections/VideoHeroRenderer.tsx",
  // Not a player policy: the shared test double names the API it stands in for.
  "src/test-utils/expoVideoMock.ts",
])

// Bare identifiers, not `useVideoPlayer(`: an aliased import still mentions the
// name on its import line. createVideoPlayer is the second creation API and its
// player does NOT release with the component — the "outlives the route" hole.
const RAW_USAGE = /\b(?:useVideoPlayer|createVideoPlayer)\b/

// Pure detector over [{ relative, content }] so a positive-control fixture can
// prove the mechanism flags a real violation, not just that today's tree is clean.
function findRawUsage(entries) {
  return entries
    .filter((entry) => !ALLOWED.has(entry.relative))
    .filter((entry) =>
      entry.content
        .split("\n")
        .some(
          (line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && RAW_USAGE.test(line),
        ),
    )
    .map((entry) => entry.relative)
}

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
  it("no raw player creation outside the adapter + allowlist", () => {
    const root = path.resolve(__dirname, "../../..")
    const files = [
      ...collectSourceFiles(path.join(root, "src")),
      ...collectSourceFiles(path.join(root, "app")),
    ]
    // A broken root resolution or empty scan must not vacuously pass — the real
    // tree has hundreds of source files; assert we actually walked them.
    expect(files.length).toBeGreaterThan(50)
    const entries = files.map((file) => ({
      relative: path.relative(root, file),
      content: fs.readFileSync(file, "utf8"),
    }))
    expect(findRawUsage(entries)).toEqual([])
  })

  it("positive control: the detector flags both creation APIs (incl. aliased imports)", () => {
    // Proves the scan mechanism itself works — without this, a broken regex or
    // root path could make the real-tree assertion pass with zero scanning.
    const offenders = findRawUsage([
      {
        relative: "src/components/watch/Rogue.tsx",
        content: 'useVideoPlayer("x")',
      },
      {
        relative: "src/components/watch/Aliased.tsx",
        content:
          'import { useVideoPlayer as useVP } from "expo-video"\nuseVP(src)',
      },
      {
        relative: "src/components/watch/Detached.tsx",
        content: 'createVideoPlayer("x")',
      },
      {
        relative: "src/components/watch/DetachedAliased.tsx",
        content:
          'import { createVideoPlayer as makePlayer } from "expo-video"\nmakePlayer(src)',
      },
      {
        relative: "src/components/watch/Comment.tsx",
        content: "// uses useVideoPlayer once\n// uses createVideoPlayer once",
      },
      {
        relative: "src/hooks/useManagedVideoPlayer.ts",
        content: "useVideoPlayer(source)\ncreateVideoPlayer(source)",
      },
    ])
    expect(offenders).toEqual([
      "src/components/watch/Rogue.tsx",
      "src/components/watch/Aliased.tsx",
      "src/components/watch/Detached.tsx",
      "src/components/watch/DetachedAliased.tsx",
    ])
  })
})
