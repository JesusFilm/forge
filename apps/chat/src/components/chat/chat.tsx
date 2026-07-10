"use client"

import { useEffect, useRef } from "react"

import { type Conversation } from "@/lib/conversations"

import { Composer } from "./composer"
import { EmptyState } from "./empty-state"
import { MessageList } from "./message-list"

type ChatProps = {
  conversation: Conversation
  draft: string
  pending: boolean
  streamingMessageId: string | null
  seekerEnabled?: boolean
  onDraftChange: (value: string) => void
  onSend: (text: string) => void
}

// The conversation pane. Presentational: all state lives in useConversations
// (via AppShell). The reading column stays 680px wide — "the room is 680px
// even on a 1440px screen" — regardless of the surrounding shell width.
export function Chat({
  conversation,
  draft,
  pending,
  streamingMessageId,
  seekerEnabled = false,
  onDraftChange,
  onSend,
}: ChatProps) {
  const logRef = useRef<HTMLDivElement>(null)
  const isEmpty = conversation.messages.length === 0 && !pending

  // Keep the latest turn in view as the conversation grows.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversation.messages, pending, conversation.id])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={logRef}
        role="log"
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto px-8 pt-12"
      >
        <div className="mx-auto w-full max-w-[680px] pb-10">
          {isEmpty ? (
            <EmptyState onPick={onSend} seekerEnabled={seekerEnabled} />
          ) : (
            <MessageList
              messages={conversation.messages}
              streamingMessageId={streamingMessageId}
            />
          )}
        </div>
      </div>

      {/* Sticky composer with a protection gradient so text dissolves into
          the bottom edge rather than cutting abruptly. */}
      <div className="sticky bottom-0 bg-gradient-to-b from-transparent via-hearthblack/85 to-hearthblack px-8 pt-16 pb-8">
        <div className="mx-auto w-full max-w-[680px]">
          <Composer
            draft={draft}
            pending={pending}
            seekerEnabled={seekerEnabled}
            placeholder={
              isEmpty
                ? "Scripture, doubt, prayer, next steps — ask anything."
                : "Keep going."
            }
            onChange={onDraftChange}
            onSend={onSend}
          />
        </div>
      </div>
    </div>
  )
}
