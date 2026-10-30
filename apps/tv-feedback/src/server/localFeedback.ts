import "server-only"

import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

import {
  submissionSchema,
  type Submission,
  type TvContext,
} from "@/lib/contracts"
import type { Upload } from "./feedbackState"
import { requireConfig } from "./config"
import {
  attachMedia,
  createIssue,
  findIssueByReference,
  issueDetails,
  uploadMedia,
} from "./linear"
import { LocalFeedbackError, localFeedbackConfig } from "./localConfig"
import { normalizeMedia, readBounded } from "./media"

export const LOCAL_COOKIE = "watch_tv_local_feedback"
const SESSION_MS = 2 * 60 * 60_000
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_SESSION_BYTES = 60 * 1024 * 1024
const MAX_SESSIONS = 32

const markSchema = z
  .object({
    id: z.string().max(100),
    type: z.enum(["draw", "arrow", "box", "text", "redact"]),
    x: z.number().finite(),
    y: z.number().finite(),
    points: z.array(z.number().finite()).max(4000).optional(),
    width: z.number().finite().optional(),
    height: z.number().finite().optional(),
    label: z.string().max(500).optional(),
    fontSize: z.number().finite().optional(),
  })
  .strict()
export const localSubmissionSchema = submissionSchema.safeExtend({
  annotationMarks: z.array(markSchema).max(100).optional(),
  annotationMetadataSimplified: z.boolean().optional(),
})
type LocalSubmission = z.infer<typeof localSubmissionSchema>
type LocalUpload = Upload & { sourceFile?: string; normalizedFile?: string }
type Delivery = {
  status: "not_sent" | "sending" | "delivered" | "needs_attention"
  issueAttempted?: boolean
  issueId?: string
  issueUrl?: string
  issueIdentifier?: string
  attachments: Record<
    string,
    { attempted: boolean; attached?: boolean; assetUrl?: string }
  >
}
type Report = {
  id: string
  savedAt: string
  payloadHash: string
  submission: Omit<LocalSubmission, "turnstileToken" | "website">
  delivery: Delivery
}
type Session = {
  id: string
  secretHash: string
  expiresAt: number
  admittedBytes: number
  uploads: Record<string, LocalUpload>
  reports: Record<string, Report>
}
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex")
function sessionPath(id: string) {
  if (!UUID.test(id)) throw new LocalFeedbackError("session_required", 401)
  return path.join(localFeedbackConfig().directory, id)
}
async function readSession(id: string): Promise<Session> {
  try {
    return JSON.parse(
      await readFile(path.join(sessionPath(id), "session.json"), "utf8"),
    ) as Session
  } catch (error) {
    if (error instanceof LocalFeedbackError) throw error
    throw new LocalFeedbackError("session_required", 401)
  }
}
async function saveSession(session: Session) {
  const directory = sessionPath(session.id)
  const temporary = path.join(directory, `${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(session, null, 2), {
    mode: 0o600,
    flag: "wx",
  })
  await rename(temporary, path.join(directory, "session.json"))
}
// The on-disk lock covers quota and idempotency across Next dev workers/restarts.
// A killed writer deliberately leaves it in place: inspect the saved state before
// removing a stale lock, especially after an uncertain Linear request.
async function locked<T>(work: () => Promise<T>): Promise<T> {
  const { directory } = localFeedbackConfig()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const lock = path.join(directory, ".writer-lock")
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new LocalFeedbackError("busy", 409)
    throw error
  }
  try {
    return await work()
  } finally {
    await rm(lock, { recursive: true })
  }
}
export async function authenticateLocalSession(
  cookie?: string,
): Promise<string | null> {
  if (!cookie) return null
  const [id, token, extra] = cookie.split(".")
  if (!UUID.test(id ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(token ?? "") || extra)
    return null
  try {
    const session = await readSession(id)
    const expected = Buffer.from(session.secretHash, "hex")
    const actual = Buffer.from(hash(token), "hex")
    return session.expiresAt > Date.now() &&
      expected.length === actual.length &&
      timingSafeEqual(expected, actual)
      ? id
      : null
  } catch {
    return null
  }
}
export async function newLocalSession() {
  return locked(async () => {
    const { directory } = localFeedbackConfig()
    const count = (await readdir(directory, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && UUID.test(entry.name),
    ).length
    if (count >= MAX_SESSIONS)
      throw new LocalFeedbackError("local_storage_full", 429)
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url")
    await mkdir(sessionPath(id), { mode: 0o700 })
    const session: Session = {
      id,
      secretHash: hash(token),
      expiresAt: Date.now() + SESSION_MS,
      admittedBytes: 0,
      uploads: {},
      reports: {},
    }
    await saveSession(session)
    return { id, cookie: `${id}.${token}`, expiresAt: session.expiresAt }
  })
}
async function activeSession(id: string) {
  const session = await readSession(id)
  if (session.expiresAt <= Date.now())
    throw new LocalFeedbackError("session_required", 401)
  return session
}
export async function reserveLocalUpload(
  sessionId: string,
  input: { name: string; type: string; size: number },
) {
  return locked(async () => {
    const session = await activeSession(sessionId)
    if (!input.type.startsWith("image/"))
      throw new LocalFeedbackError("images_only")
    if (
      Object.keys(session.uploads).length >= 12 ||
      session.admittedBytes + input.size > MAX_SESSION_BYTES
    )
      throw new LocalFeedbackError("quota_exceeded", 429)
    const id = randomUUID()
    session.uploads[id] = {
      id,
      sessionId,
      kind: "image",
      filename: input.name.replace(/[\\/]/g, "_"),
      type: input.type,
      size: input.size,
      status: "reserved",
    }
    session.admittedBytes += input.size
    await saveSession(session)
    return { uploadId: id }
  })
}
function ownedUpload(session: Session, id: string) {
  const upload = UUID.test(id) ? session.uploads[id] : undefined
  if (!upload) throw new LocalFeedbackError("not_found", 404)
  return upload
}
export async function localUploadStatus(sessionId: string, id: string) {
  const upload = ownedUpload(await activeSession(sessionId), id)
  return { status: upload.status, error_code: upload.error ?? null }
}
export async function writeLocalUpload(
  sessionId: string,
  id: string,
  request: Request,
) {
  return locked(async () => {
    const session = await activeSession(sessionId)
    const upload = ownedUpload(session, id)
    if (upload.status === "ready") return { status: "ready" }
    if (upload.status !== "reserved")
      throw new LocalFeedbackError("not_reserved", 409)
    if (request.headers.get("content-type") !== upload.type)
      throw new LocalFeedbackError("invalid_upload")
    upload.status = "uploading"
    await saveSession(session)
    try {
      const bytes = await readBounded(request, upload.size)
      const normalized = await normalizeMedia(upload, bytes)
      upload.sourceFile = `${id}.source`
      upload.normalizedFile = normalized.filename
      await writeFile(
        path.join(sessionPath(sessionId), upload.sourceFile),
        bytes,
        { mode: 0o600, flag: "wx" },
      )
      await writeFile(
        path.join(sessionPath(sessionId), upload.normalizedFile),
        normalized.bytes,
        { mode: 0o600, flag: "wx" },
      )
      upload.finalType = normalized.type
      upload.finalSize = normalized.bytes.length
      upload.status = "ready"
      await saveSession(session)
      return { status: "ready" }
    } catch {
      upload.status = "rejected"
      upload.error = "invalid_upload"
      await saveSession(session)
      throw new LocalFeedbackError("invalid_upload", 422)
    }
  })
}
export async function removeLocalUpload(sessionId: string, id: string) {
  return locked(async () => {
    const session = await activeSession(sessionId)
    const upload = ownedUpload(session, id)
    if (
      Object.values(session.reports).some((report) =>
        report.submission.uploadIds.includes(id),
      )
    )
      throw new LocalFeedbackError("already_submitted", 409)
    if (upload.status === "uploading") throw new LocalFeedbackError("busy", 409)
    upload.status = "removed"
    await saveSession(session)
    // Keep the bytes as test evidence. Removed means excluded from submission.
    return { removed: true }
  })
}
export async function saveLocalReport(
  sessionId: string,
  input: LocalSubmission,
) {
  return locked(async () => {
    const session = await activeSession(sessionId)
    const submission: Omit<LocalSubmission, "turnstileToken" | "website"> &
      Partial<Pick<LocalSubmission, "turnstileToken" | "website">> = {
      ...input,
    }
    delete submission.turnstileToken
    delete submission.website
    if (!submission.consentPhoneContext) delete submission.phoneContext
    const payloadHash = hash(JSON.stringify(submission))
    const previous = session.reports[input.idempotencyKey]
    if (previous) {
      if (previous.payloadHash !== payloadHash)
        throw new LocalFeedbackError("idempotency_conflict", 409)
      return { receipt: previous.id, status: "local_saved" }
    }
    if (Object.keys(session.reports).length >= 3)
      throw new LocalFeedbackError("quota_exceeded", 429)
    if (
      input.website ||
      new Set(input.uploadIds).size !== input.uploadIds.length
    )
      throw new LocalFeedbackError("invalid_submission")
    for (const id of input.uploadIds) {
      if (ownedUpload(session, id).status !== "ready")
        throw new LocalFeedbackError("files_not_ready", 409)
    }
    const report: Report = {
      id: input.idempotencyKey,
      savedAt: new Date().toISOString(),
      payloadHash,
      submission,
      delivery: { status: "not_sent", attachments: {} },
    }
    session.reports[report.id] = report
    await saveSession(session)
    return { receipt: report.id, status: "local_saved" }
  })
}
function ownedReport(session: Session, receipt: string) {
  const report = UUID.test(receipt) ? session.reports[receipt] : undefined
  if (!report) throw new LocalFeedbackError("not_found", 404)
  return report
}
function reportStatus(report: Report) {
  return {
    receipt: report.id,
    status:
      report.delivery.status === "not_sent"
        ? "local_saved"
        : report.delivery.status,
    issueUrl: report.delivery.issueUrl,
    issueIdentifier: report.delivery.issueIdentifier,
  }
}
export async function localReportStatus(sessionId: string, receipt: string) {
  return reportStatus(ownedReport(await activeSession(sessionId), receipt))
}
function toLinearReport(id: string, submission: Submission) {
  return {
    id: `LOCAL-SIMULATOR-${id}`,
    category: submission.category,
    message: `[LOCAL SIMULATOR TEST] ${submission.message}`,
    expected: submission.expected ?? null,
    steps: submission.steps ?? null,
    blocked: submission.blocked ?? false,
    tv_context: submission.tvContext as TvContext & Record<string, unknown>,
    phone_context: submission.consentPhoneContext
      ? (submission.phoneContext ?? null)
      : null,
    name: submission.name ?? null,
    email: submission.email ?? null,
  }
}
export async function sendLocalReportToLinear(
  sessionId: string,
  receipt: string,
) {
  if (!localFeedbackConfig().linearEnabled)
    throw new LocalFeedbackError("linear_disabled", 404)
  // Require a named destination before any attempt. No production Redis/grants.
  try {
    requireConfig(
      "FEEDBACK_LINEAR_API_KEY",
      "FEEDBACK_LINEAR_TEAM_ID",
      "FEEDBACK_LINEAR_PROJECT_ID",
    )
  } catch {
    throw new LocalFeedbackError("linear_not_configured", 503)
  }
  return locked(async () => {
    const session = await activeSession(sessionId)
    const report = ownedReport(session, receipt)
    const delivery = report.delivery
    if (delivery.status === "delivered") return reportStatus(report)
    // An interrupted request cannot safely be repeated. Reconcile the existing
    // issue by report reference only; no second create call after an attempt.
    const linearReport = toLinearReport(report.id, {
      ...report.submission,
      turnstileToken: "",
    })
    if (
      delivery.status === "needs_attention" ||
      delivery.status === "sending"
    ) {
      if (!delivery.issueId && delivery.issueAttempted) {
        try {
          delivery.issueId =
            (await findIssueByReference(linearReport.id)) ?? undefined
          if (delivery.issueId)
            Object.assign(delivery, await issueDetails(delivery.issueId))
        } catch {
          /* keep the saved uncertain state */
        }
      }
      delivery.status = "needs_attention"
      await saveSession(session)
      return reportStatus(report)
    }
    delivery.status = "sending"
    delivery.issueAttempted = true
    await saveSession(session)
    try {
      delivery.issueId = await createIssue(linearReport, {
        title: `[SIMULATOR TEST] ${report.submission.message}`,
      })
      await saveSession(session)
      Object.assign(delivery, await issueDetails(delivery.issueId))
      await saveSession(session)
      for (const uploadId of report.submission.uploadIds) {
        const upload = ownedUpload(session, uploadId)
        if (!upload.normalizedFile || upload.status !== "ready")
          throw new LocalFeedbackError("files_not_ready", 409)
        delivery.attachments[uploadId] = { attempted: true }
        await saveSession(session)
        const bytes = await readFile(
          path.join(sessionPath(sessionId), upload.normalizedFile),
        )
        const assetUrl = await uploadMedia(
          bytes,
          upload.normalizedFile,
          upload.finalType!,
        )
        delivery.attachments[uploadId].assetUrl = assetUrl
        await saveSession(session)
        await attachMedia(delivery.issueId, upload.normalizedFile, assetUrl)
        delivery.attachments[uploadId].attached = true
        await saveSession(session)
      }
      delivery.status = "delivered"
    } catch {
      delivery.status = "needs_attention"
    }
    await saveSession(session)
    return reportStatus(report)
  })
}
