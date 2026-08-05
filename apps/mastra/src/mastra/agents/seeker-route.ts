/**
 * Streaming seeker route handler (feat-204).
 *
 * Bearer-gated, default-off `POST /forge-seeker`: an internal, server-to-server
 * dogfooding surface that streams the existing `seekerAgent` (feat-198/199). It
 * mirrors `experience-chat-route.ts` but adds two things that template does not:
 *   1. per-session memory keying — `threadId` (required) + optional `resourceId`
 *      threaded into `agent.stream(..., { memory })`; and
 *   2. extraction of the `retrieveAnswer` tool's `sources[]` for the terminal
 *      `result` frame, plus a `grounded` flag.
 *
 * Wire frames (one SSE event each):
 *   - token_delta  { text }                                          — per stream chunk
 *   - result       { text, sources, grounded, producedBy, video? }   — terminal success
 *   - error        { reason }                                        — terminal failure
 *
 * `video` (feat-327) is the OPTIONAL declared-video attachment: present only
 * when this turn's model both searched and declared a pick that survives the
 * projection gates, OMITTED (never null) otherwise. The projections and the
 * declaration ladder live in `./seeker-turn-projection.ts` (feat-329, plan
 * P8), shared with the replay path so the two cannot drift.
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

import { getOpenRouterApiKey } from "../../config/env"
import { refuseUnlessLaneAdmitted } from "../ai-chat-lane-admission"
import { settleWithinBudget, TIME_BUDGET_MS, STEP_CAPS } from "../budgets"
import {
  authorizeAiChatThreadAccess,
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
}

const SEEKER_AGENT_ID = "seekerAgent"
/**
 * Constant `resourceId` supplied whenever a caller omits one (KTD3). Keeps
 * `resourceId` optional to callers while satisfying the runtime memory guard.
 */
export const SEEKER_DEFAULT_RESOURCE_ID = "seeker-dogfood"

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

  // Gate 4 — model-key preflight (R11): before opening the stream / invoking
  // the agent so a missing key is a clean 503, not a mid-stream error frame.
  if (getModelKey() == null) {
    return jsonResponse(503, { reason: "model_key_missing" })
  }

  const agent = getMastra().getAgentById(SEEKER_AGENT_ID) as SeekerStreamAgent

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
      const enqueue = (frame: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(frame))
        } catch {
          // Controller already closed (consumer disconnected) — stop emitting.
          closed = true
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

        output = await agent.stream(prompt, {
          maxSteps: STEP_CAPS.toolCallingTurn,
          abortSignal,
          memory,
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

        enqueue(
          sseFrame("result", {
            text: full,
            sources,
            grounded,
            producedBy: SEEKER_AGENT_ID,
            // OMITTED, never null, when nothing valid was declared (plan D9).
            ...(video ? { video } : {}),
          }),
        )
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
