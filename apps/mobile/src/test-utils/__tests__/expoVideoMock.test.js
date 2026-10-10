// Plain JS (like useManagedVideoPlayer.guard.test.js): the RN tsconfig has no
// Node types, and the drift check below needs fs/path to read the adapter.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, jest, require */
const fs = require("fs")
const path = require("path")

const { createExpoVideoMock, makeFakePlayer } = require("../expoVideoMock")

// The recipe this module documents, exercised — a broken wiring line costs the
// next suite an hour of jest-mock debugging.
jest.mock("expo-video", () => require("../expoVideoMock").createExpoVideoMock())

const ADAPTER = path.resolve(__dirname, "../../hooks/useManagedVideoPlayer.ts")

// The line-based scan cannot see a property reached across a multi-line chain
// (`void player\n  .replaceAsync(...)`), so the adapter's surface is also pinned
// here. Both halves must hold: the pin catches what the scan misses.
const ADAPTER_SURFACE = [
  "addListener",
  "currentTime",
  "duration",
  "loop",
  "muted",
  "pause",
  "play",
  "playing",
  "replace",
  "replaceAsync",
  "status",
]

/** Every `player.x` / `p.x` the adapter reads or writes, comments excluded. */
function adapterPlayerProperties() {
  const source = fs.readFileSync(ADAPTER, "utf8")
  const found = new Set()
  for (const line of source.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    for (const match of line.matchAll(/\b(?:player|p)\??\.([A-Za-z_$][\w$]*)/g))
      found.add(match[1])
  }
  return [...found].sort()
}

describe("makeFakePlayer", () => {
  it("carries every player property the adapter touches", () => {
    const player = makeFakePlayer()
    const scanned = adapterPlayerProperties()
    // A broken path or regex must not vacuously pass — the adapter reaches for
    // ten-plus properties.
    expect(scanned.length).toBeGreaterThan(8)
    for (const property of [...scanned, ...ADAPTER_SURFACE])
      expect(player).toHaveProperty(property)
  })

  it("models playback state: play and pause flip playing and emit", () => {
    const player = makeFakePlayer()
    const seen = []
    const sub = player.addListener("playingChange", (payload) =>
      seen.push(payload),
    )

    player.play()
    expect(player.playing).toBe(true)
    player.pause()
    expect(player.playing).toBe(false)
    expect(seen).toEqual([{ isPlaying: true }, { isPlaying: false }])

    sub.remove()
    player.play()
    expect(seen).toHaveLength(2)
  })

  it("holds replaceAsync in flight until the suite settles it, at zero", async () => {
    const player = makeFakePlayer()
    player.currentTime = 42
    let resolved = false
    const swap = player
      .replaceAsync("https://example.test/next.m3u8")
      .then(() => {
        resolved = true
      })

    expect(player.__pendingReplaceCount()).toBe(1)
    expect(resolved).toBe(false)

    player.__settleReplace()
    await swap
    expect(resolved).toBe(true)
    expect(player.currentTime).toBe(0)
    expect(player.__pendingReplaceCount()).toBe(0)
  })

  it("rejects the in-flight replaceAsync when given a reason", async () => {
    const player = makeFakePlayer()
    const swap = player.replaceAsync("https://example.test/next.m3u8")
    player.__settleReplace(new Error("replace failed"))
    await expect(swap).rejects.toThrow("replace failed")
  })

  it("__reset clears state, listeners, and call history", () => {
    const player = makeFakePlayer()
    const seen = []
    player.addListener("playingChange", (payload) => seen.push(payload))
    player.play()
    player.currentTime = 12
    player.status = "readyToPlay"

    player.__reset()
    expect(player.playing).toBe(false)
    expect(player.currentTime).toBe(0)
    expect(player.status).toBe("idle")
    expect(player.play).toHaveBeenCalledTimes(0)

    player.play()
    expect(seen).toHaveLength(1)
  })

  it("throws when a suite settles a replace that is not in flight", () => {
    expect(() => makeFakePlayer().__settleReplace()).toThrow(
      "no in-flight replaceAsync",
    )
  })
})

describe("createExpoVideoMock", () => {
  it("returns one player for every useVideoPlayer call (R10: one decoder)", () => {
    const video = createExpoVideoMock()
    expect(video.useVideoPlayer("a")).toBe(video.__player)
    expect(video.useVideoPlayer("b")).toBe(video.__player)
    expect(video.useVideoPlayer).toHaveBeenCalledTimes(2)
  })

  it("runs the setup callback once per player, like the real hook", () => {
    const video = createExpoVideoMock()
    const setup = jest.fn((p) => {
      p.muted = true
    })

    video.useVideoPlayer("a", setup)
    video.useVideoPlayer("a", setup)
    expect(setup).toHaveBeenCalledTimes(1)
    expect(video.__player.muted).toBe(true)

    video.__reset()
    video.useVideoPlayer("a", setup)
    expect(setup).toHaveBeenCalledTimes(2)
  })

  it("exposes the module surface suites mock: VideoView and PiP support", () => {
    const video = createExpoVideoMock()
    expect(video.VideoView({})).toBeNull()
    expect(video.VideoView).toHaveBeenCalledWith({})
    expect(video.isPictureInPictureSupported()).toBe(true)
  })

  it("__settleReplace forwards to the shared player", async () => {
    const video = createExpoVideoMock()
    const swap = video.__player.replaceAsync("https://example.test/next.m3u8")
    video.__settleReplace()
    await expect(swap).resolves.toBeUndefined()
  })

  it("stands in for expo-video through the documented jest.mock recipe", () => {
    const video = require("expo-video")
    expect(video.useVideoPlayer("https://example.test/a.m3u8")).toBe(
      video.__player,
    )
    expect(typeof video.VideoView).toBe("function")
  })
})
