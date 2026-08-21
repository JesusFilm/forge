/**
 * Streaming seeker route handler (feat-204).
 *
 * Bearer-gated, default-off `POST /forge-seeker`: an internal, server-to-server
 * dogfooding surface that streams the existing `seekerAgent` (feat-198/199). It
 * mirrors `experience-chat-route.ts` but adds three things that template does
 * not:
 *   1. per-session memory keying — `threadId` (required) + optional `resourceId`
 *      threaded into `agent.stream(..., { memory })`;
 *   2. extraction of the `retrieveAnswer` tool's `sources[]` for the terminal
 *      `result` frame, plus a `grounded` flag; and
 *   3. Langfuse trace routing (feat-321) — every send stamps the per-process
 *      tracing marker plus session/user/prompt-provenance metadata via
 *      `buildSeekerTracingCallOptions`, so enabled deployments export the
 *      turn's raw trace to Langfuse (see `../langfuse-tracing.ts`).
 *
 * Wire frames (one SSE event each):
 *   - token_delta  { text }                                                      — per stream chunk
 *   - result       { text, sources, grounded, producedBy, video?, followUps? }   — terminal success
 *   - error        { reason }                                                    — terminal failure
 *
 * `video` (feat-327) is the OPTIONAL declared-video attachment: present only
 * when this turn's model both searched and declared a pick that survives the
 * projection gates, OMITTED (never null) otherwise. The projections and the
 * declaration ladder live in `./seeker-turn-projection.ts` (feat-329, plan
 * P8), shared with the replay path so the two cannot drift.
 *
 * `followUps` (feat-366) is the OPTIONAL suggested-follow-up-questions list:
 * present only on a flag-on, grounded, substantive turn whose post-hoc
 * generation produced at least one valid question inside its budget, OMITTED
 * (never null or empty) otherwise. The body also accepts the optional
 * closed-vocabulary `promptSource` click-source tag (KTD11 — invalid or
 * unknown values read as absent, never a 400).
 *
 * Defense-in-depth gates, checked in order: the shared lane admission
 * preamble (`refuseUnlessLaneAdmitted`, feat-283 — enable flag (KTD7) → 404,
 * then the ai-chat lane bearer (R5, feat-250) → 401, with key sourcing inside
 * that module) → body validation (R2) → model-key preflight (R11) → thread
 * ownership + creation ceiling (feat-208; in-stream `thread_forbidden` /
 * `thread_limit` error frames) → stream. The route is MORE locked down than
 * Mastra's built-in unauthenticated `/api/agents/*` surface; it adds no CORS
 * (R6).
 *
 * Memory contract (KTD3): a memory-configured agent throws
 * `AGENT_MEMORY_MISSING_RESOURCE_ID` at runtime if a `threadId` is supplied
 * without a `resourceId` (the `.d.ts` marks `resource?` optional, but the
 * compiled runtime guards it as required). So the route ALWAYS supplies a
 * `resource`: the caller's `resourceId` when present, else the constant
 * `SEEKER_DEFAULT_RESOURCE_ID`. `resourceId` stays optional + opaque to callers
 * (R8); isolation rides on `threadId`.
 *
 * Logging is ENUM-only plain-string `[seeker-route] event=… reason=…` (KTD6) —
 * never `JSON.stringify` (Railway logsV2 silences it) and never raw
 * exception/RAG text interpolated as `key=value` (log injection). No
 * `error.message` reaches the wire — error frames carry a fixed-vocabulary
 * `reason` only (R12).
 */

import type { RequestContext } from "@mastra/core/di"

import { getOpenRouterApiKey, isSeekerFollowUpsEnabled } from "../../config/env"
import {
  getManagedPrompt,
  type ManagedPromptResult,
} from "../../services/langfuse-prompt-client"
import { refuseUnlessLaneAdmitted } from "../ai-chat-lane-admission"
import {
  buildFollowUpsTracingCallOptions,
  buildSeekerTracingCallOptions,
} from "../langfuse-tracing"
import {
  FOLLOW_UPS_GENERATION_BUDGET_MS,
  shouldGenerateFollowUps,
} from "../seeker-follow-ups"
import {
  generateSeekerFollowUps,
  registerFollowUpsMastra,
  type FollowUpsGenerationOutcome,
} from "../seeker-follow-ups-generate"
import {
  persistSeekerFollowUps,
  type FollowUpsPersistMemory,
  type FollowUpsPersistOutcome,
} from "../seeker-follow-ups-persist"
import {
  SEEKER_SYSTEM_PROMPT_FALLBACK,
  SEEKER_SYSTEM_PROMPT_NAME,
} from "./seeker-agent"
import { settleWithinBudget, TIME_BUDGET_MS, STEP_CAPS } from "../budgets"
import {
  authorizeAiChatThreadAccess,
  SEEKER_DEFAULT_RESOURCE_ID,
  type AiChatOwnershipMemory,
} from "../ai-chat-thread-ownership"
import { aiChatMemoryConfigFor, getAiChatMemory } from "../ai-chat-memory"
// The projections + declaration ladder live in the shared module (feat-329,
// plan P8) so the REPLAY path resolves attachments identically. This route
// owns only the adapter down to `SeekerToolChunk` and the operator logging.
import {
  resolveTurnAttachments,
  type SeekerToolChunk,
  type SeekerTurnAttachments,
  type SeekerWireSource,
  type SeekerWireVideo,
} from "./seeker-turn-projection"

// Narrow structural surface of the seeker agent's streaming API (avoids
// fighting the generic Agent.stream signature; the runtime contract is
// textStream + toolResults). `resource` is ALWAYS set — see KTD3. `options`
// carries the per-call memory-config override (feat-241: titling scope).
type SeekerToolResultChunk = {
  payload?: { toolName?: string; result?: unknown }
}
type SeekerStreamOutput = {
  textStream: ReadableStream<string>
  toolResults: Promise<SeekerToolResultChunk[]>
  /** Plain fields on the pinned core's stream output (feat-366, KTD10) —
   * threaded into the follow-ups generator for same-trace joining (KTD9). */
  traceId?: string
  spanId?: string
}
type SeekerStreamAgent = {
  stream: (
    prompt: string,
    opts: {
      maxSteps?: number
      abortSignal?: AbortSignal
      memory?: {
        thread: string
        resource: string
        options?: { generateTitle?: boolean }
      }
      /** Routes this run's trace to the Langfuse observability config (feat-321). */
      requestContext?: RequestContext
      /** Root-span metadata: Langfuse session/user/prompt-version stamps (feat-321). */
      tracingOptions?: { metadata?: Record<string, unknown> }
    },
  ) => Promise<SeekerStreamOutput> | SeekerStreamOutput
}

export type SeekerRouteMastra = {
  getAgentById: (id: string) => unknown
}

export type SeekerRouteHandlerInput = {
  authHeader: string | null | undefined
  readJson: () => Promise<unknown>
  getMastra: () => SeekerRouteMastra
  /** Inbound request signal — aborts the agent run when the caller disconnects. */
  requestSignal?: AbortSignal
  /** Seam: model-key preflight (R11). Defaults to `getOpenRouterApiKey`. */
  getModelKey?: () => string | undefined
  /** Seam: enable-gate (KTD7). Defaults to the admission module's flag. */
  getEnabled?: () => boolean
  /**
   * Seam: the lane bearer allowlist (feat-283). Defaults to the admission
   * module's lane-CSV source (`AI_CHAT_SERVICE_API_KEYS` — never the shared
   * pool, feat-250); the registration in index.ts passes nothing.
   */
  getServiceKeys?: () => readonly string[]
  /**
   * Seam: the Memory instance backing the thread-ownership gate (feat-208).
   * Defaults to the shared ai-chat memory (the same instance the agent
   * writes through, so the gate and the write path cannot diverge).
   */
  getMemory?: () => AiChatOwnershipMemory
  /**
   * Seam: internal per-turn wall-clock budget in ms (R9). Defaults to
   * `TIME_BUDGET_MS.chatTurn` (90s). Overridable so the timeout-reason branch
   * is deterministically testable without faking `AbortSignal.timeout`.
   */
  budgetMs?: number
  /**
   * Seam: prompt provenance for the trace metadata stamp (feat-321).
   * Defaults to the real `getManagedPrompt` read of `seeker-system` — the
   * same cache entry the agent's own instructions resolver uses, so the
   * stamped version agrees with the served prompt except across a
   * TTL-boundary refresh mid-turn (accepted; post-hoc attribution, not
   * detection — feat-272 item 5). `getManagedPrompt` never throws. The
   * registration in index.ts passes nothing; the seam exists so tests can
   * pin the langfuse/fallback/stale metadata branches deterministically.
   */
  getPromptProvenance?: () => Promise<ManagedPromptResult>
  /**
   * Seam: the follow-ups flag (feat-366, KTD8). Defaults to the real env
   * accessor; the registration in index.ts passes nothing. Gates the WRITE
   * side only — replay reads no flag (KD1).
   */
  getFollowUpsEnabled?: () => boolean
  /**
   * Seam: post-hoc follow-up generation (feat-366, KTD5/KTD6). Defaults to
   * the real module, whose internal race enforces the budget this route
   * derives (`min(2.5s, remaining turn budget)`).
   */
  generateFollowUps?: (input: {
    question: string
    answer: string
    budgetMs: number
    turnSignal?: AbortSignal
    requestContext?: RequestContext
    tracingOptions?: {
      metadata?: Record<string, unknown>
      traceId?: string
      parentSpanId?: string
    }
  }) => Promise<FollowUpsGenerationOutcome>
  /**
   * Seam: the bounded metadata persist (feat-366, KTD2/KTD6). The default
   * closure supplies the shared ai-chat Memory; the input deliberately
   * carries NO signal — the write must survive the proxy's normal
   * post-terminal-frame abort.
   */
  persistFollowUps?: (input: {
    threadId: string
    resourceId: string
    questions: string[]
    /** Turn identity for the carrier scan, LOWER bound — a lagging store
     * retries rather than writing onto the previous turn's answer. */
    turnStartedAtMs: number
    /** Turn identity for the carrier scan, UPPER bound — captured just before
     * the call, so a NEWER turn's answer can never be written onto. */
    turnEndedAtMs: number
  }) => Promise<FollowUpsPersistOutcome>
}

const SEEKER_AGENT_ID = "seekerAgent"
/**
 * Constant `resourceId` supplied whenever a caller omits one (KTD3). Keeps
 * `resourceId` optional to callers while satisfying the runtime memory guard.
 *
 * Relocated to `../ai-chat-thread-ownership` (feat-337 U1) — the module that
 * owns the resource contract — so `ai-chat-erasure.ts` can refuse this exact
 * key without importing THIS module (whose module-scope `buildSeekerAgent()`
 * would eagerly construct the seeker agent and its kill-switch-resolved
 * Memory). Re-exported here so existing importers and test pins are unchanged.
 */
export { SEEKER_DEFAULT_RESOURCE_ID }

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/**
 * Body guard (R2). Requires non-empty string `prompt` AND non-empty string
 * `threadId`. `resourceId` is accepted only as a non-empty string; absent or
 * empty is treated as not provided (never rejected — R8).
 */
function isSeekerBody(
  value: unknown,
): value is { prompt: string; threadId: string; resourceId?: string } {
  if (typeof value !== "object" || value === null) return false
  const v = value as {
    prompt?: unknown
    threadId?: unknown
    resourceId?: unknown
  }
  if (typeof v.prompt !== "string" || v.prompt.length === 0) return false
  if (typeof v.threadId !== "string" || v.threadId.length === 0) return false
  // R8: a present resourceId must be a string, but an empty string is NOT a
  // rejection — it is normalized to "not provided" at the memory-build step
  // (falls back to SEEKER_DEFAULT_RESOURCE_ID), exactly like an absent field.
  if (v.resourceId !== undefined && typeof v.resourceId !== "string") {
    return false
  }
  return true
}

/**
 * Send-path adapter (plan P8): normalize this turn's `toolResults` chunks —
 * `{ payload: { toolName, result } }` — into the shared module's
 * `{ toolName, result }`. Chunks with no string tool name are dropped; the
 * replay route supplies its own adapter over its own stored shape.
 */
function toTurnChunks(chunks: SeekerToolResultChunk[]): SeekerToolChunk[] {
  const normalized: SeekerToolChunk[] = []
  for (const chunk of chunks) {
    const toolName = chunk?.payload?.toolName
    if (typeof toolName === "string") {
      normalized.push({ toolName, result: chunk.payload?.result })
    }
  }
  return normalized
}

/**
 * Emit this turn's operator lines from the resolved attachments (feat-327).
 *
 * The declaration ladder and the E7 signal are RESOLVED in the shared module
 * and LOGGED here, because only the live path should speak: replay re-resolves
 * every stored turn on every thread open, and those rejections were already
 * logged when the turn ran.
 *
 * `video_turn_missing_retrieval` is the E7 signal — a turn that used a video
 * tool but never called `retrieveAnswer`, answering a faith question with no
 * grounding and no citations. The plan REQUIRES measuring that skip frequency
 * on the shipped shape; `grounded` on the wire cannot substitute, since it is
 * also false when retrieval ran and returned empty.
 *
 * Enum-only: video ids are catalog data and acceptable, titles and query text
 * are not.
 */
function logTurnAttachments(attachments: SeekerTurnAttachments): void {
  if (attachments.videoRejection) {
    console.warn(
      `[seeker-route] event=video_feature_invalid_declaration reason=${attachments.videoRejection}`,
    )
  }
  if (attachments.ungroundedVideoTurn) {
    console.warn("[seeker-route] event=video_turn_missing_retrieval")
  }
}

export async function handleSeekerRouteRequest({
  authHeader,
  readJson,
  getMastra,
  requestSignal,
  getModelKey = getOpenRouterApiKey,
  getEnabled,
  getServiceKeys,
  getMemory = () => getAiChatMemory(),
  budgetMs = TIME_BUDGET_MS.chatTurn,
  getPromptProvenance = () =>
    getManagedPrompt({
      name: SEEKER_SYSTEM_PROMPT_NAME,
      fallback: SEEKER_SYSTEM_PROMPT_FALLBACK,
    }),
  // feat-366 defaults — each is the one-line production revert surface the
  // default-source pin in the suite guards.
  getFollowUpsEnabled = isSeekerFollowUpsEnabled,
  generateFollowUps = generateSeekerFollowUps,
  persistFollowUps = (input) =>
    persistSeekerFollowUps({
      // The shared ai-chat Memory satisfies the persist module's structural
      // surface (recall + updateMessages) — same instance the agent writes
      // through, so the carrier scan reads what the turn just stored.
      memory: getAiChatMemory() as unknown as FollowUpsPersistMemory,
      ...input,
    }),
}: SeekerRouteHandlerInput): Promise<Response> {
  // Gates 1–2 — the shared lane admission preamble (feat-283): enable flag
  // FIRST (KTD7, 404 — no bearer check, no body read, no agent lookup when
  // disabled), then the ai-chat lane bearer (R5, 401), keys sourced inside
  // the admission module (feat-250: never the shared pool).
  const refusal = refuseUnlessLaneAdmitted({
    authHeader,
    getEnabled,
    getServiceKeys,
  })
  if (refusal) return jsonResponse(refusal.status, refusal.body)

  // Gate 3 — body validation (R2).
  const raw = await readJson().catch(() => undefined)
  if (!isSeekerBody(raw)) {
    return jsonResponse(400, { error: "prompt and threadId are required" })
  }
  const { prompt, threadId, resourceId } = raw
  // Click-source tag (feat-366, KTD11): optional, closed-vocabulary at every
  // hop — an absent, unknown, or non-string value reads as the non-chip
  // default `typed`, NEVER a 400. Logged as `prompt_source=` (flag-on turns)
  // and trace-stamped as `sendOrigin` (flag-independent — a different key
  // from the provenance `promptSource`; the tracing suite pins them apart).
  const sendOrigin: "follow_up" | "typed" =
    (raw as { promptSource?: unknown }).promptSource === "follow_up"
      ? "follow_up"
      : "typed"

  // Gate 4 — model-key preflight (R11): before opening the stream / invoking
  // the agent so a missing key is a clean 503, not a mid-stream error frame.
  if (getModelKey() == null) {
    return jsonResponse(503, { reason: "model_key_missing" })
  }

  const mastraInstance = getMastra()
  const agent = mastraInstance.getAgentById(
    SEEKER_AGENT_ID,
  ) as SeekerStreamAgent

  // Memory keying (KTD3): `resource` is ALWAYS set — the runtime guard requires
  // it whenever the agent has memory attached. `resourceId` stays opaque (R8).
  // An absent OR empty-string `resourceId` normalizes to the constant default.
  const resource =
    resourceId && resourceId.length > 0
      ? resourceId
      : SEEKER_DEFAULT_RESOURCE_ID
  // Titling scope (feat-241, KTD12): signed-in-only. The per-call policy —
  // `options: { generateTitle: false }` for non-`user:` resources — lives
  // beside the title model in the lane memory module (feat-285).
  const memory = aiChatMemoryConfigFor(threadId, resource)

  // Compose the inbound request signal with the internal turn budget so EITHER
  // a client disconnect or the 90s ceiling aborts the agent run (R9, R10).
  // `turnStartedAt` anchors the follow-ups deadline derivation (KTD6):
  // effective generation budget = min(2.5s, remaining turn budget), so the
  // terminal frame always lands inside the ceiling chat's proxy timeout was
  // sized against.
  const turnStartedAt = Date.now()
  const budgetSignal = AbortSignal.timeout(budgetMs)
  const abortSignal = requestSignal
    ? AbortSignal.any([requestSignal, budgetSignal])
    : budgetSignal

  const encoder = new TextEncoder()
  let reader: ReadableStreamDefaultReader<string> | null = null
  // Hoisted to the start/cancel scope so the outer catch and cancel() can settle
  // a still-pending `toolResults` promise. If the textStream drain throws, control
  // jumps to the outer catch BEFORE the inner `await output.toolResults`, leaving
  // that promise unawaited — a later rejection would then escape as an unhandled
  // rejection (there is no global handler). Settling it on those paths prevents it.
  let output: SeekerStreamOutput | null = null
  // Guards against enqueue/close on an already-closed controller. A consumer
  // can cancel mid-drain or during the `toolResults` await; without this the
  // terminal-frame enqueue (or the finally close) throws from inside start()
  // and surfaces as an unhandled rejection. `cancel()` and a failed enqueue
  // both flip it, so every later enqueue and the close short-circuit cleanly.
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Returns whether the frame actually landed on the controller — the
      // follow-ups persist gate reads this for the TERMINAL frame (KTD6: an
      // emitted flag captured at enqueue time, never a closed-now check,
      // because the proxy closes the stream right after relaying the frame
      // on every NORMAL turn).
      const enqueue = (frame: string): boolean => {
        if (closed) return false
        try {
          controller.enqueue(encoder.encode(frame))
          return true
        } catch {
          // Controller already closed (consumer disconnected) — stop emitting.
          closed = true
          return false
        }
      }
      try {
        // Gate 5 — thread ownership + creation ceiling (feat-208). Mastra's
        // message path silently adopts an existing thread regardless of the
        // caller's resource, so this check is the ONLY thing binding threadId
        // to its owner. Fail modes differ by branch (see the
        // authorizeAiChatThreadAccess docstring): ownership fails CLOSED
        // (getThreadById throws → this outer catch → generation_failed), while
        // the creation-ceiling check fails OPEN (listThreads swallows → total 0
        // → new thread allowed) — an accepted soft-cap gap backstopped by the
        // retention purge, never the access boundary.
        const authz = await settleWithinBudget(
          authorizeAiChatThreadAccess({
            memory: getMemory(),
            threadId: memory.thread,
            resource: memory.resource,
          }),
          budgetSignal,
        )
        if (!authz.ok) {
          console.warn(
            `[seeker-route] event=thread_access_rejected reason=${authz.reason}`,
          )
          enqueue(sseFrame("error", { reason: authz.reason }))
          return
        }

        // Langfuse tracing (feat-321): the marker-stamped RequestContext plus
        // prompt-provenance metadata, assembled by the tracing module. When
        // tracing is disabled the marker matches no registered config and the
        // run stays on the redacted default — safe to stamp unconditionally.
        // `getPromptProvenance` never rejects (managed-prompt no-throw union).
        const tracing = buildSeekerTracingCallOptions({
          promptName: SEEKER_SYSTEM_PROMPT_NAME,
          promptProvenance: await getPromptProvenance(),
          resource: memory.resource,
          thread: memory.thread,
          // KTD11: stamped flag-INDEPENDENTLY — the tag is analytics for
          // every turn, not a follow-ups feature switch.
          sendOrigin,
        })

        output = await agent.stream(prompt, {
          maxSteps: STEP_CAPS.toolCallingTurn,
          abortSignal,
          memory,
          requestContext: tracing.requestContext,
          tracingOptions: tracing.tracingOptions,
        })
        reader = output.textStream.getReader()
        let full = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (typeof value === "string" && value.length > 0) {
            full += value
            enqueue(sseFrame("token_delta", { text: value }))
          }
        }

        // Tool-result extraction is isolated: a rejected `toolResults` promise
        // (or a malformed shape) AFTER a successful textStream drain degrades
        // to an ungrounded, video-less `result` — never an `error` frame for an
        // otherwise-good generation (KTD4, and plan D4 for the video half).
        let sources: SeekerWireSource[] = []
        let grounded = false
        let video: SeekerWireVideo | undefined
        try {
          const chunks = await output.toolResults
          // feat-329: projections + ladder come from the shared module so the
          // replay path resolves identically; this route owns only the adapter
          // and the operator logging. Naturally inert with SEEKER_VIDEO_ENABLED
          // off — the tools are not registered, so no searchVideos/featureVideo
          // chunks exist and no second flag read can drift from the agent's.
          // NOTE: `attachments.followUps` is deliberately unread here — the
          // projection populates it only on the REPLAY path (from stored
          // metadata); the live frame's followUps come from the generation
          // outcome below, already validated by the same projectFollowUps.
          const attachments = resolveTurnAttachments(toTurnChunks(chunks))
          sources = attachments.sources
          grounded = attachments.grounded
          video = attachments.video
          logTurnAttachments(attachments)
        } catch {
          console.warn(
            "[seeker-route] event=tool_results_extraction_failed reason=extraction_failed",
          )
        }

        // ── Suggested follow-up questions (feat-366, KTD5–KTD7) ─────────────
        // Generation runs BETWEEN extraction and the terminal enqueue — the
        // chat proxy aborts upstream the moment it relays a terminal frame,
        // so there is no later frame to ride (KTD1); the budget below bounds
        // the delay this adds. Structural containment: the REGISTRATION and
        // GENERATION calls sit in their own try/catch so no throw — sync or
        // async — can reach the drain loop's catch and turn a streamed
        // answer into an error frame. (The flag read and the suppression
        // gate sit outside it: both are pure reads over already-parsed
        // values, with nothing to contain.)
        const followUpsEnabled = getFollowUpsEnabled()
        let followUps: string[] = []
        let generation: FollowUpsGenerationOutcome | null = null
        let generationMs = 0
        // Why the generator produced no outcome, when it produced none. The
        // three causes are operationally different — a suppressed turn, a
        // departed consumer, and a seam that threw are not the same event —
        // so they must not collapse into one literal (review, 2026-08-20).
        // Overwritten only on the containment-catch path; unread when
        // `generation` is non-null.
        let generationNotRunReason:
          | "gate_skipped"
          | "stream_closed"
          | "unexpected_error" = "gate_skipped"
        // The `!closed` check is the no-paid-call-for-an-absent-audience gate
        // (KTD6): a consumer cancel mid-drain makes the reader report done
        // with a PARTIAL answer while every later enqueue silently no-ops.
        // `!abortSignal.aborted` is its sibling for the OTHER disconnect
        // shape: a request-signal abort landing between drain completion and
        // this gate (the cancel() callback may not have flipped `closed`
        // yet). The generator survives an already-aborted signal — the
        // settleWithinBudget fast path settles the seam promise — but there
        // is no reason to start a paid call for an aborted turn at all.
        if (closed || abortSignal.aborted) {
          generationNotRunReason = "stream_closed"
        }
        if (
          followUpsEnabled &&
          !closed &&
          !abortSignal.aborted &&
          shouldGenerateFollowUps({ grounded, answer: full })
        ) {
          try {
            // Span emission needs the runtime Mastra reference (KTD5/KTD9);
            // one-time latch, never throws.
            registerFollowUpsMastra(mastraInstance)
            const remainingMs = budgetMs - (Date.now() - turnStartedAt)
            const followUpsTracing = buildFollowUpsTracingCallOptions({
              resource: memory.resource,
              thread: memory.thread,
              turnTraceId: output.traceId,
              turnSpanId: output.spanId,
            })
            const generationStartedAt = Date.now()
            generation = await generateFollowUps({
              question: prompt,
              answer: full,
              budgetMs: Math.min(FOLLOW_UPS_GENERATION_BUDGET_MS, remainingMs),
              turnSignal: abortSignal,
              requestContext: followUpsTracing.requestContext,
              tracingOptions: followUpsTracing.tracingOptions,
            })
            generationMs = Date.now() - generationStartedAt
            followUps = generation.questions
          } catch {
            // R5: every generation failure degrades to no chips — never an
            // error frame, and never a logged error object (R9).
            generation = null
            generationNotRunReason = "unexpected_error"
            followUps = []
          }
        }

        // The persist gate consumes THIS return value (KTD6): the terminal
        // frame either landed on the controller or it did not, decided at
        // enqueue time.
        const resultEmitted = enqueue(
          sseFrame("result", {
            text: full,
            sources,
            grounded,
            producedBy: SEEKER_AGENT_ID,
            // OMITTED, never null, when nothing valid was declared (plan D9).
            ...(video ? { video } : {}),
            // OMITTED, never null, when there is nothing to show (R7).
            ...(followUps.length > 0 ? { followUps } : {}),
          }),
        )

        // ── Best-effort persist, AFTER the frame (KTD2/KTD6) ────────────────
        // Deliberately NOT composed with the request signal: the proxy aborts
        // upstream immediately after relaying the terminal frame on every
        // normal turn, and live and replay must never disagree (AE3). A frame
        // that never landed persists nothing (`undelivered`); a race loss or
        // empty generation stores nothing (`skipped`).
        if (followUpsEnabled) {
          let persistOutcome:
            | "skipped"
            | "undelivered"
            | FollowUpsPersistOutcome = "skipped"
          if (followUps.length > 0) {
            if (!resultEmitted) {
              persistOutcome = "undelivered"
            } else {
              try {
                persistOutcome = await persistFollowUps({
                  threadId: memory.thread,
                  resourceId: memory.resource,
                  questions: followUps,
                  turnStartedAtMs: turnStartedAt,
                  // Captured HERE, not at turn start: it is the carrier
                  // scan's upper bound, and every row this turn wrote is
                  // already stamped by now.
                  turnEndedAtMs: Date.now(),
                })
              } catch {
                persistOutcome = "store_failed"
              }
            }
          }
          // Counts, enums, timings, and token counts ONLY (R9) — `mode=post`
          // is the mechanism label surviving the retired prototype enum.
          // `gen_reason` is a closed vocabulary: `ok` on a question-bearing
          // success, the generator's own reason when it ran and produced
          // none, and otherwise WHICH of the three no-run causes applied —
          // `gate_skipped` (flag off or the suppression gate), `stream_closed`
          // (consumer gone before the call), `unexpected_error` (containment
          // catch). Collapsing those three would cost the operator the one
          // key that tells a gate skip from a timeout from a junk reply, and
          // it is what calibrates the provisional retry after the flip.
          console.info(
            `[seeker-follow-ups] event=turn_resolved mode=post prompt_source=${sendOrigin} count=${followUps.length} gen_reason=${generation === null ? generationNotRunReason : (generation.reason ?? "ok")} added_ms=${generationMs} persist=${persistOutcome} gen_tokens_in=${generation?.tokensIn ?? -1} gen_tokens_out=${generation?.tokensOut ?? -1} total_ms=${Date.now() - turnStartedAt}`,
          )
        }
      } catch {
        // If the textStream drain threw, `output.toolResults` was never awaited
        // (the extraction try is downstream of the drain). Settle it so a later
        // rejection cannot escape as an unhandled rejection.
        void output?.toolResults.catch(() => {})
        // R12 + KTD6: fixed-vocabulary reason only — no raw text on the wire or
        // interpolated into the log as `key=value`.
        const reason = budgetSignal.aborted ? "timeout" : "generation_failed"
        console.warn(`[seeker-route] event=stream_error reason=${reason}`)
        enqueue(sseFrame("error", { reason }))
      } finally {
        if (!closed) {
          try {
            controller.close()
          } catch {
            // Already closed by a concurrent cancel — nothing to do.
          }
          closed = true
        }
      }
    },
    cancel() {
      // Caller disconnected → mark closed so in-flight enqueues stop, and cancel
      // the agent's textStream so the run stops burning provider/tool calls
      // (R10, leg 2).
      closed = true
      void reader?.cancel().catch(() => {})
      // Belt-and-suspenders: if cancel races such that the drain loop exits
      // without reaching the toolResults await, settle the promise so it cannot
      // reject unhandled.
      void output?.toolResults.catch(() => {})
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}
