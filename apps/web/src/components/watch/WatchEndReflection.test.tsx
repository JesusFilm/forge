/**
 * WatchEndReflection behavior coverage.
 *
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
          "Have a question or comments about this video or another topic?",
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
        fieldLabel: "Leave a comment, ask a question or request a prayer",
        "prompts.bibleQuestion.label": "Ask a Bible question",
        "prompts.comment.description": "Send thoughts about this video",
        "prompts.personChat.description": "Talk with someone now",
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
  it("presents every next step as a chat quick reply and opens a selected thread", () => {
    renderReflection()

    const ask = container.querySelector(
      '[data-testid="watch-end-reflection-ask-bible"]',
    ) as HTMLButtonElement
    const chatOptions = container.querySelector(
      '[data-testid="watch-end-reflection-chat-options"]',
    )

    expect(container.textContent).toContain(
      "Have a question or comments about this video or another topic?",
    )
    expect(chatOptions).not.toBeNull()
    expect(chatOptions?.getAttribute("role")).toBe("radiogroup")
    expect(
      container.querySelectorAll<HTMLElement>("[data-action-id]").length,
    ).toBe(8)
    expect(ask.getAttribute("role")).toBe("radio")
    expect(ask.getAttribute("aria-checked")).toBe("true")
    expect(
      container
        .querySelector(
          '[data-testid="watch-end-reflection-ask-bible-selector"]',
        )
        ?.getAttribute("data-selector-state"),
    ).toBe("selected")
    expect(
      container
        .querySelector(
          '[data-testid="watch-end-reflection-talk-person-selector"]',
        )
        ?.getAttribute("data-selector-state"),
    ).toBe("empty")
    const initialComposer = container.querySelector(
      '[data-testid="watch-end-reflection-chat-composer"]',
    )
    const initialInput = container.querySelector(
      '[data-testid="watch-end-reflection-question-input"]',
    ) as HTMLTextAreaElement
    expect(initialComposer).not.toBeNull()
    expect(initialInput.placeholder).toBe(
      "Leave a comment, ask a question or request a prayer",
    )
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-user-selection"]',
      ),
    ).toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-auto-progress"]',
      ),
    ).not.toBeNull()

    act(() => {
      ask.click()
    })

    expect(ask.getAttribute("aria-checked")).toBe("true")
    expect(
      container.querySelector('[data-testid="watch-end-reflection-ask-panel"]'),
    ).not.toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-user-selection"]',
      ),
    ).toBeNull()
    expect(container.textContent).toContain("What did this story show you?")
    expect(container.textContent).toContain("What could change next?")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-question-input"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="watch-end-reflection-chat"]'),
    ).not.toBeNull()
    expect(
      container
        .querySelector('[data-testid="watch-end-reflection"]')
        ?.getAttribute("aria-label"),
    ).toBe("Bible Chat")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-chat-title"]',
      ),
    ).toBeNull()
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
  })

  it("automatically activates each option for five seconds and loops", () => {
    vi.useFakeTimers()

    try {
      renderReflection()
      const actions = Array.from(
        container.querySelectorAll<HTMLButtonElement>("[data-action-id]"),
      )

      expect(actions[0]?.getAttribute("aria-checked")).toBe("true")

      act(() => {
        vi.advanceTimersByTime(4_999)
      })
      expect(actions[0]?.getAttribute("aria-checked")).toBe("true")

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(actions[1]?.getAttribute("aria-checked")).toBe("true")

      for (let index = 1; index < actions.length; index += 1) {
        act(() => {
          vi.advanceTimersByTime(5_000)
        })
      }
      expect(actions[0]?.getAttribute("aria-checked")).toBe("true")
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("pauses the guide while a viewer interacts, then resumes after inactivity", () => {
    vi.useFakeTimers()

    try {
      renderReflection()
      const prayer = container.querySelector(
        '[data-testid="watch-end-reflection-request-prayer"]',
      ) as HTMLButtonElement
      const share = container.querySelector(
        '[data-testid="watch-end-reflection-share"]',
      ) as HTMLButtonElement
      const reflection = container.querySelector(
        '[data-testid="watch-end-reflection"]',
      ) as HTMLElement

      act(() => {
        prayer.click()
      })
      expect(reflection.dataset.autoCycling).toBe("false")

      act(() => {
        vi.advanceTimersByTime(6_000)
      })
      expect(reflection.dataset.autoCycling).toBe("true")
      expect(prayer.getAttribute("aria-checked")).toBe("true")

      act(() => {
        vi.advanceTimersByTime(5_000)
      })
      expect(share.getAttribute("aria-checked")).toBe("true")
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("keeps every editorial reflection prompt available in source order", () => {
    const prompts = [
      "First editorial question",
      "Second editorial question",
      "Third editorial question",
      "Fourth editorial question",
    ]
    renderReflection({ prompts })

    expect(
      Array.from(
        container.querySelectorAll(
          '[data-testid="watch-end-reflection-suggested-question"]',
        ),
        (element) => element.textContent,
      ),
    ).toEqual(prompts)
  })

  it("does not resume guided cycling while the composer contains a draft", () => {
    vi.useFakeTimers()

    try {
      renderReflection()
      const input = container.querySelector(
        '[data-testid="watch-end-reflection-question-input"]',
      ) as HTMLTextAreaElement
      const reflection = container.querySelector(
        '[data-testid="watch-end-reflection"]',
      ) as HTMLElement
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set

      act(() => {
        setValue?.call(input, "My unfinished question")
        input.dispatchEvent(new Event("input", { bubbles: true }))
      })
      expect(reflection.dataset.autoCycling).toBe("false")

      act(() => {
        vi.advanceTimersByTime(30_000)
      })

      expect(input.value).toBe("My unfinished question")
      expect(reflection.dataset.autoCycling).toBe("false")
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("keeps Watch next as the final quick reply and confirms before advancing", () => {
    const callbacks = renderReflection()
    const actions = Array.from(
      container.querySelectorAll<HTMLElement>("[data-action-id]"),
    )
    const watchNext = actions.at(-1) as HTMLButtonElement

    expect(actions.at(-2)?.dataset.actionId).toBe("download")
    expect(watchNext.dataset.actionId).toBe("next")
    expect(watchNext.dataset.finalAction).toBe("true")
    expect(callbacks.onNext).not.toHaveBeenCalled()

    act(() => {
      watchNext.click()
    })
    expect(callbacks.onNext).not.toHaveBeenCalled()
    expect(watchNext.getAttribute("aria-checked")).toBe("true")

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-end-reflection-active-action"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(callbacks.onNext).toHaveBeenCalledOnce()
  })

  it("resets to the first guided conversation after the reflection is reopened", () => {
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
    expect(
      container
        .querySelector('[data-testid="watch-end-reflection-talk-person"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true")

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
        ?.getAttribute("aria-checked"),
    ).toBe("true")
    expect(
      container
        .querySelector('[data-testid="watch-end-reflection-talk-person"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false")
  })

  it("keeps the chat immediately accessible when reduced motion is requested", () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })

    try {
      renderReflection()
      const ask = container.querySelector(
        '[data-testid="watch-end-reflection-ask-bible"]',
      ) as HTMLButtonElement

      expect(ask.getAttribute("aria-checked")).toBe("true")

      act(() => {
        ask.click()
      })

      expect(ask.getAttribute("aria-checked")).toBe("true")
      expect(
        container.querySelector(
          '[data-testid="watch-end-reflection-ask-response"]',
        ),
      ).not.toBeNull()
    } finally {
      window.matchMedia = originalMatchMedia
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
      container.querySelector(
        '[data-testid="watch-end-reflection-talk-response"]',
      ),
    ).not.toBeNull()
    expect(
      container
        .querySelector('[data-testid="watch-end-reflection-talk-person"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-talk-input"]',
      ),
    ).not.toBeNull()
    const talkHints = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="watch-end-reflection-talk-suggested-message"]',
      ),
    )
    expect(talkHints).toHaveLength(3)
    act(() => {
      talkHints[0]?.click()
    })
    expect(
      (
        container.querySelector(
          '[data-testid="watch-end-reflection-talk-input"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Send thoughts about this video")

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
        '[data-testid="watch-end-reflection-prayer-response"]',
      ),
    ).not.toBeNull()
    expect(
      container
        .querySelector('[data-testid="watch-end-reflection-request-prayer"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true")
    expect(
      container.querySelector(
        '[data-testid="watch-end-reflection-prayer-input"]',
      ),
    ).not.toBeNull()
    const prayerHints = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="watch-end-reflection-prayer-suggested-message"]',
      ),
    )
    expect(prayerHints).toHaveLength(3)
    act(() => {
      prayerHints[1]?.click()
    })
    expect(
      (
        container.querySelector(
          '[data-testid="watch-end-reflection-prayer-input"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Send thoughts about this video")

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

    act(() => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })
    expect(callbacks.onDismiss).toHaveBeenCalledOnce()
  })

  it("locks document scrolling while the reflection is open", () => {
    renderReflection()
    expect(document.documentElement.style.overflow).toBe("hidden")
  })

  it("focuses the dialog on open and restores the previous scroll lock on unmount", () => {
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = "clip"
    const animationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0)
        return 1
      })

    renderReflection()
    const dialog = container.querySelector(
      '[data-testid="watch-end-reflection"]',
    ) as HTMLDivElement

    expect(document.activeElement).toBe(dialog)
    expect(document.documentElement.style.overflow).toBe("hidden")

    act(() => {
      root.unmount()
    })
    expect(document.documentElement.style.overflow).toBe("clip")

    document.documentElement.style.overflow = previousOverflow
    root = createRoot(container)
    animationFrame.mockRestore()
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
