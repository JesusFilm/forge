"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

import { streamReply } from "./chat-stub"
import {
  createConversationSession,
  type ConversationSessionSnapshot,
} from "./conversation-session"
import { type Conversation } from "./conversations"
import { fetchHistoryPage, fetchHistoryThread } from "./history-client"

export type UseConversations = {
  /** The FULL conversation list — the sidebar applies its own visible-row
   * projection (`components/shell/sidebar-projection.ts`, Ruling 4b). */
  conversations: Conversation[]
  activeId: string
  activeConversation: Conversation
  draft: string
  pending: boolean
  pendingIds: ReadonlySet<string>
  streamingMessageId: string | null
  history: ConversationSessionSnapshot["history"]
  setDraft: (value: string) => void
  send: (text: string) => void
  stopReply: () => void
  newConversation: () => void
  selectConversation: (id: string) => void
  /** Adopt-or-refuse by server thread id (feat-209 — the popstate path):
   * true when the id is (now) active, false only for an unknown id while
   * history sits in the terminal "denied" phase. */
  adoptConversation: (id: string) => boolean
  retryHistory: () => void
  loadMoreHistory: () => void
  retryReplay: () => void
}

/**
 * Thin React adapter over the conversation session (feat-281): one session
 * instance per hook lifetime (side-effect-free construction, so StrictMode's
 * doubled initializer is harmless), `useSyncExternalStore` for the snapshot,
 * and a mount effect driving `activate`/`deactivate` — under dev StrictMode's
 * setup → cleanup → setup the SAME instance deactivates and re-arms. Both
 * arguments are captured at construction (route-static: `seekerEnabled` is
 * read server-side in page.tsx; `initialConversationId` is feat-209's
 * deep-link seed, lowercased and validated by the /c/[id] route).
 */
export function useConversations(
  seekerEnabled: boolean,
  initialConversationId?: string,
): UseConversations {
  const [session] = useState(() =>
    createConversationSession({
      streamReply,
      fetchHistoryPage,
      fetchHistoryThread,
      seekerEnabled,
      initialConversationId,
    }),
  )

  // The server snapshot is the client session's initial one: ids differ per
  // construction (as with the old useState initializers) but never render.
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )

  useEffect(() => {
    session.activate()
    return () => session.deactivate()
  }, [session])

  return {
    conversations: snapshot.conversations,
    activeId: snapshot.activeId,
    activeConversation: snapshot.activeConversation,
    draft: snapshot.draft,
    pending: snapshot.pending,
    pendingIds: snapshot.pendingIds,
    streamingMessageId: snapshot.streamingMessageId,
    history: snapshot.history,
    setDraft: session.setDraft,
    send: session.send,
    stopReply: session.stopReply,
    newConversation: session.newConversation,
    selectConversation: session.selectConversation,
    adoptConversation: session.adoptConversation,
    retryHistory: session.retryHistory,
    loadMoreHistory: session.loadMoreHistory,
    retryReplay: session.retryReplay,
  }
}
