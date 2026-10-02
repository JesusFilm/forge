import { NextResponse } from "next/server"
import { createHash } from "node:crypto"

import { submissionForId } from "@/server/feedbackState"
import { currentSession, isSameOrigin } from "@/server/session"
import { receiptFor } from "@/server/receipt"
import { key, redis } from "@/server/redis"

import { readJsonLimited } from "@/server/request"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!(await isSameOrigin(request)))
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 })
  const sessionId = await currentSession()
  if (!sessionId)
    return NextResponse.json({ error: "session_required" }, { status: 401 })
  const input: unknown = await readJsonLimited(request).catch(() => null)
  const receipt =
    input &&
    typeof input === "object" &&
    "receipt" in input &&
    typeof input.receipt === "string"
      ? input.receipt
      : ""
  if (receipt.length !== 43)
    return NextResponse.json({ error: "invalid_receipt" }, { status: 400 })
  const receiptHash = createHash("sha256").update(receipt).digest("hex")
  const reportId = await redis().get(key("receipt", receiptHash))
  if (!reportId || receiptFor(reportId, sessionId) !== receipt)
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  const submission = await submissionForId(sessionId, reportId)
  if (!submission)
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json(
    {
      status:
        submission.status === "delivered"
          ? "delivered"
          : submission.status === "needs_attention"
            ? "needs_attention"
            : "processing",
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
