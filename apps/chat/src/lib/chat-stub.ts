// The reply-generation seam (feat-205): streamReply routes flag-OFF →
// buildStubReply (never fails) and flag-ON → the /api/seeker SSE proxy (token
// callback + terminal discriminated result). Types live in conversations.ts.

import {
  REPLY_FAILURE_REASONS,
  type MessageEngine,
  type ReplyFailureReason,
  type SeekerSource,
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
        }
        terminal = {
          ok: true,
          text: typeof d.text === "string" ? d.text : full,
          sources: toSources(d.sources),
          grounded: d.grounded === true,
          engine: "seeker",
        }
        return
      }
      if (event === "error") {
        terminal = {
          ok: false,
          reason: toReason((data as { reason?: unknown }).reason),
          partialText: full,
        }
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
