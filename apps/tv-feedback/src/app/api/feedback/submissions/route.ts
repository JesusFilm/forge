import { createHash } from "node:crypto"
import { NextResponse } from "next/server"

import { submissionSchema } from "@/lib/contracts"
import {
  activeGrantForSession,
  beginSubmission,
  finishSubmission,
  grantForId,
  recordIssueId,
  sessionForId,
  submissionForId,
  uploadForId,
} from "@/server/feedbackState"
import {
  attachMedia,
  createIssue,
  findIssueByReference,
  type ReportForLinear,
} from "@/server/linear"
import { receiptFor } from "@/server/receipt"
import { createSession, currentSession, isSameOrigin } from "@/server/session"
import { verifyTurnstile } from "@/server/turnstile"
import { grantMode } from "@/server/tvGrant"

import { readJsonLimited } from "@/server/request"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!(await isSameOrigin(request)))
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 })
  const parsed = submissionSchema.safeParse(
    await readJsonLimited(request).catch(() => null),
  )
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_report" }, { status: 400 })
  const input = parsed.data
  if (input.website)
    return NextResponse.json({ error: "invalid_report" }, { status: 400 })
  let sessionId = await currentSession()
  if (!sessionId) {
    if (grantMode() === "enforce")
      return NextResponse.json({ error: "grant_required" }, { status: 403 })
    if (!(await verifyTurnstile(input.turnstileToken)))
      return NextResponse.json(
        { error: "verification_required" },
        { status: 403 },
      )
    sessionId = await createSession().catch(() => null)
  }
  if (!sessionId)
    return NextResponse.json({ error: "unavailable" }, { status: 503 })
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ ...input, turnstileToken: "" }))
    .digest("hex")
  const previous = await submissionForId(sessionId, input.idempotencyKey)
  if (previous) {
    if (previous.payloadHash !== payloadHash)
      return NextResponse.json(
        { error: "idempotency_conflict" },
        { status: 409 },
      )
    if (previous.status === "delivered")
      return NextResponse.json(
        {
          status: "delivered",
          receipt: receiptFor(previous.reportId, sessionId),
        },
        { headers: { "Cache-Control": "no-store" } },
      )
    if (!previous.issueId)
      return NextResponse.json({ error: "delivery_uncertain" }, { status: 503 })
    const session = await sessionForId(sessionId)
    const grant = session ? await grantForId(session.grantId) : null
    if (!grant || grant.sessionId !== sessionId)
      return NextResponse.json({ error: "delivery_uncertain" }, { status: 503 })
    try {
      for (const uploadId of input.uploadIds) {
        const file = await uploadForId(uploadId)
        if (
          !file ||
          file.sessionId !== sessionId ||
          !file.assetUrl ||
          file.status !== "ready"
        )
          throw new Error("files_not_ready")
        await attachMedia(previous.issueId, file.filename, file.assetUrl)
      }
      await finishSubmission(
        previous,
        grant.day,
        grant.installationId,
        "delivered",
        previous.issueId,
      )
      return NextResponse.json(
        {
          status: "delivered",
          receipt: receiptFor(previous.reportId, sessionId),
        },
        { headers: { "Cache-Control": "no-store" } },
      )
    } catch {
      return NextResponse.json({ error: "delivery_uncertain" }, { status: 503 })
    }
  }
  const grant = await activeGrantForSession(sessionId)
  if (!grant)
    return NextResponse.json({ error: "grant_required" }, { status: 403 })
  if (new Set(input.uploadIds).size !== input.uploadIds.length)
    return NextResponse.json({ error: "files_not_ready" }, { status: 422 })
  const files = await Promise.all(input.uploadIds.map((id) => uploadForId(id)))
  if (
    files.some(
      (file) =>
        !file ||
        file.sessionId !== sessionId ||
        file.status !== "ready" ||
        !file.assetUrl,
    ) ||
    files.filter((file) => file?.kind === "image").length > 3 ||
    files.filter((file) => file?.kind === "video").length > 1 ||
    (input.flow === "photo" && files[0]?.kind !== "image")
  )
    return NextResponse.json({ error: "files_not_ready" }, { status: 422 })
  const reportId = input.idempotencyKey
  const receipt = receiptFor(reportId, sessionId)
  const receiptHash = createHash("sha256").update(receipt).digest("hex")
  const begin = await beginSubmission(
    sessionId,
    input.idempotencyKey,
    payloadHash,
    receiptHash,
    input.uploadIds,
  )
  if ("error" in begin)
    return NextResponse.json(
      { error: begin.error },
      { status: begin.error === "files_not_ready" ? 422 : 403 },
    )
  if (
    !begin.created ||
    begin.submission.payloadHash !== payloadHash ||
    begin.submission.status !== "creating" ||
    begin.submission.reportId !== reportId
  )
    return NextResponse.json({ error: "delivery_uncertain" }, { status: 503 })
  const report: ReportForLinear = {
    id: grant.reference,
    category: input.category,
    message: input.message,
    expected: input.expected ?? null,
    steps: input.steps ?? null,
    blocked: input.blocked ?? false,
    tv_context: input.tvContext,
    phone_context: input.consentPhoneContext
      ? (input.phoneContext ?? null)
      : null,
    name: input.name || null,
    email: input.email || null,
  }
  let issueId: string | undefined
  try {
    issueId = await createIssue(report)
    await recordIssueId(sessionId, input.idempotencyKey, issueId)
    for (const file of files) {
      if (!file?.assetUrl) throw new Error("files_not_ready")
      await attachMedia(issueId, file.filename, file.assetUrl)
    }
    await finishSubmission(
      begin.submission,
      grant.day,
      grant.installationId,
      "delivered",
      issueId,
    )
    return NextResponse.json(
      { status: "delivered", receipt },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    if (!issueId) {
      try {
        const found = await findIssueByReference(grant.reference)
        if (found) {
          issueId = found
          await recordIssueId(sessionId, input.idempotencyKey, found)
        }
      } catch {
        // Retain an uncertain state for manual review; never create a second issue.
      }
    }
    await finishSubmission(
      begin.submission,
      grant.day,
      grant.installationId,
      "needs_attention",
      issueId,
    ).catch(() => undefined)
    return NextResponse.json({ error: "delivery_uncertain" }, { status: 503 })
  }
}
