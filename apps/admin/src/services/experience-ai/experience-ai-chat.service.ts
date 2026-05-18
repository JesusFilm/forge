/**
 * Experience-editor AI chat streaming service.
 *
 * Consumes a chat turn (a thread + a fresh user prompt), spawns Codex
 * with a chat-style prompt, line-buffers stdout, and yields typed
 * stream events as an `AsyncIterable`. The route handler in
 * `apps/admin/src/app/api/experience-chat/stream/route.ts` bridges
 * these events into an SSE response.
 *
 * Mutation persistence is funneled through
 * `ExperienceService.applyChatMutation` (NOT direct Prisma writes) so
 * the ABAC + ContentRevision contract used by every other editorial
 * mutation also covers chat-driven writes. The only chat-specific
 * surface is the `revisedByKind: "AI"` stamp.
 *
 * Symbol-stash diff persistence (see U3 docs): the in-memory diff
 * returned by `computeDiff` carries a non-enumerable `Symbol`-keyed
 * before-blocks stash. JSON.stringify drops symbols. We accept that
 * trade-off and ALSO persist the pre-mutation `blocks` array under
 * `snapshot_diff.beforeBlocks` so revert-from-DB can rebuild the stash
 * later (see `experienceChatMessage.snapshotDiff` schema).
 */

import type { PrismaClient } from "@prisma/client"

import { canEditExperienceLocale } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { ExperienceService } from "@/services/experience.service"
import {
  computeDiff,
  type EditableLocaleState,
  type ExperienceChatDiff,
} from "./experience-chat-diff"
import { loadExperienceAiVideoCandidates } from "./experience-ai.service"
import {
  confirmedBriefMetadata,
  isCompleteBrief,
  latestBriefMetadata,
  updateBriefFromTurn,
  type EditorialBrief,
  type EditorialBriefField,
} from "./experience-ai-chat-brief"
import {
  ChatMutationEnvelopeSchema,
  buildChatMutationEnvelopeJsonSchema,
  type ChatMutationEnvelope,
} from "./experience-ai-chat-envelope"
import {
  normalizeChatProvider,
  type ChatProvider,
} from "./experience-ai-chat-provider"
import { runClaudeCodeChat } from "./experience-ai-claude-code"
import { runOllamaChat } from "./experience-ai-ollama"
import {
  buildChatPrompt,
  type ChatHistoryTurn,
  type EditableLocaleSummary,
} from "./experience-ai-chat-prompts"
import { runCodexChat } from "./experience-ai-codex"
import {
  generateQualityExperienceDraft,
  QualityExperienceDraftError,
} from "./experience-ai-quality-draft"
import type { QualityDraftReview } from "./experience-ai-quality-draft.schemas"

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type { ChatErrorCode } from "./experience-ai-chat-error-codes"
import type { ChatErrorCode } from "./experience-ai-chat-error-codes"

export type ChatStreamEvent =
  | { type: "token_delta"; text: string }
  | {
      type: "mutation_proposal"
      messageId: string
      diff: ExperienceChatDiff
      draft: EditableLocaleState
      review?: QualityDraftReview
    }
  | {
      type: "brief_update"
      messageId: string
      content: string
      brief: EditorialBrief
      missingFields: EditorialBriefField[]
      question?: string
      confirmationRequired: boolean
    }
  | {
      type: "mutation_applied"
      messageId: string
      diff: ExperienceChatDiff
    }
  | { type: "error"; code: ChatErrorCode; message: string }
  | { type: "done"; messageId: string }

export type StreamChatTurnInput = {
  threadId: string
  prompt: string
  confirmedAcrossLocales?: boolean
  confirmedBrief?: boolean
  /**
   * Selected provider channel. Optional; defaults to `openrouter` so
   * existing callers behave unchanged. `normalizeChatProvider` accepts
   * raw input (string | unknown) and coerces to the closed
   * `ChatProvider` union; the route boundary applies a tighter Zod enum
   * but the service trusts the normalized value.
   */
  provider?: ChatProvider
}

export type StreamChatTurnDeps = {
  prisma: PrismaClient
  user: Principal | null
  abortSignal?: AbortSignal
}

// -----------------------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------------------

const CANDIDATE_LIMIT = 8

// -----------------------------------------------------------------------------
// Envelope schemas — re-exported from `experience-ai-chat-envelope.ts` for
// back-compat with test consumers and any caller that imported them from
// this module before the U5 refactor.
// -----------------------------------------------------------------------------

export {
  ChatMutationEnvelopeSchema,
  ChatMutationsSchema,
} from "./experience-ai-chat-envelope"

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

function errorEvent(code: ChatErrorCode, message: string): ChatStreamEvent {
  return { type: "error", code, message }
}

function providerErrorEvent(
  error: QualityExperienceDraftError,
): ChatStreamEvent {
  return errorEvent(error.code, error.message)
}

function looksLikeSlugRejection(rawObject: unknown): boolean {
  if (!rawObject || typeof rawObject !== "object") return false
  const mutations = (rawObject as { mutations?: unknown }).mutations
  if (!mutations || typeof mutations !== "object") return false
  return Object.prototype.hasOwnProperty.call(mutations, "slug")
}

function toEditableLocaleState(row: {
  title: string | null
  metaDescription: string | null
  ogImageUrl: string | null
  blocks: unknown
}): EditableLocaleState {
  return {
    title: row.title ?? "",
    metaDescription: row.metaDescription,
    ogImageUrl: row.ogImageUrl,
    blocks: Array.isArray(row.blocks) ? (row.blocks as unknown[]) : [],
  }
}

function toLocaleSummary(
  locale: string,
  state: EditableLocaleState,
): EditableLocaleSummary {
  return {
    locale,
    title: state.title,
    metaDescription: state.metaDescription,
    ogImageUrl: state.ogImageUrl,
    // Truncate long blocks arrays so the prompt stays bounded — Codex
    // gets a structural sketch, not the full payload.
    blocksPreview: state.blocks.slice(0, 32),
  }
}

function isEmptyCanvas(state: EditableLocaleState): boolean {
  return state.blocks.length === 0
}

/**
 * Route a chat turn through the editor-selected provider channel.
 *
 * - `openrouter` → Codex CLI (legacy default; the OpenRouter HTTP API
 *   doesn't have a peer interactive-shell shape, and the existing
 *   chat-turn path has shipped on Codex since v1).
 * - `ollama`, `codex`, `claude-code` → the matching adapter.
 *
 * Each adapter returns the same discriminated `{kind: "envelope" |
 * "error"}` shape and forwards token deltas via `onToken`.
 */
type ChatTurnRunResult =
  | { kind: "envelope"; raw: unknown }
  | { kind: "error"; code: ChatErrorCode; message: string }

async function runChatTurnForProvider({
  provider,
  prompt,
  schemaJson,
  abortSignal,
  onToken,
}: {
  provider: ChatProvider
  prompt: string
  schemaJson: unknown
  abortSignal?: AbortSignal
  onToken: (text: string) => void
}): Promise<ChatTurnRunResult> {
  if (provider === "ollama") {
    return await runOllamaChat({ prompt, abortSignal, onToken })
  }
  if (provider === "claude-code") {
    return await runClaudeCodeChat({
      prompt,
      schemaJson,
      abortSignal,
      onToken,
    })
  }
  // openrouter (default) + codex both currently spawn Codex CLI for the
  // chat-turn path. The OpenRouter HTTP API doesn't have an interactive
  // peer and Codex has shipped this branch since v1.
  return await runCodexChat({ prompt, abortSignal, onToken })
}

function providerKindForChatTurn(provider: ChatProvider): string {
  switch (provider) {
    case "ollama":
      return "ollama-gemma4"
    case "codex":
      return "codex"
    case "claude-code":
      return "claude-code"
    case "openrouter":
      // Legacy stamp — the chat-turn path on openrouter pick runs Codex.
      return "codex"
  }
}

// `runCodexChat` lives in `experience-ai-codex.ts`. The chat-turn
// branch of streamChatTurn imports it from there.

/**
 * Streaming chat-turn pipeline. See module docstring for the flow.
 */
export async function* streamChatTurn(
  input: StreamChatTurnInput,
  deps: StreamChatTurnDeps,
): AsyncIterable<ChatStreamEvent> {
  const { prisma, user } = deps
  const provider: ChatProvider = normalizeChatProvider(input.provider)

  // ---- Resolve thread + locale ------------------------------------------
  const thread = await prisma.experienceChatThread.findUnique({
    where: { id: input.threadId },
    select: {
      id: true,
      experienceLocaleId: true,
      experienceLocale: {
        select: {
          id: true,
          experienceId: true,
          locale: true,
          title: true,
          metaDescription: true,
          ogImageUrl: true,
          blocks: true,
          status: true,
          experience: {
            select: { ownerId: true, archivedAt: true },
          },
        },
      },
    },
  })

  if (!thread || !thread.experienceLocale) {
    yield errorEvent("thread_not_found", "Chat thread not found")
    return
  }

  const localeRow = thread.experienceLocale

  // ---- ABAC --------------------------------------------------------------
  if (!canEditExperienceLocale(user, localeRow)) {
    yield errorEvent(
      "forbidden",
      "You do not have permission to edit this locale",
    )
    return
  }

  // ---- Persist USER turn immediately ------------------------------------
  // Anchors the conversation even if the AI run fails downstream.
  await prisma.experienceChatMessage.create({
    data: {
      threadId: thread.id,
      role: "USER",
      content: input.prompt,
    },
  })

  const beforeState = toEditableLocaleState({
    title: localeRow.title,
    metaDescription: localeRow.metaDescription,
    ogImageUrl: localeRow.ogImageUrl,
    blocks: localeRow.blocks,
  })

  const history = await prisma.experienceChatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, mutationsApplied: true },
    take: 200, // hard ceiling; trimHistory will further bound
  })
  const latestBrief = latestBriefMetadata(
    history.map((message) => message.mutationsApplied),
  )
  const emptyCanvas = isEmptyCanvas(beforeState)
  // Brief flow is disabled: every prompt routes directly to the
  // chat-turn provider, which generates a full draft inline on empty
  // canvas (see the matching prompt update in experience-ai-chat-prompts).
  // The guided Q&A path is preserved in git history if we ever want to
  // bring it back as an opt-in.
  const inBriefMode = false
  const wantsBriefGeneration = false
  void latestBrief
  void emptyCanvas

  if (inBriefMode) {
    if (
      wantsBriefGeneration &&
      latestBrief &&
      isCompleteBrief(latestBrief.brief)
    ) {
      const confirmed = confirmedBriefMetadata(latestBrief)
      const candidates = await loadExperienceAiVideoCandidates(prisma, {
        locale: localeRow.locale,
        prompt: Object.values(confirmed.brief).filter(Boolean).join("\n"),
        limit: CANDIDATE_LIMIT,
      })

      let draft
      try {
        draft = await generateQualityExperienceDraft({
          brief: confirmed.brief,
          locale: localeRow.locale,
          candidates,
          provider,
        })
      } catch (error) {
        if (error instanceof QualityExperienceDraftError) {
          yield providerErrorEvent(error)
          return
        }
        yield errorEvent(
          "provider_validation_failed",
          error instanceof Error
            ? error.message
            : "Quality draft generation failed",
        )
        return
      }

      const draftState: EditableLocaleState = {
        title: draft.title,
        metaDescription: draft.metaDescription,
        ogImageUrl: beforeState.ogImageUrl,
        blocks: draft.blocks,
      }
      const diff = computeDiff(beforeState, draftState)
      const persistableDiff = {
        scalars: diff.scalars,
        blocks: diff.blocks ?? [],
        beforeBlocks: beforeState.blocks,
      }
      const assistantMessage = await prisma.experienceChatMessage.create({
        data: {
          threadId: thread.id,
          role: "ASSISTANT",
          content: "Generated a quality-first draft for review.",
          providerKind: draft.provider.kind,
          snapshotDiff: persistableDiff as unknown as object,
          mutationsApplied: {
            kind: "quality_draft",
            staged: true,
            brief: confirmed.brief,
            review: draft.review,
            provider: draft.provider,
            imageDirection: draft.imageDirection,
            mutations: {
              title: draftState.title,
              metaDescription: draftState.metaDescription,
              blocks: draftState.blocks,
            },
          } as unknown as object,
        },
      })

      await prisma.experienceChatThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date() },
      })

      yield {
        type: "mutation_proposal",
        messageId: assistantMessage.id,
        diff,
        draft: draftState,
        review: draft.review,
      }
      yield { type: "done", messageId: assistantMessage.id }
      return
    }

    const briefTurn = updateBriefFromTurn({
      previous: latestBrief,
      prompt: input.prompt,
    })
    const assistantMessage = await prisma.experienceChatMessage.create({
      data: {
        threadId: thread.id,
        role: "ASSISTANT",
        content: briefTurn.content,
        providerKind: "brief",
        mutationsApplied: briefTurn.metadata as unknown as object,
      },
    })

    await prisma.experienceChatThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date() },
    })

    yield {
      type: "brief_update",
      messageId: assistantMessage.id,
      content: briefTurn.content,
      brief: briefTurn.metadata.brief,
      missingFields: briefTurn.metadata.missingFields,
      question: briefTurn.metadata.question,
      confirmationRequired: briefTurn.confirmationRequired,
    }
    yield { type: "done", messageId: assistantMessage.id }
    return
  }

  // ---- Build candidate retrieval (mirrors the one-shot path) ------------
  const candidates = await loadExperienceAiVideoCandidates(prisma, {
    locale: localeRow.locale,
    prompt: input.prompt,
    limit: CANDIDATE_LIMIT,
  })

  const historyTurns: ChatHistoryTurn[] = history.map((m) => ({
    role:
      m.role === "USER"
        ? "user"
        : m.role === "ASSISTANT"
          ? "assistant"
          : "system",
    content: m.content,
  }))

  const promptText = buildChatPrompt({
    state: toLocaleSummary(localeRow.locale, beforeState),
    history: historyTurns,
    candidates,
    userPrompt: input.prompt,
  })

  // Empty-canvas guard removed alongside brief flow disable above —
  // chat-turn now produces full drafts directly from the user prompt.

  // ---- Run chat turn via the selected provider --------------------------
  // Each adapter is responsible for its own gate check (CLI providers
  // surface provider_not_configured / codex_unavailable before spawning).
  // We collect token chunks in a buffer because the adapter calls onToken
  // synchronously and the surrounding generator can only yield between
  // awaits.
  const tokenBuffer: string[] = []
  const onToken = (text: string) => {
    tokenBuffer.push(text)
  }

  const envelopeSchema = buildChatMutationEnvelopeJsonSchema()
  const runResult = await runChatTurnForProvider({
    provider,
    prompt: promptText,
    schemaJson: envelopeSchema,
    abortSignal: deps.abortSignal,
    onToken,
  })

  // Drain any tokens accumulated before settling.
  for (const tok of tokenBuffer) {
    yield { type: "token_delta", text: tok }
  }

  if (runResult.kind === "error") {
    yield errorEvent(runResult.code, runResult.message)
    return
  }

  // ---- Validate envelope -------------------------------------------------
  const rawEnvelope = runResult.raw

  // Fast-path slug rejection before strict-parse so we can return the
  // more specific error code.
  if (looksLikeSlugRejection(rawEnvelope)) {
    yield errorEvent(
      "slug_change_rejected",
      "Slug changes are not permitted from chat",
    )
    return
  }

  const parsed = ChatMutationEnvelopeSchema.safeParse(rawEnvelope)
  if (!parsed.success) {
    yield errorEvent(
      "schema_violation",
      `Envelope failed schema validation: ${parsed.error.issues
        .map((i) => i.path.join(".") + ":" + i.code)
        .join(",")}`,
    )
    return
  }

  const envelope: ChatMutationEnvelope = parsed.data

  // ---- Cross-locale guard -----------------------------------------------
  if (envelope.localesAffected && envelope.localesAffected.length > 0) {
    const otherLocales = envelope.localesAffected.filter(
      (loc) => loc !== localeRow.locale,
    )
    if (otherLocales.length > 0 && input.confirmedAcrossLocales !== true) {
      yield errorEvent(
        "cross_locale_unconfirmed",
        `Mutation affects locales [${envelope.localesAffected.join(", ")}] — operator must confirm cross-locale write`,
      )
      return
    }
  }

  // ---- Apply via service layer ------------------------------------------
  const experienceService = new ExperienceService(prisma)
  let applyResult
  try {
    applyResult = await experienceService.applyChatMutation({
      input: {
        id: localeRow.id,
        ...(envelope.mutations.title !== undefined
          ? { title: envelope.mutations.title }
          : {}),
        ...(envelope.mutations.metaDescription !== undefined
          ? { metaDescription: envelope.mutations.metaDescription }
          : {}),
        ...(envelope.mutations.ogImageUrl !== undefined
          ? { ogImageUrl: envelope.mutations.ogImageUrl }
          : {}),
        ...(envelope.mutations.blocks !== undefined
          ? { blocks: envelope.mutations.blocks }
          : {}),
      },
      user,
      reason: envelope.reason ?? "Chat-driven mutation",
    })
  } catch (error) {
    // Service-layer rejection (Zod validation, ABAC second pass, DB).
    // The most likely cause is BlocksSchema rejection, which we surface
    // as schema_violation so the UI bucket matches the upstream cause.
    if (
      error instanceof Error &&
      (error.name === "ZodError" || error.message.includes("BlocksSchema"))
    ) {
      yield errorEvent(
        "schema_violation",
        `Service rejected mutation: ${error.message}`,
      )
      return
    }
    yield errorEvent(
      "unknown",
      error instanceof Error ? error.message : "Mutation application failed",
    )
    return
  }

  // ---- Compute diff + persist ASSISTANT message -------------------------
  const afterState = toEditableLocaleState({
    title: applyResult.after.title,
    metaDescription: applyResult.after.metaDescription,
    ogImageUrl: applyResult.after.ogImageUrl,
    blocks: applyResult.after.blocks,
  })

  const diff = computeDiff(beforeState, afterState)

  // The diff in-memory carries a Symbol-keyed before-blocks stash that
  // JSON.stringify drops. To make revert-from-DB work, we co-persist
  // the pre-mutation blocks under `snapshot_diff.beforeBlocks`.
  const persistableDiff = {
    scalars: diff.scalars,
    blocks: diff.blocks ?? [],
    beforeBlocks: beforeState.blocks,
  }

  const assistantContent = envelope.reason ?? "Mutation applied."
  const assistantMessage = await prisma.experienceChatMessage.create({
    data: {
      threadId: thread.id,
      role: "ASSISTANT",
      content: assistantContent,
      providerKind: providerKindForChatTurn(provider),
      snapshotDiff: persistableDiff as unknown as object,
      mutationsApplied: envelope as unknown as object,
    },
  })

  await prisma.experienceChatThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: new Date() },
  })

  yield {
    type: "mutation_applied",
    messageId: assistantMessage.id,
    diff,
  }
  yield { type: "done", messageId: assistantMessage.id }
}
