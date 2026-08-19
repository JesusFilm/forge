import {
  castSessionInitialState,
  castSessionReducer,
  mediaStatusToEvent,
  type CastSessionEvent,
  type CastSessionState,
} from "../castSessionReducer"

const connecting = (deviceName: string | null = "Living Room") =>
  castSessionReducer(castSessionInitialState, { type: "connect", deviceName })

const active = (deviceName: string | null = "Living Room") =>
  castSessionReducer(connecting(deviceName), { type: "mediaLoaded" })

describe("castSessionReducer", () => {
  describe("Idle", () => {
    it("connect enters Connecting with the device name", () => {
      expect(
        castSessionReducer(castSessionInitialState, {
          type: "connect",
          deviceName: "Living Room",
        }),
      ).toEqual({ phase: "connecting", deviceName: "Living Room" })
    })

    it("sessionStarted enters Connecting (screen mounted mid-session)", () => {
      expect(
        castSessionReducer(castSessionInitialState, {
          type: "sessionStarted",
          deviceName: "Bedroom",
        }),
      ).toEqual({ phase: "connecting", deviceName: "Bedroom" })
    })

    it("media/timeout/end events in Idle do not transition or throw", () => {
      const events: CastSessionEvent[] = [
        { type: "mediaLoaded" },
        { type: "mediaFailed" },
        { type: "mediaFinished" },
        { type: "timeout" },
        { type: "userEnd", positionSeconds: 12 },
        { type: "videoChanged", positionSeconds: 12 },
        { type: "unmount", positionSeconds: 12 },
        { type: "sessionEnded", errorMessage: "x", positionSeconds: null },
        { type: "reset" },
      ]
      for (const event of events) {
        expect(castSessionReducer(castSessionInitialState, event)).toEqual({
          phase: "idle",
        })
      }
    })
  })

  describe("Connecting", () => {
    it("mediaLoaded enters Active, carrying the device name", () => {
      expect(
        castSessionReducer(connecting("Living Room"), { type: "mediaLoaded" }),
      ).toEqual({ phase: "active", deviceName: "Living Room" })
    })

    it("sessionStarted stays Connecting and fills in a late device name", () => {
      expect(
        castSessionReducer(connecting(null), {
          type: "sessionStarted",
          deviceName: "Living Room",
        }),
      ).toEqual({ phase: "connecting", deviceName: "Living Room" })
    })

    it("sessionStarted with a null name keeps the known device name", () => {
      expect(
        castSessionReducer(connecting("Living Room"), {
          type: "sessionStarted",
          deviceName: null,
        }),
      ).toEqual({ phase: "connecting", deviceName: "Living Room" })
    })

    it("timeout fails as connect_timeout (unconditional release)", () => {
      expect(castSessionReducer(connecting(), { type: "timeout" })).toEqual({
        phase: "failed",
        reason: "connect_timeout",
        deviceName: "Living Room",
      })
    })

    it("sessionEnded with an error fails as connect_error", () => {
      expect(
        castSessionReducer(connecting(), {
          type: "sessionEnded",
          errorMessage: "boom",
          positionSeconds: null,
        }),
      ).toEqual({
        phase: "failed",
        reason: "connect_error",
        deviceName: "Living Room",
      })
    })

    it("sessionEnded without an error returns to Idle (user canceled)", () => {
      expect(
        castSessionReducer(connecting(), {
          type: "sessionEnded",
          errorMessage: null,
          positionSeconds: null,
        }),
      ).toEqual({ phase: "idle" })
    })

    it("mediaFailed fails as media_error (receiver load failure)", () => {
      expect(castSessionReducer(connecting(), { type: "mediaFailed" })).toEqual(
        {
          phase: "failed",
          reason: "media_error",
          deviceName: "Living Room",
        },
      )
    })

    it("userEnd / videoChanged / unmount abort back to Idle", () => {
      const events: CastSessionEvent[] = [
        { type: "userEnd", positionSeconds: null },
        { type: "videoChanged", positionSeconds: null },
        { type: "unmount", positionSeconds: null },
      ]
      for (const event of events) {
        expect(castSessionReducer(connecting(), event)).toEqual({
          phase: "idle",
        })
      }
    })

    it("stale mediaFinished / reset do not transition", () => {
      expect(
        castSessionReducer(connecting(), { type: "mediaFinished" }),
      ).toEqual(connecting())
      expect(castSessionReducer(connecting(), { type: "reset" })).toEqual(
        connecting(),
      )
    })
  })

  describe("Active", () => {
    it("mediaFinished enters Finished (AE2 mapping)", () => {
      expect(castSessionReducer(active(), { type: "mediaFinished" })).toEqual({
        phase: "finished",
        deviceName: "Living Room",
      })
    })

    it("mediaFailed fails as media_error (receiver error)", () => {
      expect(castSessionReducer(active(), { type: "mediaFailed" })).toEqual({
        phase: "failed",
        reason: "media_error",
        deviceName: "Living Room",
      })
    })

    it("sessionEnded with an error fails as device_drop", () => {
      expect(
        castSessionReducer(active(), {
          type: "sessionEnded",
          errorMessage: "device went away",
          positionSeconds: 44,
        }),
      ).toEqual({
        phase: "failed",
        reason: "device_drop",
        deviceName: "Living Room",
      })
    })

    it("sessionEnded without an error ends gracefully with the last position", () => {
      expect(
        castSessionReducer(active(), {
          type: "sessionEnded",
          errorMessage: null,
          positionSeconds: 44,
        }),
      ).toEqual({
        phase: "ended",
        trigger: "userEnd",
        deviceName: "Living Room",
        lastPositionSeconds: 44,
      })
    })

    it("userEnd ends with the last remote position", () => {
      expect(
        castSessionReducer(active(), { type: "userEnd", positionSeconds: 91 }),
      ).toEqual({
        phase: "ended",
        trigger: "userEnd",
        deviceName: "Living Room",
        lastPositionSeconds: 91,
      })
    })

    it("videoChanged ends the session (KTD7: keyed on video identity)", () => {
      expect(
        castSessionReducer(active(), {
          type: "videoChanged",
          positionSeconds: 10,
        }),
      ).toEqual({
        phase: "ended",
        trigger: "videoChanged",
        deviceName: "Living Room",
        lastPositionSeconds: 10,
      })
    })

    it("unmount ends the session", () => {
      expect(
        castSessionReducer(active(), { type: "unmount", positionSeconds: 5 }),
      ).toEqual({
        phase: "ended",
        trigger: "unmount",
        deviceName: "Living Room",
        lastPositionSeconds: 5,
      })
    })

    it("a stale connect timer firing in Active does not fail the session", () => {
      expect(castSessionReducer(active(), { type: "timeout" })).toEqual(
        active(),
      )
    })

    it("a late sessionStarted (async device-name race) only updates the name", () => {
      expect(
        castSessionReducer(active(null), {
          type: "sessionStarted",
          deviceName: "Living Room",
        }),
      ).toEqual({ phase: "active", deviceName: "Living Room" })
    })

    it("repeated mediaLoaded status updates do not transition", () => {
      expect(castSessionReducer(active(), { type: "mediaLoaded" })).toEqual(
        active(),
      )
    })

    it("connect (device switch) re-enters Connecting", () => {
      expect(
        castSessionReducer(active(), {
          type: "connect",
          deviceName: "Bedroom",
        }),
      ).toEqual({ phase: "connecting", deviceName: "Bedroom" })
    })
  })

  describe("Failed / Ended traps + shared reset/reconnect exits", () => {
    const failed = castSessionReducer(connecting(), { type: "timeout" })
    const ended = castSessionReducer(active(), {
      type: "userEnd",
      positionSeconds: 3,
    })
    const finished = castSessionReducer(active(), { type: "mediaFinished" })

    it("reset returns each to Idle (U4 drives this)", () => {
      for (const state of [failed, ended, finished]) {
        expect(castSessionReducer(state, { type: "reset" })).toEqual({
          phase: "idle",
        })
      }
    })

    it("connect / sessionStarted re-enter Connecting (reconnect)", () => {
      for (const state of [failed, ended, finished]) {
        expect(
          castSessionReducer(state, { type: "connect", deviceName: "TV" }),
        ).toEqual({ phase: "connecting", deviceName: "TV" })
        expect(
          castSessionReducer(state, {
            type: "sessionStarted",
            deviceName: "TV",
          }),
        ).toEqual({ phase: "connecting", deviceName: "TV" })
      }
    })

    it("media and end events do not transition Failed / Ended", () => {
      const events: CastSessionEvent[] = [
        { type: "mediaLoaded" },
        { type: "mediaFailed" },
        { type: "mediaFinished" },
        { type: "timeout" },
        { type: "userEnd", positionSeconds: 1 },
        { type: "sessionEnded", errorMessage: "x", positionSeconds: 1 },
      ]
      for (const state of [failed, ended]) {
        for (const event of events) {
          expect(castSessionReducer(state, event)).toEqual(state)
        }
      }
    })
  })

  describe("Finished (live session, receiver at end of media)", () => {
    const finished = castSessionReducer(active(), { type: "mediaFinished" })

    it("mediaLoaded re-enters Active (successful replay)", () => {
      expect(castSessionReducer(finished, { type: "mediaLoaded" })).toEqual({
        phase: "active",
        deviceName: "Living Room",
      })
    })

    it("sessionEnded without an error ends gracefully", () => {
      expect(
        castSessionReducer(finished, {
          type: "sessionEnded",
          errorMessage: null,
          positionSeconds: 120,
        }),
      ).toEqual({
        phase: "ended",
        trigger: "userEnd",
        deviceName: "Living Room",
        lastPositionSeconds: 120,
      })
    })

    it("sessionEnded with an error fails as device_drop", () => {
      expect(
        castSessionReducer(finished, {
          type: "sessionEnded",
          errorMessage: "device went away",
          positionSeconds: null,
        }),
      ).toEqual({
        phase: "failed",
        reason: "device_drop",
        deviceName: "Living Room",
      })
    })

    it("userEnd / videoChanged / unmount end with the matching trigger", () => {
      for (const type of ["userEnd", "videoChanged", "unmount"] as const) {
        expect(
          castSessionReducer(finished, { type, positionSeconds: 7 }),
        ).toEqual({
          phase: "ended",
          trigger: type,
          deviceName: "Living Room",
          lastPositionSeconds: 7,
        })
      }
    })

    it("stale mediaFailed / mediaFinished / timeout do not transition", () => {
      const events: CastSessionEvent[] = [
        { type: "mediaFailed" },
        { type: "mediaFinished" },
        { type: "timeout" },
      ]
      for (const event of events) {
        expect(castSessionReducer(finished, event)).toEqual(finished)
      }
    })
  })

  it("never throws and always returns a known phase for any state x event", () => {
    const states: CastSessionState[] = [
      castSessionInitialState,
      connecting(),
      active(),
      castSessionReducer(connecting(), { type: "timeout" }),
      castSessionReducer(active(), { type: "userEnd", positionSeconds: 1 }),
      castSessionReducer(active(), { type: "mediaFinished" }),
    ]
    const events: CastSessionEvent[] = [
      { type: "connect", deviceName: "d" },
      { type: "sessionStarted", deviceName: "d" },
      { type: "mediaLoaded" },
      { type: "mediaFailed" },
      { type: "mediaFinished" },
      { type: "sessionEnded", errorMessage: "e", positionSeconds: 1 },
      { type: "sessionEnded", errorMessage: null, positionSeconds: null },
      { type: "timeout" },
      { type: "userEnd", positionSeconds: 1 },
      { type: "videoChanged", positionSeconds: 1 },
      { type: "unmount", positionSeconds: 1 },
      { type: "reset" },
    ]
    const phases = new Set([
      "idle",
      "connecting",
      "active",
      "failed",
      "ended",
      "finished",
    ])
    for (const state of states) {
      for (const event of events) {
        const next = castSessionReducer(state, event)
        expect(phases.has(next.phase)).toBe(true)
      }
    }
  })
})

describe("mediaStatusToEvent", () => {
  // Literals pinned to the SDK's own enum values (MediaPlayerState /
  // MediaPlayerIdleReason string enums) — the destination wire contract.
  it("maps playing / paused / buffering to mediaLoaded", () => {
    for (const playerState of ["playing", "paused", "buffering"]) {
      expect(mediaStatusToEvent({ playerState })).toEqual({
        type: "mediaLoaded",
      })
    }
  })

  it("maps idle+finished to mediaFinished (receiver playback complete)", () => {
    expect(
      mediaStatusToEvent({ playerState: "idle", idleReason: "finished" }),
    ).toEqual({ type: "mediaFinished" })
  })

  it("maps idle+error to mediaFailed", () => {
    expect(
      mediaStatusToEvent({ playerState: "idle", idleReason: "error" }),
    ).toEqual({ type: "mediaFailed" })
  })

  it("ignores idle with cancelled / interrupted / absent reasons", () => {
    expect(
      mediaStatusToEvent({ playerState: "idle", idleReason: "cancelled" }),
    ).toBeNull()
    expect(
      mediaStatusToEvent({ playerState: "idle", idleReason: "interrupted" }),
    ).toBeNull()
    expect(mediaStatusToEvent({ playerState: "idle" })).toBeNull()
  })

  it("ignores loading, null status, and unknown states", () => {
    expect(mediaStatusToEvent({ playerState: "loading" })).toBeNull()
    expect(mediaStatusToEvent(null)).toBeNull()
    expect(mediaStatusToEvent({ playerState: null })).toBeNull()
    expect(mediaStatusToEvent({ playerState: "someFutureState" })).toBeNull()
  })
})
