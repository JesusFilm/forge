import { z } from "zod"
import type { PrismaClient } from "@prisma/client"

import type { Principal } from "@/auth/principal"
import { hasPermission } from "@/auth/permissions"
import { env } from "@/config/env"
import { topicBaseSlug } from "@/domain/slugify"
import { loadExperienceAiVideoCandidates } from "@/services/experience-ai/experience-ai.service"
import {
  ExperienceAiNormalizationError,
  normalizeExperienceDraft,
} from "@/services/experience-ai/experience-ai-normalize"
import { buildExemplarOutline } from "@/services/experience-ai/experience-ai-exemplar-outline"
import { launchMastraExperienceVariant } from "@/services/experience-ai/mastra-experience-variant-client"
import { serializeLocale } from "@/services/experience-locale-mcp.service"
import { launchMastraExperienceDraft } from "@/services/mastra-experience-draft-client"
import { resolveTimeoutMs } from "@/services/mastra-http-transport"
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
 * Failure reasons for the experience-level tools. Mastra launcher reasons
 * pass through verbatim; the admin-side stages add their own. Failures are
 * returned as structuredContent envelopes (never thrown) mirroring the
 * launchers' own no-throw discipline — the JSON-RPC error taxonomy cannot
 * carry `retryable` or a reason string. `experience.create` uses only
 * `slug_exists`.
 */
export type ExperienceToolFailureReason =
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

const TOOL_FAILURE_MESSAGES: Record<ExperienceToolFailureReason, string> = {
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
 * Hard runtime ceiling for the generate budget. It must stay BELOW
 * Cloudflare's ~100s proxy window or the documented clean-timeout guarantee
 * silently becomes a severed 524. A Zod `.max()` on the env var would brick
 * boot on a well-intentioned misconfiguration (the optional-env law), so the
 * ceiling is enforced here at use instead.
 */
const MAX_GENERATE_TIMEOUT_MS = 95_000

/**
 * Slug for a generated topic (+ optional persona suffix), built on the same
 * `topicBaseSlug` the operator CLI's `variantSlug` delegates to so
 * MCP-generated persona variants collide-detect against dashboard/script
 * generated ones. Clamped so the derived slug always fits
 * `CreateExperienceInput`'s 200-char cap — otherwise a near-cap topic would
 * fail Zod only AFTER paid mastra generation. Non-Latin topics collapse to
 * the literal "experience" — callers targeting non-Latin locales should pass
 * an explicit `slug`.
 */
function generatedSlug(topic: string, personaId?: string): string {
  const suffix = personaId ? `-${personaId}` : ""
  const base = topicBaseSlug(topic)
  const clamped =
    base.slice(0, 200 - suffix.length).replace(/-+$/g, "") || "experience"
  return `${clamped}${suffix}`
}

/** One-line, length-clamped, CR/LF-stripped error text for plain-string logs. */
function describeErrorForLog(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 200)
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

function editorUrlFor(experienceId: string, locale: string) {
  const url = new URL(
    `/dashboard/experiences/${experienceId}`,
    env.ADMIN_BASE_URL ?? "http://localhost:3003",
  )
  url.searchParams.set("locale", locale)
  return url.toString()
}

/**
 * Service behind the two experience-LEVEL Admin MCP tools (`experience.create`
 * and `experience.generate`). The 12 locale-level tools — including
 * `experience.list` and `experience.media.check` — live in the sibling
 * `ExperienceLocaleMcpService`.
 */
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

    // Defense-in-depth BEFORE the slug probe (mirrors generateExperience):
    // the conflict envelope names other owners' draft ids, so a principal
    // that could never create must not reach the lookup.
    if (!hasPermission(user, "write:experiences")) {
      throw new ForbiddenError()
    }

    const conflict = await this.findSlugConflict(input.locale, input.slug)
    if (conflict) {
      return { ...this.toolFailure("slug_exists", false), conflict }
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
      ok: true as const,
      experience: {
        id: created.id,
        isTemplate: created.isTemplate,
        ownerId: created.ownerId,
      },
      locale: serializeLocale(locale),
      editorUrl: editorUrlFor(created.id, input.locale),
    }
  }

  // Third composition of the candidates -> mastra -> normalize -> persist
  // pipeline, alongside generate-variant-action.ts (editor, repair loop) and
  // generate-persona-variants.ts (operator CLI, fan-out). The three have
  // real behavioral differences; if a pipeline-shape change lands, update
  // all three (consolidation is a deliberate non-goal until a fourth
  // composition appears).
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
      return this.toolFailure("config_missing", false)
    }

    const slug = input.slug ?? generatedSlug(input.topic, input.personaId)
    // Run the conflict check BEFORE any paid work so a retrying agent never
    // double-spends tokens.
    const conflict = await this.findSlugConflict(input.locale, slug)
    if (conflict) {
      return { ...this.toolFailure("slug_exists", false), conflict }
    }

    let exemplar: string | undefined
    if (input.exemplarExperienceId) {
      const exemplarRow = await this.prisma.experienceLocale.findFirst({
        where: {
          experienceId: input.exemplarExperienceId,
          experience: { archivedAt: null },
        },
        // Prefer the freshest variant of the exemplar page.
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
        `[experience-mcp] event=candidates_error message=${describeErrorForLog(error)}`,
      )
      return this.toolFailure("candidates_failed", true)
    }

    const launchOptions = {
      baseUrl: config.baseUrl,
      bearer: config.bearer,
      timeoutMs: Math.min(
        resolveTimeoutMs(config.timeoutMs, DEFAULT_GENERATE_TIMEOUT_MS),
        MAX_GENERATE_TIMEOUT_MS,
      ),
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
      const failure = this.toolFailure(remote.reason, remote.retryable)
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
          ...this.toolFailure("normalization_failed", false),
          normalizationCode: error.code,
        }
      }
      throw error
    }

    try {
      const provenanceReason = `Generated via Admin MCP experience.generate (topic: "${input.topic}"${
        input.personaId ? `, persona: ${input.personaId}` : ""
      })`
      const experienceService = new ExperienceService(this.prisma)
      const created = await experienceService.create({
        input: {
          locale: input.locale,
          slug,
          title: normalized.title,
          metaDescription: normalized.metaDescription,
          blocks: normalized.blocks,
        },
        user,
        draftAttribution: {
          revisedByKind: "AI",
          reason: provenanceReason,
        },
      })
      const createdLocale = created.locales[0]!

      return {
        ok: true as const,
        experience: {
          id: created.id,
          isTemplate: created.isTemplate,
          ownerId: created.ownerId,
        },
        locale: serializeLocale(createdLocale),
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
        `[experience-mcp] event=generate_persist_error slug=${slug} message=${describeErrorForLog(error)}`,
      )
      return this.toolFailure("persist_failed", false)
    }
  }

  /**
   * Best-effort idempotency pre-check shared by both write tools: DRAFT slugs
   * have no DB uniqueness (the partial unique index only covers published
   * rows), so a retrying agent would silently pile up duplicate drafts.
   * Report the existing resource instead. Concurrent creates can still race
   * past this check — acceptable, since the same collision surfaces at
   * publish time.
   */
  private async findSlugConflict(locale: string, slug: string) {
    const existing = await this.prisma.experienceLocale.findFirst({
      where: {
        locale,
        slug,
        experience: { archivedAt: null },
      },
      select: { id: true, experienceId: true, status: true },
    })
    if (!existing) return null
    return {
      locale,
      slug,
      existingExperienceId: existing.experienceId,
      existingLocaleId: existing.id,
      existingStatus: existing.status,
    }
  }

  // Generic over the literal reason so each call site's inferred failure
  // union stays narrow (createExperience can only ever produce slug_exists).
  private toolFailure<R extends ExperienceToolFailureReason>(
    reason: R,
    retryable: boolean,
  ) {
    return {
      ok: false as const,
      reason,
      retryable,
      message: TOOL_FAILURE_MESSAGES[reason],
    }
  }
}
