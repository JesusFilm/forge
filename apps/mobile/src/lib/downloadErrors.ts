import type { TransferInterruption } from "./downloadOutcome"

/**
 * Map the native error report onto our {@link TransferInterruption} taxonomy.
 * Pure (no native import) so it is unit-testable. Native codes vary per platform,
 * so this is intentionally conservative: unknowns default to a transient blip
 * (→ paused + auto-resume); genuinely terminal failures surface their HTTP code.
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
