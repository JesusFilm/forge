import type { ChatMessage as ChatMessageType } from "@/lib/ai/experience-schema"
import { cn } from "@/lib/cn"

type ChatMessageProps = {
  message: ChatMessageType
}

function StreamingIndicator() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:300ms]" />
    </span>
  )
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user"
  const isStreaming = message.role === "assistant" && message.content === ""

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5",
          isUser
            ? "bg-primary-500 text-white"
            : "bg-neutral-100 text-neutral-900",
        )}
      >
        {isStreaming ? (
          <StreamingIndicator />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
          </p>
        )}
      </div>
    </div>
  )
}
