import type { PrismaClient } from "@prisma/client"
import { env } from "@/config/env"
import { resolveMastraLaunchTimeoutMs } from "@/services/mastra-launch-timeout"
import { prisma as defaultPrisma } from "@/db/client"
import { buildExperienceEmbeddingSource } from "@/services/embeddings.service"

export type MastraExperienceEmbeddingMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export type MastraExperienceEmbeddingTarget = {
  experienceId: string
  experienceLocaleId: string
  locale: string
  slug?: string
}

export type MastraExperienceEmbeddingLaunchInput = {
  target: MastraExperienceEmbeddingTarget
  source: {
    text: string
    contentHash: string
    summary: string
  }
  mode?: MastraExperienceEmbeddingMode
}

export type MastraExperienceEmbeddingLaunchResult =
  | {
      ok: true
      status: "created" | "unchanged" | "repaired" | "forced" | "model_upgraded"
    }
  | {
      ok: false
      reason:
        | "config_missing"
        | "auth_failed"
        | "network_error"
        | "parse_error"
        | "invalid_input"
        | "provider_config_missing"
        | "provider_auth_failed"
        | "provider_failed"
        | "provider_dimension_mismatch"
        | "admin_config_missing"
        | "admin_auth_failed"
        | "admin_ingest_rejected"
        | "admin_ingest_failed"
        | "target_not_found"
        | "target_unpublished"
      retryable: boolean
      adminStatus?: string
      adminReason?: string
    }

export type LaunchMastraExperienceEmbeddingOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const SUCCESS_STATUSES = new Set([
  "created",
  "unchanged",
  "repaired",
  "forced",
  "model_upgraded",
])

const FAILURE_REASONS = new Set([
  "config_missing",
  "auth_failed",
  "network_error",
  "parse_error",
  "invalid_input",
  "provider_config_missing",
  "provider_auth_failed",
  "provider_failed",
  "provider_dimension_mismatch",
  "admin_config_missing",
  "admin_auth_failed",
  "admin_ingest_rejected",
  "admin_ingest_failed",
  "target_not_found",
  "target_unpublished",
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseWorkflowResult(
  value: unknown,
): MastraExperienceEmbeddingLaunchResult | null {
  const record = asRecord(value)
  const result = asRecord(record?.result)
  if (!result || typeof result.ok !== "boolean") return null

  if (result.ok === true) {
    if (
      typeof result.status !== "string" ||
      !SUCCESS_STATUSES.has(result.status)
    ) {
      return null
    }
    return {
      ok: true,
      status: result.status as Extract<
        MastraExperienceEmbeddingLaunchResult,
        { ok: true }
      >["status"],
    }
  }

  if (
    typeof result.reason !== "string" ||
    !FAILURE_REASONS.has(result.reason) ||
    typeof result.retryable !== "boolean"
  ) {
    return null
  }

  return {
    ok: false,
    reason: result.reason as Extract<
      MastraExperienceEmbeddingLaunchResult,
      { ok: false }
    >["reason"],
    retryable: result.retryable,
    adminStatus:
      typeof result.adminStatus === "string" ? result.adminStatus : undefined,
    adminReason:
      typeof result.adminReason === "string" ? result.adminReason : undefined,
  }
}

export async function launchMastraExperienceEmbedding(
  input: MastraExperienceEmbeddingLaunchInput,
  options: LaunchMastraExperienceEmbeddingOptions = {},
): Promise<MastraExperienceEmbeddingLaunchResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const body = {
    target: input.target,
    source: input.source,
    mode: input.mode ?? "idempotent",
  }

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL("/forge-experience-embeddings", baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          resolveMastraLaunchTimeoutMs(
            options.timeoutMs ?? env.MASTRA_EXPERIENCE_EMBEDDING_TIMEOUT_MS,
          ),
        ),
      },
    )
  } catch {
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (response.status === 401) {
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  const result = parseWorkflowResult(
    await response.json().catch(() => undefined),
  )
  if (result) return result

  if (!response.ok) {
    return {
      ok: false,
      reason: "network_error",
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  return { ok: false, reason: "parse_error", retryable: true }
}

export async function launchMastraExperienceEmbeddingForLocale(
  localeId: string,
  options: LaunchMastraExperienceEmbeddingOptions & {
    prisma?: PrismaClient
    mode?: MastraExperienceEmbeddingMode
  } = {},
): Promise<MastraExperienceEmbeddingLaunchResult> {
  const client = options.prisma ?? defaultPrisma
  const locale = await client.experienceLocale.findUniqueOrThrow({
    where: { id: localeId },
    select: {
      id: true,
      experienceId: true,
      locale: true,
      slug: true,
      title: true,
      metaDescription: true,
      ogTitle: true,
      ogDescription: true,
      blocks: true,
      status: true,
      experience: {
        select: {
          archivedAt: true,
        },
      },
    },
  })
  if (locale.experience.archivedAt != null) {
    return { ok: false, reason: "target_not_found", retryable: false }
  }
  if (locale.status !== "PUBLISHED") {
    return { ok: false, reason: "target_unpublished", retryable: false }
  }
  const source = buildExperienceEmbeddingSource(locale)
  return launchMastraExperienceEmbedding(
    {
      target: {
        experienceId: locale.experienceId,
        experienceLocaleId: locale.id,
        locale: locale.locale,
        slug: locale.slug,
      },
      source,
      ...(options.mode == null ? {} : { mode: options.mode }),
    },
    options,
  )
}

export const _internals = {
  parseWorkflowResult,
}
