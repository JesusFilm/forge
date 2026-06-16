"use client"

import { useEffect, useRef, useState } from "react"

import { buildStubReply, STUB_REPLY_DELAY_MS, type Message } from "./chat-stub"
import {
  createConversation,
  deriveTitle,
  type Conversation,
} from "./conversations"

export type UseConversations = {
  conversations: Conversation[]
  activeId: string
  activeConversation: Conversation
  draft: string
  pending: boolean
  setDraft: (value: string) => void
  send: (text: string) => void
  newConversation: () => void
  selectConversation: (id: string) => void
}

// Owns all conversation + reply state so the components stay presentational.
// The reply-generation seam is still buildStubReply() in chat-stub.ts; this
// hook only orchestrates timing, the pending guard, and which conversation a
// reply lands in.
export function useConversations(): UseConversations {
  const [conversations, setConversations] = useState<Conversation[]>(() => [
    createConversation(),
  ])
  const [activeId, setActiveId] = useState<string>(
    () => conversations[0]?.id ?? "",
  )
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)

  // Mirrors `pending` so the synchronous guard in send() reads the current
  // value before the next render commits — a second Enter landing before
  // React re-renders must not double-send.
  const pendingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  function appendMessage(conversationId: string, message: Message) {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              title:
                conversation.messages.length === 0 && message.role === "user"
                  ? deriveTitle(message.content)
                  : conversation.title,
              messages: [...conversation.messages, message],
            }
          : conversation,
      ),
    )
  }

  function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setDraft("")

    // Capture the target so a reply still lands here even if the user switches
    // conversations while the stub is "thinking".
    const targetId = activeId
    appendMessage(targetId, {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    })

    timerRef.current = setTimeout(() => {
      appendMessage(targetId, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: buildStubReply(trimmed),
      })
      pendingRef.current = false
      timerRef.current = null
      setPending(false)
    }, STUB_REPLY_DELAY_MS)
  }

  function newConversation() {
    const conversation = createConversation()
    setConversations((prev) => [conversation, ...prev])
    setActiveId(conversation.id)
    setDraft("")
  }

  function selectConversation(id: string) {
    if (id === activeId) return
    setActiveId(id)
    setDraft("")
  }

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ??
    conversations[0]

  return {
    conversations,
    activeId,
    activeConversation,
    draft,
    pending,
    setDraft,
    send,
    newConversation,
    selectConversation,
  }
}
