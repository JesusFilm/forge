"use client"

import { Chat } from "@/components/chat/chat"
import { useConversations } from "@/lib/use-conversations"

import { Sidebar } from "./sidebar"

// Top-level layout. Owns conversation state via useConversations and lays out
// the sidebar rail beside the chat pane. The chat keeps its own centered 680px
// room inside whatever width remains.
export function AppShell() {
  const {
    conversations,
    activeId,
    activeConversation,
    draft,
    pending,
    pendingIds,
    setDraft,
    send,
    newConversation,
    selectConversation,
  } = useConversations()

  return (
    <div className="flex h-dvh">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        pendingIds={pendingIds}
        onNew={newConversation}
        onSelect={selectConversation}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <Chat
          conversation={activeConversation}
          draft={draft}
          pending={pending}
          onDraftChange={setDraft}
          onSend={send}
        />
      </main>
    </div>
  )
}
