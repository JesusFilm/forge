import { cn } from "@/lib/cn"
import { type Conversation } from "@/lib/conversations"

import { type CollapsedStyles } from "./sidebar-collapsed-styles"

type ConversationListProps = {
  conversations: Conversation[]
  activeId: string
  pendingIds: ReadonlySet<string>
  styles: CollapsedStyles
  onSelect: (id: string) => void
  onCloseMobile: () => void
}

/**
 * The conversation history rail: a labeled nav whose rows select a conversation
 * (and close the mobile drawer). The active row is highlighted; a row awaiting a
 * reply shows a pulsing dot. Hidden entirely when the desktop rail is collapsed.
 */
export function ConversationList({
  conversations,
  activeId,
  pendingIds,
  styles,
  onSelect,
  onCloseMobile,
}: ConversationListProps) {
  return (
    <nav
      aria-label="Conversations"
      className={cn("mt-4 flex-1 overflow-y-auto px-3 pb-5", styles.nav)}
    >
      <ul className="flex flex-col gap-0.5">
        {conversations.map((conversation) => {
          const active = conversation.id === activeId
          const replying = pendingIds.has(conversation.id)
          return (
            <li key={conversation.id}>
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => {
                  onSelect(conversation.id)
                  onCloseMobile()
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3.5 py-2.5 text-left text-sm transition-colors duration-300",
                  active
                    ? "bg-linen/[0.06] text-linen"
                    : "text-ash hover:bg-linen/[0.03] hover:text-linen",
                )}
                title={conversation.title}
              >
                <span className="min-w-0 flex-1 truncate">
                  {conversation.title}
                </span>
                {replying ? (
                  <>
                    <span
                      aria-hidden="true"
                      data-replying="true"
                      className="size-1.5 shrink-0 rounded-full bg-lamplight [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]"
                    />
                    <span className="sr-only">Replying</span>
                  </>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
