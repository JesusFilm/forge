"use client"

import { BrandLockup } from "@/components/brand/brand-lockup"
import { type Conversation } from "@/lib/conversations"

type SidebarProps = {
  conversations: Conversation[]
  activeId: string
  onNew: () => void
  onSelect: (id: string) => void
}

// Left rail: brand lockup at the top (Claude/ChatGPT placement), a "New
// conversation" action, then the conversation list. This is a brand EXTENSION
// — the Vigil system is single-surface and lists no sidebar — so it is built
// from the system's tokens rather than copied from it.
export function Sidebar({
  conversations,
  activeId,
  onNew,
  onSelect,
}: SidebarProps) {
  return (
    <aside className="flex h-dvh w-[280px] shrink-0 flex-col border-r border-linen/10 bg-embersoot/40">
      <div className="px-5 pt-6 pb-2">
        <BrandLockup />
      </div>

      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-linen/10 px-3.5 py-2.5 text-left text-sm font-medium text-linen transition-colors duration-300 hover:border-linen/20 hover:bg-linen/[0.04]"
        >
          <span
            aria-hidden="true"
            className="text-base leading-none text-vesper"
          >
            +
          </span>
          New conversation
        </button>
      </div>

      <nav
        aria-label="Conversations"
        className="mt-4 flex-1 overflow-y-auto px-3 pb-5"
      >
        <ul className="flex flex-col gap-0.5">
          {conversations.map((conversation) => {
            const active = conversation.id === activeId
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(conversation.id)}
                  className={`w-full truncate rounded-lg px-3.5 py-2.5 text-left text-sm transition-colors duration-300 ${
                    active
                      ? "bg-linen/[0.06] text-linen"
                      : "text-ash hover:bg-linen/[0.03] hover:text-linen"
                  }`}
                  title={conversation.title}
                >
                  {conversation.title}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
