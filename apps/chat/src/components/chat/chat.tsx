"use client"

import { useEffect, useRef, useState } from "react"

import {
  buildStubReply,
  STUB_REPLY_DELAY_MS,
  type Message,
} from "@/lib/chat-stub"

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [pending, setPending] = useState(false)
  const [draft, setDraft] = useState("")
  // Mirrors the `pending` state, kept as a ref so the synchronous guard in
  // send() reads the current value before the next render commits — the
  // disabled attribute alone doesn't survive a second Enter keydown landing
  // before React re-renders.
  const pendingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  useEffect(() => {
    if (!pending) textareaRef.current?.focus()
  }, [pending])

  function send() {
    const text = draft.trim()
    if (!text || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setDraft("")
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text },
    ])
    timerRef.current = setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: buildStubReply(text),
        },
      ])
      pendingRef.current = false
      timerRef.current = null
      setPending(false)
    }, STUB_REPLY_DELAY_MS)
  }

  return (
    <main className="flex h-dvh flex-col bg-white text-gray-900">
      <div
        ref={logRef}
        role="log"
        aria-label="Conversation"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <h1 className="text-lg font-semibold">Ask a question</h1>
            <p className="mt-2 text-sm text-gray-500">
              Replies come from a stub — no agent is connected yet.
            </p>
          </div>
        ) : (
          <ul className="mx-auto flex max-w-2xl flex-col gap-3">
            {messages.map((message) => (
              <li
                key={message.id}
                className={
                  message.role === "user"
                    ? "max-w-[85%] self-end rounded-2xl bg-blue-600 px-4 py-2 text-white"
                    : "max-w-[85%] self-start rounded-2xl bg-gray-100 px-4 py-2"
                }
              >
                <p className="break-words whitespace-pre-wrap">
                  {message.content}
                </p>
              </li>
            ))}
            {pending ? (
              <li className="max-w-[85%] self-start rounded-2xl bg-gray-100 px-4 py-2 text-gray-500">
                Stub is thinking…
              </li>
            ) : null}
          </ul>
        )}
      </div>
      <form
        className="border-t border-gray-200 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            ref={textareaRef}
            aria-label="Message"
            placeholder="Type a message"
            rows={1}
            value={draft}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                send()
              }
            }}
            className="min-h-10 flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 focus:outline-2 focus:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={pending || draft.trim().length === 0}
            className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </main>
  )
}
