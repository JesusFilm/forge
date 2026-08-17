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

  it("exactly one adapter owns the mini-player session, and it is the host", () => {
    const owners = readTree()
      .filter((entry) => SESSION_OWNER.test(entry.content))
      .map((entry) => entry.relative)
    expect(owners).toEqual(["src/components/watch/PlaybackHost.tsx"])
  })
})
