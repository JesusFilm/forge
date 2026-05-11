import type { PrismaClient } from "@prisma/client"
import { canEditExperienceLocale } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import {
  ExperienceAiGenerationError,
  generateExperienceAiDraft,
} from "@/services/experience-ai/experience-ai.service"

export type GenerateDraftActionInput = {
  localeId: string
  locale: string
  prompt: string
  currentTitle?: string
  currentMetaDescription?: string
}

/// Typed error codes returned by the action layer. Keep in sync with
/// USER_MESSAGES below.
export type GenerateDraftActionErrorCode =
  | "EMPTY_PROMPT"
  | "LOCALE_NOT_FOUND"
  | "FORBIDDEN"
  | "CANVAS_NOT_EMPTY"
  | "NOT_CONFIGURED"
  | "NO_CANDIDATES"
  | "SCHEMA_MISMATCH"
  | "UPSTREAM_ERROR"
  | "UNKNOWN"

export type GenerateDraftActionResult =
  | {
      ok: true
      draft: {
        title: string
        metaDescription: string
        blocks: unknown[]
      }
    }
  | {
      ok: false
      code: GenerateDraftActionErrorCode
      error: string
    }

export const USER_MESSAGES: Record<GenerateDraftActionErrorCode, string> = {
  EMPTY_PROMPT: "Enter a theme or story prompt first.",
  LOCALE_NOT_FOUND: "Locale not found.",
  FORBIDDEN: "You do not have permission to generate a draft for this locale.",
  CANVAS_NOT_EMPTY: "AI drafting is only available on an empty canvas in v1.",
  NOT_CONFIGURED: "AI drafting is not configured for this environment.",
  NO_CANDIDATES:
    "No suitable in-catalog videos were found for this theme. Try broader wording.",
  SCHEMA_MISMATCH:
    "The AI response could not be turned into a valid editor draft. Try again.",
  UPSTREAM_ERROR:
    "The AI drafting service is unavailable right now. Try again shortly.",
  UNKNOWN: "Unable to generate a draft right now.",
}

type GenerateDraftActionDeps = {
  prisma: Pick<
    PrismaClient,
    | "experienceLocale"
    | "video"
    | "videoLocale"
    | "videoDub"
    | "videoImage"
    | "contentRevision"
  >
  user: Principal | null
}

function buildPrompt(input: GenerateDraftActionInput) {
  const parts = [input.prompt.trim()]
  if (input.currentTitle?.trim()) {
    parts.push(`Optional editor title hint: ${input.currentTitle.trim()}`)
  }
  if (input.currentMetaDescription?.trim()) {
    parts.push(
      `Optional editor description hint: ${input.currentMetaDescription.trim()}`,
    )
  }
  return parts.join("\n\n")
}

function fail(
  code: GenerateDraftActionErrorCode,
): Extract<GenerateDraftActionResult, { ok: false }> {
  return { ok: false, code, error: USER_MESSAGES[code] }
}

function isNonEmptyBlocksValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === "object") {
    // ContentRevision snapshots are stored as { v, data: { blocks: [...] } }.
    const data = (value as { data?: unknown }).data
    if (data && typeof data === "object") {
      const blocks = (data as { blocks?: unknown }).blocks
      if (Array.isArray(blocks)) return blocks.length > 0
    }
    const blocks = (value as { blocks?: unknown }).blocks
    if (Array.isArray(blocks)) return blocks.length > 0
  }
  return false
}

export async function runGenerateDraftAction(
  deps: GenerateDraftActionDeps,
  input: GenerateDraftActionInput,
): Promise<GenerateDraftActionResult> {
  const prompt = input.prompt.trim()
  if (!prompt) {
    return fail("EMPTY_PROMPT")
  }

  const locale = await deps.prisma.experienceLocale.findUnique({
    where: { id: input.localeId },
    select: {
      id: true,
      status: true,
      blocks: true,
      experienceId: true,
      experience: {
        select: {
          ownerId: true,
          archivedAt: true,
        },
      },
    },
  })

  if (!locale) {
    return fail("LOCALE_NOT_FOUND")
  }

  if (!canEditExperienceLocale(deps.user, locale)) {
    return fail("FORBIDDEN")
  }

  // Server-side empty-canvas guard (R4). Read canonical blocks AND any
  // pending DRAFT revision; non-empty in either path means the action
  // must NOT invoke the AI service. Returns the typed CANVAS_NOT_EMPTY
  // code so the UI can render a precise message regardless of which
  // surface (canonical or draft) is non-empty.
  if (isNonEmptyBlocksValue(locale.blocks)) {
    return fail("CANVAS_NOT_EMPTY")
  }

  const draftRevision = await deps.prisma.contentRevision.findFirst({
    where: {
      entityType: "ExperienceLocale",
      entityId: locale.id,
      status: "DRAFT",
    },
    select: { snapshot: true },
  })

  if (draftRevision && isNonEmptyBlocksValue(draftRevision.snapshot)) {
    return fail("CANVAS_NOT_EMPTY")
  }

  try {
    const draft = await generateExperienceAiDraft(deps.prisma as PrismaClient, {
      experienceLocaleId: input.localeId,
      locale: input.locale,
      prompt: buildPrompt(input),
      user: deps.user,
      experienceId: locale.experienceId ?? null,
    })

    return {
      ok: true,
      draft: {
        title: draft.title,
        metaDescription: draft.metaDescription,
        blocks: draft.blocks,
      },
    }
  } catch (error) {
    if (error instanceof ExperienceAiGenerationError) {
      switch (error.code) {
        case "NOT_CONFIGURED":
          return fail("NOT_CONFIGURED")
        case "NO_CANDIDATES":
          return fail("NO_CANDIDATES")
        case "NORMALIZATION_ERROR":
        case "SCHEMA_MISMATCH":
          return fail("SCHEMA_MISMATCH")
        case "UPSTREAM_ERROR":
          return fail("UPSTREAM_ERROR")
      }
    }

    console.error("[runGenerateDraftAction] unexpected error", error)
    return fail("UNKNOWN")
  }
}
