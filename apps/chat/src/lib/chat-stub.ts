// The reply-generation seam (feat-205): streamReply routes flag-OFF →
// buildStubReply (never fails) and flag-ON → the /api/seeker SSE proxy (token
// callback + terminal discriminated result). Types live in conversations.ts.

import {
  buildCanonicalWatchVideoPath,
  DEFAULT_WATCH_LANGUAGE_SLUG,
} from "@forge/watch-url-policy/routes"

import {
  REPLY_FAILURE_REASONS,
  type MessageEngine,
  type ReplyFailureReason,
  type SeekerSource,
  type VideoAttachment,
} from "./conversations"
import { readSseStream } from "./sse"

// Stub latency so the pulse cursor is visible before the (flag-off) reply lands.
export const STUB_REPLY_DELAY_MS = 800

export function buildStubReply(userText: string): string {
  return `Stubbed reply — no agent is connected yet. You said: "${userText}"`
}

/** Discriminated outcome of a reply turn. `partialText` carries whatever
 * streamed before a mid-stream failure (R17). */
export type StreamReplyResult =
  | {
      ok: true
      text: string
      sources: SeekerSource[]
      grounded: boolean
      engine: MessageEngine
      /** The featured video, when the terminal result carried a valid one. */
      video?: VideoAttachment
    }
  | { ok: false; reason: ReplyFailureReason; partialText: string }

/** Inputs to {@link streamReply}: the user text + conversation/thread id, the
 * deployment flag selecting stub vs Seeker, an optional abort signal, a
 * per-token callback, and an injectable fetch for tests. */
export type StreamReplyInput = {
  text: string
  conversationId: string
  seekerEnabled: boolean
  signal?: AbortSignal
  /** Called per streamed token (Seeker path only). */
  onToken?: (text: string) => void
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

const KNOWN_REASONS: ReadonlySet<string> = new Set<ReplyFailureReason>(
  REPLY_FAILURE_REASONS,
)

function toReason(value: unknown): ReplyFailureReason {
  return typeof value === "string" && KNOWN_REASONS.has(value)
    ? (value as ReplyFailureReason)
    : "generation_failed"
}

// Defensive projection of the (untrusted) wire sources into typed shape. The
// render layer additionally enforces the https-only link + text-only guards.
function toSources(value: unknown): SeekerSource[] {
  if (!Array.isArray(value)) return []
  const out: SeekerSource[] = []
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue
    const s = raw as Record<string, unknown>
    if (typeof s.sourceName !== "string" || typeof s.url !== "string") continue
    out.push({
      sourceName: s.sourceName,
      title: typeof s.title === "string" ? s.title : null,
      url: s.url,
      score: typeof s.score === "number" ? s.score : 0,
      snippet: typeof s.snippet === "string" ? s.snippet : "",
    })
  }
  return out
}

// MIRROR of apps/mastra/src/mastra/seeker-video-gates.ts (feat-327; apps can't
// cross-import). Change all three together — but chat may only TIGHTEN: the
// slug gate is the sole control over the raw-interpolated watch path.

// Mux playback ids are opaque tokens; anything outside this alphabet cannot be
// one, and the id is interpolated into the poster/stream URLs (plan D9).
const PLAYBACK_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

// Not interpolated into a URL, but it is the one string the model supplies, so
// it gets a bound rather than being the lone unvalidated hole in a
// field-by-field allowlist — and feat-329 will persist it.
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

// Case-SENSITIVE lowercase-only slug gate (plan D9): the SOLE control over the
// raw-interpolated watch path, security- AND link-integrity-bearing. All 1,154
// PUBLISHED slugs conform (2026-08-04); accented wire slugs have no page.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/

// Watch-page origin + prefix. The PATH always comes from watch-url-policy.
const WATCH_URL_BASE = "https://www.jesusfilm.org/watch"

function isSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_PATTERN.test(value)
}

// The closed reason vocabulary for the rejection log. Tokens ONLY — a wire
// value must never reach a log line (titles are catalog text, and the frame
// rides a special-category conversation).
type VideoRejectReason = "shape" | "video_id" | "title" | "playback_id" | "slug"

// A silent projection makes a producer/consumer wire drift invisible at the
// flag flip. Enum-only; lands in the DOGFOODER'S BROWSER CONSOLE, never
// Railway — chat ships no browser log collector. See apps/chat/CLAUDE.md.
function rejectVideo(reason: VideoRejectReason): undefined {
  console.warn(`[chat-video] event=projection_rejected reason=${reason}`)
  return undefined
}

/**
 * Defensive projection of the (untrusted) wire video into `VideoAttachment`
 * (feat-328). Field-by-field allowlist with pattern gates; any failure on the
 * REQUIRED fields yields `undefined` so the turn simply renders without a
 * player. `watchUrl` is built HERE from the validated slugs — a `watchUrl` (or
 * any other URL) on the wire is ignored, never rendered (plan D9/P7). An
 * absent or invalid `languageSlug` falls back to the default watch language;
 * only the CONTENT slug is a rejection vector.
 */
export function toVideo(value: unknown): VideoAttachment | undefined {
  // Nothing declared is the NORMAL case — the producer omits the field, and
  // that is most turns. Never log it: the diagnostic exists for a value that
  // was actually sent and then failed a gate.
  if (value === undefined || value === null) return undefined
  if (typeof value !== "object" || Array.isArray(value))
    return rejectVideo("shape")
  const v = value as Record<string, unknown>

  // Bind every wire field ONCE: the value that passes the gate must be the
  // same value that gets interpolated, never a second read of the source.
  const { videoId, title, playbackId, slug, durationSeconds: duration } = v
  const rawLanguageSlug = v.languageSlug
  if (typeof videoId !== "string" || !VIDEO_ID_PATTERN.test(videoId))
    return rejectVideo("video_id")
  if (typeof title !== "string" || title.trim().length === 0)
    return rejectVideo("title")
  if (typeof playbackId !== "string" || !PLAYBACK_ID_PATTERN.test(playbackId))
    return rejectVideo("playback_id")
  if (!isSlug(slug)) return rejectVideo("slug")

  const languageSlug = isSlug(rawLanguageSlug)
    ? rawLanguageSlug
    : DEFAULT_WATCH_LANGUAGE_SLUG
  return {
    videoId,
    title,
    playbackId,
    durationSeconds:
      typeof duration === "number" && Number.isFinite(duration) && duration > 0
        ? duration
        : null,
    watchUrl: `${WATCH_URL_BASE}${buildCanonicalWatchVideoPath(slug, languageSlug)}`,
  }
}

// Flag-off path: resolve buildStubReply after a visible delay, abortable.
function streamStubReply(input: StreamReplyInput): Promise<StreamReplyResult> {
  return new Promise((resolve) => {
    const { signal } = input
    if (signal?.aborted) {
      resolve({ ok: false, reason: "cancelled", partialText: "" })
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      // Total: a throw in reply generation resolves to a failure rather than
      // hanging the promise (which would leak the per-conversation slot, since
      // the hook releases it in a finally keyed on this promise settling).
      try {
        resolve({
          ok: true,
          text: buildStubReply(input.text),
          sources: [],
          grounded: false,
          engine: "stub",
        })
      } catch {
        resolve({ ok: false, reason: "generation_failed", partialText: "" })
      }
    }, STUB_REPLY_DELAY_MS)
    const onAbort = () => {
      clearTimeout(timer)
      resolve({ ok: false, reason: "cancelled", partialText: "" })
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

// Flag-on path: POST to the proxy and parse its SSE stream. First terminal frame
// (result or error) wins; any later frame is ignored.
async function streamSeekerReply(
  input: StreamReplyInput,
): Promise<StreamReplyResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl("/api/seeker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        conversationId: input.conversationId,
      }),
      signal: input.signal,
    })
  } catch {
    return {
      ok: false,
      reason: input.signal?.aborted ? "cancelled" : "network_error",
      partialText: "",
    }
  }

  // A 400 is the proxy rejecting our own body (over-length / malformed), NOT a
  // transport failure — surface it as invalid_request so the notice is accurate.
  if (response.status === 400) {
    return { ok: false, reason: "invalid_request", partialText: "" }
  }
  if (!response.ok || response.body == null) {
    return { ok: false, reason: "network_error", partialText: "" }
  }

  let full = ""
  let terminal: StreamReplyResult | null = null
  try {
    await readSseStream(response.body, (event, data) => {
      // Stop feeding tokens once aborted (unmount/disconnect) so no setState
      // fires after teardown, and after the first terminal frame wins.
      if (terminal || input.signal?.aborted) return
      if (event === "token_delta") {
        const t = (data as { text?: unknown }).text
        if (typeof t === "string" && t.length > 0) {
          full += t
          input.onToken?.(t)
        }
        return
      }
      if (event === "result") {
        // Mastra also sends `producedBy`; intentionally not read — engine is
        // fixed to "seeker" here since this path is the only producer of them.
        const d = data as {
          text?: unknown
          sources?: unknown
          grounded?: unknown
          video?: unknown
        }
        terminal = {
          ok: true,
          text: typeof d.text === "string" ? d.text : full,
          sources: toSources(d.sources),
          grounded: d.grounded === true,
          engine: "seeker",
          // Terminal-frame only (plan D3) — no mid-stream video callback exists.
          video: toVideo(d.video),
        }
        return
      }
      if (event === "error") {
        // Every error frame — gate_denied included — is reported truthfully
        // (feat-281, Ruling 3): the SESSION owns the serverPersisted predicate
        // and decides stub-vs-failure. partialText keeps what streamed (R17).
        const reason = toReason((data as { reason?: unknown }).reason)
        terminal = { ok: false, reason, partialText: full }
      }
    })
  } catch {
    if (terminal) return terminal
    return {
      ok: false,
      reason: input.signal?.aborted ? "cancelled" : "network_error",
      partialText: full,
    }
  }

  // Stream ended without a terminal frame. A caller-abort that ends the stream
  // cleanly is `cancelled`, not a protocol violation; otherwise `parse_error`.
  if (terminal) return terminal
  const reason = input.signal?.aborted ? "cancelled" : "parse_error"
  return { ok: false, reason, partialText: full }
}

/** Generate a reply for one turn. Routes to the stub or the Seeker proxy by the
 * deployment-wide flag (passed in from the server-read prop, never read here). */
export function streamReply(
  input: StreamReplyInput,
): Promise<StreamReplyResult> {
  return input.seekerEnabled ? streamSeekerReply(input) : streamStubReply(input)
}
