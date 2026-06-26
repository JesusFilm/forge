"use client"

import { useEffect, useRef } from "react"

type ComposerProps = {
  draft: string
  pending: boolean
  placeholder: string
  seekerEnabled?: boolean
  onChange: (value: string) => void
  onSend: (text: string) => void
}

// The composer card. The send affordance is a 12px Vesper dot inside a 44px
// touch target — no paper-airplane icon, per the Vigil iconography rules.
export function Composer({
  draft,
  pending,
  placeholder,
  seekerEnabled = false,
  onChange,
  onSend,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow the textarea up to a ceiling, like the design kit's Composer.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  useEffect(() => {
    if (!pending) textareaRef.current?.focus()
  }, [pending])

  const canSend = draft.trim().length > 0 && !pending

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSend(draft)
      }}
      className="rounded-[20px] border border-linen/10 bg-nightglass/90 px-5 pt-4 pb-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65)] backdrop-blur-xl transition-colors duration-300 focus-within:border-linen/20"
    >
      <div className="flex items-end gap-3.5">
        <textarea
          ref={textareaRef}
          aria-label="Message"
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
              onSend(draft)
            }
          }}
          className="max-h-[200px] min-h-7 flex-1 resize-none bg-transparent py-1.5 text-base leading-relaxed text-linen caret-lamplight outline-none placeholder:text-ash disabled:opacity-50"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!canSend}
          className="flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-300 hover:bg-vesper/15 disabled:cursor-not-allowed"
        >
          <span
            className={`size-3 rounded-full transition-colors duration-300 ${
              canSend ? "bg-vesper" : "bg-vesper/55"
            }`}
          />
        </button>
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-linen/5 pt-2.5 text-xs text-ash">
        <span>Enter to send · Shift + Enter for a new line</span>
        <span>
          {seekerEnabled
            ? "Seeker — grounded answers"
            : "Stub — no agent connected"}
        </span>
      </div>
    </form>
  )
}
