import { playPressAction } from "../playPressAction"

const AT_REST = {
  playing: false,
  status: "readyToPlay" as const,
  duration: 600,
  currentTime: 120,
}

describe("playPressAction", () => {
  it("recovers an errored player instead of calling play, which is a no-op", () => {
    // The wedge (todos/024): a transient network drop leaves ExoPlayer in
    // `error`. play() does nothing there, so the button reads as dead.
    expect(
      playPressAction({
        ...AT_REST,
        status: "error",
      }),
    ).toBe("recover")
  })

  it("pauses a playing video", () => {
    expect(playPressAction({ ...AT_REST, playing: true })).toBe("pause")
  })

  it("replays a finished video, because play alone is a no-op at the end", () => {
    expect(
      playPressAction({ ...AT_REST, duration: 600, currentTime: 599.8 }),
    ).toBe("replay")
  })

  it("plays a paused video mid-way", () => {
    expect(playPressAction(AT_REST)).toBe("play")
  })

  // The state actually observed on a Galaxy Tab S8 after a ~7s dropout: the
  // transport read 0:00 / 0:00 while the player sat in `error`. Both the
  // duration and the position are zeroed, so the finished-video branch cannot
  // catch it and the press fell through to a no-op play().
  it("recovers the real wedged state, where duration and position are zero", () => {
    expect(
      playPressAction({
        playing: false,
        status: "error",
        duration: 0,
        currentTime: 0,
      }),
    ).toBe("recover")
  })

  // Ordering guard: `error` must be tested BEFORE the end-of-video branch.
  // An errored player can report a position at or past its duration, and
  // replaying it seeks a player that cannot play — the dead button again.
  it("recovers an errored video even when it also looks finished", () => {
    expect(
      playPressAction({
        playing: false,
        status: "error",
        duration: 600,
        currentTime: 600,
      }),
    ).toBe("recover")
  })
})
