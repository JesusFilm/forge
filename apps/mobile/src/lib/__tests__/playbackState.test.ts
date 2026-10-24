import { classifyPlaybackState } from "../playbackState"

describe("classifyPlaybackState", () => {
  it.each([
    ["playing wins over everything", true, "error" as const, true, "playing"],
    [
      "a live player is playing",
      true,
      "readyToPlay" as const,
      false,
      "playing",
    ],
    ["a failed source is errored", false, "error" as const, false, "errored"],
    ["a finished video is ended", false, "readyToPlay" as const, true, "ended"],
    ["anything else is idle", false, "readyToPlay" as const, false, "idle"],
    ["an unread status is idle", false, "" as const, false, "idle"],
  ])("%s", (_name, playing, status, ended, expected) => {
    expect(classifyPlaybackState({ playing, status, ended })).toBe(expected)
  })

  // THE invariant this module exists for. An errored player can report a
  // position at or past its duration, so both callers see `ended` and `error`
  // together. Whichever they test first decides what the viewer is told: get it
  // wrong and the transport announces "Replay" while the press recovers.
  it("is errored, not ended, when a failed source also reports finished", () => {
    expect(
      classifyPlaybackState({ playing: false, status: "error", ended: true }),
    ).toBe("errored")
  })
})
