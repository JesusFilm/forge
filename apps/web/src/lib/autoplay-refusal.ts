// Classifiers for the reasons a media element's `play()` promise rejects.
// Both read the error's `name`, never its message: a refusal surfaces as
// `DOMException(message, "NotAllowedError")`, and a one-argument
// `new DOMException("NotAllowedError")` is named "Error".

function errorName(err: unknown): unknown {
  if (!err || typeof err !== "object") return undefined
  return (err as { name?: unknown }).name
}

/**
 * `<MuxVideo>` (bare `<video>`) surfaces an autoplay refusal as a `play()`
 * rejection named `NotAllowedError`. iOS Low Power Mode refuses this way even
 * for muted inline video.
 */
export function isAutoplayBlockedError(err: unknown): boolean {
  const name = errorName(err)
  return name === "NotAllowedError" || name === "AutoplayNotAllowed"
}

/**
 * A `play()` interrupted by a new load or a `pause()` rejects with
 * `AbortError`. It is not a refusal and not a stall.
 */
export function isPlaybackAbortError(err: unknown): boolean {
  return errorName(err) === "AbortError"
}
