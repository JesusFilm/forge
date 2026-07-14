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
        chatInvitation:
          "Have a question about this video or another topic? Share your thoughts or comments.",
        bibleChatTitle: "Bible Chat",
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
        "prompts.prayerRequest.label": "Request a prayer",
        "prompts.prayerRequest.description": "Share what you want prayer for",
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
  it("shows every chapter, auto-advances while idle, and pauses after intent", () => {
    vi.useFakeTimers()
    try {
      renderReflection()

      const ask = container.querySelector(
        '[data-testid="watch-end-reflection-ask-bible"]',
      ) as HTMLButtonElement
      const talk = container.querySelector(
        '[data-testid="watch-end-reflection-talk-person"]',
      ) as HTMLButtonElement

      expect(container.textContent).toContain("Choose your next step")
      expect(ask.getAttribute("data-highlighted")).toBe("true")
      expect(talk).not.toBeNull()
      expect(
        container.querySelectorAll<HTMLElement>("[data-action-id]").length,
      ).toBe(8)

      act(() => {
        vi.advanceTimersByTime(5_000)
      })

      expect(talk.getAttribute("data-highlighted")).toBe("true")
      expect(
        container.querySelector(
          '[data-testid="watch-end-reflection-talk-panel"]',
        ),
      ).not.toBeNull()

      act(() => {
        ask.click()
      })
      act(() => {
        vi.advanceTimersByTime(5_000)
      })
      expect(ask.getAttribute("data-highlighted")).toBe("true")

      act(() => {
        vi.advanceTimersByTime(6_000)
      })
      act(() => {
        vi.advanceTimersByTime(5_000)
      })
      expect(talk.getAttribute("data-highlighted")).toBe("true")

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
      expect(container.textContent).toContain(
        "Have a question about this video or another topic? Share your thoughts or comments.",
      )
      expect(
        container.querySelector(
          '[data-testid="watch-end-reflection-question-input"]',
        ),
      ).not.toBeNull()
      expect(
        container.querySelector('[data-testid="watch-end-reflection-chat"]'),
      ).not.toBeNull()
      expect(
        container.querySelector(
          '[data-testid="watch-end-reflection-chat-title"]',
        )?.textContent,
      ).toBe("Bible Chat")
      expect(
        container.querySelector(
          '[data-testid="watch-end-reflection-chat-messages"]',
        )?.className,
      ).toContain("overflow-y-auto")
      expect(
        container.querySelector('[data-testid="watch-end-reflection-chat"]')
          ?.className,
      ).toContain("flex-1")
      expect(
        container.querySelector(
          '[data-testid="watch-end-reflection-stage-title"]',
        )?.className,
      ).toContain("sr-only")
      expect(
        container.querySelector(
          '[data-testid="watch-end-reflection-stage-title"]',
        )?.textContent,
      ).toBe("Ask a Bible question")

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
      expect(suggested.getAttribute("aria-pressed")).toBe("true")
    } finally {
      vi.useRealTimers()
    }
  })

  it("makes Watch next the final timed chapter and advances after it", () => {
    vi.useFakeTimers()
    try {
      const callbacks = renderReflection()
      const actions = Array.from(
        container.querySelectorAll<HTMLElement>("[data-action-id]"),
      )

      expect(actions.at(-2)?.dataset.actionId).toBe("download")
      expect(actions.at(-1)?.dataset.actionId).toBe("next")
      expect(actions.at(-1)?.dataset.finalAction).toBe("true")

      for (let chapter = 0; chapter < actions.length; chapter += 1) {
        act(() => {
          vi.advanceTimersByTime(5_000)
        })
      }

      expect(callbacks.onNext).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("restarts the guided story after the reflection is reopened", () => {
    vi.useFakeTimers()
    try {
      const callbacks = {
        onDismiss: vi.fn(),
        onDownload: vi.fn(),
        onNext: vi.fn(),
        onReplay: vi.fn(),
        onShare: vi.fn(),
      }
      const renderOpenState = (open: boolean) => {
        act(() => {
          root.render(
            <WatchEndReflection
              open={open}
              prompts={["What did this story show you?"]}
              bibleReadHref="https://www.bible.com/bible/111/John.3.16.NIV"
              {...callbacks}
            />,
          )
        })
      }

      renderOpenState(true)
      act(() => {
        ;(
          container.querySelector(
            '[data-testid="watch-end-reflection-talk-person"]',
          ) as HTMLButtonElement
        ).click()
      })
      act(() => {
        ;(
          container.querySelector(
            '[data-testid="watch-end-reflection-dismiss"]',
          ) as HTMLButtonElement
        ).click()
      })
      renderOpenState(false)
      renderOpenState(true)

      expect(
        container
          .querySelector('[data-testid="watch-end-reflection-ask-bible"]')
          ?.getAttribute("data-highlighted"),
      ).toBe("true")

      act(() => {
        vi.advanceTimersByTime(5_000)
      })
      expect(
        container
          .querySelector('[data-testid="watch-end-reflection-talk-person"]')
          ?.getAttribute("data-highlighted"),
      ).toBe("true")
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the selected chapter stationary when reduced motion is requested", () => {
    vi.useFakeTimers()
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })

    try {
      renderReflection()
      const ask = container.querySelector(
        '[data-testid="watch-end-reflection-ask-bible"]',
      ) as HTMLButtonElement

      act(() => {
        vi.advanceTimersByTime(30_000)
      })

      expect(ask.getAttribute("data-highlighted")).toBe("true")
      expect(
        container.querySelectorAll(
          '[aria-controls="watch-end-reflection-stage"]',
        ).length,
      ).toBe(8)
    } finally {
      window.matchMedia = originalMatchMedia
      vi.useRealTimers()
    }
  })

  it("offers safe external destinations and delegates Watch-owned actions", () => {
    const callbacks = renderReflection({ prompts: ["One question"] })
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-read-bible"]',
        ) as HTMLButtonElement
      ).click()
    })
    const bible = container.querySelector(
      '[data-testid="watch-end-reflection-active-action"]',
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
    })
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-active-action"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-download"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-active-action"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
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
    expect(
      container.querySelector('[data-testid="watch-end-reflection-talk-chat"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-talk-chat-title"]',
      )?.textContent,
    ).toBe("Talk to a person")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-talk-chat-messages"]',
      )?.className,
    ).toContain("overflow-y-auto")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-talk-input"]',
      ),
    ).not.toBeNull()

    const chat = container.querySelector(
      '[data-testid="watch-end-reflection-talk-submit"]',
    ) as HTMLAnchorElement
    expect(chat.href).toContain("chataboutjesus.com/chat/")
    expect(chat.target).toBe("_blank")
    expect(chat.rel).toContain("noopener")
  })

  it("offers a dedicated prayer handoff before Watch next", () => {
    renderReflection()

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-request-prayer"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(container.textContent).toContain("Request a prayer")
    expect(container.textContent).toContain("Share what you want prayer for")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-prayer-panel"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-prayer-chat"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-prayer-chat-title"]',
      )?.textContent,
    ).toBe("Request a prayer")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-prayer-chat-messages"]',
      )?.className,
    ).toContain("overflow-y-auto")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-prayer-input"]',
      ),
    ).not.toBeNull()

    const prayer = container.querySelector(
      '[data-testid="watch-end-reflection-prayer-submit"]',
    ) as HTMLAnchorElement
    expect(prayer.href).toContain("chataboutjesus.com/chat/")
    expect(prayer.target).toBe("_blank")
    expect(prayer.rel).toContain("noopener")
  })

  it("uses the translated study-question fallback and supports Escape dismissal", () => {
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
    expect(document.documentElement.style.overflow).toBe("hidden")
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
