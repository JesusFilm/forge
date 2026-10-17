/**
 * The open report (R23). One deadline-bounded round trip, the same transport
 * and the same typed failure the registration mutation uses, because admin
 * answers the same codes on both push write paths (KTD7).
 *
 * The nonce is carried exactly as it arrived: the app never interprets it.
 */

import { mutateWithDeadline } from "../recommendations/transport"
import { PUSH_OPEN_REPORT_DEADLINE_MS } from "./constants"
import { REPORT_PUSH_OPEN } from "./operations"
import type { PushViewerHandle } from "./payload"
import { PushClientError, toPushClientError } from "./registrationClient"

/** Every answer admin gives. All three are normal receipts (KTD14). */
export type PushOpenOutcome = "STORED" | "DUPLICATE" | "UNKNOWN"

export type PushOpenReportInput = {
  nonce: string
  /** Both halves or nothing: admin refuses an incomplete handle (KTD7). */
  viewer: PushViewerHandle | null
}

export async function reportPushOpen(
  input: PushOpenReportInput,
): Promise<PushOpenOutcome> {
  try {
    const data = await mutateWithDeadline(
      REPORT_PUSH_OPEN,
      {
        input:
          input.viewer == null
            ? { nonce: input.nonce }
            : {
                nonce: input.nonce,
                viewerToken: input.viewer.viewerToken,
                sessionToken: input.viewer.sessionToken,
              },
      },
      PUSH_OPEN_REPORT_DEADLINE_MS,
    )
    const outcome = data.reportPushOpen?.outcome
    if (outcome == null) {
      // Admin declares the field non-null, so an absent one is a contract break
      // rather than a receipt this client should read as an unknown nonce.
      throw new PushClientError("GRAPHQL_ERROR", { definitive: true })
    }
    return outcome as PushOpenOutcome
  } catch (error) {
    throw toPushClientError(error)
  }
}
