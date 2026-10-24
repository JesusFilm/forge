/**
 * The one home for the conversation-id shape (feat-209): a UUID, shared by
 * the `/c/<id>` server route, the client popstate handler, and the anon
 * cookie's trust gate. Pure by contract — NO React and NO server-only
 * imports (client code imports this; `src/auth/anon-id.ts` is transitively
 * server-only, so the import direction is anon-id → conversation-id, never
 * the reverse).
 *
 * COVENANT — tighten only. `isValidAnonId` (the anon-cookie trust gate in
 * `src/auth/anon-id.ts`) is a security-critical consumer of UUID_PATTERN:
 * the sole control deciding whether a client-settable cookie value is
 * trusted as the anon resource. The pattern may only ever be TIGHTENED,
 * never relaxed to admit a new URL id shape — a looser URL id needs its own
 * pattern, not a wider one here.
 */

// Case-insensitive on purpose: deep links may arrive uppercase. Canonical
// form is lowercase — see toConversationId.
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Whether `value` is a well-formed conversation id (UUID shape, any case).
 * Shape check only — consumers that store or compare ids must canonicalize
 * via `toConversationId` first.
 */
export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

/**
 * Validate AND canonicalize: the lowercase conversation id, or null for
 * anything not UUID-shaped. Mastra thread ids and the session's exact-string
 * dedupe are lowercase, so an uppercase deep link must canonicalize here
 * rather than seed a duplicate row.
 */
export function toConversationId(value: unknown): string | null {
  return isConversationId(value) ? value.toLowerCase() : null
}
