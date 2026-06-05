/**
 * Constants shared by the chat-rating service, its REST routes, and
 * the chat panel UI. Centralised so the ratable producer set is a
 * single source of truth — adding a new ratable producer is a
 * one-line edit here.
 */

/**
 * Producer ids (agent / workflow names) whose persisted assistant
 * messages can receive 👍/👎 ratings. Anything outside this set
 * (notably `experience-default-chat`) is treated as non-ratable: the
 * panel does not render the control, and the service rejects writes
 * with `NotRatableError`.
 *
 * Current ratable set is dominated by `multi-step-draft` — the only
 * producer with a user-facing single-click entry point as of v1.
 * The other ids are reserved for the existing specialized agents
 * (`draft-experience`, `add-section`, `rewrite-copy`, `experience-critic`)
 * so future surfaces that expose them as standalone buttons don't
 * need a constants-file edit + migration coordination.
 */
export const RATABLE_PRODUCERS: ReadonlySet<string> = new Set([
  "multi-step-draft",
  // Speed-mode counterpart of multi-step-draft (plan + draft only).
  // Same rating semantics; producer id distinguishes the two so
  // analysis can compare quality across modes.
  "quick-draft",
  "draft-experience",
  "add-section",
  "rewrite-copy",
  "experience-critic",
  // Default chat agent — replies emitted via the send-button path
  // (streamChatTurn → "experience-default-chat"). The original
  // brainstorm carved these out as non-ratable to avoid noise; that
  // decision was reversed at the user's request so every assistant
  // reply (conversational + structured-mutation) can be rated.
  // Historic rows (producedBy IS NULL) still stay non-ratable.
  "experience-default-chat",
])

export function isRatableProducer(
  producedBy: string | null | undefined,
): boolean {
  return (
    producedBy !== null &&
    producedBy !== undefined &&
    RATABLE_PRODUCERS.has(producedBy)
  )
}

/**
 * Upper bound on the optional comment field, enforced at the
 * service-layer boundary. 2,000 characters is generous for a "why
 * the draft is bad" note but small enough that abusive payloads
 * don't bloat Mastra's scores table.
 */
export const CHAT_RATING_COMMENT_MAX_LENGTH = 2_000
