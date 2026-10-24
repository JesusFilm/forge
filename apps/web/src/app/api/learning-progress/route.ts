import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getRequestOrigin } from "@/auth/request-origin"
import { verifyAuthSession } from "@/lib/auth-session"
import { isWatchAudienceEnabled } from "@/lib/feature-flags"
import {
  fetchLearningProgress,
  resetLearningProgress,
  saveLearningProgress,
  type LearningFailure,
} from "@/lib/watch-learning-progress"
import { LEARNING_SUBJECT_HEADER } from "@/lib/watch-learning-progress-client"

// Own learning progress (feat-731). Private to the signed-in account: the
// user's own access token goes to Admin, which derives the account from it.
// Nothing here is cacheable and nothing accepts a user id.

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "private, no-store" }

// Shape bounds only; Admin rejects any id its course allowlist does not know.
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const idList = z.array(id).max(64)

// Strict: a body naming a user, notes, or any other field is refused rather
// than silently trimmed.
const courseSchema = z.strictObject({ courseId: id, contentVersion: id })
const lessonSchema = courseSchema.extend({
  lessonId: id,
  expectedRevision: z.number().int().min(0),
})
const saveSchema = lessonSchema.extend({
  completedMovementIds: idList,
  completedStepIds: idList,
  completed: z.boolean(),
  resumeCardId: id.nullable(),
})

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/**
 * Same rollout gate as the film finder for reads and saves: with the audience
 * flag off, or unreadable, GET and POST do not exist, so a rollback also stops
 * saves from pages opened before it. Checked before the session or Admin is
 * touched. DELETE is deliberately NOT gated: resetting data a viewer already
 * saved must keep working after a rollback (Admin's reset is ungated too).
 */
async function isProgressEnabled(): Promise<boolean> {
  try {
    return await isWatchAudienceEnabled()
  } catch {
    return false
  }
}

const notFound = () => json({ error: "Not found" }, 404)

const FAILURE_STATUS: Record<LearningFailure["reason"], number> = {
  invalid: 400,
  forbidden: 403,
  unauthorized: 401,
  upstream: 502,
}

function failed(result: LearningFailure) {
  return json({ error: result.reason }, FAILURE_STATUS[result.reason])
}

/**
 * Mutations must come from this site's own pages. Browsers send Origin on
 * every cross-origin and same-origin POST/DELETE fetch, so a missing one is
 * refused rather than trusted.
 */
function isSameOriginMutation(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite && fetchSite !== "same-origin") return false
  const origin = request.headers.get("origin")
  return origin !== null && origin === getRequestOrigin(request)
}

/**
 * Signed-out, signed in without an access token (the legacy cookie path, which
 * the session route still reports as signed in), or ready to reach Admin.
 */
async function readViewer(request: Request) {
  const session = await verifyAuthSession(request.headers)
  if (!session.authenticated) return { kind: "signed-out" } as const
  if (!session.accessToken)
    return { kind: "no-token", userId: session.userId } as const
  return {
    kind: "ready",
    userId: session.userId,
    accessToken: session.accessToken,
  } as const
}

/**
 * A write is checked, then authorized. The client names the account whose
 * progress it loaded; that is only a stale-session precondition and must equal
 * the verified session. The session alone decides which account Admin writes.
 */
async function mutationViewer(request: Request) {
  const viewer = await readViewer(request)
  if (viewer.kind === "signed-out") return json({ error: "unauthorized" }, 401)
  if (request.headers.get(LEARNING_SUBJECT_HEADER) !== viewer.userId)
    return json({ error: "identity-mismatch" }, 409)
  if (viewer.kind === "no-token")
    return json({ error: "progress-unavailable" }, 401)
  return viewer
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!(await isProgressEnabled())) return notFound()
  const url = new URL(request.url)
  const parsed = courseSchema.safeParse({
    courseId: url.searchParams.get("courseId"),
    contentVersion: url.searchParams.get("contentVersion"),
  })
  if (!parsed.success) return json({ error: "invalid" }, 400)

  const viewer = await readViewer(request)
  if (viewer.kind === "signed-out") return json({ authenticated: false })
  if (viewer.kind === "no-token")
    return json({
      authenticated: true,
      userId: viewer.userId,
      progressAvailable: false,
    })

  const result = await fetchLearningProgress(viewer.accessToken, parsed.data)
  if (!result.ok) return failed(result)
  return json({
    authenticated: true,
    userId: viewer.userId,
    lessons: result.lessons,
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await isProgressEnabled())) return notFound()
  if (!isSameOriginMutation(request)) return json({ error: "forbidden" }, 403)
  const viewer = await mutationViewer(request)
  if (viewer instanceof NextResponse) return viewer

  const parsed = saveSchema.safeParse(await readJson(request))
  if (!parsed.success) return json({ error: "invalid" }, 400)

  const result = await saveLearningProgress(viewer.accessToken, parsed.data)
  if (!result.ok) return failed(result)
  return json({ status: result.status, progress: result.progress })
}

/**
 * Resets one lesson; guarded by the revision the client last read. Cleanup of
 * existing data, so it is available whatever the audience flag says; origin,
 * verified subject, payload and revision checks still apply.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  if (!isSameOriginMutation(request)) return json({ error: "forbidden" }, 403)
  const viewer = await mutationViewer(request)
  if (viewer instanceof NextResponse) return viewer

  const parsed = lessonSchema.safeParse(await readJson(request))
  if (!parsed.success) return json({ error: "invalid" }, 400)

  const result = await resetLearningProgress(viewer.accessToken, parsed.data)
  if (!result.ok) return failed(result)
  return json({ status: result.status, progress: result.progress })
}
