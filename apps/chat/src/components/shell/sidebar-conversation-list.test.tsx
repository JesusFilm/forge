import { render, screen, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { fallbackTitle, type Conversation } from "@/lib/conversations"
import { type HistoryListUi } from "@/lib/use-conversations"

import { collapsedStyles } from "./sidebar-collapsed-styles"
import { ConversationList } from "./sidebar-conversation-list"

// Built per test (not at module load) so the instance never predates a future
// fake-timer install in this file — matches app-shell.test.tsx.
let user: UserEvent
beforeEach(() => {
  user = userEvent.setup()
})

const conversations: Conversation[] = [
  { id: "a", title: "First chat", messages: [] },
  { id: "b", title: "Second chat", messages: [] },
]

const HISTORY_IDLE: HistoryListUi = {
  loading: false,
  error: false,
  hasMore: false,
  loadingMore: false,
  loadMoreError: false,
}

type Overrides = {
  activeId?: string
  conversations?: Conversation[]
  pendingIds?: ReadonlySet<string>
  history?: Partial<HistoryListUi>
  onSelect?: (id: string) => void
  onCloseMobile?: () => void
  onRetryHistory?: () => void
  onLoadMore?: () => void
}

function buildProps(overrides: Overrides = {}) {
  return {
    conversations: overrides.conversations ?? conversations,
    activeId: overrides.activeId ?? "a",
    pendingIds: overrides.pendingIds ?? new Set<string>(),
    styles: collapsedStyles(false),
    history: { ...HISTORY_IDLE, ...overrides.history },
    onSelect: overrides.onSelect ?? (() => {}),
    onCloseMobile: overrides.onCloseMobile ?? (() => {}),
    onRetryHistory: overrides.onRetryHistory ?? (() => {}),
    onLoadMore: overrides.onLoadMore ?? (() => {}),
  }
}

function renderList(overrides: Overrides = {}) {
  return render(<ConversationList {...buildProps(overrides)} />)
}

// Match by substring (regex) so a replying row — whose accessible name gains an
// sr-only "Replying" — still resolves by its title alone.
function rowByTitle(title: string): HTMLElement {
  return within(
    screen.getByRole("navigation", { name: "Conversations" }),
  ).getByRole("button", { name: new RegExp(title) })
}

describe("ConversationList", () => {
  it("selects a conversation and closes the mobile drawer on row click", async () => {
    const onSelect = vi.fn()
    const onCloseMobile = vi.fn()
    renderList({ onSelect, onCloseMobile })

    await user.click(rowByTitle("Second chat"))

    // Both fire on a single click — selecting also dismisses the drawer.
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith("b")
    expect(onCloseMobile).toHaveBeenCalledTimes(1)
  })

  it("marks only the active row with aria-current", () => {
    renderList({ activeId: "b" })
    expect(rowByTitle("Second chat")).toHaveAttribute("aria-current", "true")
    expect(rowByTitle("First chat")).not.toHaveAttribute("aria-current")
  })

  it("renders the replying pulse only on conversations awaiting a reply", () => {
    renderList({ pendingIds: new Set(["a"]) })
    expect(
      rowByTitle("First chat").querySelector("[data-replying]"),
    ).not.toBeNull()
    expect(
      rowByTitle("Second chat").querySelector("[data-replying]"),
    ).toBeNull()
    // The pulse carries an sr-only label so it is announced, not silent.
    expect(rowByTitle("First chat")).toHaveTextContent("Replying")
  })

  it("renders the labeled nav with no rows when there are no conversations", () => {
    renderList({ conversations: [], activeId: "" })
    const nav = screen.getByRole("navigation", { name: "Conversations" })
    expect(nav).toBeInTheDocument()
    expect(within(nav).queryAllByRole("listitem")).toHaveLength(0)
  })
})

describe("ConversationList — server history states (feat-241)", () => {
  it("renders date-derived fallback labels for untitled rows; distinct dates stay distinguishable (AE6)", () => {
    renderList({
      conversations: [
        {
          id: "s1",
          title: "",
          messages: [],
          origin: "server",
          lastActivityAt: "2026-07-10T08:00:00.000Z",
          replay: "idle",
        },
        {
          id: "s2",
          title: "   ",
          messages: [],
          origin: "server",
          lastActivityAt: "2026-06-02T08:00:00.000Z",
          replay: "idle",
        },
      ],
      activeId: "s1",
    })
    const labelA = fallbackTitle("2026-07-10T08:00:00.000Z")
    const labelB = fallbackTitle("2026-06-02T08:00:00.000Z")
    expect(labelA).not.toBe(labelB)
    expect(rowByTitle(labelA)).toBeInTheDocument()
    expect(rowByTitle(labelB)).toBeInTheDocument()
  })

  it("renders a not-available row muted with an sr-only note", () => {
    renderList({
      conversations: [
        {
          id: "gone",
          title: "Old thread",
          messages: [],
          origin: "server",
          lastActivityAt: "2026-07-10T08:00:00.000Z",
          replay: "not_available",
        },
      ],
      activeId: "gone",
    })
    const row = rowByTitle("Old thread")
    expect(row.className).toContain("opacity-50")
    expect(row).toHaveTextContent("(unavailable)")
  })

  it("shows the polite loading skeleton during hydration", () => {
    renderList({ history: { loading: true } })
    const nav = screen.getByRole("navigation", { name: "Conversations" })
    const skeleton = nav.querySelector('[data-history="loading"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton).toHaveAttribute("aria-live", "polite")
    expect(skeleton).toHaveTextContent("Loading conversations")
  })

  it("shows the error state as an announced alert with a working retry", async () => {
    const onRetryHistory = vi.fn()
    renderList({ history: { error: true }, onRetryHistory })
    const nav = screen.getByRole("navigation", { name: "Conversations" })
    // role="alert" so AT users hear the failure, not just the earlier
    // polite loading announcement.
    expect(within(nav).getByRole("alert")).toHaveTextContent(
      "couldn't be loaded",
    )
    await user.click(within(nav).getByRole("button", { name: "Retry" }))
    expect(onRetryHistory).toHaveBeenCalledTimes(1)
  })

  it("shows Load more when more pages exist and fires the handler", async () => {
    const onLoadMore = vi.fn()
    renderList({ history: { hasMore: true }, onLoadMore })
    const nav = screen.getByRole("navigation", { name: "Conversations" })
    await user.click(within(nav).getByRole("button", { name: "Load more" }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it("disables Load more while a page is in flight", () => {
    renderList({ history: { hasMore: true, loadingMore: true } })
    const nav = screen.getByRole("navigation", { name: "Conversations" })
    expect(within(nav).getByRole("button", { name: "Loading…" })).toBeDisabled()
  })

  it("keeps existing rows and offers an announced inline retry when Load more fails", () => {
    renderList({ history: { hasMore: true, loadMoreError: true } })
    const nav = screen.getByRole("navigation", { name: "Conversations" })
    // Page-1 rows stay rendered; the failure is announced (role="alert").
    expect(rowByTitle("First chat")).toBeInTheDocument()
    expect(within(nav).getByRole("alert")).toHaveTextContent(
      "Couldn't load more.",
    )
    expect(within(nav).getByRole("button", { name: "Retry" })).toBeEnabled()
  })

  it("renders nothing extra for an empty, loaded server list (today's look, R16)", () => {
    renderList({ history: HISTORY_IDLE })
    const nav = screen.getByRole("navigation", { name: "Conversations" })
    expect(nav.querySelector("[data-history]")).toBeNull()
  })
})
