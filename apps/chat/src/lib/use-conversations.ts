"use client"

import { useEffect, useRef, useState } from "react"

import { streamReply } from "./chat-stub"
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
  streamingMessageId: string | null
  setDraft: (value: string) => void
  send: (text: string) => void
  newConversation: () => void
  selectConversation: (id: string) => void
}

/**
 * Owns all conversation + reply state so the components stay presentational.
 * `seekerEnabled` selects the reply source (Seeker proxy vs local stub) inside
 * the streamReply seam. Returns the conversation list, the active conversation +
 * draft, the per-conversation pending set, and the in-flight `streamingMessageId`
 * (for the pulse), plus send/new/select actions.
 *
 * Reply lifecycle: append an empty assistant turn (pulse shows pre-first-token),
 * feed tokens in as they arrive, finalize on the terminal result, and on failure
 * keep the partial text + mark the turn. In-flight replies are tracked PER
 * CONVERSATION via an AbortController map (not a global flag) so a slow reply in
 * one conversation never locks sending in another; the slot is held across the
 * full stream lifecycle and released in a `finally` so a throw can't wedge it.
 */
export function useConversations(seekerEnabled: boolean): UseConversations {
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
  // The in-flight assistant message id per conversation — the explicit "this
  // turn is streaming" signal the view reads (so it never re-derives streaming
  // from Message field absence). Set on send, cleared when the turn settles.
  const [streamingIds, setStreamingIds] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  )

  // SINGLE source of truth for in-flight replies, keyed by conversation id. Read
  // synchronously in send() so a second submit can't double-send; `pendingIds`
  // is a derived snapshot of its keys. Mutated but never reassigned.
  const controllersRef = useRef<Map<string, AbortController>>(new Map())

  // Cleared on unmount so the fire-and-forget finally can skip its setState after
  // teardown (the ref-map delete still runs unconditionally).
  const mountedRef = useRef(true)

  // Mirror of activeId that updates synchronously when the conversation changes,
  // so send() captures the right target even if a switch and a send land in the
  // same React batch.
  const activeIdRef = useRef(activeId)

  useEffect(() => {
    const controllers = controllersRef.current
    return () => {
      // Abort in-flight streams on unmount so their async callbacks don't fire
      // setState after teardown.
      mountedRef.current = false
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    }
  }, [])

  // pendingIds derives from the controller map's keys — recomputed on every
  // start/clear so the two never diverge. Both write paths go through these
  // helpers; nothing else touches the map.
  function syncPendingIds() {
    setPendingIds(new Set(controllersRef.current.keys()))
  }

  function startReply(
    conversationId: string,
    controller: AbortController,
    assistantId: string,
  ) {
    controllersRef.current.set(conversationId, controller)
    setStreamingIds((prev) => new Map(prev).set(conversationId, assistantId))
    syncPendingIds()
  }

  function clearReply(conversationId: string) {
    // Release the slot unconditionally; skip the state sync after unmount so the
    // fire-and-forget finally never setStates a torn-down tree.
    controllersRef.current.delete(conversationId)
    if (!mountedRef.current) return
    setStreamingIds((prev) => {
      const next = new Map(prev)
      next.delete(conversationId)
      return next
    })
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

  // Patch a single message in place (token append + terminal finalize/error).
  function updateMessage(
    conversationId: string,
    messageId: string,
    patch: (message: Message) => Message,
  ) {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId ? patch(message) : message,
              ),
            }
          : conversation,
      ),
    )
  }

  function send(text: string) {
    const trimmed = text.trim()
    // Capture the target up front (from the synchronous ref) so the reply lands
    // in the conversation active at send time even if the user switches mid-reply.
    const targetId = activeIdRef.current
    // One in-flight reply per conversation: a second submit before it resolves
    // is a no-op. Other conversations stay free to send in parallel.
    if (!trimmed || controllersRef.current.has(targetId)) return
    setDraft("")

    appendMessage(targetId, {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    })

    // Empty assistant turn — the pulse renders against it pre-first-token (R8),
    // and tokens append into it as they stream (R9).
    const assistantId = crypto.randomUUID()
    appendMessage(targetId, { id: assistantId, role: "assistant", content: "" })

    const controller = new AbortController()
    startReply(targetId, controller, assistantId)

    // Fire-and-forget: the whole body is wrapped so the slot releases on EVERY
    // path (terminal result, error, abort) — see the slot-leak guard pattern.
    void (async () => {
      try {
        const result = await streamReply({
          text: trimmed,
          conversationId: targetId,
          seekerEnabled,
          signal: controller.signal,
          onToken: (token) =>
            updateMessage(targetId, assistantId, (message) => ({
              ...message,
              content: message.content + token,
            })),
        })
        // Aborted (unmount) → the tree is gone; skip the finalize setState. The
        // finally below still releases the slot.
        if (controller.signal.aborted) return
        if (result.ok) {
          updateMessage(targetId, assistantId, (message) => ({
            ...message,
            content: result.text,
            sources: result.sources,
            grounded: result.grounded,
            engine: result.engine,
          }))
        } else {
          // Keep whatever streamed (partialText); mark the failure so the UI
          // renders a visible notice (R14/R17). The turn is still attributable
          // to its engine (R20).
          updateMessage(targetId, assistantId, (message) => ({
            ...message,
            content: result.partialText || message.content,
            engine: seekerEnabled ? "seeker" : "stub",
            error: result.reason,
          }))
        }
      } finally {
        clearReply(targetId)
      }
    })()
  }

  function newConversation() {
    const conversation = createConversation()
    // Keep the synchronous mirror in lockstep so a send batched with this switch
    // targets the new conversation.
    activeIdRef.current = conversation.id
    setConversations((prev) => [conversation, ...prev])
    setActiveId(conversation.id)
    setDraft("")
  }

  function selectConversation(id: string) {
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
    // Pending for the active pane is true only when the active conversation
    // itself is waiting.
    pending: pendingIds.has(activeConversation.id),
    pendingIds,
    streamingMessageId: streamingIds.get(activeConversation.id) ?? null,
    setDraft,
    send,
    newConversation,
    selectConversation,
  }
}
