// Plain JS (like plugins/*.test.js): the RN tsconfig has no Node types, and
// this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// Explore's two feed players (KTD2): they swap roles on every swipe and never
// belong to the root host, so the adapter's one-player session cannot hold them.
const FEED_PLAYERS = "src/hooks/useFeedPlayers.ts"

// Guard (todo 016): both expo-video player-creation APIs stay behind one
// adapter. The allowlisted heroes own deliberately different player policies.
const ALLOWED = new Set([
  "src/hooks/useManagedVideoPlayer.ts",
  // AE3: the home hero runs a bespoke serialized swap engine + videoReady
  // latch that the shared adapter's semantics would break.
  "src/components/home/HomeHeroPager.tsx",
  // SDUI hero renderer: viewport-pause/mute policy; follow-up candidate.
  "src/components/sections/VideoHeroRenderer.tsx",
  FEED_PLAYERS,
  // Not a player policy: the shared test double names the API it stands in for.
  "src/test-utils/expoVideoMock.ts",
])

// Bare identifiers, not `useVideoPlayer(`: an aliased import still mentions the
// name on its import line. createVideoPlayer is the second creation API and its
// player does NOT release with the component — the "outlives the route" hole.
const RAW_USAGE = /\b(?:useVideoPlayer|createVideoPlayer)\b/

function codeLines(content) {
  return content.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
}

// Pure detector over [{ relative, content }] so a positive-control fixture can
// prove the mechanism flags a real violation, not just that today's tree is clean.
function findRawUsage(entries, allowed = ALLOWED) {
  return entries
    .filter((entry) => !allowed.has(entry.relative))
    .filter((entry) =>
      codeLines(entry.content).some((line) => RAW_USAGE.test(line)),
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

const ROOT = path.resolve(__dirname, "../../..")

function readFeedPlayers() {
  return {
    relative: FEED_PLAYERS,
    content: fs.readFileSync(path.join(ROOT, FEED_PLAYERS), "utf8"),
  }
}

describe("single expo-video adapter", () => {
  it("no raw player creation outside the adapter + allowlist", () => {
    const root = ROOT
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

  it("positive control: the feed players' entry is load-bearing", () => {
    const feed = readFeedPlayers()
    const withoutFeed = new Set(
      [...ALLOWED].filter((file) => file !== FEED_PLAYERS),
    )
    expect(findRawUsage([feed], withoutFeed)).toEqual([FEED_PLAYERS])
    expect(findRawUsage([feed])).toEqual([])
  })

  // KTD2: two useVideoPlayer hooks, so both players release with the feed.
  // createVideoPlayer would outlive it, and a third player is a third decoder.
  it("the feed creates exactly two players, both with useVideoPlayer", () => {
    const code = codeLines(readFeedPlayers().content).join("\n")
    expect(code.match(/\buseVideoPlayer\(/g)).toHaveLength(2)
    expect(code).not.toMatch(/\bcreateVideoPlayer\b/)
  })
})
