/**
 * @vitest-environment jsdom
 */

import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations:
    (
      namespace:
        | "WatchEndReflection"
        | "WatchStudyQuestions"
        | "WatchQuestionPanel",
    ) =>
    (key: string, values?: Record<string, number>) => {
      const messages: Record<string, string> = {
        eyebrow: "Take a moment",
        reflectionSupport: "There is no rush. Think about what you watched.",
        back: "Back",
        nextQuestion: "Next question",
        seeNextSteps: "See next steps",
        replay: "Watch again",
        dismiss: "Close reflection",
        nextStepsEyebrow: "Choose your next step",
        nextStepsTitle: "Keep going when you are ready.",
        nextStepsSupport: "Choose one way to respond to this story.",
        readInBible: "Read this in the Bible",
        readInBibleDetail: "Explore the passage behind this story.",
        askBibleQuestion: "Ask a Bible question",
        askBibleQuestionDetail: "Get help exploring Scripture.",
        talkToPerson: "Talk to a person",
        talkToPersonDetail: "Connect with someone ready to listen.",
        goDeeper: "Go deeper",
        goDeeperDetail: "Find a Bible study for your next step.",
        watchNext: "Watch next",
        watchNextDetail: "Continue to the next part of the story.",
        share: "Share this video",
        shareDetail: "Invite someone else into this story.",
        download: "Download video",
        downloadDetail: "Save a copy to watch later.",
        moreReflection: "Return to reflection",
        fieldLabel: "Ask a question about this video",
      }
      if (namespace === "WatchStudyQuestions") {
        return key === "placeholderQuestion"
          ? "What stays with you from this story?"
          : key
      }
      if (key === "questionProgress") {
        return `${values?.current} of ${values?.total}`
      }
      return messages[key] ?? key
    },
}))

import { WatchEndReflection } from "@/components/watch/WatchEndReflection"
import {
  findBibleReadHref,
  getBibleComUrl,
} from "@/components/watch/watch-next-step-links"

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

function renderReflection(
  overrides: Partial<ComponentProps<typeof WatchEndReflection>> = {},
) {
  const callbacks = {
    onDismiss: vi.fn(),
    onDownload: vi.fn(),
    onNext: vi.fn(),
    onReplay: vi.fn(),
    onShare: vi.fn(),
  }

  act(() => {
    root.render(
      <WatchEndReflection
        open
        prompts={["What did this story show you?", "What could change next?"]}
        bibleReadHref="https://www.bible.com/bible/111/John.3.16.NIV"
        {...callbacks}
        {...overrides}
      />,
    )
  })

  return callbacks
}

describe("WatchEndReflection", () => {
  it("starts with next steps, spotlights them in sequence, and opens reflection prompts on intent", () => {
    vi.useFakeTimers()
    try {
      renderReflection()

      const ask = container.querySelector(
        '[data-testid="watch-end-reflection-ask-bible"]',
      ) as HTMLButtonElement
      const talk = container.querySelector(
        '[data-testid="watch-end-reflection-talk-person"]',
      ) as HTMLButtonElement

      expect(container.textContent).toContain("Keep going when you are ready.")
      expect(ask.getAttribute("data-revealed")).toBe("true")
      expect(ask.getAttribute("data-highlighted")).toBe("true")
      expect(talk.getAttribute("data-revealed")).toBe("false")

      act(() => {
        vi.advanceTimersByTime(850)
      })

      expect(talk.getAttribute("data-revealed")).toBe("true")
      expect(talk.getAttribute("data-highlighted")).toBe("true")

      const actions = Array.from(
        container.querySelectorAll<HTMLElement>("[data-action-id]"),
      )
      for (let index = 0; index < actions.length; index += 1) {
        act(() => {
          vi.advanceTimersByTime(850)
        })
      }
      act(() => {
        vi.advanceTimersByTime(1_400)
      })
      expect(
        actions.every((action) => action.dataset.revealed === "true"),
      ).toBe(true)
      expect(
        actions.every((action) => action.dataset.highlighted === "false"),
      ).toBe(true)

      act(() => {
        ask.click()
      })

      expect(
        container.querySelector(
          '[data-testid="watch-end-reflection-ask-panel"]',
        ),
      ).not.toBeNull()
      expect(container.textContent).toContain("What did this story show you?")
      expect(container.textContent).toContain("What could change next?")
      expect(
        container.querySelector(
          '[data-testid="watch-end-reflection-question-input"]',
        ),
      ).not.toBeNull()

      const suggested = container.querySelector(
        '[data-testid="watch-end-reflection-suggested-question"]',
      ) as HTMLButtonElement
      act(() => {
        suggested.click()
      })
      expect(
        (
          container.querySelector(
            '[data-testid="watch-end-reflection-question-input"]',
          ) as HTMLTextAreaElement
        ).value,
      ).toBe("What did this story show you?")
    } finally {
      vi.useRealTimers()
    }
  })

  it("offers safe external destinations and delegates Watch-owned actions", () => {
    const callbacks = renderReflection({ prompts: ["One question"] })
    const bible = container.querySelector(
      '[data-testid="watch-end-reflection-read-bible"]',
    ) as HTMLAnchorElement
    expect(bible.href).toBe("https://www.bible.com/bible/111/John.3.16.NIV")
    expect(bible.target).toBe("_blank")
    expect(bible.rel).toContain("noopener")
    expect(bible.rel).toContain("noreferrer")

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-next-watch"]',
        ) as HTMLButtonElement
      ).click()
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-download"]',
        ) as HTMLButtonElement
      ).click()
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-share"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-share-panel"]',
      ),
    ).not.toBeNull()

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-share-submit"]',
        ) as HTMLButtonElement
      ).click()
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-detail-back"]',
        ) as HTMLButtonElement
      ).click()
    })

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-replay"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(callbacks.onNext).toHaveBeenCalledOnce()
    expect(callbacks.onShare).toHaveBeenCalledOnce()
    expect(callbacks.onDownload).toHaveBeenCalledOnce()
    expect(callbacks.onReplay).toHaveBeenCalledOnce()
  })

  it("shows a people-and-language handoff before opening live chat", () => {
    renderReflection()

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-talk-person"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-talk-panel"]',
      ),
    ).not.toBeNull()
    expect(container.textContent).toContain("English")
    expect(container.textContent).toContain("Español")
    expect(container.textContent).toContain("Français")

    const chat = container.querySelector(
      '[data-testid="watch-end-reflection-talk-submit"]',
    ) as HTMLAnchorElement
    expect(chat.href).toContain("chataboutjesus.com/chat/")
    expect(chat.target).toBe("_blank")
    expect(chat.rel).toContain("noopener")
  })

  it("uses the translated study-question fallback and supports layered Escape dismissal", () => {
    const callbacks = renderReflection({ prompts: [] })
    const dialog = container.querySelector(
      '[data-testid="watch-end-reflection"]',
    ) as HTMLDivElement

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-ask-bible"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(dialog.textContent).toContain("What stays with you from this story?")
    expect(dialog.className).toContain("motion-reduce:animate-none")

    act(() => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })
    expect(callbacks.onDismiss).not.toHaveBeenCalled()

    act(() => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })
    expect(callbacks.onDismiss).toHaveBeenCalledOnce()
  })

  it("uses a viewport-fixed scroll surface without a decorated parent shell", () => {
    renderReflection()

    const dialog = container.querySelector(
      '[data-testid="watch-end-reflection"]',
    ) as HTMLDivElement
    const content = container.querySelector(
      '[data-testid="watch-end-reflection-content"]',
    ) as HTMLElement

    expect(dialog.className).toContain("fixed")
    expect(dialog.className).toContain("overflow-y-auto")
    expect(dialog.className).toContain("overscroll-contain")
    expect(content.className).toContain("min-h-full")
    expect(content.className).not.toContain("overflow-hidden")
    expect(content.className).not.toContain("rounded-")
    expect(content.className).not.toContain("border")
    expect(content.className).not.toContain("shadow")
  })

  it("keeps keyboard focus inside the reflection dialog", () => {
    renderReflection()
    const dialog = container.querySelector(
      '[data-testid="watch-end-reflection"]',
    ) as HTMLDivElement
    const dismiss = container.querySelector(
      '[data-testid="watch-end-reflection-dismiss"]',
    ) as HTMLButtonElement
    const replay = container.querySelector(
      '[data-testid="watch-end-reflection-replay"]',
    ) as HTMLButtonElement

    act(() => {
      dialog.focus()
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(document.activeElement).toBe(dismiss)

    act(() => {
      replay.focus()
      replay.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(document.activeElement).toBe(dismiss)

    act(() => {
      dismiss.focus()
      dismiss.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(document.activeElement).toBe(replay)
  })
})

describe("watch next-step links", () => {
  it("builds only complete Bible.com links and skips invalid passages", () => {
    const valid = {
      reference: "John 3:16",
      versionId: "111",
      versionAbbreviation: "NIV",
    } as never
    const invalid = {
      reference: "",
      versionId: "111",
      versionAbbreviation: "NIV",
    } as never

    expect(getBibleComUrl(valid)).toBe(
      "https://www.bible.com/bible/111/John%203%3A16.NIV",
    )
    expect(getBibleComUrl(invalid)).toBeNull()
    expect(findBibleReadHref([invalid, valid])).toBe(
      "https://www.bible.com/bible/111/John%203%3A16.NIV",
    )
  })
})
