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

import { spawn, type ChildProcessByStdio } from "node:child_process"
import readline from "node:readline"
import type { Readable, Writable } from "node:stream"
import type { PrismaClient } from "@prisma/client"
import { z } from "zod"

import { canEditExperienceLocale } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { ExperienceService } from "@/services/experience.service"
import {
  computeDiff,
  type EditableLocaleState,
  type ExperienceChatDiff,
} from "./experience-chat-diff"
import {
  generateExperienceAiDraft,
  loadExperienceAiVideoCandidates,
} from "./experience-ai.service"
import {
  buildChatPrompt,
  type ChatHistoryTurn,
  type EditableLocaleSummary,
} from "./experience-ai-chat-prompts"

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type ChatErrorCode =
  | "codex_unavailable"
  | "codex_timeout"
  | "codex_idle_timeout"
  | "invalid_json"
  | "schema_violation"
  | "slug_change_rejected"
  | "cross_locale_unconfirmed"
  | "rate_limited"
  | "forbidden"
  | "locale_not_found"
  | "thread_not_found"
  | "cancelled"
  | "empty_response"
  | "unknown"

export type ChatStreamEvent =
  | { type: "token_delta"; text: string }
  | {
      type: "mutation_proposal"
      messageId: string
      diff: ExperienceChatDiff
      draft: EditableLocaleState
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
}

export type StreamChatTurnDeps = {
  prisma: PrismaClient
  user: Principal | null
  abortSignal?: AbortSignal
}

// -----------------------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------------------

// Codex with model_reasoning_effort="medium" can stall for 30-60s before
// emitting the first token. Higher than the one-shot draft path's ceiling on
// purpose — the chat surface is interactive and a low ceiling produces
// noisy idle_timeout errors with no real failure.
const TOTAL_TIMEOUT_MS = 180_000
const IDLE_TIMEOUT_MS = 120_000
const CODEX_CHAT_MODEL = "gpt-5.5"
const CANDIDATE_LIMIT = 8
const EXPLICIT_DRAFT_INTENT_RE =
  /\b(create|draft|generate|build|start|make|compose|write|design)\b.*\b(experience|draft|page|canvas|version)\b|\b(generate|create)\s+(an?\s+)?ai\s+draft\b/i
const DISCOVERY_PROMPT_RE =
  /^\s*(what|which|where|who|why|how)\b|\b(find|search|show|list|suggest)\b.*\b(videos?|candidates?|catalog|library)\b/i

// -----------------------------------------------------------------------------
// Envelope schema
// -----------------------------------------------------------------------------

/**
 * Envelope contract — `.strict()` so any unknown key (including `slug`)
 * is rejected at the schema layer. The route handler logs the rejection
 * code; the service maps `slug` specifically to the more specific
 * `slug_change_rejected` code before falling through to
 * `schema_violation`.
 */
const ChatMutationsSchema = z
  .object({
    title: z.string().optional(),
    metaDescription: z.string().nullable().optional(),
    blocks: z.array(z.unknown()).optional(),
    ogImageUrl: z.string().url().nullable().optional(),
  })
  .strict()

const ChatMutationEnvelopeSchema = z
  .object({
    mutations: ChatMutationsSchema,
    localesAffected: z.array(z.string()).optional(),
    reason: z.string().optional(),
  })
  .strict()

type ChatMutationEnvelope = z.infer<typeof ChatMutationEnvelopeSchema>

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

function errorEvent(code: ChatErrorCode, message: string): ChatStreamEvent {
  return { type: "error", code, message }
}

function isPotentialEnvelopeLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("{") && trimmed.endsWith("}")
}

function tryParseEnvelope(line: string): unknown | null {
  try {
    return JSON.parse(line.trim())
  } catch {
    return null
  }
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

function isFirstDraftPrompt(prompt: string): boolean {
  const trimmed = prompt.trim()
  if (!trimmed) return false
  if (DISCOVERY_PROMPT_RE.test(trimmed)) return false
  if (EXPLICIT_DRAFT_INTENT_RE.test(trimmed)) return true
  // On an empty canvas, most editor prompts are implicitly asking for a
  // first draft. Keep only explicit discovery prompts on the normal chat path.
  return true
}

/**
 * Spawn Codex and consume stdout line-by-line until the terminal JSON
 * envelope arrives (or one of the failure timers fires). Yields
 * `token_delta` for every non-envelope line and resolves with the
 * parsed envelope on success.
 *
 * Caller-provided callbacks (`onToken`) keep this generator-friendly
 * without forcing us to plumb async iterators through the spawn boundary.
 */
type CodexRunResult =
  | { kind: "envelope"; raw: unknown }
  | { kind: "error"; code: ChatErrorCode; message: string }

async function runCodexChat({
  prompt,
  abortSignal,
  onToken,
}: {
  prompt: string
  abortSignal?: AbortSignal
  onToken: (text: string) => void
}): Promise<CodexRunResult> {
  return await new Promise<CodexRunResult>((resolve) => {
    let proc: ChildProcessByStdio<Writable, Readable, Readable>
    try {
      proc = spawn(
        "codex",
        [
          "exec",
          "-m",
          CODEX_CHAT_MODEL,
          "-c",
          'model_reasoning_effort="medium"',
          "--sandbox",
          "read-only",
          "-",
        ],
        {
          env: { ...process.env, LANG: "en_US.UTF-8" },
          stdio: ["pipe", "pipe", "pipe"],
        },
      ) as ChildProcessByStdio<Writable, Readable, Readable>
    } catch (error) {
      resolve({
        kind: "error",
        code: "codex_unavailable",
        message:
          error instanceof Error ? error.message : "codex CLI failed to start",
      })
      return
    }

    let stderrBuf = ""
    let envelope: unknown | null = null
    let sawAnyLine = false
    let settled = false
    const tailLines: string[] = []

    const totalTimer = setTimeout(() => {
      if (settled) return
      settle({
        kind: "error",
        code: "codex_timeout",
        message: `Codex turn timed out after ${TOTAL_TIMEOUT_MS}ms`,
      })
    }, TOTAL_TIMEOUT_MS)

    let idleTimer = setTimeout(() => {
      if (settled) return
      settle({
        kind: "error",
        code: "codex_idle_timeout",
        message: `Codex produced no output for ${IDLE_TIMEOUT_MS}ms`,
      })
    }, IDLE_TIMEOUT_MS)

    function bumpIdle() {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        if (settled) return
        settle({
          kind: "error",
          code: "codex_idle_timeout",
          message: `Codex produced no output for ${IDLE_TIMEOUT_MS}ms`,
        })
      }, IDLE_TIMEOUT_MS)
    }

    function settle(result: CodexRunResult) {
      if (settled) return
      settled = true
      clearTimeout(totalTimer)
      clearTimeout(idleTimer)
      try {
        proc.kill("SIGTERM")
      } catch {
        // ignore — proc may have already exited
      }
      if (abortSignal && abortListener) {
        abortSignal.removeEventListener("abort", abortListener)
      }
      resolve(result)
    }

    const abortListener = abortSignal
      ? () =>
          settle({
            kind: "error",
            code: "cancelled",
            message: "request aborted by client",
          })
      : null

    if (abortSignal && abortListener) {
      if (abortSignal.aborted) {
        abortListener()
        return
      }
      abortSignal.addEventListener("abort", abortListener, { once: true })
    }

    const rl = readline.createInterface({ input: proc.stdout })
    rl.on("line", (line) => {
      sawAnyLine = true
      bumpIdle()
      tailLines.push(line)
      if (tailLines.length > 64) tailLines.shift()

      // Try a multi-line tail-buffer parse first (envelopes can wrap).
      const tail = tailLines.join("\n").trim()
      if (isPotentialEnvelopeLine(tail)) {
        const parsedTail = tryParseEnvelope(tail)
        if (parsedTail !== null) {
          envelope = parsedTail
          settle({ kind: "envelope", raw: envelope })
          return
        }
      }

      // Single-line envelope path (preferred — model is told to emit
      // the envelope on its own final line).
      if (isPotentialEnvelopeLine(line)) {
        const parsed = tryParseEnvelope(line)
        if (parsed !== null) {
          envelope = parsed
          settle({ kind: "envelope", raw: envelope })
          return
        }
      }

      // Otherwise treat as a freeform token chunk.
      onToken(line)
    })

    proc.stderr.on("data", (chunk: Buffer | string) => {
      stderrBuf += chunk.toString()
    })

    proc.on("error", (error: NodeJS.ErrnoException) => {
      if (error?.code === "ENOENT") {
        settle({
          kind: "error",
          code: "codex_unavailable",
          message: "codex CLI is not installed or not available on PATH",
        })
        return
      }
      settle({
        kind: "error",
        code: "codex_unavailable",
        message: error?.message ?? "codex CLI failed to start",
      })
    })

    proc.on("close", (code, signal) => {
      if (settled) return
      // We reached close without a parsed envelope.
      if (!sawAnyLine) {
        settle({
          kind: "error",
          code: "empty_response",
          message: "codex closed stdout without emitting any output",
        })
        return
      }
      if (signal === "SIGTERM") {
        // Already settled paths handle their own message; this is a
        // safety net.
        settle({
          kind: "error",
          code: "codex_timeout",
          message: "codex terminated before emitting an envelope",
        })
        return
      }
      if (code !== 0) {
        const sanitizedStderr = stderrBuf.trim().slice(0, 500)
        settle({
          kind: "error",
          code: "codex_unavailable",
          message:
            sanitizedStderr || `codex exited with status ${code ?? "unknown"}`,
        })
        return
      }
      // Exit 0 but no envelope ever parsed → invalid JSON.
      settle({
        kind: "error",
        code: "invalid_json",
        message: "codex finished without emitting a parseable JSON envelope",
      })
    })

    try {
      proc.stdin.write(prompt)
      proc.stdin.end()
    } catch (error) {
      settle({
        kind: "error",
        code: "codex_unavailable",
        message:
          error instanceof Error ? error.message : "codex stdin write failed",
      })
    }
  })
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

  // ---- Build candidate retrieval (mirrors the one-shot path) ------------
  const candidates = await loadExperienceAiVideoCandidates(prisma, {
    locale: localeRow.locale,
    prompt: input.prompt,
    limit: CANDIDATE_LIMIT,
  })

  // ---- Build prompt ------------------------------------------------------
  const beforeState = toEditableLocaleState({
    title: localeRow.title,
    metaDescription: localeRow.metaDescription,
    ogImageUrl: localeRow.ogImageUrl,
    blocks: localeRow.blocks,
  })

  if (isEmptyCanvas(beforeState) && isFirstDraftPrompt(input.prompt)) {
    let draft
    try {
      draft = await generateExperienceAiDraft(prisma, {
        experienceLocaleId: localeRow.id,
        locale: localeRow.locale,
        prompt: input.prompt,
        user,
        candidateLimit: CANDIDATE_LIMIT,
        experienceId: localeRow.experienceId,
      })
    } catch (error) {
      yield errorEvent(
        "unknown",
        error instanceof Error ? error.message : "Draft generation failed",
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
        content: "Generated a first draft for review.",
        providerKind: "draft-generation",
        snapshotDiff: persistableDiff as unknown as object,
        mutationsApplied: {
          staged: true,
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
    }
    yield { type: "done", messageId: assistantMessage.id }
    return
  }

  const history = await prisma.experienceChatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
    take: 200, // hard ceiling; trimHistory will further bound
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

  // ---- Spawn Codex -------------------------------------------------------
  // The codex fallback gate ALSO guards the chat path. Without the gate
  // we surface `codex_unavailable` immediately so the operator knows
  // why the spawn was skipped — without the gate, prod would otherwise
  // ENOENT loudly on every chat call.
  if (env.EXPERIENCE_AI_ALLOW_CODEX_FALLBACK !== true) {
    yield errorEvent(
      "codex_unavailable",
      "Chat is not configured for this environment (EXPERIENCE_AI_ALLOW_CODEX_FALLBACK is off)",
    )
    return
  }

  // We collect token chunks in a buffer that the generator drains; the
  // codex run is a single `await` so we can't yield from inside a
  // callback. Drain at end-of-run + on settle.
  const tokenBuffer: string[] = []
  const onToken = (text: string) => {
    tokenBuffer.push(text)
  }

  const codexResult = await runCodexChat({
    prompt: promptText,
    abortSignal: deps.abortSignal,
    onToken,
  })

  // Drain any tokens accumulated before settling.
  for (const tok of tokenBuffer) {
    yield { type: "token_delta", text: tok }
  }

  if (codexResult.kind === "error") {
    yield errorEvent(codexResult.code, codexResult.message)
    return
  }

  // ---- Validate envelope -------------------------------------------------
  const rawEnvelope = codexResult.raw

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
      providerKind: "codex",
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

// Re-exports for tests and callers that want the same envelope shape
// the service uses internally.
export {
  ChatMutationEnvelopeSchema,
  ChatMutationsSchema,
  TOTAL_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
}
