import { NextResponse } from "next/server"
import { z } from "zod"

import { uploadReservationSchema } from "@/lib/contracts"
import {
  authenticateLocalSession,
  LOCAL_COOKIE,
  localReportStatus,
  localSubmissionSchema,
  localUploadStatus,
  newLocalSession,
  removeLocalUpload,
  reserveLocalUpload,
  saveLocalReport,
  sendLocalReportToLinear,
  writeLocalUpload,
} from "@/server/localFeedback"
import { checkLocalRequest, LocalFeedbackError } from "@/server/localConfig"
import { readJsonLimited } from "@/server/request"

export const runtime = "nodejs"
const receiptSchema = z.object({ receipt: z.uuid() }).strict()
type Context = { params: Promise<{ operation: string[] }> }
function cookie(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCAL_COOKIE}=`))
    ?.slice(LOCAL_COOKIE.length + 1)
}
async function handle(request: Request, context: Context) {
  try {
    checkLocalRequest(request)
    const { operation } = await context.params
    const route = operation.join("/")
    const sessionId = await authenticateLocalSession(cookie(request))
    const json = (value: unknown, status = 200) =>
      NextResponse.json(value, {
        status,
        headers: { "Cache-Control": "no-store" },
      })
    if (route === "session" && request.method === "POST") {
      if (sessionId) return json({ local: true })
      const session = await newLocalSession()
      const response = json({ local: true }, 201)
      response.cookies.set(LOCAL_COOKIE, session.cookie, {
        httpOnly: true,
        sameSite: "strict",
        secure: false,
        path: "/api/feedback/local",
        expires: new Date(session.expiresAt),
      })
      return response
    }
    if (!sessionId) throw new LocalFeedbackError("session_required", 401)
    if (route === "uploads" && request.method === "POST") {
      const parsed = uploadReservationSchema.safeParse(
        await readJsonLimited(request),
      )
      if (!parsed.success) throw new LocalFeedbackError("invalid_file")
      return json(await reserveLocalUpload(sessionId, parsed.data), 201)
    }
    if (operation.length === 2 && operation[0] === "uploads") {
      if (request.method === "GET")
        return json(await localUploadStatus(sessionId, operation[1]))
      if (request.method === "PUT")
        return json(await writeLocalUpload(sessionId, operation[1], request))
      if (request.method === "DELETE")
        return json(await removeLocalUpload(sessionId, operation[1]))
    }
    if (route === "submissions" && request.method === "POST") {
      const parsed = localSubmissionSchema.safeParse(
        await readJsonLimited(request),
      )
      if (!parsed.success) throw new LocalFeedbackError("invalid_submission")
      return json(await saveLocalReport(sessionId, parsed.data), 201)
    }
    if (
      (route === "status" || route === "linear") &&
      request.method === "POST"
    ) {
      const parsed = receiptSchema.safeParse(await readJsonLimited(request))
      if (!parsed.success) throw new LocalFeedbackError("invalid_receipt")
      return json(
        await (
          route === "linear" ? sendLocalReportToLinear : localReportStatus
        )(sessionId, parsed.data.receipt),
      )
    }
    throw new LocalFeedbackError("not_found", 404)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof LocalFeedbackError
            ? error.code
            : "local_request_failed",
      },
      {
        status: error instanceof LocalFeedbackError ? error.status : 400,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }
}
export const POST = handle
export const GET = handle
export const PUT = handle
export const DELETE = handle
