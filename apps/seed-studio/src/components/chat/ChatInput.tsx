"use client"

import { useCallback, useRef, useState } from "react"
import { SendHorizontal } from "lucide-react"

import { cn } from "@/lib/cn"

type ChatInputProps = {
  onSend: (message: string) => void
  disabled: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [value, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-xl border border-neutral-200",
        "bg-white p-2 shadow-sm",
        "focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100",
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          adjustHeight()
        }}
        onKeyDown={handleKeyDown}
        placeholder="Describe your experience theme..."
        disabled={disabled}
        rows={1}
        className={cn(
          "max-h-40 min-h-[40px] flex-1 resize-none bg-transparent",
          "px-2 py-1.5 text-sm text-neutral-900 outline-none",
          "placeholder:text-neutral-400",
          "disabled:opacity-50",
        )}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          "bg-primary-500 text-white transition-colors",
          "hover:bg-primary-600",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        <SendHorizontal className="h-4 w-4" />
      </button>
    </div>
  )
}
