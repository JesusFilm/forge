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
 * projection gates, OMITTED (never null) otherwise. See resolveDeclaredVideo.
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
// Tool NAMES are imported, not re-declared: the route matches tool-result
// chunks on these exact strings, so a rename in either tool module would
// otherwise break every declaration silently, with no test or log line to
// catch it. Importing the constants (not the tools) keeps the handler free of
// agent imports — the isolation guard's actual concern.
import { FEATURE_VIDEO_TOOL_NAME } from "../tools/feature-video"
import { SEEKER_SEARCH_VIDEOS_TOOL_NAME } from "../tools/seeker-search-videos"
import {
  FEATURABLE_AVAILABILITY_KIND,
  PLAYBACK_ID_PATTERN,
  SLUG_PATTERN,
  VIDEO_ID_PATTERN,
} from "../seeker-video-gates"

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
const RETRIEVE_ANSWER_TOOL_NAME = "retrieveAnswer"

/** A single source as projected onto the wire (KTD4 allowlist). */
type SeekerWireSource = {
  sourceName: string
  title: string | null
  url: string
  score: number
  snippet: string
}

/**
 * The declared video as projected onto the wire (feat-327, plan D9). Exactly
 * these six fields — `toStrictEqual`-pinned. No URL field exists on the wire at
 * all: chat builds the watch URL client-side from the validated slugs.
 */
type SeekerWireVideo = {
  videoId: string
  title: string
  slug: string
  playbackId: string
  durationSeconds: number | null
  languageSlug: string | null
}

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
 * Project a single retrieveAnswer source onto the wire field-by-field (KTD4).
 * Never spreads — a future field added to the tool's source shape cannot
 * silently widen the wire. `snippet` is the tool's already-capped `text`.
 * Returns null when the candidate is not a well-shaped source object.
 */
function projectSource(candidate: unknown): SeekerWireSource | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const s = candidate as {
    text?: unknown
    sourceName?: unknown
    title?: unknown
    url?: unknown
    score?: unknown
  }
  if (typeof s.sourceName !== "string") return null
  if (typeof s.url !== "string") return null
  if (typeof s.score !== "number") return null
  return {
    sourceName: s.sourceName,
    title: typeof s.title === "string" ? s.title : null,
    url: s.url,
    score: s.score,
    snippet: typeof s.text === "string" ? s.text : "",
  }
}

/**
 * Extract `{ sources, grounded }` from the resolved tool results. Reads the
 * LAST `retrieveAnswer` chunk, projects its `result.sources` through the
 * allowlist, and sets `grounded` only when that result's `status === "ok"`.
 * Pure + total: any shape mismatch degrades to `{ sources: [], grounded:false }`.
 */
function extractSources(chunks: SeekerToolResultChunk[]): {
  sources: SeekerWireSource[]
  grounded: boolean
} {
  let last: { result?: unknown } | undefined
  for (const chunk of chunks) {
    if (chunk?.payload?.toolName === RETRIEVE_ANSWER_TOOL_NAME) {
      last = chunk.payload
    }
  }
  if (!last) return { sources: [], grounded: false }
  const result = last.result as { status?: unknown; sources?: unknown }
  const rawSources = Array.isArray(result?.sources) ? result.sources : []
  const sources = rawSources
    .map(projectSource)
    .filter((s): s is SeekerWireSource => s !== null)
  return { sources, grounded: result?.status === "ok" }
}

/**
 * Project one `searchVideos` candidate row onto the wire field-by-field
 * (plan D9). Never spreads, so a future field on the tool's output cannot
 * silently widen the wire, and re-asserts every condition the tool boundary
 * already enforced (belt-and-braces: the route treats tool payloads as
 * untrusted).
 *
 * Returns null — meaning "not featurable" — when the row is not a well-shaped
 * object, when any required string is missing, when `playbackId` or either slug
 * fails its pattern gate, or when `availability.kind` is not `target_audio`
 * (which also fail-closes an unknown/absent kind).
 *
 * D9 SHAPE GATES, shared with the tool boundary (`../seeker-video-gates` —
 * read it for why each pattern is what it is, and for the 2026-08-04
 * production evidence affirming the slug pattern). The tool now drops
 * non-conforming rows too, so in practice these re-checks fire only when a
 * tool payload is not what the route was promised — which is exactly the
 * assumption D9 refuses to make. Sharing the CONSTANTS is not skipping the
 * CHECK: this function re-validates the declared row over an `unknown`
 * payload regardless of what any upstream filter claims to have done.
 *
 * `languageSlug` is nullable: absent is legitimate (chat falls back to the
 * default-language watch URL). But a PRESENT value that fails the slug pattern
 * rejects the whole row rather than degrading to null — a malformed slug is a
 * contract violation, not a missing field.
 */
export function projectVideo(candidate: unknown): SeekerWireVideo | null {
  if (typeof candidate !== "object" || candidate === null) return null
  const v = candidate as {
    videoId?: unknown
    title?: unknown
    slug?: unknown
    playbackId?: unknown
    durationSeconds?: unknown
    languageSlug?: unknown
    availability?: unknown
  }
  if (typeof v.videoId !== "string" || !VIDEO_ID_PATTERN.test(v.videoId)) {
    return null
  }
  if (typeof v.title !== "string" || v.title.length === 0) return null
  if (typeof v.slug !== "string" || !SLUG_PATTERN.test(v.slug)) return null
  if (
    typeof v.playbackId !== "string" ||
    !PLAYBACK_ID_PATTERN.test(v.playbackId)
  ) {
    return null
  }

  const availability = v.availability as { kind?: unknown } | null | undefined
  if (availability?.kind !== FEATURABLE_AVAILABILITY_KIND) return null

  let languageSlug: string | null = null
  if (v.languageSlug != null) {
    if (
      typeof v.languageSlug !== "string" ||
      !SLUG_PATTERN.test(v.languageSlug)
    ) {
      return null
    }
    languageSlug = v.languageSlug
  }

  return {
    videoId: v.videoId,
    title: v.title,
    slug: v.slug,
    playbackId: v.playbackId,
    // Finite and non-negative, not merely `typeof === "number"`: NaN and
    // Infinity both serialize to JSON `null` on the wire — a silent lie about a
    // field the renderer formats — and a negative duration is not a duration.
    durationSeconds:
      typeof v.durationSeconds === "number" &&
      Number.isFinite(v.durationSeconds) &&
      v.durationSeconds >= 0
        ? v.durationSeconds
        : null,
    languageSlug,
  }
}

/**
 * Resolve this turn's featured video from the tool results (feat-327, plan
 * D4/P3).
 *
 * The model DECLARES; it never authors. Resolution is:
 *   1. union every `searchVideos` result row from the turn, keyed by videoId —
 *      both the raw ids the model was shown and their projected,
 *      pattern-gated, target_audio-only counterparts. On a videoId collision a
 *      later call's row replaces an earlier one ONLY when it also projects
 *      successfully; a later row that fails a gate leaves the earlier valid
 *      projection standing rather than downgrading the turn to no video;
 *   2. take the LAST `featureVideo` declaration;
 *   3. attach iff the declared id resolves in the PROJECTED union.
 *
 * Keeping both maps is what makes the failure ladder honest: an id the model
 * never saw (`id_not_in_results`) is a different operator signal from an id it
 * saw whose row failed the gates (`projection_failed`).
 *
 * FAILURE LADDER — every rung attaches nothing and NEVER produces an error
 * frame (plan D4). Logging is enum-only; video ids are catalog data and
 * acceptable, titles and query text are not.
 *   - no declaration            → undefined, no log (the normal case)
 *   - malformed declaration     → reason=malformed
 *   - declared id unseen        → reason=id_not_in_results
 *   - declared row fails gates  → reason=projection_failed
 *
 * Note for operators: `id_not_in_results` also fires on legitimate "show me
 * that one again" turns, because the union is turn-scoped by design —
 * frequency, not existence, is the signal.
 *
 * Pure + total: any shape mismatch degrades to `undefined`.
 */
function resolveDeclaredVideo(
  chunks: SeekerToolResultChunk[],
): SeekerWireVideo | undefined {
  const seenIds = new Set<string>()
  const projected = new Map<string, SeekerWireVideo>()
  let declaration: { result?: unknown } | undefined

  for (const chunk of chunks) {
    const toolName = chunk?.payload?.toolName
    if (toolName === SEEKER_SEARCH_VIDEOS_TOOL_NAME) {
      const result = chunk.payload?.result as { videos?: unknown }
      const rows = Array.isArray(result?.videos) ? result.videos : []
      for (const row of rows) {
        const id = (row as { videoId?: unknown } | null)?.videoId
        if (typeof id === "string" && id.length > 0) seenIds.add(id)
        const video = projectVideo(row)
        // A later call's row replaces an earlier one only when it ALSO
        // projects — a later gate failure never downgrades a turn that already
        // had a valid candidate for that id.
        if (video) projected.set(video.videoId, video)
      }
    } else if (toolName === FEATURE_VIDEO_TOOL_NAME) {
      declaration = chunk.payload
    }
  }

  if (!declaration) return undefined

  const declared = (declaration.result as { videoId?: unknown } | null)?.videoId
  if (typeof declared !== "string" || declared.length === 0) {
    console.warn(
      "[seeker-route] event=video_feature_invalid_declaration reason=malformed",
    )
    return undefined
  }

  const video = projected.get(declared)
  if (video) return video

  const reason = seenIds.has(declared)
    ? "projection_failed"
    : "id_not_in_results"
  console.warn(
    `[seeker-route] event=video_feature_invalid_declaration reason=${reason}`,
  )
  return undefined
}

/**
 * Emit the E7 signal: a turn that used a video tool but never called
 * `retrieveAnswer` (feat-327, plan risk E7).
 *
 * Adding a second tool to this agent is known to disturb single-tool
 * discipline — video turns intermittently skip retrieval and answer faith
 * questions with no grounding and no citations. The plan REQUIRES measuring
 * that skip frequency on the shipped shape before the dogfood roster is
 * exposed, and the durable prompt fix is feat-330. Without a signal, that
 * measurement is eyeballing transcripts; with it, an operator can count the
 * line. `grounded` on the wire cannot substitute — it is also false when
 * retrieval ran and returned empty.
 *
 * Enum-only, zero payload. Silent on turns with no video tool activity, so it
 * costs nothing while the flag is off.
 */
function logUngroundedVideoTurn(chunks: SeekerToolResultChunk[]): void {
  let usedVideoTool = false
  let retrieved = false
  for (const chunk of chunks) {
    const toolName = chunk?.payload?.toolName
    if (
      toolName === SEEKER_SEARCH_VIDEOS_TOOL_NAME ||
      toolName === FEATURE_VIDEO_TOOL_NAME
    ) {
      usedVideoTool = true
    } else if (toolName === RETRIEVE_ANSWER_TOOL_NAME) {
      retrieved = true
    }
  }
  if (usedVideoTool && !retrieved) {
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
          const extracted = extractSources(chunks)
          sources = extracted.sources
          grounded = extracted.grounded
          // feat-327. Naturally inert with SEEKER_VIDEO_ENABLED off: the tools
          // are not registered, so no searchVideos/featureVideo chunks exist —
          // no second flag read that could drift from the agent's.
          video = resolveDeclaredVideo(chunks)
          logUngroundedVideoTurn(chunks)
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
