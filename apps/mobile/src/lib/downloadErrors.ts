import type { TransferInterruption } from "./downloadOutcome"

/**
 * Map the native error report onto our {@link TransferInterruption} taxonomy.
 * Pure (no native import) so it is unit-testable, and conservative: unknowns
 * default to a transient blip (→ paused + auto-resume); terminal failures surface HTTP code.
 */
export function mapNativeError(params: {
  error: string
  errorCode: number
}): TransferInterruption {
  const { error, errorCode } = params

  if (Number.isInteger(errorCode) && errorCode >= 400 && errorCode <= 599) {
    return { kind: "httpError", status: errorCode }
  }
  const message = error ?? ""
  if (/no space|insufficient|storage full|disk full|ENOSPC/i.test(message)) {
    return { kind: "storageFull" }
  }
  if (/integrity|checksum|corrupt/i.test(message)) {
    return { kind: "integrity" }
  }
  if (/cancell?ed|aborted by user/i.test(message)) {
    return { kind: "userCancel" }
  }
  return { kind: "connectivity" }
}

/**
 * R25: bound a native error message before it reaches telemetry — replace any
 * url/path-shaped run and cap length, so a signed download URL can never leak
 * into a log line.
 */
export function sanitizeNativeErrorMessage(message: string): string {
  const stripped = (message ?? "")
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\/\S+/g, "<path>")
    .trim()
  return stripped.length > 200 ? `${stripped.slice(0, 200)}…` : stripped
}
