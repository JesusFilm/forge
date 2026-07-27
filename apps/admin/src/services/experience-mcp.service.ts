import { z } from "zod"
import { Prisma, type PrismaClient } from "@prisma/client"

import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { env } from "@/config/env"
import { loadExperienceAiVideoCandidates } from "@/services/experience-ai/experience-ai.service"
import {
  ExperienceAiNormalizationError,
  normalizeExperienceDraft,
} from "@/services/experience-ai/experience-ai-normalize"
import { buildExemplarOutline } from "@/services/experience-ai/experience-ai-exemplar-outline"
import { launchMastraExperienceVariant } from "@/services/experience-ai/mastra-experience-variant-client"
import { launchMastraExperienceDraft } from "@/services/mastra-experience-draft-client"
import { ForbiddenError, NotFoundError } from "@/services/errors"
import { ExperienceService } from "@/services/experience.service"

// `.strict()` is deliberate: `ExperienceService.create`'s own schema silently
// STRIPS unknown keys, so a caller passing e.g. `metaDescription` here would
// otherwise lose the field with no error. Meta/OG fields route through the
// existing `experience.locale.update` tool after creation (the two-call
// composition both operator scripts use).
const CreateExperienceToolInput = z
  .object({
    locale: z.string().min(1).max(35),
    slug: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    blocks: z.array(z.unknown()),
    isTemplate: z.boolean().optional().default(false),
  })
  .strict()

const GenerateExperienceToolInput = z
  .object({
    topic: z.string().trim().min(1).max(200),
    locale: z.string().min(1).max(35),
    slug: z.string().min(1).max(200).optional(),
    personaId: z.string().min(1).max(50).optional(),
    exemplarExperienceId: z.string().min(1).optional(),
  })
  .strict()

/**
 * Failure reasons for `experience.generate`. Mastra launcher reasons pass
 * through verbatim; the admin-side stages add their own. Failures are
 * returned as structuredContent envelopes (never thrown) mirroring the
 * launchers' own no-throw discipline — the JSON-RPC error taxonomy cannot
 * carry `retryable` or a reason string.
 */
type GenerateExperienceFailureReason =
  | "config_missing"
  | "auth_failed"
  | "network_error"
  | "parse_error"
  | "invalid_input"
  | "timeout"
  | "generation_failed"
  | "internal_error"
  | "slug_exists"
  | "candidates_failed"
  | "normalization_failed"
  | "persist_failed"

const GENERATE_FAILURE_MESSAGES: Record<
  GenerateExperienceFailureReason,
  string
> = {
  config_missing:
    "Experience generation is not configured on this environment.",
  auth_failed: "Admin could not authenticate to the generation service.",
  network_error:
    "The generation service call failed or exceeded the admin-side budget.",
  parse_error: "The generation service returned an unreadable response.",
  invalid_input: "The generation service rejected the request input.",
  timeout: "Generation timed out before completing. Safe to retry.",
  generation_failed: "The generation service could not produce a valid draft.",
  internal_error: "The generation service reported an internal error.",
  slug_exists: "An ExperienceLocale with this locale and slug already exists.",
  candidates_failed: "Video candidate retrieval failed. Safe to retry.",
  normalization_failed:
    "The generated draft failed admin validation and was not persisted.",
  persist_failed: "The generated draft could not be persisted.",
}

const DEFAULT_GENERATE_TIMEOUT_MS = 90_000

/**
 * Guard mirroring the mastra clients' `resolveTimeoutMs`: env values can
 * arrive `undefined`/string under t3-env `skipValidation`, and a timer API
 * throws `ERR_INVALID_ARG_TYPE` on those.
 */
function resolveGenerateTimeoutMs(value: unknown): number {
  const ms = typeof value === "string" ? Number(value) : value
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? ms
    : DEFAULT_GENERATE_TIMEOUT_MS
}

/**
 * Slug for a generated topic (+ optional persona suffix). Mirrors
 * `variantSlug` in generate-persona-variants.ts; non-Latin topics collapse
 * to the literal "experience" — callers targeting non-Latin locales should
 * pass an explicit `slug`.
 */
function generatedSlug(topic: string, personaId?: string): string {
  const base = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  const stem = base || "experience"
  return personaId ? `${stem}-${personaId}` : stem
}

/**
 * Versioned snapshot envelope for the AI-provenance ContentRevision.
 * Duplicates the field list of experience.service.ts's module-private
 * `snapshotExperienceLocale` (deliberately excludes `embedding`).
 */
function snapshotGeneratedLocale(
  locale: LocaleRow & { createdAt?: Date },
): Prisma.InputJsonObject {
  return {
    v: 1,
    data: {
      id: locale.id,
      experienceId: locale.experienceId,
      locale: locale.locale,
      slug: locale.slug,
      isHomepage: locale.isHomepage,
      pathSegment: locale.pathSegment,
      title: locale.title,
      metaDescription: locale.metaDescription,
      ogTitle: locale.ogTitle,
      ogDescription: locale.ogDescription,
      ogImageUrl: locale.ogImageUrl,
      blocks: locale.blocks as Prisma.InputJsonValue,
      status: locale.status,
      publishedAt: locale.publishedAt?.toISOString() ?? null,
      createdAt: locale.createdAt?.toISOString() ?? null,
      updatedAt: locale.updatedAt.toISOString(),
    },
  }
}

export type ExperienceMcpServiceOverrides = {
  loadCandidates?: typeof loadExperienceAiVideoCandidates
  launchDraft?: typeof launchMastraExperienceDraft
  launchVariant?: typeof launchMastraExperienceVariant
  /** Generation transport config; defaults to the MASTRA_* env vars. */
  generationConfig?: {
    baseUrl?: string
    bearer?: string
    timeoutMs?: number
  }
}

type LocaleRow = {
  id: string
  experienceId: string
  locale: string
  slug: string
  isHomepage: boolean
  pathSegment: string | null
  title: string | null
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  ogImageUrl: string | null
  blocks: unknown
  status: string
  publishedAt: Date | null
  updatedAt: Date
}

function serializeLocale(locale: LocaleRow) {
  return {
    id: locale.id,
    experienceId: locale.experienceId,
    locale: locale.locale,
    slug: locale.slug,
    isHomepage: locale.isHomepage,
    pathSegment: locale.pathSegment,
    title: locale.title,
    metaDescription: locale.metaDescription,
    ogTitle: locale.ogTitle,
    ogDescription: locale.ogDescription,
    ogImageUrl: locale.ogImageUrl,
    blocks: locale.blocks,
    status: locale.status,
    publishedAt: locale.publishedAt?.toISOString() ?? null,
    updatedAt: locale.updatedAt.toISOString(),
  }
}

function editorUrlFor(experienceId: string, locale: string) {
  const url = new URL(
    `/dashboard/experiences/${experienceId}`,
    env.ADMIN_BASE_URL ?? "http://localhost:3003",
  )
  url.searchParams.set("locale", locale)
  return url.toString()
}

export class ExperienceMcpService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly overrides: ExperienceMcpServiceOverrides = {},
  ) {}

  async createExperience({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = CreateExperienceToolInput.parse(raw)

    // Best-effort idempotency: DRAFT slugs have no DB uniqueness (the partial
    // unique index only covers published rows), so a retrying agent would
    // silently pile up duplicate drafts. Report the existing resource instead
    // of creating a second one. Concurrent creates can still race past this
    // check — acceptable, since the same collision surfaces at publish time.
    const existing = await this.prisma.experienceLocale.findFirst({
      where: {
        locale: input.locale,
        slug: input.slug,
        experience: { archivedAt: null },
      },
      select: { id: true, experienceId: true, status: true },
    })
    if (existing) {
      return {
        created: false as const,
        conflict: {
          reason: "slug_exists" as const,
          locale: input.locale,
          slug: input.slug,
          existingExperienceId: existing.experienceId,
          existingLocaleId: existing.id,
          existingStatus: existing.status,
        },
      }
    }

    const created = await new ExperienceService(this.prisma).create({
      input: {
        locale: input.locale,
        slug: input.slug,
        title: input.title,
        blocks: input.blocks,
        isTemplate: input.isTemplate,
      },
      user,
    })
    const locale = created.locales[0]!

    return {
      created: true as const,
      experience: {
        id: created.id,
        isTemplate: created.isTemplate,
        ownerId: created.ownerId,
      },
      locale: serializeLocale(locale),
      editorUrl: editorUrlFor(created.id, input.locale),
    }
  }

  async generateExperience({
    input: raw,
    user,
  }: {
    input: unknown
    user: Principal | null
  }) {
    const input = GenerateExperienceToolInput.parse(raw)

    // Defense-in-depth ahead of the usual ExperienceService check: generation
    // spends paid AI tokens before anything persists, so a principal that
    // could never persist must fail before candidates or mastra run.
    if (!hasPermission(user, "write:experiences")) {
      throw new ForbiddenError()
    }

    const config = this.overrides.generationConfig ?? {
      baseUrl: env.MASTRA_BASE_URL,
      bearer: env.MASTRA_SERVICE_API_KEY,
      timeoutMs: env.MASTRA_GENERATE_TIMEOUT_MS,
    }
    if (!config.baseUrl || !config.bearer) {
      return this.generateFailure("config_missing", false)
    }

    const slug = input.slug ?? generatedSlug(input.topic, input.personaId)
    // Same best-effort idempotency pre-check as createExperience — run it
    // BEFORE any paid work so a retrying agent never double-spends tokens.
    const existing = await this.prisma.experienceLocale.findFirst({
      where: {
        locale: input.locale,
        slug,
        experience: { archivedAt: null },
      },
      select: { id: true, experienceId: true, status: true },
    })
    if (existing) {
      return {
        ...this.generateFailure("slug_exists", false),
        conflict: {
          locale: input.locale,
          slug,
          existingExperienceId: existing.experienceId,
          existingLocaleId: existing.id,
          existingStatus: existing.status,
        },
      }
    }

    let exemplar: string | undefined
    if (input.exemplarExperienceId) {
      const exemplarRow = await this.prisma.experienceLocale.findFirst({
        where: {
          experienceId: input.exemplarExperienceId,
          experience: { archivedAt: null },
        },
        // Prefer the requested locale's variant of the exemplar page.
        orderBy: { updatedAt: "desc" },
        select: { title: true, metaDescription: true, blocks: true },
      })
      if (!exemplarRow) {
        throw new NotFoundError("Experience", input.exemplarExperienceId)
      }
      exemplar = buildExemplarOutline(exemplarRow) ?? undefined
    }

    const loadCandidates =
      this.overrides.loadCandidates ?? loadExperienceAiVideoCandidates
    let candidates
    try {
      candidates = await loadCandidates(this.prisma, {
        locale: input.locale,
        prompt: input.topic,
      })
    } catch (error) {
      console.error(
        `[experience-mcp] event=candidates_error message=${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return this.generateFailure("candidates_failed", true)
    }

    const timeoutMs = resolveGenerateTimeoutMs(config.timeoutMs)
    const launchOptions = {
      baseUrl: config.baseUrl,
      bearer: config.bearer,
      timeoutMs,
    }
    const remote = input.personaId
      ? await (this.overrides.launchVariant ?? launchMastraExperienceVariant)(
          {
            topic: input.topic,
            locale: input.locale,
            personaId: input.personaId,
            candidates,
            exemplar,
          },
          launchOptions,
        )
      : await (this.overrides.launchDraft ?? launchMastraExperienceDraft)(
          {
            prompt: input.topic,
            locale: input.locale,
            candidates,
            exemplar,
            mode: "quick",
          },
          launchOptions,
        )
    if (!remote.ok) {
      console.warn(
        `[experience-mcp] event=generate_remote_failed reason=${remote.reason} retryable=${remote.retryable}`,
      )
      const failure = this.generateFailure(remote.reason, remote.retryable)
      // The launcher parsers discard the route's message field, but the
      // most common invalid_input cause is an unknown persona — name it.
      if (remote.reason === "invalid_input" && input.personaId) {
        failure.message = `${failure.message} Check personaId "${input.personaId}" against the mastra persona roster.`
      }
      return failure
    }

    let normalized
    try {
      normalized = normalizeExperienceDraft(remote.draft, [...candidates])
    } catch (error) {
      if (error instanceof ExperienceAiNormalizationError) {
        console.warn(
          `[experience-mcp] event=generate_normalize_failed code=${error.code}`,
        )
        return {
          ...this.generateFailure("normalization_failed", false),
          normalizationCode: error.code,
        }
      }
      throw error
    }

    try {
      const created = await new ExperienceService(this.prisma).create({
        input: {
          locale: input.locale,
          slug,
          title: normalized.title,
          blocks: normalized.blocks,
        },
        user,
      })
      const createdLocale = created.locales[0]!

      // AI-provenance revision + metaDescription in one transaction.
      // ExperienceService.create writes no revision (nothing existed to
      // snapshot) and its input surface has no metaDescription; going
      // through updateLocale here would stamp the wrong provenance
      // (hardcoded USER kind) and applyChatMutation fires the revalidate
      // webhook even for DRAFT rows. Neither publish side effects nor
      // manifest refreshes may fire from this path.
      const provenanceReason = `Generated via Admin MCP experience.generate (topic: "${input.topic}"${
        input.personaId ? `, persona: ${input.personaId}` : ""
      })`
      const finalLocale = await this.prisma.$transaction(async (tx) => {
        await tx.contentRevision.create({
          data: {
            entityType: "ExperienceLocale",
            entityId: createdLocale.id,
            snapshot: snapshotGeneratedLocale(createdLocale),
            status: "HISTORICAL",
            revisedBy: user?.id ?? null,
            revisedByKind: "AI",
            reason: provenanceReason,
          },
        })
        if (!normalized.metaDescription) return createdLocale
        return tx.experienceLocale.update({
          where: { id: createdLocale.id },
          data: { metaDescription: normalized.metaDescription },
        })
      })

      return {
        ok: true as const,
        experience: {
          id: created.id,
          isTemplate: created.isTemplate,
          ownerId: created.ownerId,
        },
        locale: serializeLocale(finalLocale),
        editorUrl: editorUrlFor(created.id, input.locale),
        provenance: {
          source: input.personaId
            ? ("mastra-persona-variant" as const)
            : ("mastra-quick-draft" as const),
          topic: input.topic,
          ...(input.personaId ? { personaId: input.personaId } : {}),
          ...(input.exemplarExperienceId
            ? { exemplarExperienceId: input.exemplarExperienceId }
            : {}),
          candidatesCount: candidates.length,
        },
      }
    } catch (error) {
      console.error(
        `[experience-mcp] event=generate_persist_error message=${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return this.generateFailure("persist_failed", false)
    }
  }

  private generateFailure(
    reason: GenerateExperienceFailureReason,
    retryable: boolean,
  ) {
    return {
      ok: false as const,
      reason,
      retryable,
      message: GENERATE_FAILURE_MESSAGES[reason],
    }
  }
}
