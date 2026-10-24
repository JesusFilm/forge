import { render, screen, within } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { type RenameConversationResult } from "@/lib/conversation-session"
import { fallbackTitle, type Conversation } from "@/lib/conversations"

import { collapsedStyles } from "./sidebar-collapsed-styles"
import { ConversationList } from "./sidebar-conversation-list"
import { type HistoryListUi } from "./sidebar-projection"

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

const SERVER_ROW: Conversation = {
  id: "s1",
  title: "Server thread",
  messages: [],
  origin: "server",
  serverPersisted: true,
  lastActivityAt: "2026-07-10T08:00:00.000Z",
  replay: "idle",
}

const UNTITLED_ROW: Conversation = {
  ...SERVER_ROW,
  id: "s2",
  title: "",
  lastActivityAt: "2026-06-02T08:00:00.000Z",
}

type Overrides = {
  activeId?: string
  conversations?: Conversation[]
  pendingIds?: ReadonlySet<string>
  renamingIds?: ReadonlySet<string>
  grantedShell?: boolean
  history?: Partial<HistoryListUi>
  onSelect?: (id: string) => void
  onCloseMobile?: () => void
  onRetryHistory?: () => void
  onLoadMore?: () => void
  onRename?: (id: string, draft: string) => Promise<RenameConversationResult>
}

function buildProps(overrides: Overrides = {}) {
  return {
    conversations: overrides.conversations ?? conversations,
    activeId: overrides.activeId ?? "a",
    pendingIds: overrides.pendingIds ?? new Set<string>(),
    renamingIds: overrides.renamingIds ?? new Set<string>(),
    // Pre-existing behavioural tests pin the GRANTED axis explicitly (the
    // hidden-subtree discipline): the rename controls exist on this surface.
    grantedShell: overrides.grantedShell ?? true,
    styles: collapsedStyles(false),
    history: { ...HISTORY_IDLE, ...overrides.history },
    onSelect: overrides.onSelect ?? (() => {}),
    onCloseMobile: overrides.onCloseMobile ?? (() => {}),
    onRetryHistory: overrides.onRetryHistory ?? (() => {}),
    onLoadMore: overrides.onLoadMore ?? (() => {}),
    onRename: overrides.onRename ?? (async () => ({ ok: true }) as const),
  }
}

function renderList(overrides: Overrides = {}) {
  return render(<ConversationList {...buildProps(overrides)} />)
}

function nav(): HTMLElement {
  return screen.getByRole("navigation", { name: "Conversations" })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// The row's SELECT button, told apart from its pencil sibling (named
// "Rename <title>") by anchoring on the title: the select button's accessible
// name STARTS with the title (sr-only suffixes follow), the pencil's does not.
function rowByTitle(title: string): HTMLElement {
  return within(nav()).getByRole("button", {
    name: new RegExp(`^${escapeRegExp(title)}`),
  })
}

function pencilFor(title: string): HTMLElement {
  return within(nav()).getByRole("button", { name: `Rename ${title}` })
}

function queryPencilFor(title: string): HTMLElement | null {
  return within(nav()).queryByRole("button", { name: `Rename ${title}` })
}

function editorInput(): HTMLInputElement {
  return within(nav()).getByRole<HTMLInputElement>("textbox", {
    name: "Conversation name",
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
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

  it("marks only the active row's SELECT button with aria-current", () => {
    renderList({ activeId: "b" })
    expect(rowByTitle("Second chat")).toHaveAttribute("aria-current", "true")
    expect(rowByTitle("First chat")).not.toHaveAttribute("aria-current")
    // The pencil sibling never carries it.
    expect(pencilFor("Second chat")).not.toHaveAttribute("aria-current")
    expect(
      within(nav()).getAllByRole("button", { current: true }),
    ).toHaveLength(1)
  })

  it("renders exactly one <li> per row, holding the select button and the pencil", () => {
    renderList()
    const items = within(nav()).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getAllByRole("button")).toHaveLength(2)
  })

  it("renders the replying pulse only on conversations awaiting a reply, inside the row", () => {
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
    expect(nav()).toBeInTheDocument()
    expect(within(nav()).queryAllByRole("listitem")).toHaveLength(0)
  })
})

describe("ConversationList — server history states (feat-241)", () => {
  it("renders date-derived fallback labels for untitled rows; distinct dates stay distinguishable (AE6)", () => {
    renderList({
      conversations: [
        {
          ...UNTITLED_ROW,
          id: "s1",
          lastActivityAt: "2026-07-10T08:00:00.000Z",
        },
        { ...UNTITLED_ROW, id: "s2", title: "   " },
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
          ...SERVER_ROW,
          id: "gone",
          title: "Old thread",
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
    const skeleton = nav().querySelector('[data-history="loading"]')
    expect(skeleton).not.toBeNull()
    expect(skeleton).toHaveAttribute("aria-live", "polite")
    expect(skeleton).toHaveTextContent("Loading conversations")
  })

  it("shows the error state as an announced alert with a working retry", async () => {
    const onRetryHistory = vi.fn()
    renderList({ history: { error: true }, onRetryHistory })
    // role="alert" so AT users hear the failure, not just the earlier
    // polite loading announcement.
    expect(within(nav()).getByRole("alert")).toHaveTextContent(
      "couldn't be loaded",
    )
    await user.click(within(nav()).getByRole("button", { name: "Retry" }))
    expect(onRetryHistory).toHaveBeenCalledTimes(1)
  })

  it("shows Load more when more pages exist and fires the handler", async () => {
    const onLoadMore = vi.fn()
    renderList({ history: { hasMore: true }, onLoadMore })
    await user.click(within(nav()).getByRole("button", { name: "Load more" }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it("disables Load more while a page is in flight", () => {
    renderList({ history: { hasMore: true, loadingMore: true } })
    expect(
      within(nav()).getByRole("button", { name: "Loading…" }),
    ).toBeDisabled()
  })

  it("keeps existing rows and offers an announced inline retry when Load more fails", () => {
    renderList({ history: { hasMore: true, loadMoreError: true } })
    // Page-1 rows stay rendered; the failure is announced (role="alert").
    expect(rowByTitle("First chat")).toBeInTheDocument()
    expect(within(nav()).getByRole("alert")).toHaveTextContent(
      "Couldn't load more.",
    )
    expect(within(nav()).getByRole("button", { name: "Retry" })).toBeEnabled()
  })

  it("renders nothing extra for an empty, loaded server list (today's look, R16)", () => {
    renderList({ history: HISTORY_IDLE })
    expect(nav().querySelector("[data-history]")).toBeNull()
  })
})

describe("ConversationList — rename control (feat-450: R1–R4, KTD8)", () => {
  it("renders a select button and a pencil per row on a granted shell", () => {
    renderList({ conversations: [SERVER_ROW], activeId: "" })
    expect(rowByTitle("Server thread")).toBeInTheDocument()
    expect(pencilFor("Server thread")).toBeInTheDocument()
  })

  it("renders no pencil on a non-granted shell (R2)", () => {
    renderList({
      conversations: [SERVER_ROW],
      activeId: "",
      grantedShell: false,
    })
    expect(rowByTitle("Server thread")).toBeInTheDocument()
    expect(queryPencilFor("Server thread")).toBeNull()
    expect(within(nav()).getAllByRole("button")).toHaveLength(1)
  })

  it("hides the pencil on a not_available row (R3)", () => {
    renderList({
      conversations: [{ ...SERVER_ROW, replay: "not_available" }],
      activeId: "",
    })
    expect(queryPencilFor("Server thread")).toBeNull()
  })

  it("disables the pencil while the row has a send in flight (R3)", () => {
    renderList({
      conversations: [SERVER_ROW],
      activeId: "",
      pendingIds: new Set([SERVER_ROW.id]),
    })
    expect(pencilFor("Server thread")).toBeDisabled()
  })

  it("disables the pencil while the row's rename is in flight (R3)", () => {
    renderList({
      conversations: [SERVER_ROW],
      activeId: "",
      renamingIds: new Set([SERVER_ROW.id]),
    })
    expect(pencilFor("Server thread")).toBeDisabled()
  })

  it("names the pencil 'Rename <displayTitle>' — the date fallback for an untitled row", () => {
    renderList({ conversations: [UNTITLED_ROW], activeId: "" })
    expect(
      pencilFor(fallbackTitle(UNTITLED_ROW.lastActivityAt!)),
    ).toBeInTheDocument()
  })

  it("does not call onSelect or onCloseMobile when the pencil is clicked", async () => {
    const onSelect = vi.fn()
    const onCloseMobile = vi.fn()
    renderList({
      conversations: [SERVER_ROW],
      activeId: "",
      onSelect,
      onCloseMobile,
    })
    await user.click(pencilFor("Server thread"))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCloseMobile).not.toHaveBeenCalled()
    expect(editorInput()).toBeInTheDocument()
  })

  // Pointer-capability wiring (R4/KTD8) is a class contract: Tailwind v4's
  // `group-hover:` is `(hover: hover)`-scoped and `pointer-coarse:` is the
  // coarse-pointer variant. jsdom applies no CSS; the browser smoke proves it.
  it("wires the pencil's reveal to hover/focus-within, always-visible on coarse pointers and in the drawer", () => {
    renderList({ conversations: [SERVER_ROW], activeId: "" })
    const pencil = pencilFor("Server thread")
    const li = pencil.closest("li")!
    expect(li.className).toContain("group")
    for (const token of [
      "opacity-0",
      "group-hover:opacity-100",
      "group-focus-within:opacity-100",
      "pointer-coarse:opacity-100",
      "max-md:opacity-100",
    ]) {
      expect(pencil.className.split(/\s+/)).toContain(token)
    }
  })
})

describe("ConversationList — inline editor (feat-450: R5–R8, KTD9)", () => {
  function renderEditable(
    over: Overrides = {},
    row: Conversation = SERVER_ROW,
  ) {
    return renderList({ conversations: [row], activeId: "", ...over })
  }

  it("prefills the current title, bounds it at 120 units, and marks the input as the Escape owner", async () => {
    renderEditable()
    await user.click(pencilFor("Server thread"))
    const input = editorInput()
    expect(input).toHaveValue("Server thread")
    expect(input).toHaveAttribute("maxlength", "120")
    expect(input).toHaveAttribute("data-escape-owner")
    // Entering edit moves focus into the input (latch armed in the handler).
    expect(document.activeElement).toBe(input)
    // The select button and pencil are replaced by the editor for that row.
    expect(
      within(nav()).queryByRole("button", { name: /^Server thread/ }),
    ).toBeNull()
  })

  it("opens an untitled row EMPTY with the date label as placeholder (AE2 UI half, R8)", async () => {
    renderEditable({}, UNTITLED_ROW)
    const label = fallbackTitle(UNTITLED_ROW.lastActivityAt!)
    await user.click(pencilFor(label))
    const input = editorInput()
    expect(input).toHaveValue("")
    expect(input).toHaveAttribute("placeholder", label)
  })

  it("Enter without typing on an untitled row closes the editor with NO call (AE2)", async () => {
    const onRename = vi.fn(async () => ({ ok: true }) as const)
    renderEditable({ onRename }, UNTITLED_ROW)
    const label = fallbackTitle(UNTITLED_ROW.lastActivityAt!)
    await user.click(pencilFor(label))
    await user.keyboard("{Enter}")
    expect(onRename).not.toHaveBeenCalled()
    expect(within(nav()).queryByRole("textbox")).toBeNull()
    expect(rowByTitle(label)).toBeInTheDocument()
  })

  it("Enter calls onRename once with the draft and closes on ok; focus returns to the select button", async () => {
    const onRename = vi.fn(async () => ({ ok: true }) as const)
    renderEditable({ onRename })
    await user.click(pencilFor("Server thread"))
    await user.clear(editorInput())
    await user.type(editorInput(), "Renamed thread{Enter}")
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith(SERVER_ROW.id, "Renamed thread")
    expect(within(nav()).queryByRole("textbox")).toBeNull()
    expect(document.activeElement).toBe(rowByTitle("Server thread"))
  })

  it("Enter on an unchanged (or whitespace-padded) draft closes without a call (R7)", async () => {
    const onRename = vi.fn(async () => ({ ok: true }) as const)
    renderEditable({ onRename })
    await user.click(pencilFor("Server thread"))
    await user.type(editorInput(), "  {Enter}")
    expect(onRename).not.toHaveBeenCalled()
    expect(within(nav()).queryByRole("textbox")).toBeNull()
  })

  it("Escape cancels with no call, restores the title, and returns focus to the select button", async () => {
    const onRename = vi.fn(async () => ({ ok: true }) as const)
    renderEditable({ onRename })
    await user.click(pencilFor("Server thread"))
    await user.type(editorInput(), " edited{Escape}")
    expect(onRename).not.toHaveBeenCalled()
    expect(within(nav()).queryByRole("textbox")).toBeNull()
    expect(rowByTitle("Server thread")).toBeInTheDocument()
    expect(document.activeElement).toBe(rowByTitle("Server thread"))
  })

  it("blur before submit cancels with no call and does NOT move focus", async () => {
    const onRename = vi.fn(async () => ({ ok: true }) as const)
    renderEditable({ onRename })
    await user.click(pencilFor("Server thread"))
    await user.type(editorInput(), " edited")
    await user.tab()
    expect(onRename).not.toHaveBeenCalled()
    expect(within(nav()).queryByRole("textbox")).toBeNull()
    expect(document.activeElement).not.toBe(rowByTitle("Server thread"))
  })

  it("while saving the input is read-only with the Saving pulse; a second Enter does not call again; blur does not cancel", async () => {
    const gate = deferred<RenameConversationResult>()
    const onRename = vi.fn(() => gate.promise)
    renderEditable({ onRename })
    await user.click(pencilFor("Server thread"))
    await user.type(editorInput(), " two{Enter}")
    expect(onRename).toHaveBeenCalledTimes(1)
    const input = editorInput()
    expect(input).toHaveAttribute("readonly")
    expect(nav().querySelector("[data-saving]")).not.toBeNull()
    expect(nav()).toHaveTextContent("Saving")
    await user.keyboard("{Enter}")
    expect(onRename).toHaveBeenCalledTimes(1)
    await user.tab()
    expect(editorInput()).toBeInTheDocument()
    gate.resolve({ ok: true })
    await screen.findByRole("button", { name: /^Server thread/ })
    expect(within(nav()).queryByRole("textbox")).toBeNull()
  })

  it.each([
    ["access", "Your access has changed. Sign in again to check."],
    ["invalid_title", "That name can't be used. Try different text."],
    ["unavailable", "Couldn't rename. Try again."],
  ] as const)(
    "a %s failure keeps the editor open with the draft and shows its notice (AE6)",
    async (reason, copy) => {
      const onRename = vi.fn(async () => ({ ok: false, reason }) as const)
      renderEditable({ onRename })
      await user.click(pencilFor("Server thread"))
      await user.type(editorInput(), " kept{Enter}")
      const alert = await within(nav()).findByRole("alert")
      expect(alert).toHaveTextContent(copy)
      expect(editorInput()).toHaveValue("Server thread kept")
      expect(editorInput()).not.toHaveAttribute("readonly")
      // Focus stays where the user left it.
      expect(document.activeElement).toBe(editorInput())
      // Failed → Saving: Enter submits again.
      await user.keyboard("{Enter}")
      expect(onRename).toHaveBeenCalledTimes(2)
    },
  )

  it("a not_available failure closes the editor; the row becomes muted with no pencil once the prop lands (AE7)", async () => {
    const onRename = vi.fn(
      async () => ({ ok: false, reason: "not_available" }) as const,
    )
    const view = renderEditable({ onRename })
    await user.click(pencilFor("Server thread"))
    await user.type(editorInput(), " gone{Enter}")
    await screen.findByRole("button", { name: /^Server thread/ })
    expect(within(nav()).queryByRole("textbox")).toBeNull()
    // The session marks the row; the list reflects the new prop.
    view.rerender(
      <ConversationList
        {...buildProps({
          conversations: [{ ...SERVER_ROW, replay: "not_available" }],
          activeId: "",
          onRename,
        })}
      />,
    )
    expect(rowByTitle("Server thread").className).toContain("opacity-50")
    expect(queryPencilFor("Server thread")).toBeNull()
  })

  it("a title prop change while editing does not change the input value (R17)", async () => {
    const view = renderEditable()
    await user.click(pencilFor("Server thread"))
    await user.type(editorInput(), " mine")
    view.rerender(
      <ConversationList
        {...buildProps({
          conversations: [{ ...SERVER_ROW, title: "LLM retitled" }],
          activeId: "",
        })}
      />,
    )
    expect(editorInput()).toHaveValue("Server thread mine")
  })

  it("a slow rename settling does not clobber an editor opened on ANOTHER row (review fix)", async () => {
    const gateA = deferred<RenameConversationResult>()
    const onRename = vi.fn((id: string) =>
      id === "s1" ? gateA.promise : Promise.resolve({ ok: true } as const),
    )
    const second: Conversation = { ...SERVER_ROW, id: "s9", title: "Other" }
    renderList({ conversations: [SERVER_ROW, second], activeId: "", onRename })
    await user.click(pencilFor("Server thread"))
    await user.type(editorInput(), " one{Enter}")
    expect(editorInput()).toHaveAttribute("readonly")
    // Open row B's editor while A is still saving, and type into it.
    await user.click(pencilFor("Other"))
    await user.type(editorInput(), " draft")
    expect(editorInput()).toHaveValue("Other draft")
    gateA.resolve({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // B's editor survives A's stale settle, with its draft and its focus.
    expect(editorInput()).toHaveValue("Other draft")
    expect(editorInput()).not.toHaveAttribute("readonly")
    expect(document.activeElement).toBe(editorInput())
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it("does not steal focus on settle when the person moved on during saving (review fix)", async () => {
    const gate = deferred<RenameConversationResult>()
    renderEditable({ onRename: vi.fn(() => gate.promise) })
    await user.click(pencilFor("Server thread"))
    await user.type(editorInput(), " two{Enter}")
    // Blur is ignored while saving, so focus can legitimately leave.
    const elsewhere = document.createElement("button")
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    expect(document.activeElement).toBe(elsewhere)
    gate.resolve({ ok: true })
    await screen.findByRole("button", { name: /^Server thread/ })
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  it("keeps aria-current on the ACTIVE row's select button after a rename round trip", async () => {
    renderEditable({ activeId: SERVER_ROW.id })
    expect(rowByTitle("Server thread")).toHaveAttribute("aria-current", "true")
    await user.click(pencilFor("Server thread"))
    await user.type(editorInput(), " x{Enter}")
    await screen.findByRole("button", { name: /^Server thread/ })
    expect(rowByTitle("Server thread")).toHaveAttribute("aria-current", "true")
  })
})
