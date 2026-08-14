// Plain JS (like the other guards): the RN tsconfig has no Node types, and
// this one walks the source tree with fs/path.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

/**
 * SOURCE-SHAPE guard on the picture-in-picture wiring (U9; R13, R14, R15).
 *
 * The BEHAVIOUR is proved in `pictureInPicture.test.ts` plus the two render
 * suites, and every one of those stays green when a FIFTH surface writes its
 * own `allowsPictureInPicture` by hand. That surface then presents an
 * affordance whose start and stop never reach the latch, so the app pauses the
 * video the system just handed to the floating window — a fault with no
 * failing test and no log line.
 *
 * A shared predicate that reached only the call sites a change already touched
 * while siblings kept a hand-rolled copy is a failure this repo has recorded.
 * The rule here is stronger than "adopt the helper": the four prop names may
 * appear ONLY inside the helper, so a hand-rolled site cannot compile past this
 * scan even to override one prop after the spread.
 */

// src/lib/miniPlayer/__tests__ → the app root, four levels up.
const ROOT = path.resolve(__dirname, "..", "..", "..", "..")

/** The one module allowed to name the props. */
const HELPER = "src/lib/miniPlayer/pictureInPicture.ts"

/** Every surface that must spread it. Each is a render site, not a file. */
const WIRED_SURFACES = [
  // Backs BOTH the watch screen and the series-detail trailer, so this one
  // spread applies to that pair.
  "src/components/watch/VideoPlayer.tsx",
  "src/components/watch/MiniPlayerWindow.tsx",
  "app/video/[sectionKey].tsx",
  "app/collection/[sectionKey].tsx",
]

/** The `VideoView` props the helper owns. None may be written by hand. */
const OWNED_PROPS = [
  "allowsPictureInPicture",
  "startsPictureInPictureAutomatically",
  "onPictureInPictureStart",
  "onPictureInPictureStop",
]

const HAND_ROLLED_MESSAGE = [
  "A file names a picture-in-picture VideoView prop by hand.",
  "",
  "Every capable surface spreads pictureInPictureViewProps() from",
  `${HELPER} instead. A hand-rolled prop presents an affordance whose start`,
  "and stop never reach the latch, so the app pauses the video the operating",
  "system just handed to its floating window, and R24's hold never arms.",
  "",
  "Replace the props with {...pictureInPictureViewProps()} in the file below:",
].join("\n")

const MANUAL_START_MESSAGE = [
  "A file calls startPictureInPicture on a view directly.",
  "",
  "expo-video documents that call as THROWING on a device that does not",
  `support the mode, and it also returns a rejectable promise. Use the wrapped`,
  `startPictureInPicture() from ${HELPER}, which checks support and catches`,
  "both, in the file below:",
].join("\n")

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

/** Lines that are not whole-line comments — a mention in prose is not a use. */
function codeLines(entry) {
  return entry.content
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
}

const OWNED_PROP_PATTERN = new RegExp(`\\b(${OWNED_PROPS.join("|")})\\b`)
// A CALL, not the identifier: the helper's own name contains the bare word,
// and so does an `import type` line in a file that owns no view.
const MANUAL_START_PATTERN = /\.\s*startPictureInPicture\s*\(/
const SPREAD_PATTERN = /\.\.\.\s*pictureInPictureViewProps\s*\(/

/** Pure detectors over [{ relative, content }], so a fixture can prove the
 *  mechanism flags a real violation rather than that today's tree is clean. */
function findHandRolledProps(entries) {
  return entries
    .filter((entry) => entry.relative !== HELPER)
    .filter((entry) =>
      codeLines(entry).some((line) => OWNED_PROP_PATTERN.test(line)),
    )
    .map((entry) => entry.relative)
    .sort()
}

function findRawManualStarts(entries) {
  return entries
    .filter((entry) => entry.relative !== HELPER)
    .filter((entry) =>
      codeLines(entry).some((line) => MANUAL_START_PATTERN.test(line)),
    )
    .map((entry) => entry.relative)
    .sort()
}

function findWiredSurfaces(entries) {
  return entries
    .filter((entry) =>
      codeLines(entry).some((line) => SPREAD_PATTERN.test(line)),
    )
    .map((entry) => entry.relative)
    .sort()
}

describe("one picture-in-picture wiring for every surface", () => {
  it("no file outside the helper names a picture-in-picture prop", () => {
    const entries = collectEntries()
    // A broken root resolution or an empty scan must not vacuously pass.
    expect(entries.length).toBeGreaterThan(50)

    const handRolled = findHandRolledProps(entries)
    if (handRolled.length > 0) {
      throw new Error(
        `${HAND_ROLLED_MESSAGE}\n\n  ${handRolled.join("\n  ")}\n`,
      )
    }
  })

  it("no file calls a view's startPictureInPicture unwrapped", () => {
    const raw = findRawManualStarts(collectEntries())
    if (raw.length > 0) {
      throw new Error(`${MANUAL_START_MESSAGE}\n\n  ${raw.join("\n  ")}\n`)
    }
  })

  it("every known surface spreads the helper", () => {
    // The anti-vacuous companion: the scan above also passes on a tree where
    // nobody wires picture-in-picture at all.
    const wired = findWiredSurfaces(collectEntries())

    for (const surface of WIRED_SURFACES) expect(wired).toContain(surface)
  })

  it("the wired set has not grown unnoticed", () => {
    // Separate so the number shows up in the diff. A new capable surface is
    // then a deliberate edit here, next to the four that already exist.
    expect(findWiredSurfaces(collectEntries())).toEqual(
      [...WIRED_SURFACES].sort(),
    )
  })

  it("the helper is where the props live", () => {
    const source = fs.readFileSync(path.join(ROOT, HELPER), "utf8")

    for (const prop of OWNED_PROPS) expect(source).toContain(prop)
  })

  it("positive control: the detector flags a hand-rolled surface", () => {
    const found = findHandRolledProps([
      {
        relative: "app/playlist/[sectionKey].tsx",
        content: "<VideoView player={p} allowsPictureInPicture />",
      },
      {
        // The revert that survives a bare "adopts the helper" scan: the spread
        // stays and one callback is overridden after it, so the latch loses
        // this surface while every other check passes.
        relative: "src/components/watch/Override.tsx",
        content:
          "<VideoView {...pictureInPictureViewProps()} onPictureInPictureStop={noop} />",
      },
      {
        relative: "src/components/watch/Fine.tsx",
        content: "<VideoView {...pictureInPictureViewProps()} />",
      },
      {
        relative: HELPER,
        content: "allowsPictureInPicture: available,",
      },
      {
        // Prose only. Naming the prop in a comment is not a use.
        relative: "src/lib/miniPlayer/notes.ts",
        content: "// allowsPictureInPicture is set by the shared helper",
      },
    ])

    expect(found).toEqual([
      "app/playlist/[sectionKey].tsx",
      "src/components/watch/Override.tsx",
    ])
  })

  it("positive control: the detector flags a raw manual start", () => {
    const found = findRawManualStarts([
      {
        relative: "src/components/watch/Raw.tsx",
        content: "void ref.current?.startPictureInPicture()",
      },
      {
        relative: "src/components/watch/Wrapped.tsx",
        content:
          'import { startPictureInPicture } from "../../lib/miniPlayer/pictureInPicture"\nstartPictureInPicture(ref.current)',
      },
      {
        relative: HELPER,
        content: "void view.startPictureInPicture().catch(() => {})",
      },
    ])

    expect(found).toEqual(["src/components/watch/Raw.tsx"])
  })
})
