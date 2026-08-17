import { CastState } from "react-native-google-cast"

import {
  castButtonLabel,
  castDevicesAvailable,
  castIndicatorLabel,
  isRemoteCastPhase,
  isRemotePlayingState,
  releaseTriggersSwap,
  selectPlaybackTarget,
  type CastTargetInput,
} from "../playbackTarget"

function makeInput(overrides: Partial<CastTargetInput> = {}): CastTargetInput {
  return {
    phase: "active",
    position: 30,
    duration: 120,
    remotePlayerState: "playing",
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    fallbackPositionSeconds: 11,
    fallbackDurationSeconds: 99,
    ...overrides,
  }
}

describe("selectPlaybackTarget (KTD4)", () => {
  it.each(["idle", "failed", "ended"] as const)(
    "returns null in %s — the chrome keeps the live local player",
    (phase) => {
      expect(selectPlaybackTarget(makeInput({ phase }))).toBeNull()
    },
  )

  it("hands the chrome the remote session while active", () => {
    const input = makeInput()
    const target = selectPlaybackTarget(input)
    expect(target).toMatchObject({
      isPlaying: true,
      currentTime: 30,
      duration: 120,
      ended: false,
      held: false,
    })
    target?.play()
    target?.pause()
    target?.seekTo(45)
    expect(input.play).toHaveBeenCalledTimes(1)
    expect(input.pause).toHaveBeenCalledTimes(1)
    expect(input.seekTo).toHaveBeenCalledWith(45)
  })

  it("reads paused from the receiver's player state", () => {
    const target = selectPlaybackTarget(
      makeInput({ remotePlayerState: "paused" }),
    )
    expect(target?.isPlaying).toBe(false)
  })

  it("treats receiver buffering as playing (pause must stay offered)", () => {
    const target = selectPlaybackTarget(
      makeInput({ remotePlayerState: "buffering" }),
    )
    expect(target?.isPlaying).toBe(true)
  })

  it("falls back to the frozen local snapshot before the receiver reports", () => {
    const target = selectPlaybackTarget(
      makeInput({ position: null, duration: null }),
    )
    expect(target?.currentTime).toBe(11)
    expect(target?.duration).toBe(99)
  })

  it("holds the transport while connecting (R16)", () => {
    const input = makeInput({
      phase: "connecting",
      position: null,
      duration: null,
      remotePlayerState: null,
    })
    const target = selectPlaybackTarget(input)
    expect(target?.held).toBe(true)
    expect(target?.isPlaying).toBe(false)
    target?.play()
    target?.pause()
    target?.seekTo(5)
    expect(input.play).not.toHaveBeenCalled()
    expect(input.pause).not.toHaveBeenCalled()
    expect(input.seekTo).not.toHaveBeenCalled()
  })

  it("maps the session's Finished state to ended (chrome shows Replay)", () => {
    const input = makeInput({
      phase: "finished",
      remotePlayerState: "idle",
    })
    const target = selectPlaybackTarget(input)
    expect(target?.ended).toBe(true)
    expect(target?.isPlaying).toBe(false)
    // Replay must still dispatch to the session.
    target?.play()
    expect(input.play).toHaveBeenCalledTimes(1)
  })
})

describe("isRemoteCastPhase", () => {
  it.each([
    ["idle", false],
    ["connecting", true],
    ["active", true],
    ["failed", false],
    ["ended", false],
    ["finished", true],
  ] as const)("%s -> %s", (phase, expected) => {
    expect(isRemoteCastPhase(phase)).toBe(expected)
  })
})

describe("isRemotePlayingState", () => {
  it.each([
    ["playing", true],
    ["buffering", true],
    ["paused", false],
    ["idle", false],
    ["loading", false],
    [null, false],
  ] as const)("%s -> %s", (state, expected) => {
    expect(isRemotePlayingState(state)).toBe(expected)
  })
})

describe("castDevicesAvailable (R2)", () => {
  it("pins the literal to the SDK's real enum value", () => {
    // The derivation compares strings so src/lib stays SDK-free; this pin
    // fails if a react-native-google-cast upgrade changes the wire value.
    expect(CastState.NO_DEVICES_AVAILABLE).toBe("noDevicesAvailable")
  })

  it("is false with no state and with no devices", () => {
    expect(castDevicesAvailable(null)).toBe(false)
    expect(castDevicesAvailable(CastState.NO_DEVICES_AVAILABLE)).toBe(false)
  })

  it("is true for every discovered-devices state", () => {
    expect(castDevicesAvailable(CastState.NOT_CONNECTED)).toBe(true)
    expect(castDevicesAvailable(CastState.CONNECTING)).toBe(true)
    expect(castDevicesAvailable(CastState.CONNECTED)).toBe(true)
  })
})

describe("cast labels", () => {
  it("labels the button idle outside a session", () => {
    expect(castButtonLabel("idle", null)).toBe("Cast")
    expect(castButtonLabel("failed", "TV")).toBe("Cast")
    expect(castButtonLabel("ended", "TV")).toBe("Cast")
  })

  it("labels the button with the device during a session", () => {
    expect(castButtonLabel("connecting", "Living Room TV")).toBe(
      "Casting to Living Room TV",
    )
    expect(castButtonLabel("active", "Living Room TV")).toBe(
      "Casting to Living Room TV",
    )
    expect(castButtonLabel("active", null)).toBe("Casting")
  })

  it("names the connecting state distinctly (R16)", () => {
    expect(castIndicatorLabel("connecting", "Living Room TV")).toBe(
      "Connecting to Living Room TV…",
    )
    expect(castIndicatorLabel("connecting", null)).toBe("Connecting…")
  })

  it("names the live session (R7)", () => {
    expect(castIndicatorLabel("active", "Living Room TV")).toBe(
      "Casting to Living Room TV",
    )
    expect(castIndicatorLabel("finished", "Living Room TV")).toBe(
      "Casting to Living Room TV",
    )
    expect(castIndicatorLabel("active", null)).toBe("Casting")
  })
})

describe("releaseTriggersSwap", () => {
  const dubA = "https://stream.mux.com/aaa111.m3u8"
  const dubB = "https://stream.mux.com/bbb222.m3u8"

  it("is false when the pin releases onto the same URL", () => {
    expect(releaseTriggersSwap(dubA, dubA)).toBe(false)
  })

  it("mirrors the adapter: same Mux playback id means no reload", () => {
    expect(
      releaseTriggersSwap(dubA, "https://stream.mux.com/aaa111.m3u8?x=1"),
    ).toBe(false)
  })

  it("is true when a dub chosen mid-session changed the asset", () => {
    expect(releaseTriggersSwap(dubA, dubB)).toBe(true)
  })

  it("is true for a non-Mux URL change (id compare unavailable)", () => {
    expect(releaseTriggersSwap(dubA, "https://cdn.example.com/v.m3u8")).toBe(
      true,
    )
  })

  it("is false with nothing pinned or nothing current", () => {
    expect(releaseTriggersSwap(null, dubA)).toBe(false)
    expect(releaseTriggersSwap(dubA, null)).toBe(false)
  })
})
