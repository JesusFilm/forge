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
 * The sidebar-visible projection (feat-270): ordered per orderConversations,
 * minus never-used empty local conversations that are not active — the New
 * action reuses those, so an inactive empty is pure clutter under the
 * identically-labeled action button. The active fresh row stays pinned.
 * Pure — exported for direct unit coverage.
 */
export function listConversations(
  conversations: Conversation[],
  activeId: string,
): Conversation[] {
  return orderConversations(conversations).filter(
    (c) => c.id === activeId || c.origin === "server" || c.messages.length > 0,
  )
}
