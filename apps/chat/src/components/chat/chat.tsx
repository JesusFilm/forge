"use client"

import { useEffect, useRef } from "react"

import { type Conversation, type ReplayState } from "@/lib/conversations"

import { Composer } from "./composer"
import { EmptyState } from "./empty-state"
import { MessageList } from "./message-list"

type ChatProps = {
  conversation: Conversation
  draft: string
  pending: boolean
  streamingMessageId: string | null
  seekerEnabled?: boolean
  /** Replay state of the active conversation when it is server-origin;
   * null/undefined for local conversations (feat-241, R18). */
  replayState?: ReplayState | null
  onDraftChange: (value: string) => void
  onSend: (text: string) => void
  onRetryReplay?: () => void
  onStartNew?: () => void
}

/** The transcript-loading affordance (R18): announced politely like the
 * streaming turn, with a skeleton the sighted user reads as loading. */
function ReplayLoading() {
  return (
    <div
      aria-live="polite"
      data-replay="loading"
      className="flex flex-col gap-3"
    >
      <span className="sr-only">Loading conversation</span>
      <span
        aria-hidden="true"
        className="block h-4 w-2/3 rounded bg-linen/[0.06] [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]"
      />
      <span
        aria-hidden="true"
        className="block h-4 w-1/2 rounded bg-linen/[0.06] [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]"
      />
    </div>
  )
}

/** Explicit replay failure (network/5xx) with a working retry (R18). */
function ReplayFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div data-replay="failed" className="flex flex-col items-start gap-3">
      <p role="alert" className="text-sm text-vesper">
        This conversation couldn&apos;t be loaded. Check your connection and try
        again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full border border-linen/15 px-4 py-2 text-sm text-linen transition-colors duration-300 hover:bg-linen/[0.06]"
      >
        Retry
      </button>
    </div>
  )
}

/** The "no longer available" state (thread_forbidden / vanished thread) with
 * an in-pane recovery action — no mobile drawer round-trip needed (R18). */
function ReplayNotAvailable({ onStartNew }: { onStartNew: () => void }) {
  return (
    <div
      data-replay="not_available"
      className="flex flex-col items-start gap-3"
    >
      <p className="text-sm text-ash">
        This conversation is no longer available.
      </p>
      <button
        type="button"
        onClick={onStartNew}
        className="rounded-full border border-linen/15 px-4 py-2 text-sm text-linen transition-colors duration-300 hover:bg-linen/[0.06]"
      >
        Start new conversation
      </button>
    </div>
  )
}

/**
 * The conversation pane — the centered 680px reading "room". Presentational:
 * all state lives in useConversations (via AppShell). feat-241 adds the replay
 * pane states (loading / failed / not-available), mutually exclusive with the
 * starter-questions empty state — a server-origin conversation whose
 * transcript is not loaded must never show dead starter questions while sends
 * are blocked — and the composer's per-state blocked-send reason.
 */
export function Chat({
  conversation,
  draft,
  pending,
  streamingMessageId,
  seekerEnabled = false,
  replayState = null,
  onDraftChange,
  onSend,
  onRetryReplay = () => {},
  onStartNew = () => {},
}: ChatProps) {
  const logRef = useRef<HTMLDivElement>(null)
  // The replay states own the pane while the transcript is loading, failed,
  // or gone; the starter-questions gate is suppressed for those (R18).
  const replayBlocked =
    replayState === "loading" ||
    replayState === "failed" ||
    replayState === "not_available"
  const isEmpty =
    conversation.messages.length === 0 && !pending && !replayBlocked

  // Keep the latest turn in view as the conversation grows.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conversation.messages, pending, conversation.id])

  const sendBlockedReason =
    replayState === "loading"
      ? ("loading" as const)
      : replayState === "failed" || replayState === "not_available"
        ? ("unavailable" as const)
        : null

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* scroll-padding keeps focus auto-scroll from parking a focused
          element behind the sticky composer band at the scrollport bottom. */}
      <div
        ref={logRef}
        className="min-h-0 flex-1 overflow-y-auto [scroll-padding-bottom:13rem]"
      >
        {/* min-h-full column keeps the sticky composer pinned to the pane
            bottom even when the transcript is shorter than the viewport. */}
        <div className="flex min-h-full flex-col">
          <div className="flex-1 px-8 pt-12">
            <div
              role="log"
              aria-label="Conversation"
              className="mx-auto w-full max-w-[680px] pb-6"
            >
              {replayState === "failed" ? (
                <ReplayFailed onRetry={onRetryReplay} />
              ) : replayState === "not_available" ? (
                <ReplayNotAvailable onStartNew={onStartNew} />
              ) : replayState === "loading" ? (
                <ReplayLoading />
              ) : isEmpty ? (
                <EmptyState onPick={onSend} seekerEnabled={seekerEnabled} />
              ) : (
                <MessageList
                  messages={conversation.messages}
                  streamingMessageId={streamingMessageId}
                />
              )}
            </div>
          </div>

          {/* Sticky INSIDE the scroller so text dissolves through the gradient
              instead of clipping. Only the transparent fade is click-through;
              the full-width inner wrapper intercepts over the opaque zone. */}
          <div className="pointer-events-none sticky bottom-0 bg-gradient-to-b from-transparent via-hearthblack/85 to-hearthblack pt-16">
            <div className="pointer-events-auto px-8 pb-8">
              <div className="mx-auto w-full max-w-[680px]">
                <Composer
                  draft={draft}
                  pending={pending}
                  seekerEnabled={seekerEnabled}
                  sendBlockedReason={sendBlockedReason}
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
        </div>
      </div>
    </div>
  )
}
