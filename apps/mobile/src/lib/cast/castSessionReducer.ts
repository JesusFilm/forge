// Cast session lifecycle as a pure reducer (KTD3). Async native callbacks
// race chrome fades and each other, so every state change routes through
// here — the hook holds no session useState side-channels.

/** Connect budget: the unconditional release for the Connecting state. */
export const CAST_CONNECT_TIMEOUT_MS = 30_000

export type CastFailureReason =
  | "connect_timeout"
  | "connect_error"
  | "media_error"
  | "device_drop"

export type CastEndTrigger = "userEnd" | "unmount" | "videoChanged"

export type CastSessionState =
  | { phase: "idle" }
  | { phase: "connecting"; deviceName: string | null }
  | { phase: "active"; deviceName: string | null }
  | { phase: "failed"; reason: CastFailureReason; deviceName: string | null }
  | {
      phase: "ended"
      trigger: CastEndTrigger
      deviceName: string | null
      lastPositionSeconds: number | null
    }
  | { phase: "finished"; deviceName: string | null }

export type CastPhase = CastSessionState["phase"]

export type CastSessionEvent =
  | { type: "connect"; deviceName: string | null }
  | { type: "sessionStarted"; deviceName: string | null }
  | { type: "mediaLoaded" }
  | { type: "mediaFailed" }
  | { type: "mediaFinished" }
  | {
      type: "sessionEnded"
      errorMessage: string | null
      positionSeconds: number | null
    }
  | { type: "timeout" }
  | { type: "userEnd"; positionSeconds: number | null }
  | { type: "videoChanged"; positionSeconds: number | null }
  | { type: "unmount"; positionSeconds: number | null }
  | { type: "reset" }

export const castSessionInitialState: CastSessionState = { phase: "idle" }

export function castSessionReducer(
  state: CastSessionState,
  event: CastSessionEvent,
): CastSessionState {
  switch (state.phase) {
    case "idle":
      // sessionStarted also enters Connecting: the screen can mount while a
      // session already exists, and native callbacks can outrun `connect`.
      if (event.type === "connect" || event.type === "sessionStarted") {
        return { phase: "connecting", deviceName: event.deviceName }
      }
      return state

    case "connecting":
      switch (event.type) {
        case "connect":
          return {
            phase: "connecting",
            deviceName: event.deviceName ?? state.deviceName,
          }
        case "sessionStarted":
          return {
            phase: "connecting",
            deviceName: event.deviceName ?? state.deviceName,
          }
        case "mediaLoaded":
          return { phase: "active", deviceName: state.deviceName }
        case "mediaFailed":
          return {
            phase: "failed",
            reason: "media_error",
            deviceName: state.deviceName,
          }
        case "timeout":
          return {
            phase: "failed",
            reason: "connect_timeout",
            deviceName: state.deviceName,
          }
        case "sessionEnded":
          // No error means the user dismissed the dialog — a silent abort,
          // not a Failed state (no snackbar for a deliberate cancel).
          return event.errorMessage != null
            ? {
                phase: "failed",
                reason: "connect_error",
                deviceName: state.deviceName,
              }
            : castSessionInitialState
        case "userEnd":
        case "videoChanged":
        case "unmount":
          return castSessionInitialState
        default:
          return state
      }

    case "active":
      switch (event.type) {
        case "mediaFinished":
          return { phase: "finished", deviceName: state.deviceName }
        case "mediaFailed":
          return {
            phase: "failed",
            reason: "media_error",
            deviceName: state.deviceName,
          }
        case "sessionEnded":
          return event.errorMessage != null
            ? {
                phase: "failed",
                reason: "device_drop",
                deviceName: state.deviceName,
              }
            : {
                phase: "ended",
                trigger: "userEnd",
                deviceName: state.deviceName,
                lastPositionSeconds: event.positionSeconds,
              }
        case "userEnd":
        case "videoChanged":
        case "unmount":
          return {
            phase: "ended",
            trigger: event.type,
            deviceName: state.deviceName,
            lastPositionSeconds: event.positionSeconds,
          }
        case "sessionStarted":
          // Late async device-name resolution must not regress an active
          // session to Connecting — only the name updates.
          return {
            phase: "active",
            deviceName: event.deviceName ?? state.deviceName,
          }
        case "connect":
          return { phase: "connecting", deviceName: event.deviceName }
        default:
          // timeout here is a stale Connecting timer; mediaLoaded a repeat.
          return state
      }

    case "failed":
    case "ended":
    case "finished":
      if (event.type === "reset") return castSessionInitialState
      if (event.type === "connect" || event.type === "sessionStarted") {
        return { phase: "connecting", deviceName: event.deviceName }
      }
      return state
  }
}

/** Structural mirror of the SDK's MediaStatus — keeps this module SDK-free. */
export type RemoteMediaStatusLike = {
  playerState?: string | null
  idleReason?: string | null
}

// Literals pinned to the SDK's MediaPlayerState / MediaPlayerIdleReason
// string-enum values — the destination wire contract.
export function mediaStatusToEvent(
  status: RemoteMediaStatusLike | null,
): CastSessionEvent | null {
  if (status == null) return null
  switch (status.playerState) {
    case "playing":
    case "paused":
    case "buffering":
      return { type: "mediaLoaded" }
    case "idle":
      if (status.idleReason === "finished") return { type: "mediaFinished" }
      if (status.idleReason === "error") return { type: "mediaFailed" }
      // cancelled / interrupted: a stop or a new LOAD; other events own those.
      return null
    default:
      // "loading" (still loading), null, or an unknown future state.
      return null
  }
}
