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

export type Conversation = {
  id: string
  title: string
  messages: Message[]
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
