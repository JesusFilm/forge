import { render, screen, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { type Conversation } from "@/lib/conversations"

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

type Overrides = {
  activeId?: string
  conversations?: Conversation[]
  pendingIds?: ReadonlySet<string>
  onSelect?: (id: string) => void
  onCloseMobile?: () => void
}

function buildProps(overrides: Overrides = {}) {
  return {
    conversations: overrides.conversations ?? conversations,
    activeId: overrides.activeId ?? "a",
    pendingIds: overrides.pendingIds ?? new Set<string>(),
    styles: collapsedStyles(false),
    onSelect: overrides.onSelect ?? (() => {}),
    onCloseMobile: overrides.onCloseMobile ?? (() => {}),
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
