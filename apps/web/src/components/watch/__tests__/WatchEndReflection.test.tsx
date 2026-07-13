/**
 * @vitest-environment jsdom
 */

import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: "WatchEndReflection" | "WatchStudyQuestions") =>
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
  it("reveals editorial questions one at a time before next steps", () => {
    renderReflection()

    const firstPanel = container.querySelector(
      '[data-testid="watch-end-reflection-panel"]',
    )

    expect(
      container.querySelector('[data-testid="watch-end-reflection-question"]')
        ?.textContent,
    ).toBe("What did this story show you?")
    expect(container.textContent).toContain("1 of 2")
    expect(
      container.querySelector('[data-testid="watch-end-reflection-ask-bible"]'),
    ).toBeNull()

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-continue"]',
        ) as HTMLButtonElement
      )?.click()
    })
    expect(
      container.querySelector('[data-testid="watch-end-reflection-question"]')
        ?.textContent,
    ).toBe("What could change next?")
    expect(container.textContent).toContain("2 of 2")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-announcement"]',
      )?.textContent,
    ).toContain("2 of 2 What could change next?")
    expect(
      container.querySelector('[data-testid="watch-end-reflection-panel"]'),
    ).not.toBe(firstPanel)

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-continue"]',
        ) as HTMLButtonElement
      )?.click()
    })

    expect(
      container.querySelector('[data-testid="watch-end-reflection-ask-bible"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-talk-person"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="watch-end-reflection-go-deeper"]'),
    ).not.toBeNull()
  })

  it("offers safe external destinations and delegates Watch-owned actions", () => {
    const callbacks = renderReflection({ prompts: ["One question"] })

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-continue"]',
        ) as HTMLButtonElement
      )?.click()
    })

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
      )?.click()
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-share"]',
        ) as HTMLButtonElement
      )?.click()
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-download"]',
        ) as HTMLButtonElement
      )?.click()
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-replay"]',
        ) as HTMLButtonElement
      )?.click()
    })

    expect(callbacks.onNext).toHaveBeenCalledOnce()
    expect(callbacks.onShare).toHaveBeenCalledOnce()
    expect(callbacks.onDownload).toHaveBeenCalledOnce()
    expect(callbacks.onReplay).toHaveBeenCalledOnce()
  })

  it("uses the translated study-question fallback and supports Escape dismissal", () => {
    const callbacks = renderReflection({ prompts: [] })
    const dialog = container.querySelector(
      '[data-testid="watch-end-reflection"]',
    ) as HTMLDivElement

    expect(dialog.textContent).toContain("What stays with you from this story?")
    expect(dialog.className).toContain("motion-reduce:animate-none")

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
