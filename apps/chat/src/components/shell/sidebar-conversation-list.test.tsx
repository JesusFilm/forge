// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { type Conversation } from "@/lib/conversations"

import { collapsedStyles } from "./sidebar-collapsed-styles"
import { ConversationList } from "./sidebar-conversation-list"
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
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

function render(overrides: Overrides = {}) {
  const props = {
    conversations: overrides.conversations ?? conversations,
    activeId: overrides.activeId ?? "a",
    pendingIds: overrides.pendingIds ?? new Set<string>(),
    styles: collapsedStyles(false),
    onSelect: overrides.onSelect ?? (() => {}),
    onCloseMobile: overrides.onCloseMobile ?? (() => {}),
  }
  act(() => {
    root.render(<ConversationList {...props} />)
  })
}

function rowByTitle(title: string): HTMLButtonElement {
  const btn = Array.from(
    container.querySelectorAll<HTMLButtonElement>("nav button"),
  ).find((b) => b.textContent?.includes(title))
  if (!btn) throw new Error(`row "${title}" not found`)
  return btn
}

describe("ConversationList", () => {
  it("selects a conversation and closes the mobile drawer on row click", () => {
    const onSelect = vi.fn()
    const onCloseMobile = vi.fn()
    render({ onSelect, onCloseMobile })

    act(() => {
      rowByTitle("Second chat").click()
    })

    // Both fire on a single click — selecting also dismisses the drawer.
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith("b")
    expect(onCloseMobile).toHaveBeenCalledTimes(1)
  })

  it("marks only the active row with aria-current", () => {
    render({ activeId: "b" })
    expect(rowByTitle("Second chat").getAttribute("aria-current")).toBe("true")
    expect(rowByTitle("First chat").getAttribute("aria-current")).toBeNull()
  })

  it("renders the replying pulse only on conversations awaiting a reply", () => {
    render({ pendingIds: new Set(["a"]) })
    expect(
      rowByTitle("First chat").querySelector("[data-replying]"),
    ).not.toBeNull()
    expect(
      rowByTitle("Second chat").querySelector("[data-replying]"),
    ).toBeNull()
    // The pulse carries an sr-only label so it is announced, not silent.
    expect(rowByTitle("First chat").textContent).toContain("Replying")
  })

  it("renders the labeled nav with no rows when there are no conversations", () => {
    render({ conversations: [], activeId: "" })
    const nav = container.querySelector('nav[aria-label="Conversations"]')
    expect(nav).not.toBeNull()
    expect(nav?.querySelectorAll("li")).toHaveLength(0)
  })
})
