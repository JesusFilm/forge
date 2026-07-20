"use client"

import { useEffect, useId, useRef, type RefObject } from "react"

import { ArrowUpIcon, StopIcon } from "@/components/shell/icons"

type ComposerProps = {
  draft: string
  pending: boolean
  placeholder: string
  seekerEnabled?: boolean
  /** feat-241 (R22): non-null while the active conversation's transcript is
   * not loaded — only the SEND action is blocked (the textarea stays editable
   * so the draft survives), with a visible per-state reason. */
  sendBlockedReason?: "loading" | "unavailable" | null
  /** feat-270: lets the shell focus the textarea imperatively (e.g. the
   * New-conversation action landing on the already-empty pane). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void
  onSend: (text: string) => void
  /** feat-270: aborts the in-flight reply. The stop control renders only
   * while `pending` — the R22 blocked states keep the plain disabled send. */
  onStop?: () => void
}

// The composer card. The send slot is a 44px target: a directional Vesper
// arrow when a draft is ready, a dim dot otherwise, and a stop control while
// a reply is in flight (feat-270).
export function Composer({
  draft,
  pending,
  placeholder,
  seekerEnabled = false,
  sendBlockedReason = null,
  textareaRef,
  onChange,
  onSend,
  onStop = () => {},
}: ComposerProps) {
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const blockedHintId = useId()

  // Auto-grow the textarea up to a ceiling, like the design kit's Composer.
  useEffect(() => {
    const el = localTextareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  useEffect(() => {
    if (!pending) localTextareaRef.current?.focus()
  }, [pending])

  const sendBlocked = sendBlockedReason !== null
  const canSend = draft.trim().length > 0 && !pending && !sendBlocked

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (sendBlocked) return
        onSend(draft)
      }}
      className="rounded-[20px] border border-linen/10 bg-nightglass/90 px-5 pt-4 pb-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65)] backdrop-blur-xl transition-colors duration-300 focus-within:border-linen/20"
    >
      <div className="flex items-end gap-3.5">
        <textarea
          ref={(el) => {
            localTextareaRef.current = el
            if (textareaRef) textareaRef.current = el
          }}
          aria-label="Message"
          aria-describedby={sendBlocked ? blockedHintId : undefined}
          placeholder={placeholder}
          rows={1}
          value={draft}
          disabled={pending}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              if (sendBlocked) return
              onSend(draft)
            }
          }}
          className="max-h-[200px] min-h-7 flex-1 resize-none bg-transparent py-1.5 text-base leading-relaxed text-linen caret-lamplight outline-none placeholder:text-ash disabled:opacity-50"
        />
        {pending ? (
          <button
            type="button"
            aria-label="Stop generating"
            onClick={onStop}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-vesper transition-colors duration-300 hover:bg-vesper/15"
          >
            <StopIcon className="size-5" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className="flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-300 hover:bg-vesper/15 disabled:cursor-not-allowed"
          >
            {canSend ? (
              <ArrowUpIcon className="size-5 text-vesper" />
            ) : (
              <span className="size-3 rounded-full bg-vesper/55" />
            )}
          </button>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-linen/5 pt-2.5 text-xs text-ash">
        {/* Keyboard-only hint — meaningless on touch, so hidden below md. */}
        <span className="hidden md:inline">
          Enter to send · Shift + Enter for a new line
        </span>
        {sendBlocked ? (
          // Visually distinct from the reply-pending disabled state (Vesper,
          // not Ash) and referenced from the textarea via aria-describedby.
          <span
            id={blockedHintId}
            data-send-blocked={sendBlockedReason}
            className="text-vesper"
          >
            {sendBlockedReason === "loading"
              ? "Loading conversation…"
              : "This conversation is unavailable"}
          </span>
        ) : (
          <span>
            {seekerEnabled
              ? "Seeker — grounded answers"
              : "Stub — no agent connected"}
          </span>
        )}
      </div>
    </form>
  )
}
