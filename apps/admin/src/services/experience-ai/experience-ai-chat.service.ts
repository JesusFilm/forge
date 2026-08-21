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
import { env } from "@/config/env"
import { STEP_CAPS, TIME_BUDGET_MS } from "@/mastra/budgets"
import {
  streamMastraExperienceChat,
  type MastraChatRelayReason,
} from "./mastra-experience-chat-client"
import { ExperienceService } from "@/services/experience.service"
import {
  computeDiff,
  type EditableLocaleState,
  type ExperienceChatDiff,
} from "./experience-chat-diff"
import { loadExperienceAiVideoCandidates } from "./experience-ai.service"
import {
  ChatMutationEnvelopeSchema,
  type ChatMutationEnvelope,
} from "./experience-ai-chat-envelope"
import {
  buildChatPrompt,
  type ChatHistoryTurn,
  type EditableLocaleSummary,
} from "./experience-ai-chat-prompts"
import { extractJsonObject } from "@forge/experience-schema"

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type { ChatErrorCode } from "./experience-ai-chat-error-codes"
import type { ChatErrorCode } from "./experience-ai-chat-error-codes"

export type ChatStreamEvent =
  | { type: "token_delta"; text: string }
  | {
      type: "mutation_applied"
      messageId: string
      diff: ExperienceChatDiff
    }
  | { type: "error"; code: ChatErrorCode; message: string }
  | { type: "done"; messageId: string; producedBy: string }

export type StreamChatTurnInput = {
  threadId: string
  prompt: string
  confirmedAcrossLocales?: boolean
  confirmedBrief?: boolean
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

/**
 * Mastra-routed chat turn — uses the `experience-default-chat` agent
 * from `apps/admin/src/mastra/`. Streams tokens through `onToken`,
 * accumulates the full text, parses it as the new `{ diff }` envelope
 * the Mastra prompt produces, then translates to the legacy
 * `{ mutations }` envelope the chat service's downstream applier
 * expects.
 *
 * This is the only chat-turn path post-convergence — there used to
 * be four (openrouter/ollama/codex/claude-code), all routed via a
 * provider switch. The plan at
 * `docs/plans/2026-05-18-001-feat-admin-mastra-only-chat-channel-plan.md`
 * collapsed them.
 */
type ChatTurnRunResult =
  | { kind: "envelope"; raw: unknown }
  | { kind: "error"; code: ChatErrorCode; message: string }

async function runMastraChat({
  prompt,
  abortSignal,
  onToken,
}: {
  prompt: string
  abortSignal?: AbortSignal
  onToken: (text: string) => void
}): Promise<ChatTurnRunResult> {
  // Flag-gated streaming cutover (U9): relay the token stream from the
  // standalone /forge-experience-chat route (admin = proxy). config_missing
  // degrades to the in-process path below — it is a pre-fetch short-circuit so
  // NO tokens were relayed, making the fallback re-run clean. Every other relay
  // failure returns its mapped error WITHOUT falling back (tokens may already
  // have been relayed, so an in-process re-run would duplicate them).
  if (env.EXPERIENCE_AI_REMOTE_CHAT === "true") {
    const relay = await streamMastraExperienceChat({
      prompt,
      onToken,
      abortSignal,
    })
    if (relay.ok) return finalizeChatBuffer(relay.text)
    if (relay.reason !== "config_missing") {
      return mapRelayReason(relay.reason, relay.message)
    }
    console.warn(
      "[mastra-chat] event=remote_chat_config_missing falling_back=in_process",
    )
  }

  // Wall-clock ceiling on the agent call. Without this, a hung provider
  // (gateway 5xx that never responds, Ollama stall) keeps streamChatTurn
  // — and the SSE connection behind it — open indefinitely. Compose the
  // budget timeout with the caller's user-cancel signal so EITHER aborts
  // the generate; `AbortSignal.any` is no-op past whichever fires first.
  const budgetSignal = AbortSignal.timeout(TIME_BUDGET_MS.chatTurn)
  const composedSignal = abortSignal
    ? AbortSignal.any([abortSignal, budgetSignal])
    : budgetSignal
  try {
    const { getMastra } = await import("@/mastra")
    const mastra = getMastra()
    const agent = mastra.getAgentById("experience-default-chat")
    // Use generate() instead of stream() — Mastra's textStream can be
    // empty when the agent is composing structured output or in a
    // tool-call cycle. generate() returns the final text synchronously
    // which is sufficient for the demo; true token streaming requires
    // wiring the full UIMessageStream (the U3 bridge).
    //
    // `maxSteps` bounds tool-call recursion: `experience-default-chat`
    // is a tool-calling agent (searchVideos / lookupBibleVerse /
    // fetchVideoImage). `STEP_CAPS.toolCallingTurn` caps the
    // tool→observe→respond loop so a misbehaving turn can't recurse
    // without bound. (It is NOT what fixes the empty-buffer bug — that
    // is the abort guard below.)
    const result = await agent.generate(prompt, {
      abortSignal: composedSignal,
      maxSteps: STEP_CAPS.toolCallingTurn,
    })
    // Abort-resolves-empty guard. When the budget (or user-cancel)
    // signal fires mid-generation, the AI SDK RESOLVES `generate()` with
    // empty text rather than rejecting — so an aborted turn never enters
    // the catch block's timeout/cancel classification, and an empty
    // `result.text` would otherwise be misreported downstream as
    // "agent returned text without a JSON object" / DRAFT REJECTED. A
    // full from-scratch draft on the gateway model runs ~37-45s, so the
    // 30s+ budget abort was the real production failure (logs:
    // `stream_done buffer_length=0` + `no_json_object head="" tail=""`,
    // with NO `chat_turn_timeout`). Classify the abort honestly here,
    // before any empty-buffer handling.
    if (budgetSignal.aborted) {
      console.warn(
        "[mastra-chat] event=chat_turn_timeout source=generate_resolved_empty budget_ms=" +
          TIME_BUDGET_MS.chatTurn,
      )
      return {
        kind: "error",
        code: "timeout",
        message: "The AI took too long to respond and the request timed out.",
      }
    }
    if (abortSignal?.aborted) {
      return {
        kind: "error",
        code: "cancelled",
        message: "The request was cancelled.",
      }
    }
    // Prefer `result.text`; fall back to a serialized `result.object`
    // (mirrors the draft workflow's resolveDraft) so a structured-output
    // turn still yields a parseable buffer instead of an empty string.
    const buffer =
      typeof result.text === "string" && result.text.length > 0
        ? result.text
        : result.object !== undefined
          ? JSON.stringify(result.object)
          : ""
    if (buffer.length > 0) onToken(buffer)
    console.warn(
      "[mastra-chat] event=stream_done buffer_length=" + buffer.length,
    )
    return finalizeChatBuffer(buffer)
  } catch (error) {
    if (error instanceof Error && error.name === "ProviderNotConfiguredError") {
      return {
        kind: "error",
        code: "provider_not_configured",
        message: error.message,
      }
    }
    // Distinguish a wall-clock timeout from a user-initiated cancel. With
    // the composed signal, an abort can come from either source; classify
    // by which underlying signal actually aborted (the error name is a
    // fallback — `AbortSignal.timeout` rejects as DOMException
    // "TimeoutError", a manual abort as "AbortError").
    if (budgetSignal.aborted) {
      console.warn(
        "[mastra-chat] event=chat_turn_timeout budget_ms=" +
          TIME_BUDGET_MS.chatTurn,
      )
      return {
        kind: "error",
        code: "timeout",
        message: "The AI took too long to respond and the request timed out.",
      }
    }
    if (abortSignal?.aborted) {
      return {
        kind: "error",
        code: "cancelled",
        message: "The request was cancelled.",
      }
    }
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" ||
        (error instanceof DOMException && error.name === "TimeoutError"))
    ) {
      return {
        kind: "error",
        code: "timeout",
        message: "The AI took too long to respond and the request timed out.",
      }
    }
    return {
      kind: "error",
      code: "unknown",
      message: error instanceof Error ? error.message : "Mastra chat failed",
    }
  }
}

/**
 * Parse a chat-turn buffer (full agent text — from the in-process generate() or
 * the relayed remote stream) into the legacy envelope. Shared by both paths so
 * the parse → jsonrepair → translate ladder cannot drift. Does NOT call
 * `onToken` (the in-process path streams the buffer; the remote path streams
 * per chunk before this runs).
 */
async function finalizeChatBuffer(buffer: string): Promise<ChatTurnRunResult> {
  const extracted = extractJsonObject(buffer)
  if (extracted === null) {
    console.warn(
      "[mastra-chat] event=no_json_object head=" +
        JSON.stringify(buffer.slice(0, 200)) +
        " tail=" +
        JSON.stringify(buffer.slice(-200)),
    )
    return {
      kind: "error",
      code: "provider_validation_failed",
      message:
        "Mastra agent returned text without a JSON object. (See server log.)",
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(extracted)
  } catch (err) {
    // Small local models (gemma4:e4b) occasionally produce not-quite-valid
    // JSON — unescaped quotes, trailing commas, missing braces. Try jsonrepair
    // before giving up.
    try {
      const { jsonrepair } = await import("jsonrepair")
      const repaired = jsonrepair(extracted)
      parsed = JSON.parse(repaired)
      console.warn(
        "[mastra-chat] event=json_repaired original_err=" +
          (err instanceof Error ? err.message : String(err)),
      )
    } catch (repairErr) {
      console.warn(
        "[mastra-chat] event=json_parse_failed err=" +
          (err instanceof Error ? err.message : String(err)) +
          " repair_err=" +
          (repairErr instanceof Error ? repairErr.message : String(repairErr)) +
          " head=" +
          JSON.stringify(extracted.slice(0, 200)) +
          " tail=" +
          JSON.stringify(extracted.slice(-200)),
      )
      return {
        kind: "error",
        code: "provider_validation_failed",
        message: "Mastra agent returned malformed JSON. (See server log.)",
      }
    }
  }
  const translated = translateMastraEnvelopeToLegacy(parsed)
  normalizeBlockFieldAliases(translated)
  console.warn(
    "[mastra-chat] event=envelope_parsed translated_keys=" +
      Object.keys(translated as object).join(","),
  )
  return { kind: "envelope", raw: translated }
}

/**
 * Map a remote chat-relay failure reason onto the chat error-code union (U9).
 * `config_missing` is handled at the call site (in-process fallback) and never
 * reaches here. A remote `timeout` stays a `timeout` (not a generic retryable
 * network error) per the outbound-timeout-classification learning.
 */
function mapRelayReason(
  reason: Exclude<MastraChatRelayReason, "config_missing">,
  message: string | undefined,
): ChatTurnRunResult {
  switch (reason) {
    case "timeout":
      return {
        kind: "error",
        code: "timeout",
        message:
          message ??
          "The AI took too long to respond and the request timed out.",
      }
    case "cancelled":
      return {
        kind: "error",
        code: "cancelled",
        message: message ?? "The request was cancelled.",
      }
    case "auth_failed":
      return {
        kind: "error",
        code: "provider_not_configured",
        message: "The AI chat service rejected admin's credentials.",
      }
    case "generation_failed":
    case "parse_error":
      return {
        kind: "error",
        code: "provider_validation_failed",
        message: message ?? "The AI chat service returned an unusable result.",
      }
    case "ssrf_blocked":
    case "network_error":
      return {
        kind: "error",
        code: "unknown",
        message: "The AI chat service is unavailable right now.",
      }
    default: {
      const exhaustive: never = reason
      void exhaustive
      return {
        kind: "error",
        code: "unknown",
        message: "The AI chat service is unavailable right now.",
      }
    }
  }
}

/**
 * Translate the Mastra-prompt envelope (`{ diff: { scalars, blocks } }`)
 * to the legacy chat-service envelope (`{ mutations: { title,
 * metaDescription, ogImageUrl, blocks } }`). If the input already looks
 * like the legacy shape, pass through.
 *
 * This adapter is the post-rebase U6 schema-alignment work; once the
 * Mastra rewrite owns the full chat pipeline (U10 cutover), one shape
 * will be canonical and this translator goes away.
 */
/**
 * Free-tier LLMs frequently pick natural-English field names that don't
 * match our strict block schemas (e.g. `{ quote: "..." }` instead of
 * `{ text: "..." }` for a bibleQuotesCarousel item). The agent's system
 * prompt names every field, but adherence is imperfect. This pass walks
 * the envelope mutations.blocks tree and rewrites known aliases in
 * place. Mutates `envelope` for simplicity — the caller has the only
 * reference.
 */
function normalizeBlockFieldAliases(envelope: unknown): void {
  if (envelope === null || typeof envelope !== "object") return
  const mutations = (envelope as { mutations?: unknown }).mutations
  if (
    mutations === null ||
    typeof mutations !== "object" ||
    !Array.isArray((mutations as { blocks?: unknown }).blocks)
  ) {
    return
  }
  const blocks = (mutations as { blocks: unknown[] }).blocks
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node === null || typeof node !== "object") return
    const obj = node as Record<string, unknown>
    // bibleQuotesCarousel items: `quote` → `text`. Add more aliases here
    // as failure modes emerge.
    if (typeof obj.quote === "string" && typeof obj.text !== "string") {
      obj.text = obj.quote
      delete obj.quote
    }
    for (const value of Object.values(obj)) {
      walk(value)
    }
  }
  walk(blocks)
}

/**
 * Normalize a scalar that may be diff-shaped (`{ before, after }`) to its
 * flat `.after` value, in place. Bridges models that emit the legacy
 * `mutations` wrapper but with diff-shaped scalar VALUES — the gateway
 * coding model (Qwen) does exactly this, blending the prompt's
 * `diff.scalars` contract with the legacy string contract. Plain strings
 * / null / absent values are left untouched. Mirrors the unwrap in the
 * `{ diff }` branch of `translateMastraEnvelopeToLegacy` so the strict
 * string envelope schema (`experience-ai-chat-envelope.ts`:
 * title/metaDescription are `z.string()`) accepts either convention
 * instead of throwing `invalid_type expected string received object`.
 */
function coerceScalarDiffInPlace(
  target: Record<string, unknown>,
  key: string,
): void {
  const value = target[key]
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "after" in (value as Record<string, unknown>)
  ) {
    target[key] = (value as { after: unknown }).after
  }
}

function translateMastraEnvelopeToLegacy(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== "object") return parsed
  // Some models (and some jsonrepair recoveries) wrap the envelope in a
  // top-level array — e.g. `[{ mutations: ... }]` or two concatenated
  // objects coerced into `[obj1, obj2]`. Pick the first array element
  // that looks like an envelope (has `mutations` or `diff`), otherwise
  // fall back to element 0.
  if (Array.isArray(parsed)) {
    const candidate =
      parsed.find(
        (el) =>
          el !== null &&
          typeof el === "object" &&
          ("mutations" in (el as object) || "diff" in (el as object)),
      ) ?? parsed[0]
    if (candidate === undefined || candidate === null) return parsed
    return translateMastraEnvelopeToLegacy(candidate)
  }
  const obj = parsed as Record<string, unknown>
  if ("mutations" in obj) {
    // Already legacy-shape — but free LLMs often nest the envelope-level
    // `localesAffected` / `reason` siblings INSIDE `mutations`, and
    // mirror-image, sometimes hoist `blocks` OUT of `mutations` up to
    // the envelope level. The strict envelope schema rejects both. Pull
    // them where they belong before validation.
    if (typeof obj.mutations === "object" && obj.mutations !== null) {
      const m = obj.mutations as Record<string, unknown>
      const lifted: Record<string, unknown> = { ...obj }
      const cleaned: Record<string, unknown> = { ...m }
      // Some models (notably the gateway coding model) emit this legacy
      // `mutations` wrapper but with diff-shaped scalar VALUES
      // (`title: { before, after }`). The `{ diff }` branch unwraps those
      // to `.after`; do the same here so the strict string schema accepts
      // the hybrid shape rather than logging event=schema_violation and
      // dropping the edit. Regression-guarded in the service test.
      coerceScalarDiffInPlace(cleaned, "title")
      coerceScalarDiffInPlace(cleaned, "metaDescription")
      if ("localesAffected" in cleaned) {
        if (!("localesAffected" in lifted)) {
          lifted.localesAffected = cleaned.localesAffected
        }
        delete cleaned.localesAffected
      }
      if ("reason" in cleaned) {
        if (!("reason" in lifted)) {
          lifted.reason = cleaned.reason
        }
        delete cleaned.reason
      }
      // Sink envelope-level `blocks` into mutations when mutations
      // doesn't already declare its own block list.
      if ("blocks" in lifted && !("blocks" in cleaned)) {
        cleaned.blocks = lifted.blocks
        delete lifted.blocks
      }
      lifted.mutations = cleaned
      return lifted
    }
    return obj
  }
  if ("diff" in obj && typeof obj.diff === "object" && obj.diff !== null) {
    const diff = obj.diff as Record<string, unknown>
    const scalars = (diff.scalars ?? {}) as Record<string, unknown>
    const mutations: Record<string, unknown> = {}
    if (
      typeof scalars.title === "object" &&
      scalars.title !== null &&
      "after" in (scalars.title as Record<string, unknown>)
    ) {
      mutations.title = (scalars.title as { after: string }).after
    } else if (typeof scalars.title === "string") {
      mutations.title = scalars.title
    }
    if (
      typeof scalars.metaDescription === "object" &&
      scalars.metaDescription !== null &&
      "after" in (scalars.metaDescription as Record<string, unknown>)
    ) {
      mutations.metaDescription = (
        scalars.metaDescription as { after: string | null }
      ).after
    } else if (
      typeof scalars.metaDescription === "string" ||
      scalars.metaDescription === null
    ) {
      mutations.metaDescription = scalars.metaDescription
    }
    if (Array.isArray(diff.blocks)) {
      mutations.blocks = diff.blocks
    }
    return { mutations }
  }
  // Unknown shape — pass through; the downstream Zod check will reject.
  return parsed
}

/**
 * Streaming chat-turn pipeline. See module docstring for the flow.
 */
export async function* streamChatTurn(
  input: StreamChatTurnInput,
  deps: StreamChatTurnDeps,
): AsyncIterable<ChatStreamEvent> {
  const { prisma, user } = deps

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

  const canonicalLocale = thread.experienceLocale

  // ---- ABAC --------------------------------------------------------------
  if (!canEditExperienceLocale(user, canonicalLocale)) {
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

  // Chat edits the same shared aggregate as the dashboard and MCP. Reading
  // canonical relation fields here would make a second chat turn forget the
  // first staged turn until publication.
  const experienceService = new ExperienceService(prisma)
  const { effective: localeRow } = await experienceService.getLocaleDraftState({
    id: canonicalLocale.id,
    user,
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
    select: { role: true, content: true },
    take: 200, // hard ceiling; trimHistory will further bound
  })

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

  // ---- Run chat turn via Mastra -----------------------------------------
  // Mastra is the only chat-turn channel post-convergence. We collect
  // token chunks in a buffer because runMastraChat calls onToken
  // synchronously and the surrounding generator can only yield between
  // awaits.
  const tokenBuffer: string[] = []
  const onToken = (text: string) => {
    tokenBuffer.push(text)
  }

  const runResult = await runMastraChat({
    prompt: promptText,
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
    console.warn(
      "[mastra-chat] event=schema_violation issues=" +
        JSON.stringify(parsed.error.issues) +
        " envelope_keys=" +
        Object.keys((rawEnvelope as object) ?? {}).join(",") +
        " mutations_keys=" +
        Object.keys(
          ((rawEnvelope as { mutations?: object }).mutations as object) ?? {},
        ).join(",") +
        " block_count=" +
        (Array.isArray(
          (rawEnvelope as { mutations?: { blocks?: unknown } }).mutations
            ?.blocks,
        )
          ? (rawEnvelope as { mutations: { blocks: unknown[] } }).mutations
              .blocks.length
          : "n/a"),
    )
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
      console.warn(
        "[mastra-chat] event=cross_locale_blocked current=" +
          localeRow.locale +
          " affected=" +
          envelope.localesAffected.join(",") +
          " confirmed=" +
          String(input.confirmedAcrossLocales),
      )
      yield errorEvent(
        "cross_locale_unconfirmed",
        `Mutation affects locales [${envelope.localesAffected.join(", ")}] — operator must confirm cross-locale write`,
      )
      return
    }
  }

  // ---- Apply via service layer ------------------------------------------
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
    const errMsg = error instanceof Error ? error.message : String(error)
    const errName = error instanceof Error ? error.name : "non-error"
    console.warn(
      "[mastra-chat] event=apply_failed name=" +
        errName +
        " msg=" +
        JSON.stringify(errMsg.slice(0, 800)) +
        " block_count=" +
        (Array.isArray(envelope.mutations.blocks)
          ? envelope.mutations.blocks.length
          : "n/a"),
    )
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
      providerKind: "mastra",
      // Producer id read by the AI chat panel to decide whether the
      // 👍/👎 rating control should render. The send-button flow
      // routes through this default-chat agent, and these replies
      // are now in the ratable set (see
      // `apps/admin/src/services/chat-rating.constants.ts`) so the
      // editor can rate every assistant reply, conversational or
      // mutation-bearing.
      producedBy: "experience-default-chat",
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
  yield {
    type: "done",
    messageId: assistantMessage.id,
    // streamChatTurn always uses the experience-default-chat agent —
    // mirror that constant on the persisted row (see
    // experienceChatMessage.create above) so the panel's stream
    // consumer sees the same value the DB carries.
    producedBy: "experience-default-chat",
  }
}
