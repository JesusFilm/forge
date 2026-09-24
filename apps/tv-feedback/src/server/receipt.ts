import { createHmac } from "node:crypto"

import { requireConfig } from "./config"

export function receiptFor(reportId: string, sessionId: string): string {
  return createHmac(
    "sha256",
    requireConfig("FEEDBACK_SESSION_SECRET").FEEDBACK_SESSION_SECRET,
  )
    .update(`tv-feedback-receipt:v1:${reportId}:${sessionId}`)
    .digest("base64url")
}
