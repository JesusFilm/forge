// The sidebar-facing projection module (feat-281, Ruling 4b): what the rail
// actually renders. The session exposes conversation STATE (unprojected);
// visible-row policy lives here, with its consumers.

import { orderConversations } from "@/lib/conversation-session"
import { type Conversation } from "@/lib/conversations"

/** Sidebar-facing server-history list state (feat-241, R12/R16). The session
 * snapshot's `history` field satisfies this shape structurally — the named
 * contract lives here, with the sidebar that consumes it. */
export type HistoryListUi = {
  /** First page in flight — the sidebar skeleton state. */
  loading: boolean
  /** First page failed (transport/5xx) — the error state with retry. */
  error: boolean
  /** More pages exist — render the Load-more control. */
  hasMore: boolean
  /** A Load-more fetch is in flight (inline pending on the control). */
  loadingMore: boolean
  /** The last Load-more failed — inline retry; page-1 rows stay rendered. */
  loadMoreError: boolean
}

/**
 * The sidebar-visible projection (feat-270, extended by feat-401): ordered per
 * orderConversations, minus every never-used empty local conversation — the
 * New action reuses those, so an empty local row is pure clutter under the
 * identically-labeled action button. feat-401 extends that reasoning to the
 * ACTIVE one: an unstarted conversation gets NO row at all, so pressing New no
 * longer grows the list with a second "New conversation" control that vanishes
 * again on the next click. The row appears at the first send, when
 * `messages.length > 0` starts holding.
 *
 * The `origin === "server"` clause is load-bearing (its PRESENCE, not its
 * position — the `||` is side-effect-free): an adopted deep-link row
 * (feat-209) is server-origin with zero messages until its replay lands, and
 * must stay visible while active. Dropping the clause hides every deep link;
 * `sidebar-projection.test.ts` pins it with an ACTIVE fixture.
 *
 * Pure — exported for direct unit coverage.
 */
export function listConversations(
  conversations: Conversation[],
  activeId: string,
): Conversation[] {
  return orderConversations(conversations, activeId).filter(
    (c) => c.origin === "server" || c.messages.length > 0,
  )
}
