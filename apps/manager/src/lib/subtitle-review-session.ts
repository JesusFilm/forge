import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { env } from "@/config/env"

const TOKEN_VERSION = 1

export type SubtitleReviewConfigVariable =
  | "SUBTITLE_EDITOR_PUBLIC_URL"
  | "SUBTITLE_EDITOR_ALLOWED_ORIGINS"
  | "SUBTITLE_REVIEW_SESSION_SECRET"

export type SubtitleReviewConfiguration =
  | {
      ok: true
      editorPublicUrl: string
      allowedOrigins: string
      sessionSecret: string
    }
  | {
      ok: false
      missing: SubtitleReviewConfigVariable[]
    }

export type SubtitleReviewTokenPayload = {
  jobId: string
  sourceArtifactKey: string
  targetLanguage: string
  baseArtifactKey: string
  baseFingerprint: string
  actorId: string
  expiresAt: string
}

type SignedSubtitleReviewTokenPayload = SubtitleReviewTokenPayload & {
  version: typeof TOKEN_VERSION
}

function configuredValue(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function getSubtitleReviewConfiguration(): SubtitleReviewConfiguration {
  const editorPublicUrl = configuredValue(
    process.env.SUBTITLE_EDITOR_PUBLIC_URL ?? env.SUBTITLE_EDITOR_PUBLIC_URL,
  )
  const allowedOrigins = configuredValue(
    process.env.SUBTITLE_EDITOR_ALLOWED_ORIGINS ??
      env.SUBTITLE_EDITOR_ALLOWED_ORIGINS,
  )
  const sessionSecret = configuredValue(
    process.env.SUBTITLE_REVIEW_SESSION_SECRET ??
      env.SUBTITLE_REVIEW_SESSION_SECRET,
  )
  const missing: SubtitleReviewConfigVariable[] = []
  if (!editorPublicUrl) missing.push("SUBTITLE_EDITOR_PUBLIC_URL")
  if (!allowedOrigins) missing.push("SUBTITLE_EDITOR_ALLOWED_ORIGINS")
  if (!sessionSecret) missing.push("SUBTITLE_REVIEW_SESSION_SECRET")

  if (
    missing.length > 0 ||
    !editorPublicUrl ||
    !allowedOrigins ||
    !sessionSecret
  ) {
    return { ok: false, missing }
  }

  return {
    ok: true,
    editorPublicUrl,
    allowedOrigins,
    sessionSecret,
  }
}

export function isSubtitleReviewConfigured(): boolean {
  return getSubtitleReviewConfiguration().ok
}

function getSubtitleReviewSessionSecret(): string {
  const secret = configuredValue(
    process.env.SUBTITLE_REVIEW_SESSION_SECRET ??
      env.SUBTITLE_REVIEW_SESSION_SECRET,
  )
  if (!secret) {
    throw new Error("SUBTITLE_REVIEW_SESSION_SECRET is required")
  }
  return secret
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8")
  } catch {
    return null
  }
}

function signTokenBody(body: string): string {
  return createHmac("sha256", getSubtitleReviewSessionSecret())
    .update(body)
    .digest("base64url")
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "base64url")
  const rightBuffer = Buffer.from(right, "base64url")
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function isTokenPayload(
  value: unknown,
): value is SignedSubtitleReviewTokenPayload {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false
  }

  const payload = value as Record<string, unknown>
  return (
    payload.version === TOKEN_VERSION &&
    typeof payload.jobId === "string" &&
    typeof payload.sourceArtifactKey === "string" &&
    typeof payload.targetLanguage === "string" &&
    typeof payload.baseArtifactKey === "string" &&
    typeof payload.baseFingerprint === "string" &&
    typeof payload.actorId === "string" &&
    typeof payload.expiresAt === "string"
  )
}

export function createSubtitleReviewLaunchCode(): string {
  return randomBytes(32).toString("base64url")
}

export function hashSubtitleReviewLaunchCode(launchCode: string): string {
  return createHmac("sha256", getSubtitleReviewSessionSecret())
    .update(`launch:${launchCode}`)
    .digest("base64url")
}

export async function signSubtitleReviewToken(
  payload: SubtitleReviewTokenPayload,
): Promise<string> {
  const body = base64UrlEncode(
    JSON.stringify({
      ...payload,
      version: TOKEN_VERSION,
    } satisfies SignedSubtitleReviewTokenPayload),
  )
  return `${body}.${signTokenBody(body)}`
}

export async function verifySubtitleReviewToken(
  token: string,
): Promise<SubtitleReviewTokenPayload | null> {
  const [body, signature, extra] = token.split(".")
  if (!body || !signature || extra != null) {
    return null
  }

  if (!safeEqual(signature, signTokenBody(body))) {
    return null
  }

  const decoded = base64UrlDecode(body)
  if (!decoded) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(decoded)
  } catch {
    return null
  }

  if (!isTokenPayload(parsed)) {
    return null
  }

  if (Date.parse(parsed.expiresAt) <= Date.now()) {
    return null
  }

  return {
    jobId: parsed.jobId,
    sourceArtifactKey: parsed.sourceArtifactKey,
    targetLanguage: parsed.targetLanguage,
    baseArtifactKey: parsed.baseArtifactKey,
    baseFingerprint: parsed.baseFingerprint,
    actorId: parsed.actorId,
    expiresAt: parsed.expiresAt,
  }
}

export function buildSubtitleEditorLaunchUrl(input: {
  jobId: string
  launchCode: string
}): string {
  const editorPublicUrl = configuredValue(
    process.env.SUBTITLE_EDITOR_PUBLIC_URL ?? env.SUBTITLE_EDITOR_PUBLIC_URL,
  )
  if (!editorPublicUrl) {
    throw new Error("SUBTITLE_EDITOR_PUBLIC_URL is required")
  }

  const url = new URL("/edit", editorPublicUrl)
  url.searchParams.set("jobId", input.jobId)
  url.searchParams.set("launch", input.launchCode)
  return url.toString()
}

export function isAllowedSubtitleEditorOrigin(origin: string | null): boolean {
  const allowedOrigins = configuredValue(
    process.env.SUBTITLE_EDITOR_ALLOWED_ORIGINS ??
      env.SUBTITLE_EDITOR_ALLOWED_ORIGINS,
  )
  if (!origin || !allowedOrigins) {
    return false
  }

  return allowedOrigins
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .includes(origin)
}

export function buildSubtitleReviewCorsHeaders(
  origin: string | null,
): Record<string, string> | null {
  if (!origin || !isAllowedSubtitleEditorOrigin(origin)) {
    return null
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  }
}
