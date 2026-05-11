import { env } from "@/config/env"

const WATCH_REVALIDATION_TIMEOUT_MS = 2_000

export type WatchExperienceRevalidationEntry = {
  slug: string
  locale: string
  isTemplate?: boolean | null
}

export type WatchExperienceRevalidationConfig = {
  endpoint: string | undefined
  secret: string | undefined
  timeoutMs?: number
}

export type WatchExperienceRevalidationResult =
  | { status: "skipped"; reason: "not_configured" | "invalid_entry" }
  | { status: "revalidated"; paths: string[] }
  | {
      status: "failed"
      reason: "network_error" | "remote_error" | "invalid_response"
      httpStatus?: number
      retryable: boolean
      message: string
    }

function configuredWatchRevalidation(): WatchExperienceRevalidationConfig {
  return {
    endpoint: env.WATCH_REVALIDATION_URL,
    secret: env.WATCH_REVALIDATION_SECRET,
  }
}

function normalizeEntry(entry: WatchExperienceRevalidationEntry) {
  const slug = entry.slug.trim()
  const locale = entry.locale.trim()
  if (!slug || !locale) return null
  return {
    slug,
    locale,
    isTemplate: entry.isTemplate === true,
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

export async function postWatchExperienceRevalidation(
  entry: WatchExperienceRevalidationEntry,
  config: WatchExperienceRevalidationConfig,
): Promise<WatchExperienceRevalidationResult> {
  const endpoint = config.endpoint?.trim()
  const secret = config.secret?.trim()
  if (!endpoint || !secret) {
    return { status: "skipped", reason: "not_configured" }
  }

  const normalizedEntry = normalizeEntry(entry)
  if (!normalizedEntry) {
    return { status: "skipped", reason: "invalid_entry" }
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revalidation-secret": secret,
      },
      body: JSON.stringify({
        model: "experience",
        entry: normalizedEntry,
      }),
      signal: AbortSignal.timeout(
        config.timeoutMs ?? WATCH_REVALIDATION_TIMEOUT_MS,
      ),
    })
  } catch (error) {
    return {
      status: "failed",
      reason: "network_error",
      retryable: true,
      message:
        error instanceof Error
          ? error.message
          : "Unable to reach watch revalidation endpoint",
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    return {
      status: "failed",
      reason: "remote_error",
      httpStatus: response.status,
      retryable: response.status === 429 || response.status >= 500,
      message:
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `Watch revalidation failed with status ${response.status}`,
    }
  }

  if (!body || typeof body !== "object") {
    return {
      status: "failed",
      reason: "invalid_response",
      httpStatus: response.status,
      retryable: true,
      message: "Watch revalidation endpoint returned a non-JSON response",
    }
  }

  const record = body as Record<string, unknown>
  if (record.revalidated !== true) {
    return {
      status: "failed",
      reason: "invalid_response",
      httpStatus: response.status,
      retryable: false,
      message:
        typeof record.reason === "string"
          ? record.reason
          : "Watch revalidation endpoint did not confirm revalidation",
    }
  }

  return {
    status: "revalidated",
    paths: asStringArray(record.paths),
  }
}

export async function notifyWatchExperienceRevalidation(
  entry: WatchExperienceRevalidationEntry,
): Promise<WatchExperienceRevalidationResult> {
  const result = await postWatchExperienceRevalidation(
    entry,
    configuredWatchRevalidation(),
  )

  if (result.status === "failed") {
    console.warn("[experience-watch-revalidation] failed", {
      slug: entry.slug,
      locale: entry.locale,
      reason: result.reason,
      httpStatus: result.httpStatus,
      retryable: result.retryable,
      message: result.message,
    })
  }

  return result
}
