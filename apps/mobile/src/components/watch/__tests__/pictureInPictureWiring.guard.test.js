// Plain JS (like the ownership guard beside it): the RN tsconfig has no Node
// types, and this guard scans source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// U9. Two source-shape facts jest cannot see from behaviour.
//
// A view that reaches the operating system's window without feeding the latch
// is paused by the AppState handler (R13) and unmounted by the host (R24), and
// nothing about it fails — it just freezes in the window, which is the spike's
// finding 6. So every call site goes through `pictureInPictureViewProps`, and
// no file spells the raw props itself.
//
// And `automatic` belongs to exactly ONE mounted view: expo-video elects a
// single candidate across every view that carries it, warns when it finds more
// than one, and re-parents only the elected view's player back out.
const HELPER = "src/lib/miniPlayer/pictureInPicture.ts"
const RAW_PROPS =
  /\b(allowsPictureInPicture|startsPictureInPictureAutomatically|onPictureInPictureStart|onPictureInPictureStop)\b/
const SPREADS = /pictureInPictureViewProps\(/
const AUTOMATIC_FALSE =
  /pictureInPictureViewProps\(\{\s*automatic:\s*false\s*\}\)/

const PLAYBACK_HOST = "src/components/watch/PlaybackHost.tsx"

/** The R19-excluded SDUI routes: viewer-initiated players, never the host's. */
const VIEWER_INITIATED_PLAYERS = [
  "app/video/[sectionKey].tsx",
  "app/collection/[sectionKey].tsx",
]

function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function readTree() {
  const root = path.resolve(__dirname, "../../../..")
  const files = [
    ...collectSourceFiles(path.join(root, "src")),
    ...collectSourceFiles(path.join(root, "app")),
  ]
  // A broken root resolution must not vacuously pass.
  expect(files.length).toBeGreaterThan(50)
  return files.map((file) => ({
    relative: path.relative(root, file),
    content: fs.readFileSync(file, "utf8"),
  }))
}

describe("picture-in-picture is wired through one helper", () => {
  it("only the helper spells the raw props", () => {
    const spellers = readTree()
      .filter((entry) => RAW_PROPS.test(entry.content))
      .map((entry) => entry.relative)

    expect(spellers).toEqual([HELPER])
  })

  it("the host and the two SDUI players are the call sites", () => {
    const callers = readTree()
      .filter(
        (entry) => entry.relative !== HELPER && SPREADS.test(entry.content),
      )
      .map((entry) => entry.relative)

    expect(callers.sort()).toEqual(
      [PLAYBACK_HOST, ...VIEWER_INITIATED_PLAYERS].sort(),
    )
  })

  it("only the host may arm automatic entry", () => {
    const tree = readTree()
    const armed = tree
      .filter(
        (entry) =>
          entry.relative !== HELPER &&
          SPREADS.test(entry.content) &&
          !AUTOMATIC_FALSE.test(entry.content),
      )
      .map((entry) => entry.relative)

    expect(armed).toEqual([PLAYBACK_HOST])

    // Anti-vacuous: the host's own call site is the one that varies, so read
    // its argument rather than trusting the absence of a literal false.
    const host = tree.find((entry) => entry.relative === PLAYBACK_HOST)
    expect(host.content.replace(/\s+/g, "")).toContain(
      "pictureInPictureViewProps({automatic:automaticPip})",
    )
  })

  it("positive control: the detectors flag a hand-rolled call site", () => {
    const hand = { content: "<VideoView allowsPictureInPicture />" }
    const spread = { content: "{...pictureInPictureViewProps({ automatic })}" }

    expect(RAW_PROPS.test(hand.content)).toBe(true)
    expect(RAW_PROPS.test(spread.content)).toBe(false)
    expect(SPREADS.test(spread.content)).toBe(true)
    expect(AUTOMATIC_FALSE.test(spread.content)).toBe(false)
  })
})
