"use client"

import { useEffect, useRef, useState } from "react"

import { buildStubReply, STUB_REPLY_DELAY_MS } from "./chat-stub"
import {
  createConversation,
  deriveTitle,
  type Conversation,
  type Message,
} from "./conversations"

export type UseConversations = {
  conversations: Conversation[]
  activeId: string
  activeConversation: Conversation
  draft: string
  pending: boolean
  pendingIds: ReadonlySet<string>
  setDraft: (value: string) => void
  send: (text: string) => void
  newConversation: () => void
  selectConversation: (id: string) => void
}

// Owns all conversation + reply state so the components stay presentational.
// The reply-generation seam is still buildStubReply() in chat-stub.ts; this
// hook only orchestrates timing and which conversation a reply lands in.
//
// In-flight replies are tracked PER CONVERSATION (an id set for rendering + a
// timer map keyed by id), not as one global flag. Each conversation owns its
// own pending reply, so the pulse cursor and disabled composer attach to the
// conversation that is actually waiting — never to whichever one happens to be
// active when the user switches mid-reply — and a slow reply in one
// conversation never locks sending in another.
export function useConversations(): UseConversations {
  const [conversations, setConversations] = useState<Conversation[]>(() => [
    createConversation(),
  ])
  const [activeId, setActiveId] = useState<string>(
    () => conversations[0]?.id ?? "",
  )
  const [draft, setDraft] = useState("")
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  // The SINGLE source of truth for in-flight replies, keyed by conversation
  // id. Read synchronously in send() before the next render commits so a second
  // submit into the same conversation can't double-send. `pendingIds` above is
  // a derived snapshot of this map's keys (kept in sync via syncPendingIds), so
  // rendering and the guard can never drift. The map is mutated but never
  // reassigned — the unmount cleanup below relies on that.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  )

  // Mirror of activeId that updates synchronously when the conversation
  // changes, so send() captures the right target even if a switch and a send
  // land in the same React batch (a render-closure read of activeId could be
  // stale there).
  const activeIdRef = useRef(activeId)

  useEffect(() => {
    // Capturing timersRef.current is safe because the map is mutated, never
    // reassigned, so this local stays the live instance for the component's
    // lifetime.
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  // pendingIds is derived from the timer map's keys — recomputed on every
  // start/clear so the two never diverge. Both write paths (start + the
  // finally below) go through these two helpers; nothing else touches the map.
  function syncPendingIds() {
    setPendingIds(new Set(timersRef.current.keys()))
  }

  function startTimer(
    conversationId: string,
    timer: ReturnType<typeof setTimeout>,
  ) {
    timersRef.current.set(conversationId, timer)
    syncPendingIds()
  }

  function clearTimer(conversationId: string) {
    timersRef.current.delete(conversationId)
    syncPendingIds()
  }

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
    // Capture the target up front (from the synchronous ref, not the render
    // closure) so the reply lands in the conversation that was active at send
    // time even if the user switches while the stub is "thinking".
    const targetId = activeIdRef.current
    // One in-flight reply per conversation: a second submit into the same
    // conversation before it resolves is a no-op. Other conversations stay
    // free to send in parallel.
    if (!trimmed || timersRef.current.has(targetId)) return
    setDraft("")

    appendMessage(targetId, {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    })

    const timer = setTimeout(() => {
      // Release the slot in finally so a throw in reply generation can never
      // leave the conversation wedged (stuck pulse + double-send lock). Latent
      // with the pure stub, but load-bearing once the Mastra call — which can
      // reject — replaces buildStubReply. See the fire-and-forget slot-leak
      // guard pattern in the root CLAUDE.md known-patterns list.
      try {
        appendMessage(targetId, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildStubReply(trimmed),
        })
      } finally {
        clearTimer(targetId)
      }
    }, STUB_REPLY_DELAY_MS)
    startTimer(targetId, timer)
  }

  function newConversation() {
    const conversation = createConversation()
    // Keep the synchronous mirror in lockstep with the state update so a send
    // batched with this switch targets the new conversation.
    activeIdRef.current = conversation.id
    setConversations((prev) => [conversation, ...prev])
    setActiveId(conversation.id)
    setDraft("")
  }

  function selectConversation(id: string) {
    // Guard on the synchronous mirror (not the render-closure activeId) so it
    // stays consistent with how send() reads the active id.
    if (id === activeIdRef.current) return
    activeIdRef.current = id
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
    // Pending state for the active pane is derived from the per-conversation
    // set, so it is true only when the active conversation itself is waiting.
    pending: pendingIds.has(activeConversation.id),
    pendingIds,
    setDraft,
    send,
    newConversation,
    selectConversation,
  }
}
