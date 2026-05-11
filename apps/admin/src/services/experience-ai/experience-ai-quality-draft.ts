import type { EditorialBrief } from "./experience-ai-chat-brief"
import {
  CONTENT_KIT_PAGE_STRUCTURE_PROMPT,
  CONTENT_KIT_SYSTEM_PROMPT,
} from "./experience-ai-content-kit"
import type { VideoCandidate } from "./experience-ai.schemas"
import {
  ExperienceAiNormalizationError,
  normalizeExperienceDraft,
  type NormalizedExperienceDraft,
} from "./experience-ai-normalize"
import {
  generateOpenRouterFreeStructuredOutput,
  OpenRouterFreeProviderError,
  type OpenRouterProviderAttempt,
} from "./experience-ai-openrouter-free"
import {
  buildQualityDraftJsonSchema,
  QualityDraftPackageSchema,
  type QualityDraftReview,
} from "./experience-ai-quality-draft.schemas"

export type QualityExperienceDraftResult = NormalizedExperienceDraft & {
  review: QualityDraftReview
  imageDirection: string | null
  provider: {
    kind: "openrouter-free"
    model: string
    usedModel: string
    attempts: OpenRouterProviderAttempt[]
  }
}

export class QualityExperienceDraftError extends Error {
  constructor(
    readonly code:
      | "provider_not_configured"
      | "provider_rate_limited"
      | "provider_unavailable"
      | "provider_timeout"
      | "provider_validation_failed",
    message: string,
    readonly attempts: OpenRouterProviderAttempt[] = [],
  ) {
    super(message)
    this.name = "QualityExperienceDraftError"
  }
}

function briefLines(brief: EditorialBrief) {
  return [
    `Topic or passage: ${brief.topicOrPassage}`,
    `Language: ${brief.language}`,
    `Audience: ${brief.audience}`,
    `Desired outcome: ${brief.desiredOutcome}`,
    `Tone: ${brief.tone}`,
    `Page type: ${brief.pageType}`,
    `Scripture emphasis: ${brief.scriptureEmphasis}`,
    `CTA or next step: ${brief.ctaOrNextStep}`,
  ].join("\n")
}

function candidateInput(candidates: readonly VideoCandidate[]) {
  return candidates.map((candidate) => ({
    ref: candidate.ref,
    videoId: candidate.videoId,
    title: candidate.title,
    description: candidate.description,
    label: candidate.label,
    previewImageUrl: candidate.previewImageUrl,
    previewStreamUrl: candidate.previewStreamUrl,
  }))
}

function mapProviderError(error: OpenRouterFreeProviderError) {
  switch (error.code) {
    case "missing_provider":
      return "provider_not_configured"
    case "provider_rate_limited":
      return "provider_rate_limited"
    case "timeout":
      return "provider_timeout"
    case "validation_error":
      return "provider_validation_failed"
    case "upstream_error":
      return "provider_unavailable"
  }
}

function validateQualityPackage(payload: unknown) {
  const parsed = QualityDraftPackageSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error("Quality draft package failed schema validation")
  }
  return parsed.data
}

export async function generateQualityExperienceDraft({
  brief,
  locale,
  candidates,
  fetchImpl,
}: {
  brief: EditorialBrief
  locale: string
  candidates: VideoCandidate[]
  fetchImpl?: typeof fetch
}): Promise<QualityExperienceDraftResult> {
  try {
    const result = await generateOpenRouterFreeStructuredOutput({
      fetchImpl,
      messages: [
        {
          role: "system",
          content: [
            CONTENT_KIT_SYSTEM_PROMPT,
            CONTENT_KIT_PAGE_STRUCTURE_PROMPT,
          ]
            .join("\n\n")
            .trim(),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              locale,
              editorialBrief: briefLines(brief),
              videoCandidates: candidateInput(candidates),
              outputContract:
                "Return public draft content under draft and admin-only review evidence under review. Public draft blocks must never include research notes or provider metadata.",
            },
            null,
            2,
          ),
        },
      ],
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "quality_experience_draft",
          strict: true,
          schema: buildQualityDraftJsonSchema(),
        },
      },
      maxTokens: 7000,
      temperature: 0.35,
      validate: validateQualityPackage,
    })

    const normalized = normalizeExperienceDraft(
      result.payload.draft,
      candidates,
    )
    return {
      ...normalized,
      review: result.payload.review,
      imageDirection: result.payload.imageDirection ?? null,
      provider: {
        kind: "openrouter-free",
        model: result.model,
        usedModel: result.usedModel,
        attempts: result.attempts,
      },
    }
  } catch (error) {
    if (error instanceof OpenRouterFreeProviderError) {
      throw new QualityExperienceDraftError(
        mapProviderError(error),
        error.message,
        error.attempts,
      )
    }
    if (error instanceof ExperienceAiNormalizationError) {
      throw new QualityExperienceDraftError(
        "provider_validation_failed",
        error.message,
      )
    }
    throw new QualityExperienceDraftError(
      "provider_validation_failed",
      error instanceof Error
        ? error.message
        : "Quality draft validation failed",
    )
  }
}
