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
import type { VideoLibraryItem } from "./block-helpers"

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

function makeVideo(overrides: Partial<VideoLibraryItem>): VideoLibraryItem {
  return {
    key: "vid1",
    title: "The Resurrection",
    description: null,
    id: "core-vid1",
    label: null,
    labelLabel: null,
    sourceLabel: "Core",
    sourceTone: "success",
    dubs: "1 dub",
    updated: "2026-06-01T00:00:00.000Z",
    duration: "10:00",
    durationSeconds: 600,
    previewImageUrl: null,
    previewStreamUrl: "https://example.com/v.m3u8",
    hasGrounding: true,
    ...overrides,
  }
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

  it("renders optional utility controls inside the chat rail", async () => {
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={makeActions()}
        utilitySlot={<button type="button">Create persona version</button>}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const panel = view.container.querySelector(
      '[data-testid="experience-chat-panel"]',
    )
    expect(panel?.textContent).toContain("Create persona version")
  })

  it("reports Experience-mutating generation as busy", async () => {
    const onBusyChange = vi.fn()
    const draftDeferred: {
      resolve?: (result: {
        ok: true
        draft: {
          title: string
          metaDescription: string
          blocks: unknown[]
        }
      }) => void
    } = {}
    const generateDraftAction = vi.fn(
      () =>
        new Promise<{
          ok: true
          draft: {
            title: string
            metaDescription: string
            blocks: unknown[]
          }
        }>((resolve) => {
          draftDeferred.resolve = resolve
        }),
    )
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={makeActions()}
        generateDraftAction={generateDraftAction}
        onBusyChange={onBusyChange}
      />,
    )
    cleanup = view.cleanup
    await flush()
    onBusyChange.mockClear()

    const textarea = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    )
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Chat input not found")
    }
    setTextareaValue(textarea, "Create a hopeful draft")
    const quickDraft = view.container.querySelector(
      '[data-testid="experience-chat-quick-draft"]',
    )
    if (!(quickDraft instanceof HTMLButtonElement)) {
      throw new Error("Quick draft button not found")
    }

    act(() => quickDraft.click())
    await flush()
    expect(onBusyChange).toHaveBeenCalledWith(true)

    draftDeferred.resolve?.({
      ok: true,
      draft: {
        title: "Hope",
        metaDescription: "A hopeful page",
        blocks: [],
      },
    })
    await flush()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it("video-anchored section: stages an append-mode draft and Apply appends to existing canvas blocks", async () => {
    const existingBlock = {
      t: "text",
      heading: "Existing",
      contentParagraphs: ["x"],
    }
    const state: EditableLocaleState = {
      title: "Existing Title",
      metaDescription: "Existing meta",
      ogImageUrl: null,
      blocks: [existingBlock],
    }
    const canvas: ExperienceCanvasController & {
      applyDiff: ReturnType<typeof vi.fn>
      revertDiff: ReturnType<typeof vi.fn>
    } = {
      getState: () => state,
      applyDiff: vi.fn(),
      revertDiff: vi.fn(),
    }
    const sectionBlocks = [
      { t: "videoHero", videoId: "vid1", heading: "The Resurrection" },
      {
        t: "relatedQuestions",
        questions: [{ question: "Why?", answer: "Because." }],
      },
    ]
    const generateSectionAction = vi.fn().mockResolvedValue({
      ok: true,
      draft: {
        title: "The Resurrection",
        metaDescription: "meta",
        blocks: sectionBlocks,
      },
      review: {
        scriptureNotes: ["note"],
        researchNotes: [],
        theologyReview: { status: "passed", notes: [] },
        referenceLedger: [
          {
            sourceKind: "video_candidate",
            claim: "Anchor",
            reference: "The Resurrection",
            candidateRef: "v01",
          },
        ],
      },
    })

    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={canvas}
        actions={makeActions()}
        videoLibrary={[makeVideo({ key: "vid1", title: "The Resurrection" })]}
        generateSectionAction={generateSectionAction}
      />,
    )
    cleanup = view.cleanup
    await flush()

    // Open the picker, choose a video — no raw id is typed (Covers AE1).
    const chooseBtn = view.container.querySelector(
      '[data-testid="experience-chat-choose-video"]',
    ) as HTMLButtonElement
    await act(async () => {
      chooseBtn.click()
    })
    const row = document.querySelector(
      '[data-video-key="vid1"]',
    ) as HTMLButtonElement
    await act(async () => {
      row.click()
    })
    await flush()

    const genBtn = view.container.querySelector(
      '[data-testid="experience-chat-generate-section"]',
    ) as HTMLButtonElement
    await act(async () => {
      genBtn.click()
    })
    await flush()

    expect(generateSectionAction).toHaveBeenCalledWith({
      anchorVideoId: "vid1",
    })

    const applyBtn = view.container.querySelector(
      '[data-testid="experience-chat-draft-apply"]',
    ) as HTMLButtonElement
    expect(applyBtn).not.toBeNull()
    await act(async () => {
      applyBtn.click()
    })
    await flush()

    expect(canvas.applyDiff).toHaveBeenCalledTimes(1)
    const arg = canvas.applyDiff.mock.calls[0][0] as { blocks: unknown[] }
    // Append: existing block preserved + section blocks added (not replaced).
    expect(arg.blocks).toHaveLength(1 + sectionBlocks.length)
    expect(arg.blocks[0]).toMatchObject({ heading: "Existing" })
    expect(arg.blocks[1]).toMatchObject({ t: "videoHero" })
  })

  it("video-anchored section: Generate is disabled until a video is chosen, and no raw-id input remains", async () => {
    const generateSectionAction = vi.fn()
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={makeActions()}
        videoLibrary={[makeVideo({ key: "vid1", title: "The Resurrection" })]}
        generateSectionAction={generateSectionAction}
      />,
    )
    cleanup = view.cleanup
    await flush()

    // The old raw-id text input is gone.
    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-anchor-input"]',
      ),
    ).toBeNull()

    const genBtn = view.container.querySelector(
      '[data-testid="experience-chat-generate-section"]',
    ) as HTMLButtonElement
    expect(genBtn.disabled).toBe(true)
    // Clicking while disabled is a no-op.
    await act(async () => {
      genBtn.click()
    })
    expect(generateSectionAction).not.toHaveBeenCalled()

    // Choose a video → button enables.
    const chooseBtn = view.container.querySelector(
      '[data-testid="experience-chat-choose-video"]',
    ) as HTMLButtonElement
    await act(async () => {
      chooseBtn.click()
    })
    const row = document.querySelector(
      '[data-video-key="vid1"]',
    ) as HTMLButtonElement
    await act(async () => {
      row.click()
    })
    await flush()

    expect(genBtn.disabled).toBe(false)
    // The chosen video's title is surfaced.
    const chosen = view.container.querySelector(
      '[data-testid="experience-chat-anchor-chosen"]',
    ) as HTMLElement
    expect(chosen.textContent).toContain("The Resurrection")
  })

  it("video-anchored section: surfaces the backend error for an ineligible pick (Covers AE3)", async () => {
    const generateSectionAction = vi.fn().mockResolvedValue({
      ok: false,
      code: "NO_GROUNDING",
      error:
        "This video has no study questions or scripture to ground a section.",
    })
    const view = mount(
      <ExperienceChatPanel
        experienceLocaleId="locale-1"
        locale="en"
        canvasController={makeCanvasController()}
        actions={makeActions()}
        videoLibrary={[
          makeVideo({
            key: "bare",
            title: "Bare Clip",
            previewStreamUrl: null,
            hasGrounding: false,
          }),
        ]}
        generateSectionAction={generateSectionAction}
      />,
    )
    cleanup = view.cleanup
    await flush()

    const chooseBtn = view.container.querySelector(
      '[data-testid="experience-chat-choose-video"]',
    ) as HTMLButtonElement
    await act(async () => {
      chooseBtn.click()
    })
    // A non-ready video is still selectable — the badge does not gate.
    const row = document.querySelector(
      '[data-video-key="bare"]',
    ) as HTMLButtonElement
    await act(async () => {
      row.click()
    })
    await flush()

    const genBtn = view.container.querySelector(
      '[data-testid="experience-chat-generate-section"]',
    ) as HTMLButtonElement
    await act(async () => {
      genBtn.click()
    })
    await flush()

    expect(generateSectionAction).toHaveBeenCalledWith({
      anchorVideoId: "bare",
    })
    const error = view.container.querySelector(
      '[data-testid="experience-chat-draft-workflow-error"]',
    ) as HTMLElement
    expect(error).not.toBeNull()
    expect(error.textContent).toContain("no study questions or scripture")
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
      {
        type: "done",
        messageId: "m-final",
        producedBy: "experience-default-chat",
      },
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
      {
        type: "done",
        messageId: "asst-1",
        producedBy: "experience-default-chat",
      },
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

  it("renders the composer with no provider dropdown (mastra is the only channel)", async () => {
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

    expect(
      view.container.querySelector('[data-testid="experience-chat-provider"]'),
    ).toBeNull()
    expect(view.container.querySelector("select")).toBeNull()
    expect(
      view.container.querySelector('[data-testid="experience-chat-input"]'),
    ).not.toBeNull()
  })

  it("calls openChatStream with no provider field on send", async () => {
    const actions = makeActions()
    const streamFactory = makeStreamFactory([
      {
        type: "done",
        messageId: "m-final",
        producedBy: "experience-default-chat",
      },
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
    setTextareaValue(input, "say hi")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-send"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    expect(streamFactory).toHaveBeenCalledTimes(1)
    const [body] = (streamFactory as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(body).toMatchObject({ prompt: "say hi" })
    expect(body).not.toHaveProperty("provider")
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

  it("thread switch mid-stream does not write A's diff/message into thread B", async () => {
    // Two threads exist. Sending on the active thread (t-a) starts a
    // stream that PAUSES before its mutation_applied/done. We switch to
    // t-b mid-stream, then let the stream finish: its diff must not hit
    // the canvas and its assistant message must not appear in t-b.
    let releaseStream: (() => void) | null = null
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve
    })
    const diff: ExperienceChatDiff = {
      scalars: { title: { before: "Old", after: "Stale A" } },
    }
    const streamFactory = vi.fn(async function* () {
      yield { type: "token_delta" as const, text: "partial A" }
      await streamGate
      yield { type: "mutation_applied" as const, messageId: "asst-A", diff }
      yield {
        type: "done" as const,
        messageId: "asst-A",
        producedBy: "experience-default-chat",
      }
    })
    const canvas = makeCanvasController()
    const actions = makeActions({
      listThreads: vi.fn().mockResolvedValue([
        {
          id: "t-a",
          title: "Thread A",
          createdAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        },
        {
          id: "t-b",
          title: "Thread B",
          createdAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
        },
      ]),
      getMessages: vi.fn().mockResolvedValue([]),
    })

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

    // Send on the active thread (t-a auto-selected).
    const input = view.container.querySelector(
      '[data-testid="experience-chat-input"]',
    ) as HTMLTextAreaElement
    setTextareaValue(input, "edit A")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-send"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    // Switch to thread B while A's stream is paused.
    const threadB = view.container.querySelector(
      '[data-testid="experience-chat-thread-t-b"]',
    ) as HTMLButtonElement
    act(() => threadB.click())
    await flush()

    // Release the paused stream — its terminal events fire now.
    act(() => releaseStream?.())
    await flush()
    await flush()

    // A's diff never reached the canvas (the switch happened first), and
    // A's assistant message is absent from B's (empty) message list.
    expect(canvas.applyDiff).not.toHaveBeenCalled()
    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-message-asst-A"]',
      ),
    ).toBeNull()
  })

  it("double-submit during thread creation is a no-op (one thread, one stream)", async () => {
    // createThread is slow; two rapid sends must not both create a thread
    // or both open a stream. The second send hits the creating_thread
    // busy guard.
    let resolveCreate: ((v: unknown) => void) | null = null
    const createThread = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    const streamFactory = makeStreamFactory([
      {
        type: "done",
        messageId: "m-final",
        producedBy: "experience-default-chat",
      },
    ])
    const actions = makeActions({ createThread })

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
    setTextareaValue(input, "first and only")
    await flush()

    const send = view.container.querySelector(
      '[data-testid="experience-chat-send"]',
    ) as HTMLButtonElement
    // Fire twice in a row before the create resolves.
    act(() => send.click())
    act(() => send.click())
    await flush()

    // Only one createThread dispatched despite two clicks.
    expect(createThread).toHaveBeenCalledTimes(1)

    // Resolve the create; the single stream then runs.
    act(() =>
      resolveCreate?.({
        id: "new-thread",
        title: "first and only",
        createdAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
      }),
    )
    await flush()
    await flush()

    expect(streamFactory).toHaveBeenCalledTimes(1)
  })

  it("shows an error (not a success message) when canvas applyDiff throws", async () => {
    // The mutation persisted server-side, but the canvas applyDiff throws.
    // The panel must surface an error state and NOT push the success
    // assistant message.
    const diff: ExperienceChatDiff = {
      scalars: { title: { before: "Old", after: "New" } },
    }
    const canvas = makeCanvasController()
    canvas.applyDiff.mockImplementation(() => {
      throw new Error("canvas rejected the patch")
    })
    const actions = makeActions()
    const streamFactory = makeStreamFactory([
      { type: "mutation_applied", messageId: "asst-err", diff },
      {
        type: "done",
        messageId: "asst-err",
        producedBy: "experience-default-chat",
      },
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
    setTextareaValue(input, "apply something")
    await flush()
    act(() =>
      (
        view.container.querySelector(
          '[data-testid="experience-chat-send"]',
        ) as HTMLButtonElement
      ).click(),
    )
    await flush()

    // Error block rendered; no success assistant message bubble.
    expect(
      view.container.querySelector('[data-testid="experience-chat-error"]'),
    ).not.toBeNull()
    expect(
      view.container.querySelector(
        '[data-testid="experience-chat-message-asst-err"]',
      ),
    ).toBeNull()
  })
})
