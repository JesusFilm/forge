// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatStreamEvent } from "@/services/experience-ai/experience-ai-chat.service"
import type {
  EditableLocaleState,
  ExperienceChatDiff,
} from "@/services/experience-ai/experience-chat-diff"
import {
  ExperienceChatPanel,
  type ExperienceCanvasController,
  type ExperienceChatPanelActions,
} from "./experience-chat-panel"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

// Quiet React's "not configured to support act" warnings. The existing
// experience-editor.test.tsx sets the same flag.
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

function makeCanvasController(): ExperienceCanvasController & {
  applyDiff: ReturnType<typeof vi.fn>
  revertDiff: ReturnType<typeof vi.fn>
} {
  const state: EditableLocaleState = {
    title: "Initial",
    metaDescription: null,
    ogImageUrl: null,
    blocks: [],
  }
  return {
    getState: () => state,
    applyDiff: vi.fn(),
    revertDiff: vi.fn(),
  }
}

function makeActions(overrides?: Partial<ExperienceChatPanelActions>) {
  const base = {
    listThreads: vi.fn().mockResolvedValue([]),
    createThread: vi.fn().mockImplementation(async ({ firstPrompt }) => ({
      id: "new-thread",
      title: firstPrompt.slice(0, 20),
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
    })),
    archiveThread: vi.fn().mockResolvedValue(undefined),
    getMessages: vi.fn().mockResolvedValue([]),
  }
  return Object.assign(base, overrides ?? {}) as typeof base &
    ExperienceChatPanelActions
}

function makeStreamFactory(events: ChatStreamEvent[]) {
  return vi.fn(async function* () {
    for (const evt of events) {
      // Simulate microtask boundaries between events.
      await Promise.resolve()
      yield evt
    }
  })
}

async function flush() {
  // Drain pending microtasks so async effects/promises resolve.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function mount(node: React.ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return {
    container,
    cleanup() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set
  act(() => {
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    textarea.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("ExperienceChatPanel", () => {
  let cleanup: (() => void) | null = null

  beforeEach(() => {
    cleanup = null
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  it("renders the empty-state placeholder when thread list is empty", async () => {
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={makeActions()}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const empty = view.container.querySelector(
      '[data-testid="experience-chat-empty-state"]',
    )
    expect(empty).not.toBeNull()
  })

  it("keeps the rail viewport-bound with an independently scrollable message list", async () => {
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={makeActions()}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const panel = view.container.querySelector(
      '[data-testid="experience-chat-panel"]',
    )
    expect(panel?.className).toContain("sticky")
    expect(panel?.className).toContain("top-12")
    expect(panel?.className).toContain("h-[calc(100vh-3rem)]")
    expect(panel?.className).toContain("overflow-hidden")

    const messageList = view.container.querySelector(
      '[data-testid="experience-chat-message-list"]',
    )
    expect(messageList?.className).toContain("min-h-0")
    expect(messageList?.className).toContain("overflow-y-auto")
  })

  it("renders the composer as a solid readable surface", async () => {
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={makeActions()}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const composer = view.container.querySelector(
      '[data-testid="experience-chat-composer"]',
    )
    expect(composer?.className).toContain("bg-[var(--color-surface)]")
    expect(composer?.className).toContain(
      "border-[var(--color-hairline-strong)]",
    )

    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    )
    expect(input?.className).toContain("bg-[var(--color-surface-inset)]")
    expect(input?.className).toContain(
      "placeholder:text-[var(--color-text-muted)]",
    )

    const send = view.container.querySelector(
      '[data-testid="experience-chat-send"]',
    )
    expect(send?.className).toContain(
      "disabled:bg-[var(--color-surface-raised)]",
    )
    expect(send?.className).toContain(
      "disabled:text-[var(--color-text-disabled)]",
    )
    expect(send?.className).toContain(
      "disabled:hover:bg-[var(--color-surface-raised)]",
    )
  })

  it("renders thread list and loads messages when a thread is clicked", async () => {
    const actions = makeActions({
      listThreads: vi.fn().mockResolvedValue([
        {
          id: "t-a",
          title: "First convo",
          createdAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        },
        {
          id: "t-b",
          title: "Second convo",
          createdAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        },
      ]),
      getMessages: vi.fn().mockResolvedValue([
        {
          id: "m-1",
          role: "USER",
          content: "first user msg",
          createdAt: new Date().toISOString(),
          snapshotDiff: null,
          mutationsApplied: null,
        },
      ]),
    })

    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={actions}
      />,
    )
    cleanup = view.cleanup
    await flush()

    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-thread-list"]',
      ),
    ).not.toBeNull()

    // The first thread auto-loads its messages on mount.
    expect(actions.getMessages).toHaveBeenCalledWith("t-a")

    // Click the second thread.
    const second = view.container.querySelector(
      '[data-testid="experience-chat-thread-t-b"]',
    ) as HTMLButtonElement
    expect(second).not.toBeNull()
    act(() => second.click())
    await flush()
    expect(actions.getMessages).toHaveBeenCalledWith("t-b")
  })

  it("creates a new thread when the New button is clicked", async () => {
    const actions = makeActions()
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={actions}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const btn = Array.from(view.container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Start new conversation",
    )
    expect(btn).toBeTruthy()
    act(() => btn!.click())
    await flush()
    expect(actions.createThread).toHaveBeenCalledTimes(1)
  })

  it("send fires the stream call with the right payload", async () => {
    const actions = makeActions()
    const streamFactory = makeStreamFactory([
      { type: "done", messageId: "m-final" },
    ])
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={actions}
        streamFactory={streamFactory as never}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    ) as HTMLTextAreaElement
    setTextareaValue(input, "expand the intro")
    await flush()

    const send = view.container.querySelector(
      '[data-testid="experience-chat-send"]',
    ) as HTMLButtonElement
    act(() => send.click())
    await flush()

    expect(actions.createThread).toHaveBeenCalledWith({
      firstPrompt: "expand the intro",
    })
    expect(streamFactory).toHaveBeenCalledTimes(1)
    const [body] = (streamFactory as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(body).toMatchObject({
      threadId: "new-thread",
      prompt: "expand the intro",
      confirmedAcrossLocales: false,
    })
  })

  it("stream events update UI: tokens accumulate, applyDiff called, done finalizes", async () => {
    const actions = makeActions()
    const canvas = makeCanvasController()
    const diff: ExperienceChatDiff = {
      scalars: { title: { before: "Old", after: "New" } },
    }
    const streamFactory = makeStreamFactory([
      { type: "token_delta", text: "Hello " },
      { type: "token_delta", text: "world" },
      { type: "mutation_applied", messageId: "asst-1", diff },
      { type: "done", messageId: "asst-1" },
    ])

    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={canvas}
        actions={actions}
        streamFactory={streamFactory as never}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    ) as HTMLTextAreaElement
    setTextareaValue(input, "go")
    await flush()
    const send = view.container.querySelector(
      '[data-testid="experience-chat-send"]',
    ) as HTMLButtonElement
    act(() => send.click())
    await flush()

    expect(canvas.applyDiff).toHaveBeenCalledWith(diff)
    // Final assistant message rendered with the streamed tokens.
    const final = view.container.querySelector(
      '[data-testid="experience-chat-message-asst-1"]',
    )
    expect(final?.textContent).toContain("Hello world")
  })

  it("shows an editable draft preview for first-draft proposals and applies only after confirmation", async () => {
    const actions = makeActions({
      listThreads: vi.fn().mockResolvedValue([
        {
          id: "thread-1",
          title: "Existing thread",
          createdAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        },
      ]),
      getMessages: vi.fn().mockResolvedValue([]),
    })
    const canvas = makeCanvasController()
    const streamFactory = makeStreamFactory([
      {
        type: "mutation_proposal",
        messageId: "draft-1",
        diff: {
          scalars: { title: { before: "Initial", after: "Generated" } },
          blocks: [{ op: "add", path: "/0", value: { type: "text" } }],
        },
        draft: {
          title: "Generated",
          metaDescription: "A generated description.",
          ogImageUrl: null,
          blocks: [{ type: "text", text: "Generated block" }],
        },
        review: {
          scriptureNotes: ["Matthew 11:28-30 anchors the draft."],
          researchNotes: [],
          theologyReview: { status: "passed", notes: [] },
          referenceLedger: [
            {
              sourceKind: "scripture",
              claim: "Jesus invites weary people to come to him.",
              reference: "Matthew 11:28-30",
            },
          ],
        },
      },
      { type: "done", messageId: "draft-1" },
    ])

    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={canvas}
        actions={actions}
        streamFactory={streamFactory as never}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    ) as HTMLTextAreaElement
    setTextareaValue(input, "Generate AI draft about hope")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-send"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    expect(canvas.applyDiff).not.toHaveBeenCalled()
    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-draft-preview"]',
      ),
    ).not.toBeNull()
    const userMessage = view.container.querySelector(
      '[data-testid^="experience-chat-message-pending-user-"]',
    )
    const preview = view.container.querySelector(
      '[data-testid="experience-chat-draft-preview"]',
    )
    expect(userMessage).not.toBeNull()
    expect(preview).not.toBeNull()
    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-quality-review"]',
      )?.textContent,
    ).toContain("Matthew 11:28-30 anchors the draft.")
    const orderedConversationItems = Array.from(
      view.container.querySelectorAll(
        '[data-testid^="experience-chat-message-pending-user-"], [data-testid="experience-chat-draft-preview"]',
      ),
    )
    expect(orderedConversationItems).toEqual([userMessage, preview])

    const titleInput = view.container.querySelector(
      '[data-testid="experience-chat-draft-title"]',
    ) as HTMLInputElement
    setInputValue(titleInput, "Edited")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-draft-apply"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    expect(canvas.applyDiff).toHaveBeenCalledWith({
      scalars: {
        title: { before: "Initial", after: "Edited" },
        metaDescription: { before: null, after: "A generated description." },
      },
      blocks: [{ type: "text", text: "Generated block" }],
    })
    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-message-draft-1"]',
      ),
    ).not.toBeNull()
  })

  it("renders a completed brief card and confirms generation with confirmedBrief", async () => {
    const actions = makeActions()
    const streamFactory = vi.fn(async function* (body: {
      confirmedBrief?: boolean
    }) {
      if (body.confirmedBrief) {
        yield { type: "done" as const, messageId: "final" }
        return
      }
      yield {
        type: "brief_update" as const,
        messageId: "brief-1",
        content: "Confirm this brief.",
        brief: {
          topicOrPassage: "Matthew 11:28-30",
          language: "English",
          audience: "young adults",
          desiredOutcome: "Trust Jesus with weariness.",
          tone: "Warm",
          pageType: "Experience page",
          scriptureEmphasis: "Center Matthew 11:28-30.",
          ctaOrNextStep: "Invite readers to pray.",
        },
        missingFields: [],
        confirmationRequired: true,
      }
      yield { type: "done" as const, messageId: "brief-1" }
    })

    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={actions}
        streamFactory={streamFactory as never}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    ) as HTMLTextAreaElement
    setTextareaValue(input, "Create an experience about rest")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-send"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-brief-confirmation"]',
      )?.textContent,
    ).toContain("Matthew 11:28-30")
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-brief-confirm"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    expect(streamFactory).toHaveBeenCalledTimes(2)
    expect(streamFactory.mock.calls[1][0]).toMatchObject({
      threadId: "new-thread",
      prompt: "Generate from this brief",
      confirmedBrief: true,
    })
  })

  it("stop button aborts the in-flight stream", async () => {
    const actions = makeActions()
    let abortedSignal: AbortSignal | undefined
    const streamFactory = vi.fn(async function* (
      _body: unknown,
      opts: { signal?: AbortSignal },
    ) {
      abortedSignal = opts.signal
      yield { type: "token_delta" as const, text: "..." }
      // Hang until aborted.
      await new Promise<void>((resolve) => {
        opts.signal?.addEventListener("abort", () => resolve())
      })
      yield { type: "error" as const, code: "cancelled" as const, message: "x" }
    })

    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={actions}
        streamFactory={streamFactory as never}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    ) as HTMLTextAreaElement
    setTextareaValue(input, "long task")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-send"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    const stop = view.container.querySelector(
      '[data-testid="experience-chat-stop"]',
    ) as HTMLButtonElement
    expect(stop).not.toBeNull()
    act(() => stop.click())
    await flush()

    expect(abortedSignal?.aborted).toBe(true)
  })

  it("undo button on assistant message calls revertDiff with the message diff", async () => {
    const diff: ExperienceChatDiff = {
      scalars: { title: { before: "A", after: "B" } },
    }
    const actions = makeActions({
      listThreads: vi.fn().mockResolvedValue([
        {
          id: "t-1",
          title: "Convo",
          createdAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        },
      ]),
      getMessages: vi.fn().mockResolvedValue([
        {
          id: "asst-x",
          role: "ASSISTANT",
          content: "Did the thing.",
          createdAt: new Date().toISOString(),
          snapshotDiff: diff,
          mutationsApplied: null,
        },
      ]),
    })
    const canvas = makeCanvasController()

    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={canvas}
        actions={actions}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const undoBtn = view.container.querySelector(
      '[data-testid="experience-chat-undo-asst-x"]',
    ) as HTMLButtonElement
    expect(undoBtn).not.toBeNull()
    act(() => undoBtn.click())
    await flush()

    expect(canvas.revertDiff).toHaveBeenCalledWith(diff)
  })

  it("cross-locale modal appears when toggle is on; cancel does not submit", async () => {
    const actions = makeActions()
    const streamFactory = makeStreamFactory([])
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={actions}
        streamFactory={streamFactory as never}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const toggle = view.container.querySelector(
      '[data-testid="experience-chat-cross-locale-toggle"]',
    ) as HTMLInputElement
    act(() => {
      toggle.click()
    })
    await flush()
    expect(toggle.checked).toBe(true)

    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    ) as HTMLTextAreaElement
    setTextareaValue(input, "do the thing across locales")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-send"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    // Modal opened (it's portalled into the panel root with role=dialog).
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()

    // Cancel.
    const cancelBtn = Array.from(dialog!.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Cancel",
    )
    expect(cancelBtn).toBeTruthy()
    act(() => cancelBtn!.click())
    await flush()

    expect(streamFactory).not.toHaveBeenCalled()
  })

  it("error event renders typed terminal state on the in-flight bubble", async () => {
    const actions = makeActions()
    const streamFactory = makeStreamFactory([
      { type: "token_delta", text: "partial..." },
      { type: "error", code: "schema_violation", message: "bad envelope" },
    ])
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={actions}
        streamFactory={streamFactory as never}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    ) as HTMLTextAreaElement
    setTextareaValue(input, "force error")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-send"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    const errorEl = view.container.querySelector(
      '[data-testid="experience-chat-error"]',
    )
    expect(errorEl).not.toBeNull()
    expect(errorEl?.getAttribute("data-error-code")).toBe("schema_violation")
    // U8: untyped error.message strings ("bad envelope") must NOT leak
    // past the service layer. The panel renders the typed presentation
    // map keyed by code instead.
    expect(errorEl?.textContent).not.toContain("bad envelope")
    expect(errorEl?.textContent).toContain("Invalid change")
    expect(errorEl?.getAttribute("data-severity")).toBe("error")
    // schema_violation is a retryable code → "Try again" button present.
    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-error-retry"]',
      ),
    ).not.toBeNull()
  })

  it("renders cancelled errors with severity=warn and no retry button", async () => {
    const actions = makeActions()
    const streamFactory = makeStreamFactory([
      { type: "error", code: "cancelled", message: "user stopped" },
    ])

    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={actions}
        streamFactory={streamFactory as never}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    ) as HTMLTextAreaElement
    setTextareaValue(input, "stop me")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-send"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    const errorEl = view.container.querySelector(
      '[data-testid="experience-chat-error"]',
    )
    expect(errorEl).not.toBeNull()
    expect(errorEl?.getAttribute("data-error-code")).toBe("cancelled")
    expect(errorEl?.getAttribute("data-severity")).toBe("warn")
    expect(errorEl?.textContent).not.toContain("user stopped")
    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-error-retry"]',
      ),
    ).toBeNull()
  })
})
