import { type Message } from "@/lib/conversations"

type MessageListProps = {
  messages: Message[]
  pending: boolean
}

// Renders the conversation. User turns sit in an Embersoot bubble (12px on
// three corners, 4px on the inner corner); assistant turns are plain Linen
// text with no bubble, per the Vigil chat layout. The pending turn is a single
// Lamplight pulse cursor — never an "AI is thinking…" label.
export function MessageList({ messages, pending }: MessageListProps) {
  return (
    <ul className="flex flex-col gap-8">
      {messages.map((message) =>
        message.role === "user" ? (
          <li key={message.id} className="flex justify-end">
            <div className="max-w-[460px] rounded-[12px_12px_4px_12px] bg-embersoot px-[18px] py-3.5 text-base leading-relaxed whitespace-pre-wrap text-linen">
              {message.content}
            </div>
          </li>
        ) : (
          <li
            key={message.id}
            className="max-w-[560px] text-lg leading-relaxed whitespace-pre-wrap text-linen"
          >
            {message.content}
          </li>
        ),
      )}
      {pending ? (
        <li data-pending="true" className="text-lg leading-relaxed text-linen">
          <span
            aria-hidden="true"
            className="inline-block h-[1em] w-0.5 translate-y-1 bg-lamplight [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]"
          />
          <span className="sr-only">Replying</span>
        </li>
      ) : null}
    </ul>
  )
}
