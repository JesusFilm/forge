import type { TransferInterruption } from "./downloadOutcome"

/**
 * Map the background-download module's native error report
 * ({ error, errorCode }) onto our {@link TransferInterruption} taxonomy, which
 * the classifier then turns into a paused/failed/canceled outcome.
 *
 * Pure (no native import) so it is unit-testable. The exact native error codes
 * vary per platform; this mapping is intentionally conservative and should be
 * tuned from real device logs during verification:
 *  - an HTTP status (4xx/5xx) is a terminal httpError;
 *  - an out-of-space message is storageFull (terminal);
 *  - an integrity/corruption message is terminal;
 *  - an explicit cancel is userCancel;
 *  - anything else defaults to a transient connectivity blip (→ paused +
 *    auto-resume), which is the field-friendly default — a genuinely terminal
 *    failure surfaces its HTTP code and is caught above.
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
