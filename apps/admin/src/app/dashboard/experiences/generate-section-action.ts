/**
 * Server action — video-anchored section generation.
 *
 * Orchestrates the full backend path admin-side: ABAC → load the video context
 * pack (which gates on playability) → ship the grounding to the standalone
 * `/forge-experience-section` mastra route → re-validate + allowlist-filter the
 * response against the pack → wrap in a synthetic DraftExperience envelope →
 * `normalizeExperienceDraft([anchorCandidate])` → build a review ledger → return
 * a stageable result. Unlike the full-page draft action it does NOT enforce
 * CANVAS_NOT_EMPTY (the section is APPENDED to the canvas in the UI).
 *
 * Remote-first: there is no admin in-process fallback for the section path
 * (the in-process generator is slated for deletion at the consolidation's U10
 * cutover), so an unset flag / unconfigured client yields NOT_CONFIGURED.
 */

import type { PrismaClient } from "@prisma/client"

import { canEditExperienceLocale } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import {
  GENERATION_MIN_BLOCKS,
  type DraftExperience,
  type VideoCandidate,
} from "@forge/experience-schema"

import {
  ExperienceAiNormalizationError,
  normalizeExperienceDraft,
} from "@/services/experience-ai/experience-ai-normalize"
import { loadVideoContextPack } from "@/services/experience-ai/video-context-pack.service"
import { applySectionAllowlist } from "@/services/experience-ai/section-generator"
import { launchMastraExperienceSection } from "@/services/experience-ai/mastra-experience-section-client"
import type { QualityDraftReview } from "@/services/experience-ai/experience-ai-quality-draft.schemas"

export type GenerateSectionActionInput = {
  localeId: string
  locale: string
  anchorVideoId: string
}

export type GenerateSectionActionErrorCode =
  | "LOCALE_NOT_FOUND"
  | "FORBIDDEN"
  | "ANCHOR_NOT_FOUND"
  | "NO_GROUNDING"
  | "NOT_CONFIGURED"
  | "SCHEMA_MISMATCH"
  | "UPSTREAM_ERROR"
  | "UNKNOWN"

export type GenerateSectionActionResult =
  | {
      ok: true
      draft: { title: string; metaDescription: string; blocks: unknown[] }
      review: QualityDraftReview
    }
  | { ok: false; code: GenerateSectionActionErrorCode; error: string }

export const SECTION_USER_MESSAGES: Record<
  GenerateSectionActionErrorCode,
  string
> = {
  LOCALE_NOT_FOUND: "Locale not found.",
  FORBIDDEN: "You do not have permission to edit this locale.",
  ANCHOR_NOT_FOUND:
    "That video can't be used as an anchor — it has no playable published version.",
  NO_GROUNDING:
    "This video has no study questions or scripture citations to ground a section. Pick another video.",
  NOT_CONFIGURED:
    "AI section generation is not configured for this environment.",
  SCHEMA_MISMATCH:
    "The AI response could not be turned into a valid grounded section. Try again.",
  UPSTREAM_ERROR:
    "The AI section service is unavailable right now. Try again shortly.",
  UNKNOWN: "Unable to generate a section right now.",
}

type GenerateSectionActionDeps = {
  prisma: PrismaClient
  user: Principal | null
}

export type GenerateSectionActionOverrides = {
  remoteEnabled?: boolean
  launchRemoteSection?: typeof launchMastraExperienceSection
  loadPack?: typeof loadVideoContextPack
}

function fail(
  code: GenerateSectionActionErrorCode,
): Extract<GenerateSectionActionResult, { ok: false }> {
  return { ok: false, code, error: SECTION_USER_MESSAGES[code] }
}

export async function runGenerateSectionAction(
  deps: GenerateSectionActionDeps,
  input: GenerateSectionActionInput,
  overrides: GenerateSectionActionOverrides = {},
): Promise<GenerateSectionActionResult> {
  // 1. Locale + ABAC.
  const locale = await deps.prisma.experienceLocale.findUnique({
    where: { id: input.localeId },
    select: {
      id: true,
      status: true,
      experienceId: true,
      experience: { select: { ownerId: true, archivedAt: true } },
    },
  })
  if (!locale) return fail("LOCALE_NOT_FOUND")
  if (!canEditExperienceLocale(deps.user, locale)) return fail("FORBIDDEN")

  // 2. Load the context pack (gates on playability; null = anchor unusable).
  const loadPack = overrides.loadPack ?? loadVideoContextPack
  let pack: Awaited<ReturnType<typeof loadVideoContextPack>>
  try {
    pack = await loadPack(deps.prisma, {
      videoId: input.anchorVideoId,
      locale: input.locale,
    })
  } catch (error) {
    console.error(
      `[runGenerateSectionAction] event=pack_load_error message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return fail("UPSTREAM_ERROR")
  }
  if (!pack) return fail("ANCHOR_NOT_FOUND")
  if (!pack.provenance.studyQuestions && !pack.provenance.citations) {
    return fail("NO_GROUNDING")
  }

  // 3. Remote-first call to the mastra section route.
  const remoteEnabled =
    overrides.remoteEnabled ?? env.EXPERIENCE_AI_REMOTE_SECTION === "true"
  if (!remoteEnabled) return fail("NOT_CONFIGURED")

  const anchorCandidate: VideoCandidate = {
    ref: "v01",
    videoId: pack.video.videoId,
    slug: pack.video.slug,
    title: pack.video.title,
    description: pack.video.description,
    previewImageUrl: pack.video.previewImageUrl,
    previewStreamUrl: pack.video.previewStreamUrl,
    label: pack.video.label,
  }

  const launch = overrides.launchRemoteSection ?? launchMastraExperienceSection
  const remote = await launch({
    locale: input.locale,
    anchorCandidate: pack.video,
    grounding: {
      studyQuestions: pack.studyQuestions,
      citations: pack.citations,
      scene: pack.scene,
      transcript: pack.transcript,
    },
  })
  if (!remote.ok) {
    switch (remote.reason) {
      case "config_missing":
        return fail("NOT_CONFIGURED")
      case "invalid_input":
      case "generation_failed":
        return fail("SCHEMA_MISMATCH")
      default:
        return fail("UPSTREAM_ERROR")
    }
  }

  // 4. Allowlist-filter the response against the pack (drop off-grounding content).
  const filtered = applySectionAllowlist(remote.draft, pack)
  if (filtered.blocks.length < GENERATION_MIN_BLOCKS) {
    // Too thin after grounding/filtering to be a usable section.
    return fail("SCHEMA_MISMATCH")
  }

  // 5. Wrap in a synthetic DraftExperience envelope (placeholder title/meta —
  //    dropped on append in the UI) so normalize can resolve candidateRef v01.
  const envelope: DraftExperience = {
    title: pack.video.title,
    metaDescription:
      pack.video.description?.trim() ||
      `A grounded section for ${pack.video.title}.`,
    blocks: filtered.blocks,
  }

  let normalized
  try {
    normalized = normalizeExperienceDraft(envelope, [anchorCandidate])
  } catch (error) {
    if (error instanceof ExperienceAiNormalizationError) {
      console.warn(
        `[runGenerateSectionAction] event=normalize_failed code=${error.code}`,
      )
      return fail("SCHEMA_MISMATCH")
    }
    console.error("[runGenerateSectionAction] event=normalize_error", error)
    return fail("UNKNOWN")
  }

  // 6. Build the review ledger. The anchor is a video_candidate; surviving
  //    citations are scripture; FAQ answers are AI-composed → needs_verification.
  const review = buildSectionReview(pack.video.title, filtered)

  return {
    ok: true,
    draft: {
      title: normalized.title,
      metaDescription: normalized.metaDescription,
      blocks: normalized.blocks,
    },
    review,
  }
}

function buildSectionReview(
  anchorTitle: string,
  filtered: ReturnType<typeof applySectionAllowlist>,
): QualityDraftReview {
  const referenceLedger: QualityDraftReview["referenceLedger"] = [
    {
      sourceKind: "video_candidate",
      claim: `Anchor video: ${anchorTitle}`,
      reference: anchorTitle,
      candidateRef: "v01",
    },
    ...filtered.usedCitations.map((c) => ({
      sourceKind: "scripture" as const,
      claim: c.reference,
      reference: c.reference,
    })),
  ]
  if (filtered.faqCount > 0) {
    referenceLedger.push({
      sourceKind: "needs_verification",
      claim: "FAQ answers are AI-composed from the video's content",
      reference: "Study questions",
      note: "Verify the answers against the video before publishing.",
    })
  }

  const scriptureNotes =
    filtered.usedCitations.length > 0
      ? filtered.usedCitations.map(
          (c) =>
            `${c.reference} — verse text is resolved at render, not authored by AI.`,
        )
      : ["No scripture is cited in this section."]

  return {
    scriptureNotes,
    researchNotes: [],
    theologyReview: {
      status: filtered.faqCount > 0 ? "needs_review" : "passed",
      notes:
        filtered.faqCount > 0
          ? ["FAQ answers are AI-composed — review before publishing."]
          : [],
    },
    referenceLedger,
  }
}
