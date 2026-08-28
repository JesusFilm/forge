import { cn } from "@/lib/cn"
import { fallbackTitle, type Conversation } from "@/lib/conversations"
import { type CollapsedStyles } from "./sidebar-collapsed-styles"
import { type HistoryListUi } from "./sidebar-projection"

type ConversationListProps = {
  conversations: Conversation[]
  activeId: string
  pendingIds: ReadonlySet<string>
  styles: CollapsedStyles
  history: HistoryListUi
  onSelect: (id: string) => void
  onCloseMobile: () => void
  onRetryHistory: () => void
  onLoadMore: () => void
}

/**
 * The conversation history rail: a labeled nav whose rows select a conversation
 * (and close the mobile drawer). The active row is highlighted; a row awaiting a
 * reply shows a pulsing dot. Hidden entirely when the desktop rail is collapsed.
 *
 * feat-241 additions, all presentational: a polite loading skeleton while the
 * server history hydrates, an error state with retry, a Load-more control with
 * inline pending/retry (already-rendered rows always stay), date-derived
 * fallback labels for untitled server threads (R11), and a muted presentation
 * (+ sr-only note) for rows whose transcript is no longer available. An empty
 * server list renders nothing extra — today's client-only look (R16).
 *
 * feat-401 makes a FULLY empty list reachable for the first time, by three
 * paths: a first-time signed-in user with no server history, and either
 * access-denial revert (list or replay), which empties a rail the user just
 * saw populated. Decided for all three: leave it bare — no empty-state copy,
 * no reserved space. The chat pane beside it already answers "what now?"
 * ("What would you like to ask?"), so a second empty-state message a few
 * pixels away only restates it, and the rail's own affordance is the New
 * action directly above; the denial paths additionally want R16 silence.
 * That same pane is also why nothing marks `aria-current` while the open
 * conversation is unstarted: the pane, not a highlighted row, is the
 * indication. Revisit only if the rail gains a purpose beyond history.
 */
export function ConversationList({
  conversations,
  activeId,
  pendingIds,
  styles,
  history,
  onSelect,
  onCloseMobile,
  onRetryHistory,
  onLoadMore,
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
          const notAvailable = conversation.replay === "not_available"
          // Untitled server threads (title "" — pre-existing, generation
          // pending, or generation failed) get the date-derived label (AE6).
          const displayTitle =
            conversation.title.trim().length > 0
              ? conversation.title
              : fallbackTitle(conversation.lastActivityAt ?? "")
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
                  notAvailable && "opacity-50",
                )}
                title={displayTitle}
              >
                <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
                {notAvailable ? (
                  <span className="sr-only">(unavailable)</span>
                ) : null}
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

      {history.loading ? (
        // Polite announcement + a visual skeleton while the first page loads
        // (same aria treatment as replay loading in the chat pane).
        <div aria-live="polite" data-history="loading" className="mt-2 px-3.5">
          <span className="sr-only">Loading conversations</span>
          <div aria-hidden="true" className="flex flex-col gap-2">
            <span className="block h-4 w-4/5 rounded bg-linen/[0.06] [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]" />
            <span className="block h-4 w-3/5 rounded bg-linen/[0.06] [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]" />
            <span className="block h-4 w-2/3 rounded bg-linen/[0.06] [animation:vigil-pulse_2s_var(--ease-vigil)_infinite]" />
          </div>
        </div>
      ) : null}

      {history.error ? (
        <div data-history="error" className="mt-2 flex flex-col gap-2 px-3.5">
          {/* role="alert" so AT users hear the failure, not just the loading
              announcement that preceded it. */}
          <p role="alert" className="text-xs text-ash">
            Your conversations couldn&apos;t be loaded.
          </p>
          <button
            type="button"
            onClick={onRetryHistory}
            className="self-start rounded-full border border-linen/15 px-3 py-1 text-xs text-linen transition-colors duration-300 hover:bg-linen/[0.06]"
          >
            Retry
          </button>
        </div>
      ) : null}

      {history.hasMore ? (
        <div
          data-history="load-more"
          className="mt-2 flex flex-col gap-1 px-3.5"
        >
          {history.loadMoreError ? (
            <p role="alert" className="text-xs text-ash">
              Couldn&apos;t load more.
            </p>
          ) : null}
          <button
            type="button"
            onClick={onLoadMore}
            disabled={history.loadingMore}
            className="self-start rounded-full border border-linen/15 px-3 py-1 text-xs text-linen transition-colors duration-300 hover:bg-linen/[0.06] disabled:opacity-50"
          >
            {history.loadingMore
              ? "Loading…"
              : history.loadMoreError
                ? "Retry"
                : "Load more"}
          </button>
        </div>
      ) : null}
    </nav>
  )
}
