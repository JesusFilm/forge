"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

import { streamReply } from "./chat-stub"
import {
  createConversationSession,
  type HistoryListUi,
} from "./conversation-session"
import { type Conversation } from "./conversations"
import { fetchHistoryPage, fetchHistoryThread } from "./history-client"

// The machines live in conversation-session.ts (feat-281); these re-exports
// keep the pre-extraction import surface stable for consumers and tests.
export {
  listConversations,
  mergeReplayMessages,
  mergeServerThreads,
  orderConversations,
  type HistoryListUi,
} from "./conversation-session"

export type UseConversations = {
  conversations: Conversation[]
  activeId: string
  activeConversation: Conversation
  draft: string
  pending: boolean
  pendingIds: ReadonlySet<string>
  streamingMessageId: string | null
  history: HistoryListUi
  setDraft: (value: string) => void
  send: (text: string) => void
  stopReply: () => void
  newConversation: () => void
  selectConversation: (id: string) => void
  retryHistory: () => void
  loadMoreHistory: () => void
  retryReplay: () => void
}

/**
 * Thin React adapter over the conversation session (feat-281): one session
 * instance per hook lifetime (side-effect-free construction, so StrictMode's
 * doubled initializer is harmless), `useSyncExternalStore` for the snapshot,
 * and a mount effect driving `activate`/`deactivate` — under dev StrictMode's
 * setup → cleanup → setup the SAME instance deactivates and re-arms. The
 * returned shape is unchanged from the pre-extraction hook; `seekerEnabled`
 * is captured at construction (deploy-static, read server-side in page.tsx).
 */
export function useConversations(seekerEnabled: boolean): UseConversations {
  const [session] = useState(() =>
    createConversationSession({
      streamReply,
      fetchHistoryPage,
      fetchHistoryThread,
      seekerEnabled,
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
    retryHistory: session.retryHistory,
    loadMoreHistory: session.loadMoreHistory,
    retryReplay: session.retryReplay,
  }
}
