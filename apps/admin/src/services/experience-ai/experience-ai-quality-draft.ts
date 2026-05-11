import type { EditorialBrief } from "./experience-ai-chat-brief"
import {
  DEFAULT_CHAT_PROVIDER,
  type ChatProvider,
} from "./experience-ai-chat-provider"
import {
  ClaudeCodeProviderError,
  generateClaudeCodeStructuredOutput,
  type ClaudeCodeProviderAttempt,
} from "./experience-ai-claude-code"
import {
  CodexProviderError,
  generateCodexStructuredOutput,
  type CodexProviderAttempt,
} from "./experience-ai-codex"
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
  generateOllamaStructuredOutput,
  OllamaProviderError,
  type OllamaProviderAttempt,
} from "./experience-ai-ollama"
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

export type QualityDraftProviderKind =
  | "openrouter-free"
  | "ollama-gemma4"
  | "codex"
  | "claude-code"

export type QualityDraftProviderAttempt =
  | OpenRouterProviderAttempt
  | OllamaProviderAttempt
  | CodexProviderAttempt
  | ClaudeCodeProviderAttempt

export type QualityExperienceDraftResult = NormalizedExperienceDraft & {
  review: QualityDraftReview
  imageDirection: string | null
  provider: {
    kind: QualityDraftProviderKind
    model: string
    usedModel: string
    attempts: QualityDraftProviderAttempt[]
  }
}

export type QualityExperienceDraftErrorCode =
  | "provider_not_configured"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_validation_failed"

export class QualityExperienceDraftError extends Error {
  constructor(
    readonly code: QualityExperienceDraftErrorCode,
    message: string,
    readonly attempts: QualityDraftProviderAttempt[] = [],
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

function mapOpenRouterError(
  error: OpenRouterFreeProviderError,
): QualityExperienceDraftErrorCode {
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

function mapOllamaError(
  error: OllamaProviderError,
): QualityExperienceDraftErrorCode {
  switch (error.code) {
    case "missing_provider":
      return "provider_not_configured"
    case "timeout":
      return "provider_timeout"
    case "validation_error":
      return "provider_validation_failed"
    case "upstream_error":
      return "provider_unavailable"
  }
}

function mapCodexError(
  error: CodexProviderError,
): QualityExperienceDraftErrorCode {
  switch (error.code) {
    case "missing_provider":
      return "provider_not_configured"
    case "timeout":
      return "provider_timeout"
    case "validation_error":
      return "provider_validation_failed"
    case "upstream_error":
      return "provider_unavailable"
  }
}

function mapClaudeCodeError(
  error: ClaudeCodeProviderError,
): QualityExperienceDraftErrorCode {
  switch (error.code) {
    case "missing_provider":
      return "provider_not_configured"
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

function systemPromptText(): string {
  return [CONTENT_KIT_SYSTEM_PROMPT, CONTENT_KIT_PAGE_STRUCTURE_PROMPT]
    .join("\n\n")
    .trim()
}

function userPromptText({
  brief,
  locale,
  candidates,
}: {
  brief: EditorialBrief
  locale: string
  candidates: VideoCandidate[]
}): string {
  return JSON.stringify(
    {
      locale,
      editorialBrief: briefLines(brief),
      videoCandidates: candidateInput(candidates),
      outputContract:
        "Return public draft content under draft and admin-only review evidence under review. Public draft blocks must never include research notes or provider metadata.",
    },
    null,
    2,
  )
}

function combinedPromptText(args: {
  brief: EditorialBrief
  locale: string
  candidates: VideoCandidate[]
}): string {
  // CLIs receive a single prompt string with the system + user blocks
  // concatenated. Mirrors the prompt structure used by the existing
  // Codex chat-turn path.
  return [
    "[SYSTEM]\n" + systemPromptText(),
    "[USER]\n" + userPromptText(args),
  ].join("\n\n")
}

/**
 * Generate a quality-first Experience draft through the editor-selected
 * provider channel. All four channels return the same uniform result
 * shape — the only observable differences are `provider.kind` and the
 * shape of the per-attempt log.
 */
export async function generateQualityExperienceDraft({
  brief,
  locale,
  candidates,
  fetchImpl,
  provider = DEFAULT_CHAT_PROVIDER,
}: {
  brief: EditorialBrief
  locale: string
  candidates: VideoCandidate[]
  fetchImpl?: typeof fetch
  provider?: ChatProvider
}): Promise<QualityExperienceDraftResult> {
  const systemPrompt = systemPromptText()
  const userPrompt = userPromptText({ brief, locale, candidates })

  try {
    if (provider === "ollama") {
      const result = await generateOllamaStructuredOutput({
        fetchImpl,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        numPredict: 7000,
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
          kind: "ollama-gemma4",
          model: result.model,
          usedModel: result.usedModel,
          attempts: result.attempts,
        },
      }
    }

    if (provider === "codex") {
      const result = await generateCodexStructuredOutput({
        prompt: combinedPromptText({ brief, locale, candidates }),
        schemaJson: buildQualityDraftJsonSchema(),
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
          kind: "codex",
          model: result.model,
          usedModel: result.usedModel,
          attempts: result.attempts,
        },
      }
    }

    if (provider === "claude-code") {
      const result = await generateClaudeCodeStructuredOutput({
        prompt: combinedPromptText({ brief, locale, candidates }),
        schemaJson: buildQualityDraftJsonSchema(),
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
          kind: "claude-code",
          model: result.model,
          usedModel: result.usedModel,
          attempts: result.attempts,
        },
      }
    }

    // Default: openrouter
    const result = await generateOpenRouterFreeStructuredOutput({
      fetchImpl,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
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
        mapOpenRouterError(error),
        error.message,
        error.attempts,
      )
    }
    if (error instanceof OllamaProviderError) {
      throw new QualityExperienceDraftError(
        mapOllamaError(error),
        error.message,
        error.attempts,
      )
    }
    if (error instanceof CodexProviderError) {
      throw new QualityExperienceDraftError(
        mapCodexError(error),
        error.message,
        error.attempts,
      )
    }
    if (error instanceof ClaudeCodeProviderError) {
      throw new QualityExperienceDraftError(
        mapClaudeCodeError(error),
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
