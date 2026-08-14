// Plain JS (like useManagedVideoPlayer.guard.test.js): the RN tsconfig has no
// Node types, and this guard walks the source tree with fs/path.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

/**
 * SOURCE-SHAPE guard on the SDUI routes' yield (R9/R10).
 *
 * The BEHAVIOUR is proved in
 * `src/hooks/__tests__/useEndMiniPlayerOnPlayback.test.tsx`, against route
 * stand-ins — and it stays green when either real route simply stops calling
 * the helper. That revert is one line, it compiles, it typechecks, and it puts
 * a second decoder plus a second audio stream back under the floating window.
 *
 * The scan is the other half. A shared predicate applied only to the files a PR
 * already touched, while sibling hand-rolled copies keep the old shape, is a
 * failure this repo has recorded; here the equivalent is a NEW route that owns
 * its own decoder and never adopts the helper.
 */

const ROOT = path.resolve(__dirname, "..", "..")

/**
 * Adapter consumers that must NOT end the session, each with the policy that
 * replaces it. An exemption is a claim that this decoder can never overlap the
 * mini player's — not a way past the scan.
 */
const EXEMPT = {
  "src/hooks/useManagedVideoPlayer.ts": "the adapter itself — it plays nothing",
  // It IS the mini player's decoder. Ending the session here would close the
  // window this component renders.
  "src/components/watch/PlaybackHost.tsx": "the root-owned playback host",
  // Its one production caller is the series-detail trailer, and that screen
  // already yields the other way: `showsSeriesTrailer` drops the trailer to a
  // poster while a session is live, so the two never decode at once.
  "src/components/watch/VideoPlayer.tsx": "the series-detail trailer",
}

/** The routes that own a decoder AND must hand it the session's place. */
const YIELDING_ROUTES = [
  "app/video/[sectionKey].tsx",
  "app/collection/[sectionKey].tsx",
]

const UNYIELDING_MESSAGE = [
  "A surface creates its own expo-video decoder and does not yield the mini",
  "player's session to it.",
  "",
  "A floating mini player over a route that decodes its own video is two",
  "decoders and two live audio streams, and on Android the route's SurfaceView",
  "draws over the window. The owner's decision is that the video the viewer",
  "just started wins.",
  "",
  "Pick one for the file below:",
  "  1. Call useEndMiniPlayerOnPlayback(isPlaying) — the shared helper, not a",
  "     hand-rolled store.end() beside it.",
  "  2. Suppress this surface while a session is live (useMiniPlayerActive),",
  "     the way the series trailer does, and add it to EXEMPT with that reason.",
].join("\n")

// Bare identifier for the adapter: an aliased import still names it on the
// import line, so word-boundary matching flags the file either way.
const ADAPTER_USAGE = /\buseManagedVideoPlayer\b/
// A CALL for the yield, because the import line is the identifier too — a
// route that keeps the import and drops the call must not read as adopted.
const YIELD_CALL = /\buseEndMiniPlayerOnPlayback\s*\(/

/** Lines that are not whole-line comments — a mention in prose is not a use. */
function codeLines(entry) {
  return entry.content
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
}

function findAdapterConsumers(entries) {
  return entries
    .filter((entry) =>
      codeLines(entry).some((line) => ADAPTER_USAGE.test(line)),
    )
    .map((entry) => entry.relative)
    .sort()
}

/** Pure detector over [{ relative, content }], so a fixture can prove the
 *  mechanism flags a real violation rather than that today's tree is clean. */
function findUnyieldingConsumers(entries) {
  return entries
    .filter((entry) =>
      codeLines(entry).some((line) => ADAPTER_USAGE.test(line)),
    )
    .filter((entry) => !(entry.relative in EXEMPT))
    .filter((entry) => !codeLines(entry).some((line) => YIELD_CALL.test(line)))
    .map((entry) => entry.relative)
    .sort()
}

// test-utils is skipped alongside __tests__: the shared expo-video stub names
// these identifiers by definition, and mocking one is not owning a decoder.
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
  const files = [
    ...collectSourceFiles(path.join(ROOT, "src")),
    ...collectSourceFiles(path.join(ROOT, "app")),
  ]
  return files.map((file) => ({
    relative: path.relative(ROOT, file),
    content: fs.readFileSync(file, "utf8"),
  }))
}

function routeSource(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8")
}

describe("every self-owned decoder yields the mini player session", () => {
  it("no adapter consumer skips the helper without an exemption", () => {
    const entries = collectEntries()
    // A broken root resolution or an empty scan must not vacuously pass.
    expect(entries.length).toBeGreaterThan(50)

    const unyielding = findUnyieldingConsumers(entries)
    if (unyielding.length > 0) {
      throw new Error(`${UNYIELDING_MESSAGE}\n\n  ${unyielding.join("\n  ")}\n`)
    }
  })

  it("both SDUI routes are inside the scanned set", () => {
    // The anti-vacuous companion: the check above also passes on a scan that
    // walked the wrong directory and found no consumer at all.
    const consumers = findAdapterConsumers(collectEntries())

    for (const route of YIELDING_ROUTES) expect(consumers).toContain(route)
    // Both directions: a stale exemption left behind after a surface changed
    // policy silently excuses whoever inherits that file.
    for (const exempt of Object.keys(EXEMPT))
      expect(consumers).toContain(exempt)
  })

  it("the exempt set has not grown", () => {
    // Separate from the scan so the number itself shows up in the diff. Excusing
    // a decoder is then two deliberate edits, not one line slipped into a map.
    expect(Object.keys(EXEMPT)).toHaveLength(3)
  })

  it("positive control: the detector flags a consumer that does not yield", () => {
    const found = findUnyieldingConsumers([
      {
        relative: "app/playlist/[sectionKey].tsx",
        content: "const { player, isPlaying } = useManagedVideoPlayer(url)",
      },
      {
        relative: "app/aliased/[sectionKey].tsx",
        content:
          'import { useManagedVideoPlayer as useMVP } from "../../src/hooks/useManagedVideoPlayer"\nuseMVP(url)',
      },
      {
        // The revert that survives a bare-identifier scan: the call goes, the
        // import stays behind, and the route silently stops yielding.
        relative: "app/import-only/[sectionKey].tsx",
        content:
          'import { useEndMiniPlayerOnPlayback } from "../../src/hooks/useEndMiniPlayerOnPlayback"\nuseManagedVideoPlayer(url)',
      },
      {
        relative: "app/video/[sectionKey].tsx",
        content:
          "useManagedVideoPlayer(url)\nuseEndMiniPlayerOnPlayback(isPlaying)",
      },
      {
        relative: "src/components/watch/PlaybackHost.tsx",
        content: "useManagedVideoPlayer(streamingUrl)",
      },
      {
        relative: "src/lib/miniPlayer/session.ts",
        content: " * useManagedVideoPlayer already re-keys its own recorder",
      },
    ])

    expect(found).toEqual([
      "app/aliased/[sectionKey].tsx",
      "app/import-only/[sectionKey].tsx",
      "app/playlist/[sectionKey].tsx",
    ])
  })
})

describe.each(YIELDING_ROUTES)("%s hands over its decoder", (relative) => {
  it("imports the shared helper, not a hand-rolled store end", () => {
    const source = routeSource(relative)

    expect(source).toContain(
      'import { useEndMiniPlayerOnPlayback } from "../../src/hooks/useEndMiniPlayerOnPlayback"',
    )
    // A local `store.end("replaced")` would satisfy the scan above while
    // being a second definition of the rule — the shape this guard exists for.
    expect(source).not.toContain('.end("replaced")')
  })

  it("calls it with the adapter's own playing state", () => {
    // Keyed on playback, never on the mount: a viewer who opens the page to
    // read the description keeps the window they deliberately left floating.
    const source = routeSource(relative)

    expect(source).toContain(
      "const { player, isPlaying } = useManagedVideoPlayer(",
    )
    expect(source).toContain("useEndMiniPlayerOnPlayback(isPlaying)")
  })

  it("has exactly one player block", () => {
    // The positive control: without it every check above passes on a file that
    // grew a second, unyielding player somewhere else on the screen.
    const source = routeSource(relative)

    expect(source.split("useManagedVideoPlayer(").length - 1).toBe(1)
    expect(source.split("useEndMiniPlayerOnPlayback(").length - 1).toBe(1)
  })
})
