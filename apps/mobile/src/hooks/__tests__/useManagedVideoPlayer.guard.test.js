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

// Match the bare identifier, not `useVideoPlayer(` — an aliased import
// (`import { useVideoPlayer as useVP }`) mentions the identifier on its import
// line, so word-boundary matching flags the file even when the call is aliased.
// createVideoPlayer is included because it is the API a "the player must
// outlive the route" change reaches for, and it escapes the adapter identically.
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

// The adapter's OWN call sites (U6). The scan above matches only the bare
// expo-video identifiers, so it is structurally blind to a decoder created
// THROUGH the adapter — which is every legitimate one. Nothing else caps them.
// Each entry says why that surface is allowed its own decoder.
const ADAPTER_CALL_SITES = {
  "src/hooks/useManagedVideoPlayer.ts": "the adapter itself",
  // Mounted by app/watch/[slug].tsx and app/series/[slug].tsx — the feature
  // and the trailer — so this one call site accounts for two live decoders.
  "src/components/watch/VideoPlayer.tsx": "the watch surface",
  "app/video/[sectionKey].tsx": "the SDUI single-video route",
  "app/collection/[sectionKey].tsx": "the SDUI collection route",
  // U6: the root layout mounts this, so its decoder outlives the watch route.
  "src/components/watch/PlaybackHost.tsx": "the root-owned playback host",
}

const UNLISTED_CALL_SITE_MESSAGE = [
  "A new expo-video decoder was added through useManagedVideoPlayer.",
  "",
  "This is not a list to update on the way past. Every entry is a decoder the",
  "device may have to hold at once, and the audience for this app is on low-end",
  "hardware where a second concurrent decoder is a black frame, not a slow one.",
  "",
  "Before adding the file below to ADAPTER_CALL_SITES, answer in the PR:",
  "  1. Can this surface reuse an existing player (PlaybackHost owns one that",
  "     outlives the route) instead of creating its own?",
  "  2. If not, what unmounts it, and can it overlap with any other entry?",
  "  3. Add the file WITH a one-line reason, the way the others carry one.",
].join("\n")

// Bare identifier, same discipline as RAW_USAGE above: an aliased import names
// it on the import line, so word-boundary matching still flags the file.
const ADAPTER_USAGE = /\buseManagedVideoPlayer\b/

function findAdapterCallSites(entries) {
  return entries
    .filter((entry) =>
      entry.content
        .split("\n")
        .some(
          (line) =>
            !/^\s*(\/\/|\*|\/\*)/.test(line) && ADAPTER_USAGE.test(line),
        ),
    )
    .map((entry) => entry.relative)
    .sort()
}

// test-utils is skipped alongside __tests__: the shared expo-video stub names
// both identifiers by definition, and mocking them is not escaping the adapter.
const SKIP_DIRS = new Set(["__tests__", "node_modules", "test-utils"])

function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function collectEntries() {
  const root = path.resolve(__dirname, "../../..")
  const files = [
    ...collectSourceFiles(path.join(root, "src")),
    ...collectSourceFiles(path.join(root, "app")),
  ]
  return files.map((file) => ({
    relative: path.relative(root, file),
    content: fs.readFileSync(file, "utf8"),
  }))
}

describe("single expo-video adapter", () => {
  it("no raw useVideoPlayer usage outside the adapter + allowlist", () => {
    const entries = collectEntries()
    // A broken root resolution or empty scan must not vacuously pass — the real
    // tree has hundreds of source files; assert we actually walked them.
    expect(entries.length).toBeGreaterThan(50)
    expect(findRawUsage(entries)).toEqual([])
  })

  it("positive control: the detector flags a real violation (incl. aliased import)", () => {
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
        relative: "src/components/watch/Comment.tsx",
        content: "// uses useVideoPlayer once",
      },
      {
        relative: "src/hooks/useManagedVideoPlayer.ts",
        content: "useVideoPlayer(source)",
      },
    ])
    expect(offenders).toEqual([
      "src/components/watch/Rogue.tsx",
      "src/components/watch/Aliased.tsx",
    ])
  })

  it("positive control: the detector flags createVideoPlayer (incl. aliased import)", () => {
    // createVideoPlayer is the API a "player must outlive the route" change
    // reaches for, and it escapes the adapter just as completely as the hook.
    const offenders = findRawUsage([
      {
        relative: "src/components/watch/Detached.tsx",
        content: 'createVideoPlayer("x")',
      },
      {
        relative: "src/lib/miniPlayer/Aliased.ts",
        content:
          'import { createVideoPlayer as makePlayer } from "expo-video"\nmakePlayer(src)',
      },
      {
        relative: "src/components/watch/Comment.tsx",
        content: "// createVideoPlayer is deliberately not used here",
      },
      {
        relative: "src/hooks/useManagedVideoPlayer.ts",
        content: "createVideoPlayer(source)",
      },
    ])
    expect(offenders).toEqual([
      "src/components/watch/Detached.tsx",
      "src/lib/miniPlayer/Aliased.ts",
    ])
  })
})

describe("adapter call-site budget", () => {
  it("no adapter call site outside the enumerated set", () => {
    const entries = collectEntries()
    expect(entries.length).toBeGreaterThan(50)
    const found = findAdapterCallSites(entries)

    const unlisted = found.filter((file) => !(file in ADAPTER_CALL_SITES))
    if (unlisted.length > 0) {
      throw new Error(
        `${UNLISTED_CALL_SITE_MESSAGE}\n\n  ${unlisted.join("\n  ")}\n`,
      )
    }
    // Both directions: a stale entry left behind after a surface was deleted
    // silently raises the ceiling for whoever adds the next one.
    expect(found).toEqual(Object.keys(ADAPTER_CALL_SITES).sort())
  })

  it("the set has not grown", () => {
    // Separate from the scan so the number itself shows up in the diff. Adding
    // a decoder is then two deliberate edits, not one line slipped into a list.
    expect(Object.keys(ADAPTER_CALL_SITES)).toHaveLength(5)
  })

  it("positive control: the detector flags an unlisted call site", () => {
    // Without this, a broken regex would make the real-tree assertion above
    // pass while detecting nothing at all.
    const found = findAdapterCallSites([
      {
        relative: "src/components/watch/Rogue.tsx",
        content: "useManagedVideoPlayer(url)",
      },
      {
        relative: "app/experiment/Aliased.tsx",
        content:
          'import { useManagedVideoPlayer as useMVP } from "../../src/hooks/useManagedVideoPlayer"\nuseMVP(url)',
      },
      {
        relative: "src/lib/miniPlayer/session.ts",
        content: " * useManagedVideoPlayer already re-keys its own recorder",
      },
      {
        relative: "src/components/watch/PlaybackHost.tsx",
        content: "useManagedVideoPlayer(streamingUrl)",
      },
    ])

    expect(found).toEqual([
      "app/experiment/Aliased.tsx",
      "src/components/watch/PlaybackHost.tsx",
      "src/components/watch/Rogue.tsx",
    ])
    expect(found.filter((file) => !(file in ADAPTER_CALL_SITES))).toEqual([
      "app/experiment/Aliased.tsx",
      "src/components/watch/Rogue.tsx",
    ])
  })
})
