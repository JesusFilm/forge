// Plain JS (like the adapter guard beside it): the RN tsconfig has no Node
// types, and this guard needs fs/path to scan source files.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// U6 hoisted the one player to the root. Two source-shape facts hold it there,
// and jest cannot see either from behaviour: a screen that mounts the player
// component again gets its own adapter, and a second adapter that owns the
// session would flush ITS recorder on someone else's ending.
const PLAYER_MOUNT = /<VideoPlayer[\s/>]|\buseManagedVideoPlayer\b/
const SESSION_OWNER = /ownsSession:\s*true/

// R9/R10: the host owns the window's surface, so a hero — a video view the
// viewer never asked for — gives the decoder up while the window holds a video.
const VIDEO_VIEW = /<VideoView[\s/>]/
const YIELDS = /\buseMiniPlayerHoldsVideo\b/
const PLAYBACK_HOST = "src/components/watch/PlaybackHost.tsx"
const HOME_SCREEN = "src/components/home/HomeScreen.tsx"

const HERO_VIDEO_SURFACES = [
  "src/components/home/HomeHeroPager.tsx",
  "src/components/sections/VideoHeroRenderer.tsx",
]

// Viewer-initiated full players on two R19-excluded SDUI routes. They are not
// wired to the root player at all, which is an open R10 gap reported alongside
// U8 — and one a poster yield would be the wrong fix for.
const VIEWER_INITIATED_PLAYERS = [
  "app/video/[sectionKey].tsx",
  "app/collection/[sectionKey].tsx",
]

const SCREENS_WITHOUT_A_PLAYER = [
  "app/watch/[slug].tsx",
  "app/series/[slug].tsx",
]

function mountsAPlayer(entries) {
  return entries
    .filter((entry) =>
      entry.content
        .split("\n")
        .some(
          (line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && PLAYER_MOUNT.test(line),
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

describe("the screens borrow the root player", () => {
  it("neither the watch screen nor the series trailer mounts a player of its own", () => {
    const tree = readTree()
    const screens = tree.filter((entry) =>
      SCREENS_WITHOUT_A_PLAYER.includes(entry.relative),
    )
    expect(screens.map((entry) => entry.relative).sort()).toEqual(
      [...SCREENS_WITHOUT_A_PLAYER].sort(),
    )
    expect(mountsAPlayer(screens)).toEqual([])
  })

  it("positive control: the detector flags a screen that mounts one either way", () => {
    expect(
      mountsAPlayer([
        {
          relative: "app/series/[slug].tsx",
          content: "  return <VideoPlayer streamingUrl={trailerHls} />",
        },
        {
          relative: "app/watch/[slug].tsx",
          content: "const { player } = useManagedVideoPlayer(src)",
        },
        {
          relative: "app/quiet.tsx",
          content: "// once mounted a VideoPlayer here",
        },
      ]),
    ).toEqual(["app/series/[slug].tsx", "app/watch/[slug].tsx"])
  })

  // A slot the watch screen renders only when it HAS a stream hands the player
  // back to the route beneath for the gap, and its unmount reads as a committed
  // back press. Neither is visible from the screen's own behaviour in jest.
  it("the watch screen keeps one slot whatever its source resolves to", () => {
    const watch = readTree().find(
      (entry) => entry.relative === "app/watch/[slug].tsx",
    )
    expect(watch).toBeDefined()

    expect(watch.content.match(/<PlayerSlot\b/g)).toHaveLength(1)
    // The cast pin (KTD4) is what reaches the player; `playerSource` is the
    // live chain it freezes. Pinning the chain here would miss a dropped pin.
    expect(watch.content).toContain("streamingUrl={effectivePlayerSource}")
    // The shape that dropped it: a dock branched on the source being absent.
    expect(watch.content).not.toMatch(/playerSource\s*==\s*null\s*\?/)
  })

  it("positive control: the detector flags a dock branched on the source", () => {
    const branched =
      "{playerSource == null ? <PlayerPoster /> : <PlayerSlot />}"
    expect(branched).toMatch(/playerSource\s*==\s*null\s*\?/)
  })

  it("exactly one adapter owns the mini-player session, and it is the host", () => {
    const owners = readTree()
      .filter((entry) => SESSION_OWNER.test(entry.content))
      .map((entry) => entry.relative)
    expect(owners).toEqual([PLAYBACK_HOST])
  })
})

describe("the heroes yield the decoder to a live window", () => {
  // Read off the tree rather than asserted from a list, so a NEW video surface
  // fails here and has to be classified instead of quietly holding a decoder.
  it("the app's video views are the host, the two heroes, and the two SDUI players", () => {
    const surfaces = readTree()
      .filter((entry) => VIDEO_VIEW.test(entry.content))
      .map((entry) => entry.relative)

    expect(surfaces.sort()).toEqual(
      [
        PLAYBACK_HOST,
        ...HERO_VIDEO_SURFACES,
        ...VIEWER_INITIATED_PLAYERS,
      ].sort(),
    )
  })

  it("each hero reads the yield for itself, at every call site it has", () => {
    const heroes = readTree().filter((entry) =>
      HERO_VIDEO_SURFACES.includes(entry.relative),
    )

    // Anti-vacuous: a broken scan would leave nothing to check.
    expect(heroes.map((entry) => entry.relative).sort()).toEqual(
      [...HERO_VIDEO_SURFACES].sort(),
    )
    expect(
      heroes
        .filter((entry) => !YIELDS.test(entry.content))
        .map((entry) => entry.relative),
    ).toEqual([])
  })

  // The pager reads the window itself, so this composition is defence in depth:
  // reverting it leaves every behaviour test green.
  it("Home composes the window into its hero's paused predicate", () => {
    const home = readTree().find((entry) => entry.relative === HOME_SCREEN)
    const squished = home.content.replace(/\s+/g, "")

    expect(squished).toContain(
      "constwindowHoldsVideo=useMiniPlayerHoldsVideo()",
    )
    expect(squished).toContain("paused={heroPlaybackPaused(")
  })
})
