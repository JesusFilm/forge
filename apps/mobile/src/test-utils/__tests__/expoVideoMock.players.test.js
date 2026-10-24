// Plain JS, like expoVideoMock.test.js beside it. This file covers the two
// opt-ins the Explore feed's suites use: a second distinct player, and a
// `timeUpdate` that goes out only when the player asks for one.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, jest, require */
const { createExpoVideoMock, makeFakePlayer } = require("../expoVideoMock")

describe("createExpoVideoMock({ players: 2 })", () => {
  it("hands each call site its own player on every render", () => {
    const video = createExpoVideoMock({ players: 2 })
    const [first, second] = video.__players

    expect(first).not.toBe(second)
    expect(video.__player).toBe(first)
    // Two renders of one component that calls the hook twice.
    for (let render = 0; render < 2; render++) {
      expect(video.useVideoPlayer(null)).toBe(first)
      expect(video.useVideoPlayer(null)).toBe(second)
    }
  })

  it("runs each player's setup once, like the real hook", () => {
    const video = createExpoVideoMock({ players: 2 })
    const setup = jest.fn()

    for (let render = 0; render < 3; render++) {
      video.useVideoPlayer(null, setup)
      video.useVideoPlayer(null, setup)
    }
    expect(setup.mock.calls.map(([player]) => player)).toEqual(video.__players)
  })

  it("__reset resets every player and starts the call order again", () => {
    const video = createExpoVideoMock({ players: 2 })
    video.useVideoPlayer(null)
    video.__players[1].currentTime = 9

    video.__reset()
    expect(video.__players[1].currentTime).toBe(0)
    expect(video.useVideoPlayer(null)).toBe(video.__players[0])
  })

  it("keeps one shared player by default", () => {
    const video = createExpoVideoMock()
    expect(video.__players).toEqual([video.__player])
    expect(video.useVideoPlayer(null)).toBe(video.useVideoPlayer(null))
  })
})

describe("makeFakePlayer().__tick", () => {
  it("emits timeUpdate only while timeUpdateEventInterval is above 0", () => {
    const player = makeFakePlayer()
    const seen = []
    player.addListener("timeUpdate", (payload) => seen.push(payload))

    expect(player.__tick({ currentTime: 3, bufferedPosition: 8 })).toBe(false)
    expect(seen).toEqual([])
    // The playhead still moves: the property is what a poll would read.
    expect(player.currentTime).toBe(3)

    player.timeUpdateEventInterval = 0.25
    expect(player.__tick({ currentTime: 4 })).toBe(true)
    expect(seen).toEqual([
      {
        currentTime: 4,
        bufferedPosition: 8,
        currentLiveTimestamp: null,
        currentOffsetFromLive: null,
      },
    ])
  })
})
