import { playerCenterControl } from "../playerCenterControl"

const PAUSED_ONLINE = {
  playing: false,
  ended: false,
  status: "readyToPlay" as const,
  online: true,
}

describe("playerCenterControl", () => {
  it("shows the no-connection state when the source failed and the device is offline", () => {
    expect(
      playerCenterControl({
        ...PAUSED_ONLINE,
        status: "error",
        online: false,
      }),
    ).toBe("offline")
  })

  it("shows pause while playing", () => {
    expect(playerCenterControl({ ...PAUSED_ONLINE, playing: true })).toBe(
      "pause",
    )
  })

  it("shows replay at the end", () => {
    expect(playerCenterControl({ ...PAUSED_ONLINE, ended: true })).toBe(
      "replay",
    )
  })

  it("shows play when paused mid-way", () => {
    expect(playerCenterControl(PAUSED_ONLINE)).toBe("play")
  })

  // The retry has to come back the moment the connection does, otherwise the
  // viewer is left staring at a dead indicator with no way to resume.
  it("offers play again once the device is back online, even while errored", () => {
    expect(
      playerCenterControl({ ...PAUSED_ONLINE, status: "error", online: true }),
    ).toBe("play")
  })

  // Losing Wi-Fi mid-playback does not stop a video that is still running from
  // its buffer. Only a failed source earns the no-connection indicator.
  it("keeps the normal control when offline but the source has not failed", () => {
    expect(
      playerCenterControl({ ...PAUSED_ONLINE, playing: true, online: false }),
    ).toBe("pause")
  })

  // The control and the press must agree. playPressAction tests `error` before
  // the end-of-video branch, so this must too — otherwise the button announces
  // "Replay" while the press performs a recover. An errored player can report a
  // position at or past its duration, and PlayerControls' remount seed effect
  // (`setEnded(!player.playing && t >= d - 0.5)`) makes that reachable.
  it("offers play, not replay, for an errored video that also looks finished", () => {
    expect(
      playerCenterControl({
        playing: false,
        ended: true,
        status: "error",
        online: true,
      }),
    ).toBe("play")
  })

  it("shows the no-connection state for an errored, finished, offline video", () => {
    expect(
      playerCenterControl({
        playing: false,
        ended: true,
        status: "error",
        online: false,
      }),
    ).toBe("offline")
  })
})
