// Stub conversation model. Lives entirely in the client and resets on refresh
// — no persistence until users + a database land. A Conversation is just a
// titled list of messages.

// A single cited passage as it reaches the UI. Mirrors the `/forge-seeker`
// wire shape (SeekerWireSource). All fields are UNTRUSTED (RAG-corpus-originated)
// and the render layer enforces https-only links + text-only rendering.
export type SeekerSource = {
  sourceName: string
  title: string | null
  url: string
  score: number
  snippet: string
}

// Which engine produced an assistant turn (feat-205, R20). Every Seeker-on
// assistant turn is marked so a Seeker answer is never confusable with a stub
// one, and a conversation never silently mixes the two.
export type MessageEngine = "stub" | "seeker"

// The closed set of reply-failure reasons the UI maps to user-facing notices
// (feat-205, R16). The const array is the single source of truth — the type
// derives from it and the seam's runtime guard (KNOWN_REASONS) is built from it.
export const REPLY_FAILURE_REASONS = [
  "timeout",
  "generation_failed",
  "model_key_missing",
  "config_missing",
  "ssrf_blocked",
  "auth_failed",
  "network_error",
  // The proxy rejected the request body (400) — e.g. an over-length prompt.
  // Client-synthesized; distinct from network_error so the notice is accurate.
  "invalid_request",
  "cancelled",
  "parse_error",
  // feat-208 thread-gate rejections from Mastra, passed through verbatim:
  // the conversation belongs to another identity / the per-user thread
  // ceiling was hit. Distinct notices — never fold into generation_failed.
  "thread_forbidden",
  "thread_limit",
  // feat-233: the server-side per-user gate denied seeker; the client seam
  // maps it to the local stub rather than a failure notice.
  "gate_denied",
] as const

export type ReplyFailureReason = (typeof REPLY_FAILURE_REASONS)[number]

/**
 * A chat message. Owned here (not in the stub seam) so it outlives the Mastra
 * swap; the `id`/`role`/`content` core is AI-SDK-aligned. The optional fields
 * are view-only assistant-turn metadata added with the Seeker wiring (feat-205).
 */
export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  // Assistant-turn metadata (absent on user turns and stub-era messages):
  sources?: SeekerSource[]
  grounded?: boolean
  engine?: MessageEngine
  // Set on a failed assistant turn so the UI renders a visible failure notice
  // (R14/R16/R17). Partial streamed text stays in `content`.
  error?: ReplyFailureReason
}

// Where a conversation came from (feat-241): "local" = created this session
// (the pre-241 shape; the field is absent on those too), "server" = hydrated
// from the history listing — its transcript lazy-loads via replay.
export type ConversationOrigin = "local" | "server"

// Per-conversation replay lifecycle (feat-241, KTD11). Single-flight and
// session-cached: loaded/not_available never refetch; failed retries only via
// the explicit retry action. Sends are blocked unless "loaded" (R22).
export type ReplayState =
  | "idle"
  | "loading"
  | "loaded"
  | "failed"
  | "not_available"

export type Conversation = {
  id: string
  title: string
  messages: Message[]
  // feat-241 additive fields (all optional so pre-241 call sites stay valid):
  /** Absent = "local". Server-origin rows skip the deriveTitle retitle branch
   * and gate sends on their replay state (KTD9/KTD11). */
  origin?: ConversationOrigin
  /** KTD10 predicate: true once hydrated from history OR after a send's
   * SUCCESS finalize with engine "seeker" — never from the engine tag alone
   * (the failure branch stamps it on turns that never reached the server).
   * Persisted conversations fail visibly on gate_denied instead of
   * stub-degrading. */
  serverPersisted?: boolean
  /** ISO ordering key: server `updatedAt` at hydration, re-stamped on every
   * send. Also the fallback-label input for untitled threads (R11). */
  lastActivityAt?: string
  /** Replay state — set (starting "idle") on server-origin rows only. */
  replay?: ReplayState
}

export const NEW_CONVERSATION_TITLE = "New conversation"

export function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: NEW_CONVERSATION_TITLE,
    messages: [],
  }
}

// First user message becomes the sidebar title — trimmed to a single line.
export function deriveTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ")
  if (normalized.length <= 40) return normalized
  return `${normalized.slice(0, 39).trimEnd()}…`
}

/**
 * Backfill an untitled (blank) title from a first user turn's text
 * (feat-270): the ONE implementation of "client snippet beats the date
 * fallback" — a non-empty title (client snippet or server LLM) always wins.
 */
export function titleFromFirstUser(
  currentTitle: string,
  firstUserContent: string | undefined,
): string {
  return currentTitle.trim().length === 0 && firstUserContent
    ? deriveTitle(firstUserContent)
    : currentTitle
}

/**
 * Deterministic label for an untitled server thread (R11/AE6): derived from
 * its last-activity date in the user's timezone, e.g. "Conversation — Jul 10",
 * so pre-existing, generation-pending, and generation-failed threads stay
 * distinguishable by date. Unparseable input degrades to the bare noun.
 */
export function fallbackTitle(updatedAt: string): string {
  const parsed = new Date(updatedAt)
  if (Number.isNaN(parsed.getTime())) return "Conversation"
  const label = parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
  return `Conversation — ${label}`
}
