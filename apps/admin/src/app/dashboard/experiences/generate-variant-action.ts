/**
 * Server action core — "duplicate experience with persona influence".
 *
 * Given a SOURCE experience locale + a persona, generate a persona-adapted
 * DUPLICATE and stage it as a NEW DRAFT experience. The source page's structure
 * and voice steer generation (via the sanitized `buildExemplarOutline` string —
 * video ids/urls/colors stripped, so the source's videos are NOT reused); the
 * persona drives framing/tone/Scripture/audience; copy is freshly written and
 * videos come only from semantic candidate retrieval. The result is staged as a
 * DRAFT (`<topic>-<persona>`) for review — never published.
 *
 * This is "Phase B's button": it assembles the already-built persona-variant
 * backend (`launchMastraExperienceVariant` + `normalizeExperienceDraft` +
 * `ExperienceService.create`). Remote generation runs on the standalone mastra
 * `/forge-experience-variant` route; an unconfigured client → NOT_CONFIGURED.
 *
 * Pure, injectable core (deps + overrides) so it unit-tests without a real
 * Prisma / network — the `"use server"` boundary is the thunk in `[id]/page.tsx`.
 */

import type { PrismaClient } from "@prisma/client"

import { canEditExperienceLocale } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"

import { buildExemplarOutline } from "@/services/experience-ai/experience-ai-exemplar-outline"
import {
  ExperienceAiNormalizationError,
  normalizeExperienceDraft,
  type NormalizedExperienceDraft,
} from "@/services/experience-ai/experience-ai-normalize"
import { loadExperienceAiVideoCandidates } from "@/services/experience-ai/experience-ai.service"
import { launchMastraExperienceVariant } from "@/services/experience-ai/mastra-experience-variant-client"
import { ExperienceService } from "@/services/experience.service"
import { variantSlug } from "@/scripts/generate-persona-variants"

export type GenerateVariantActionInput = {
  /** The source experience locale to duplicate from. */
  sourceLocaleId: string
  /** Locale of the source + the new duplicate. */
  locale: string
  /** Persona id from the Mastra roster (e.g. "grieving", "seeker-skeptic"). */
  personaId: string
}

export type GenerateVariantActionErrorCode =
  | "SOURCE_NOT_FOUND"
  | "FORBIDDEN"
  | "NOT_CONFIGURED"
  | "GENERATION_FAILED"
  | "TIMEOUT"
  | "SCHEMA_MISMATCH"
  | "PERSIST_FAILED"
  | "UPSTREAM_ERROR"
  | "UNKNOWN"

export type GenerateVariantActionResult =
  | {
      ok: true
      experienceId: string
      localeId: string
      slug: string
      /** Editor href for the freshly-created DRAFT duplicate. */
      href: string
    }
  | { ok: false; code: GenerateVariantActionErrorCode; error: string }

export const VARIANT_USER_MESSAGES: Record<
  GenerateVariantActionErrorCode,
  string
> = {
  SOURCE_NOT_FOUND: "The experience to duplicate was not found.",
  FORBIDDEN: "You do not have permission to duplicate this experience.",
  NOT_CONFIGURED:
    "AI persona generation is not configured for this environment.",
  GENERATION_FAILED: "The AI couldn't generate a persona version. Try again.",
  TIMEOUT: "Generation took too long. Try again shortly.",
  SCHEMA_MISMATCH: "The generated page wasn't valid. Try again.",
  PERSIST_FAILED: "The persona version was generated but couldn't be saved.",
  UPSTREAM_ERROR: "The AI service is unavailable right now. Try again shortly.",
  UNKNOWN: "Unable to create a persona version right now.",
}

type GenerateVariantActionDeps = {
  prisma: PrismaClient
  user: Principal | null
}

export type GenerateVariantActionOverrides = {
  loadCandidates?: typeof loadExperienceAiVideoCandidates
  launchVariant?: typeof launchMastraExperienceVariant
  /** Persist the staged DRAFT; defaults to ExperienceService.create + updateLocale. */
  persist?: (args: {
    slug: string
    title: string
    metaDescription: string
    blocks: NormalizedExperienceDraft["blocks"]
    locale: string
  }) => Promise<{ experienceId: string; localeId: string }>
}

function fail(
  code: GenerateVariantActionErrorCode,
): Extract<GenerateVariantActionResult, { ok: false }> {
  return { ok: false, code, error: VARIANT_USER_MESSAGES[code] }
}

export async function runGenerateVariantAction(
  deps: GenerateVariantActionDeps,
  input: GenerateVariantActionInput,
  overrides: GenerateVariantActionOverrides = {},
): Promise<GenerateVariantActionResult> {
  // 1. Load the source locale + ABAC (must be allowed to read/edit the source).
  const source = await deps.prisma.experienceLocale.findUnique({
    where: { id: input.sourceLocaleId },
    select: {
      id: true,
      slug: true,
      title: true,
      metaDescription: true,
      blocks: true,
      status: true,
      experienceId: true,
      experience: { select: { ownerId: true, archivedAt: true } },
    },
  })
  if (!source) return fail("SOURCE_NOT_FOUND")
  if (!canEditExperienceLocale(deps.user, source)) return fail("FORBIDDEN")

  // Topic drives both candidate retrieval and the persona prompt subject.
  const topic = (source.title?.trim() || source.slug).slice(0, 200)
  // Sanitized structure-and-voice reference (source video ids/urls stripped).
  const exemplar =
    buildExemplarOutline({
      title: source.title,
      metaDescription: source.metaDescription,
      blocks: source.blocks,
    }) ?? undefined

  // 2. Load fresh video candidates by semantic relevance to the topic.
  const loadCandidates =
    overrides.loadCandidates ?? loadExperienceAiVideoCandidates
  let candidates
  try {
    candidates = await loadCandidates(deps.prisma, {
      locale: input.locale,
      prompt: topic,
    })
  } catch (error) {
    console.error(
      `[runGenerateVariantAction] event=candidates_error message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return fail("UPSTREAM_ERROR")
  }

  // 3. Remote persona-variant generation (source as exemplar + persona steering).
  const launch = overrides.launchVariant ?? launchMastraExperienceVariant
  const remote = await launch({
    topic,
    locale: input.locale,
    personaId: input.personaId,
    candidates,
    exemplar,
  })
  if (!remote.ok) {
    console.warn(
      `[runGenerateVariantAction] event=remote_failed reason=${remote.reason} retryable=${remote.retryable}`,
    )
    switch (remote.reason) {
      case "config_missing":
        return fail("NOT_CONFIGURED")
      case "timeout":
        return fail("TIMEOUT")
      case "generation_failed":
      case "invalid_input":
        return fail("GENERATION_FAILED")
      default:
        return fail("UPSTREAM_ERROR")
    }
  }

  // 4. R11 block gate — re-validate + resolve candidateRefs against the pack.
  let normalized: NormalizedExperienceDraft
  try {
    normalized = normalizeExperienceDraft(remote.draft, [...candidates])
  } catch (error) {
    if (error instanceof ExperienceAiNormalizationError) {
      console.warn(
        `[runGenerateVariantAction] event=normalize_failed code=${error.code}`,
      )
      return fail("SCHEMA_MISMATCH")
    }
    console.error("[runGenerateVariantAction] event=normalize_error", error)
    return fail("UNKNOWN")
  }

  // 5. Persist as a NEW DRAFT. Drafts may share a (locale, slug) — the partial
  //    unique index is published-only — so we create rather than delete-by-slug
  //    (a destructive nuke-by-slug would be unsafe from a user-facing action).
  const slug = variantSlug(topic, input.personaId)
  const persist = overrides.persist ?? ((args) => defaultPersist(deps, args))
  let persisted: { experienceId: string; localeId: string }
  try {
    persisted = await persist({
      slug,
      title: normalized.title,
      metaDescription: normalized.metaDescription,
      blocks: normalized.blocks,
      locale: input.locale,
    })
  } catch (error) {
    console.error("[runGenerateVariantAction] event=persist_error", error)
    return fail("PERSIST_FAILED")
  }

  return {
    ok: true,
    experienceId: persisted.experienceId,
    localeId: persisted.localeId,
    slug,
    href: `/dashboard/experiences/${persisted.experienceId}?locale=${encodeURIComponent(
      input.locale,
    )}`,
  }
}

async function defaultPersist(
  deps: GenerateVariantActionDeps,
  args: {
    slug: string
    title: string
    metaDescription: string
    blocks: NormalizedExperienceDraft["blocks"]
    locale: string
  },
): Promise<{ experienceId: string; localeId: string }> {
  const service = new ExperienceService(deps.prisma)
  const created = await service.create({
    input: {
      locale: args.locale,
      slug: args.slug,
      title: args.title,
      blocks: args.blocks,
    },
    user: deps.user,
  })
  const localeId = created.locales[0]!.id
  if (args.metaDescription) {
    await service.updateLocale({
      input: { id: localeId, metaDescription: args.metaDescription },
      user: deps.user,
    })
  }
  return { experienceId: created.id, localeId }
}
