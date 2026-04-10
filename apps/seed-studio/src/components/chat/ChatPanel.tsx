"use client"

import { useEffect, useRef } from "react"
import { MessageSquare, Square } from "lucide-react"

import type { ChatMessage as ChatMessageType } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

import { ChatInput } from "./ChatInput"
import { ChatMessage } from "./ChatMessage"
import { SuggestionChips } from "./SuggestionChips"

type ChatPanelProps = {
  messages: ChatMessageType[]
  isLoading: boolean
  streamingText: string
  statusText: string
  onSendMessage: (content: string) => void
  onStopGenerating: () => void
}

const EXAMPLE_PROMPTS = [
  "Create an Easter experience about hope and resurrection",
  "A Christmas experience for families with children",
  "Exploring forgiveness through stories and scripture",
]

export function ChatPanel({
  messages,
  isLoading,
  streamingText,
  statusText,
  onSendMessage,
  onStopGenerating,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [messages, streamingText])

  const lastAssistantMessage = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")

  const isEmpty = messages.length === 0 && !isLoading

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
            <div
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-2xl",
                "bg-primary-50",
              )}
            >
              <MessageSquare className="h-7 w-7 text-primary-500" />
            </div>
            <div className="space-y-2 text-center">
              <p className="text-sm font-medium text-neutral-700">
                Describe your experience theme to get started
              </p>
              <p className="text-xs text-neutral-400">Try something like:</p>
            </div>
            <div className="flex flex-col gap-2">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onSendMessage(prompt)}
                  className={cn(
                    "rounded-xl border border-neutral-200 px-4 py-2.5",
                    "text-left text-sm text-neutral-600",
                    "transition-colors hover:border-primary-200 hover:bg-primary-50",
                  )}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {/* Streaming response */}
            {isLoading ? (
              <div className="flex justify-start">
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-3",
                    "bg-neutral-100 text-neutral-900",
                  )}
                >
                  {streamingText ? (
                    <p className="whitespace-pre-wrap text-sm">
                      {streamingText}
                      <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-primary-500" />
                    </p>
                  ) : statusText ? (
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-primary-400 [animation-delay:0ms]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-primary-400 [animation-delay:150ms]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-primary-400 [animation-delay:300ms]" />
                      </div>
                      <span className="text-xs text-neutral-500">
                        {statusText}
                      </span>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-primary-400 [animation-delay:0ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-primary-400 [animation-delay:150ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-primary-400 [animation-delay:300ms]" />
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Suggestion chips after last message */}
            {!isLoading &&
            lastAssistantMessage?.suggestions &&
            lastAssistantMessage.suggestions.length > 0 ? (
              <div className="pl-1">
                <SuggestionChips
                  suggestions={lastAssistantMessage.suggestions}
                  onSelect={onSendMessage}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="border-t border-neutral-200 bg-white p-4">
        {isLoading ? (
          <button
            type="button"
            onClick={onStopGenerating}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl",
              "border border-neutral-200 px-4 py-2.5",
              "text-sm text-neutral-600 transition hover:bg-neutral-50",
            )}
          >
            <Square className="h-3.5 w-3.5" />
            Stop generating
          </button>
        ) : (
          <ChatInput onSend={onSendMessage} disabled={false} />
        )}
      </div>
    </div>
  )
}
