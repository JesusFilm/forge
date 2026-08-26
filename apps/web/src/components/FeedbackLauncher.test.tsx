/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { setRequestLocale } from "next-intl/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const searchState = vi.hoisted(() => ({ searchOpen: false }))
const interaction = vi.hoisted(() => ({
  loadGlobalWatchLanguageOptions: vi.fn(),
}))
const watchSearch = vi.hoisted(() => ({
  fetchWatchSearchSuggestions: vi.fn(),
}))
const feedbackAction = vi.hoisted(() => ({
  submit: vi.fn(),
  addEmail: vi.fn(),
}))

vi.mock("@/components/FloatingSearchProvider", () => ({
  useFloatingSearchPinned: () => ({
    pinned: false,
    playerChromeVisible: true,
    searchChromeVisible: true,
    searchChromeDimmed: false,
    searchOpen: searchState.searchOpen,
  }),
}))

vi.mock("@/lib/watch-interaction-loader", () => ({
  loadGlobalWatchLanguageOptions: interaction.loadGlobalWatchLanguageOptions,
}))

vi.mock("@/lib/watch-search-client", () => ({
  fetchWatchSearchSuggestions: watchSearch.fetchWatchSearchSuggestions,
}))

vi.mock("@/lib/feedback-action", () => ({
  submitFeedback: feedbackAction.submit,
  addFeedbackFollowUpEmail: feedbackAction.addEmail,
}))

const languageOptions = [
  {
    slug: "english",
    aliasOwnerSlug: null,
    englishName: "English",
    nativeName: "English",
  },
  {
    slug: "spanish-latin-american",
    aliasOwnerSlug: null,
    englishName: "Spanish",
    nativeName: "Español",
  },
]

import {
  FeedbackLauncher,
  FeedbackLoadNotice,
} from "@/components/FeedbackLauncher"

let container: HTMLDivElement
let root: Root

function launcher() {
  return document.querySelector(
    '[data-testid="feedback-launcher"]',
  ) as HTMLButtonElement | null
}

async function flushDynamicModal() {
  await act(async () => {
    const deadline = Date.now() + 5000
    while (
      !document.querySelector('[data-testid="feedback-modal"]') &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    }
  })
}

async function openFeedback() {
  const button = launcher()
  if (!button) throw new Error("Expected feedback launcher")
  act(() => {
    button.focus()
    button.click()
  })
  await flushDynamicModal()
}

function setValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function selectThemed(id: string, value: string) {
  act(() => {
    ;(
      document.querySelector(
        `[data-testid="${id}-trigger"]`,
      ) as HTMLButtonElement
    ).click()
  })
  act(() => {
    ;(
      document.querySelector(
        `[aria-controls][data-testid="${id}-trigger"] + [role="listbox"] [data-value="${value}"]`,
      ) as HTMLButtonElement
    ).click()
  })
}

function submitCurrentStep() {
  const submit = document.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement
  act(() => submit.click())
}

function selectFeedbackCategory(
  value: "problem" | "confusing" | "idea" | "praise",
) {
  act(() => {
    ;(
      document.querySelector(
        `[data-testid="feedback-category-${value}"]`,
      ) as HTMLButtonElement
    ).click()
  })
}

async function fillMinimalFeedback(
  category: "problem" | "confusing" | "idea" | "praise" = "problem",
) {
  await openFeedback()
  selectFeedbackCategory(category)
  submitCurrentStep()
  setValue(
    document.querySelector("textarea") as HTMLTextAreaElement,
    "Playback failed after I pressed Watch.",
  )
  submitCurrentStep()
  submitCurrentStep()
  submitCurrentStep()
  setValue(
    document.querySelector('input[autocomplete="name"]') as HTMLInputElement,
    "Alex Morgan",
  )
}

async function sendFeedback() {
  await act(async () => {
    ;(
      document.querySelector('button[type="submit"]') as HTMLButtonElement
    ).click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  interaction.loadGlobalWatchLanguageOptions.mockResolvedValue(languageOptions)
  watchSearch.fetchWatchSearchSuggestions.mockResolvedValue([
    {
      kind: "content",
      title: "The Life of Jesus",
      description: "Feature film",
      matchSource: "title",
      id: "video-1",
      slug: "life-of-jesus",
      label: "FEATURE_FILM",
      childCount: null,
    },
    {
      kind: "content",
      title: "Jesus Film Collection",
      description: "12 videos",
      matchSource: "title",
      id: "collection-1",
      slug: "jesus-film-collection",
      label: "COLLECTION",
      childCount: 12,
    },
  ])
  setRequestLocale("en")
  searchState.searchOpen = false
  document.title = "The Life of Jesus"
  document.documentElement.lang = "en"
  window.history.replaceState({}, "", "/watch/jesus.html")
  feedbackAction.submit.mockReset()
  feedbackAction.submit.mockResolvedValue({ ok: true })
  feedbackAction.addEmail.mockReset()
  feedbackAction.addEmail.mockResolvedValue({ ok: true })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<FeedbackLauncher />)
  })
})

afterEach(() => {
  vi.useRealTimers()
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("FeedbackLauncher", () => {
  it("keeps the lazy 44px headset launcher and removes every Google form resource", async () => {
    const button = launcher()
    expect(button?.querySelector(".lucide-headset")).not.toBeNull()
    expect(button?.className).toContain("h-11")
    expect(button?.className).toContain("w-11")
    expect(button?.className).toContain("hover:w-32")
    expect(button?.className).toContain("hover:bg-brand-red")
    expect(button?.hasAttribute("data-feedback-ignore")).toBe(true)
    expect(document.querySelector('[data-testid="feedback-modal"]')).toBeNull()

    await openFeedback()

    expect(document.querySelector("iframe")).toBeNull()
    expect(document.querySelector('a[href*="forms.gle"]')).toBeNull()
    expect(document.body.textContent).toContain("Share feedback")
    const modal = document.querySelector(
      '[data-testid="feedback-modal"]',
    ) as HTMLElement
    expect(modal.className).toContain("m-auto")
    expect(modal.className).toContain("max-w-[800px]")
    expect(modal.className).toContain("overflow-visible")
    expect(modal.className).toContain("bg-transparent")
    expect(modal.className).not.toContain("sm:rounded-2xl")
    expect(modal.className).not.toContain("h-dvh")
    expect(modal.className).not.toContain("w-dvw")
    expect(modal.parentElement?.className).toContain("overflow-y-auto")
    expect(modal.parentElement?.className).toContain("sm:py-24")
    expect(modal.querySelector("form")?.className).toContain("overflow-visible")
    const footer = modal.querySelector("footer") as HTMLElement
    expect(footer.className).toBe("mt-6")
  })

  it("renders large icon categories with contextual copy", async () => {
    await openFeedback()

    const problem = document.querySelector(
      '[data-testid="feedback-category-problem"]',
    ) as HTMLButtonElement
    const idea = document.querySelector(
      '[data-testid="feedback-category-idea"]',
    ) as HTMLButtonElement
    expect(problem.getAttribute("aria-pressed")).toBe("false")
    expect(problem.className).toContain("sm:min-h-28")
    expect(problem.querySelector(".lucide-triangle-alert")).not.toBeNull()

    submitCurrentStep()
    expect(document.body.textContent).toContain(
      "Choose a feedback type to continue.",
    )

    act(() => idea.click())

    expect(idea.getAttribute("aria-pressed")).toBe("true")
    expect(idea.querySelector(".lucide-lightbulb")).not.toBeNull()
    submitCurrentStep()
    expect(document.body.textContent).toContain("What would make Watch better?")
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "A clearer playback status would help.",
    )
    submitCurrentStep()
    submitCurrentStep()
    expect(
      document.querySelector('button[type="submit"]')?.textContent,
    ).toContain("Skip for now")
    submitCurrentStep()

    expect(document.body.textContent).not.toContain("How urgent is this?")
  })

  it("requires a useful message and name while validating optional email", async () => {
    await openFeedback()

    selectFeedbackCategory("problem")
    submitCurrentStep()
    submitCurrentStep()

    expect(document.body.textContent).toContain(
      "Please share at least 10 characters.",
    )
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "Playback failed after I pressed Watch.",
    )
    submitCurrentStep()
    submitCurrentStep()
    submitCurrentStep()
    submitCurrentStep()
    expect(document.body.textContent).toContain("Name is required.")
    expect(document.body.textContent).not.toContain(
      "Enter a valid email address.",
    )
    setValue(
      document.querySelector('input[autocomplete="name"]') as HTMLInputElement,
      "Alex Morgan",
    )
    setValue(
      document.querySelector('input[autocomplete="email"]') as HTMLInputElement,
      "not-an-email",
    )
    submitCurrentStep()
    expect(document.body.textContent).toContain("Enter a valid email address.")
    expect(feedbackAction.submit).not.toHaveBeenCalled()
  })

  it("previews opt-in diagnostics and sends the native payload to Forge", async () => {
    await openFeedback()

    selectFeedbackCategory("problem")
    submitCurrentStep()
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "Playback failed after I pressed Watch.",
    )
    const diagnostics = document.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement
    expect(diagnostics.checked).toBe(false)
    act(() => diagnostics.click())

    const details = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("View details"),
    ) as HTMLButtonElement
    expect(details.disabled).toBe(false)
    act(() => details.click())
    expect(document.body.textContent).toContain("browser")
    expect(document.body.textContent).toContain("time Zone")
    submitCurrentStep()
    selectThemed("feedback-language-area", "subtitles")
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => {
      ;(
        document.querySelector(
          '[data-testid="language-combobox-trigger"]',
        ) as HTMLButtonElement
      ).click()
    })
    const spanish = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-testid="language-combobox-option"]',
      ),
    ).find((option) => option.textContent?.includes("Spanish"))
    expect(spanish).toBeTruthy()
    act(() => spanish?.click())
    selectThemed("feedback-content-scope", "other")
    setValue(
      document.querySelector("#feedback-content-title") as HTMLInputElement,
      "Jesus",
    )
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      await Promise.resolve()
    })
    expect(watchSearch.fetchWatchSearchSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Jesus",
        languageSlug: "spanish-latin-american",
      }),
    )
    const collectionResult = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "#feedback-content-results button",
      ),
    ).find((button) => button.textContent?.includes("Jesus Film Collection"))
    expect(collectionResult).toBeTruthy()
    act(() => collectionResult?.click())
    submitCurrentStep()
    submitCurrentStep()
    setValue(
      document.querySelector('input[autocomplete="name"]') as HTMLInputElement,
      "Alex Morgan",
    )
    setValue(
      document.querySelector('input[autocomplete="email"]') as HTMLInputElement,
      "alex@example.com",
    )

    await act(async () => {
      ;(
        document.querySelector('button[type="submit"]') as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(feedbackAction.submit).toHaveBeenCalledOnce()
    const payload = feedbackAction.submit.mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(payload).toMatchObject({
      category: "problem",
      name: "Alex Morgan",
      email: "alex@example.com",
      languageIssue: { area: "subtitles", language: "Spanish" },
      content: {
        scope: "other",
        title: "Jesus Film Collection",
        id: "collection-1",
        slug: "jesus-film-collection",
        label: "COLLECTION",
      },
    })
    expect(payload.diagnostics).toBeTruthy()
    expect(payload.page).toMatchObject({ title: "The Life of Jesus" })
    expect(document.body.textContent).toContain("Thank you")
    expect(document.body.textContent).toContain(
      "We’ll email you when the problem is resolved.",
    )
  })

  it("uses idea-aware receipt copy when an email was supplied", async () => {
    await fillMinimalFeedback("idea")
    setValue(
      document.querySelector('input[autocomplete="email"]') as HTMLInputElement,
      "alex@example.com",
    )

    await sendFeedback()

    expect(document.body.textContent).toContain(
      "We’ll email you once we implement your idea.",
    )
    expect(
      document.querySelector('[data-testid="feedback-follow-up-email-form"]'),
    ).toBeNull()
  })

  it("gives people one final chance to attach an email to the same issue", async () => {
    feedbackAction.submit.mockResolvedValueOnce({
      ok: true,
      receipt: "opaque-feedback-receipt",
    })
    await fillMinimalFeedback()
    await sendFeedback()

    expect(document.body.textContent).toContain(
      "Want to know when this is fixed?",
    )
    const form = document.querySelector(
      '[data-testid="feedback-follow-up-email-form"]',
    ) as HTMLFormElement
    const input = form.querySelector("input") as HTMLInputElement
    setValue(input, "not-an-email")
    act(() => form.requestSubmit())
    expect(document.body.textContent).toContain("Enter a valid email address.")
    expect(feedbackAction.addEmail).not.toHaveBeenCalled()

    setValue(input, "alex@example.com")
    await act(async () => {
      form.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(feedbackAction.addEmail).toHaveBeenCalledWith({
      email: "alex@example.com",
      receipt: "opaque-feedback-receipt",
    })
    expect(document.body.textContent).toContain(
      "We’ll email you when the problem is resolved.",
    )
    expect(
      document.querySelector('[data-testid="feedback-follow-up-email-form"]'),
    ).toBeNull()
  })

  it("accepts typed language and content when lookup services fail", async () => {
    interaction.loadGlobalWatchLanguageOptions.mockRejectedValueOnce(
      new Error("languages unavailable"),
    )
    watchSearch.fetchWatchSearchSuggestions.mockRejectedValueOnce(
      new Error("search unavailable"),
    )
    await openFeedback()

    selectFeedbackCategory("problem")
    submitCurrentStep()
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "The language and content could not be found.",
    )
    submitCurrentStep()
    selectThemed("feedback-language-area", "audio")
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    setValue(
      document.querySelector(
        'input[aria-label="Affected language"]',
      ) as HTMLInputElement,
      "Klingon",
    )
    selectThemed("feedback-content-scope", "other")
    setValue(
      document.querySelector("#feedback-content-title") as HTMLInputElement,
      "Unknown Collection",
    )
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(
      "You can continue with what you typed.",
    )
    submitCurrentStep()
    expect(
      document.querySelector('[data-testid="feedback-step-4"]'),
    ).not.toBeNull()

    submitCurrentStep()
    setValue(
      document.querySelector('input[autocomplete="name"]') as HTMLInputElement,
      "Alex Morgan",
    )
    await act(async () => {
      ;(
        document.querySelector('button[type="submit"]') as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const payload = feedbackAction.submit.mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(payload).toMatchObject({
      languageIssue: { area: "audio", language: "Klingon" },
      content: { scope: "other", title: "Unknown Collection" },
    })
    expect(payload).not.toHaveProperty("email")
  })

  it("submits typed content with no match and omits unapproved diagnostics", async () => {
    watchSearch.fetchWatchSearchSuggestions.mockResolvedValueOnce([])
    await openFeedback()
    selectFeedbackCategory("problem")
    submitCurrentStep()
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "The screening page does not start playback.",
    )
    submitCurrentStep()
    selectThemed("feedback-content-scope", "other")
    setValue(
      document.querySelector("#feedback-content-title") as HTMLInputElement,
      "My local screening",
    )
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(
      "No direct match. Your typed title will still be submitted.",
    )
    submitCurrentStep()
    submitCurrentStep()
    setValue(
      document.querySelector('input[autocomplete="name"]') as HTMLInputElement,
      "Alex Morgan",
    )
    await sendFeedback()

    expect(feedbackAction.submit.mock.calls[0][0]).toMatchObject({
      content: { scope: "other", title: "My local screening" },
    })
    expect(feedbackAction.submit.mock.calls[0][0]).not.toHaveProperty(
      "diagnostics",
    )
  })

  it("keeps the form retryable after a typed delivery failure", async () => {
    feedbackAction.submit
      .mockResolvedValueOnce({
        ok: false,
        reason: "delivery_failed",
        message: "RAW SERVER DELIVERY COPY - must not render",
      })
      .mockResolvedValueOnce({ ok: true })
    await fillMinimalFeedback()

    await sendFeedback()
    expect(document.body.textContent).toContain(
      "We could not send your feedback. Please try again.",
    )
    expect(document.body.textContent).not.toContain(
      "RAW SERVER DELIVERY COPY - must not render",
    )
    const supportLink = document.querySelector(
      '[data-testid="feedback-support-form-link"]',
    ) as HTMLAnchorElement
    expect(supportLink.href).toBe("https://www.jesusfilm.org/contact/")
    expect(supportLink.target).toBe("_blank")
    await sendFeedback()
    expect(feedbackAction.submit).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("Thank you")
  })

  it("renders reason-keyed translated messages, never the server message string", async () => {
    feedbackAction.submit.mockResolvedValueOnce({
      ok: false,
      reason: "rate_limited",
      message: "RAW SERVER RATE COPY - must not render",
    })
    await fillMinimalFeedback()

    await sendFeedback()
    expect(document.body.textContent).toContain(
      "Too many feedback requests. Please try again later.",
    )
    expect(document.body.textContent).not.toContain(
      "RAW SERVER RATE COPY - must not render",
    )

    feedbackAction.submit.mockResolvedValueOnce({
      ok: false,
      reason: "invalid",
      message: "RAW SERVER INVALID COPY - must not render",
    })
    await sendFeedback()
    expect(document.body.textContent).toContain(
      "Please check the form and try again.",
    )
    expect(document.body.textContent).not.toContain(
      "RAW SERVER INVALID COPY - must not render",
    )
  })

  it("falls back to the generic failure message on an unknown reason", async () => {
    feedbackAction.submit.mockResolvedValueOnce({
      ok: false,
      reason: "mystery_reason",
      message: "RAW SERVER MYSTERY COPY - must not render",
    } as never)
    await fillMinimalFeedback()

    await sendFeedback()
    expect(document.body.textContent).toContain(
      "We could not send your feedback. Please try again.",
    )
    expect(document.body.textContent).not.toContain(
      "RAW SERVER MYSTERY COPY - must not render",
    )
    expect(document.body.textContent).not.toContain("undefined")
  })

  it("renders reason-keyed translated follow-up email errors, never the server message", async () => {
    feedbackAction.submit.mockResolvedValueOnce({
      ok: true,
      receipt: "opaque-feedback-receipt",
    })
    feedbackAction.addEmail
      .mockResolvedValueOnce({
        ok: false,
        reason: "delivery_failed",
        message: "RAW SERVER FOLLOW-UP COPY - must not render",
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: "invalid",
        message: "RAW SERVER FOLLOW-UP INVALID COPY - must not render",
      })
    await fillMinimalFeedback()
    await sendFeedback()

    const form = document.querySelector(
      '[data-testid="feedback-follow-up-email-form"]',
    ) as HTMLFormElement
    setValue(form.querySelector("input") as HTMLInputElement, "a@example.com")
    await act(async () => {
      form.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(
      "We could not add your email. Please use the support form to contact us.",
    )
    expect(document.body.textContent).not.toContain(
      "RAW SERVER FOLLOW-UP COPY - must not render",
    )
    expect(document.body.textContent).toContain("Open support form")

    await act(async () => {
      form.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(
      "This follow-up link has expired. Please use the support form to contact us.",
    )
    expect(document.body.textContent).not.toContain(
      "RAW SERVER FOLLOW-UP INVALID COPY - must not render",
    )
  })

  it("shows a generic retry state when the Server Action rejects", async () => {
    feedbackAction.submit.mockRejectedValueOnce(new Error("connection lost"))
    await fillMinimalFeedback()

    await sendFeedback()
    expect(document.body.textContent).toContain(
      "We could not send your feedback. Please try again.",
    )
    expect(document.body.textContent).not.toContain("connection lost")
  })

  it("prevents dismissal while a submission is pending", async () => {
    let resolveSubmission: ((value: { ok: true }) => void) | undefined
    feedbackAction.submit.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubmission = resolve
      }),
    )
    await fillMinimalFeedback()

    act(() => {
      ;(
        document.querySelector('button[type="submit"]') as HTMLButtonElement
      ).click()
    })
    const close = document.querySelector(
      '[data-testid="feedback-modal-close"]',
    ) as HTMLButtonElement
    expect(close.disabled).toBe(true)
    act(() => close.click())
    expect(
      document.querySelector('[data-testid="feedback-modal"]'),
    ).not.toBeNull()

    await act(async () => {
      resolveSubmission?.({ ok: true })
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("Thank you")
  })

  it("bounds a stalled client submission", async () => {
    feedbackAction.submit.mockReturnValueOnce(new Promise(() => undefined))
    await fillMinimalFeedback()
    vi.useFakeTimers()

    act(() => {
      ;(
        document.querySelector('button[type="submit"]') as HTMLButtonElement
      ).click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(document.body.textContent).toContain(
      "Your feedback may have been received",
    )
    expect(
      (
        document.querySelector(
          '[data-testid="feedback-modal-close"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })

  it("lets a person point at a safe page element without capturing form values", async () => {
    const pageButton = document.createElement("button")
    const pageButtonLabel = document.createElement("span")
    pageButtonLabel.textContent = "Watch now"
    pageButton.appendChild(pageButtonLabel)
    document.body.appendChild(pageButton)
    const privateInput = document.createElement("input")
    privateInput.value = "private value"
    document.body.appendChild(privateInput)
    await openFeedback()

    selectFeedbackCategory("problem")
    submitCurrentStep()
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "Playback failed after I pressed Watch.",
    )
    submitCurrentStep()
    submitCurrentStep()

    act(() => {
      ;(
        document.querySelector(
          '[data-testid="feedback-select-element"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(
      document.querySelector('[data-testid="feedback-element-picker"]'),
    ).not.toBeNull()
    expect(document.querySelector('[data-testid="feedback-modal"]')).toBeNull()

    act(() => {
      privateInput.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true }),
      )
    })
    expect(document.body.textContent).not.toContain("private value")

    act(() => {
      pageButtonLabel.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true }),
      )
      pageButtonLabel.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      )
    })

    expect(
      document.querySelector('[data-testid="feedback-modal"]'),
    ).not.toBeNull()
    expect(document.body.textContent).toContain("Watch now")
    expect(document.body.textContent).toContain("Selected button")
    pageButton.remove()
    privateInput.remove()
  })

  it("shows retry and cancel when the lazy modal chunk fails without returning to Google", () => {
    const onCancel = vi.fn()
    const retry = vi.fn()

    act(() => {
      root.render(
        <FeedbackLoadNotice
          error={new Error("chunk failed")}
          retry={retry}
          onCancel={onCancel}
        />,
      )
    })

    expect(document.body.textContent).toContain("Feedback form could not load")
    expect(document.querySelector("a")).toBeNull()
    const buttons = Array.from(document.querySelectorAll("button"))
    act(() => {
      buttons.find((button) => button.textContent === "Retry")?.click()
      buttons.find((button) => button.textContent === "Cancel")?.click()
    })
    expect(retry).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("restores focus on close and yields atomically to global search", async () => {
    await openFeedback()
    const button = launcher()
    const close = document.querySelector(
      '[data-testid="feedback-modal-close"]',
    ) as HTMLButtonElement
    await act(async () => {
      close.click()
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    })
    expect(document.activeElement).toBe(button)

    await openFeedback()
    searchState.searchOpen = true
    act(() => root.render(<FeedbackLauncher />))
    expect(launcher()).toBeNull()
    expect(document.querySelector('[data-testid="feedback-modal"]')).toBeNull()
  })

  it("renders translated unavailable-language helper and retry affordances when the language list fails", async () => {
    interaction.loadGlobalWatchLanguageOptions.mockRejectedValue(
      new Error("languages unavailable"),
    )
    await openFeedback()
    selectFeedbackCategory("problem")
    submitCurrentStep()
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "Playback failed after I pressed Watch.",
    )
    submitCurrentStep()
    selectThemed("feedback-language-area", "audio")
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain(
      "The language list is unavailable. Your typed value will still be submitted.",
    )
    expect(document.body.textContent).toContain("Retry list")
    expect(document.body.textContent).not.toContain("Feedback.")

    // Recovery path: a successful retry swaps to the manual-entry toggle copy.
    interaction.loadGlobalWatchLanguageOptions.mockResolvedValue(
      languageOptions,
    )
    const retryButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry list",
    ) as HTMLButtonElement
    await act(async () => {
      retryButton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(
      "Can’t find the right language?",
    )
    expect(document.body.textContent).toContain("Enter manually")
    const manualToggle = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Enter manually",
    ) as HTMLButtonElement
    act(() => manualToggle.click())
    expect(document.body.textContent).toContain("Choose from list")
  })

  it("renders translated content-search loading, error, and no-match states", async () => {
    watchSearch.fetchWatchSearchSuggestions.mockReturnValueOnce(
      new Promise(() => undefined),
    )
    await openFeedback()
    selectFeedbackCategory("problem")
    submitCurrentStep()
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "Playback failed after I pressed Watch.",
    )
    submitCurrentStep()
    selectThemed("feedback-content-scope", "other")
    setValue(
      document.querySelector("#feedback-content-title") as HTMLInputElement,
      "Jesus",
    )
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("Searching titles…")

    watchSearch.fetchWatchSearchSuggestions.mockRejectedValueOnce(
      new Error("search unavailable"),
    )
    setValue(
      document.querySelector("#feedback-content-title") as HTMLInputElement,
      "Jesus film",
    )
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(
      "Couldn’t search titles. You can continue with what you typed.",
    )

    watchSearch.fetchWatchSearchSuggestions.mockResolvedValueOnce([])
    setValue(
      document.querySelector("#feedback-content-title") as HTMLInputElement,
      "My local screening",
    )
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(
      "No direct match. Your typed title will still be submitted.",
    )
    expect(document.body.textContent).not.toContain("Feedback.")
  })

  it("interpolates the step-progress aria-label and the selected-element role", async () => {
    const pageButton = document.createElement("button")
    pageButton.textContent = "Watch now"
    document.body.appendChild(pageButton)
    await openFeedback()

    expect(document.querySelector('[aria-label="Step 1 of 5"]')).not.toBeNull()
    selectFeedbackCategory("problem")
    submitCurrentStep()
    expect(document.querySelector('[aria-label="Step 2 of 5"]')).not.toBeNull()
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "Playback failed after I pressed Watch.",
    )
    submitCurrentStep()
    expect(document.querySelector('[aria-label="Step 3 of 5"]')).not.toBeNull()
    submitCurrentStep()
    expect(document.querySelector('[aria-label="Step 4 of 5"]')).not.toBeNull()

    act(() => {
      ;(
        document.querySelector(
          '[data-testid="feedback-select-element"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(document.body.textContent).toContain("Choose something on the page")
    expect(document.body.textContent).toContain(
      "Point to a heading, button, image, or section",
    )
    act(() => {
      pageButton.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }))
      pageButton.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      )
    })
    await flushDynamicModal()
    expect(document.body.textContent).toContain(
      "Selected button · choose again",
    )
    expect(document.body.textContent).not.toContain("Feedback.")
    pageButton.remove()
  })

  it("keeps localized launcher and close-control labels", async () => {
    setRequestLocale("ru")
    act(() => root.render(<FeedbackLauncher />))
    expect(launcher()?.getAttribute("aria-label")).toBe(
      "Открыть форму обратной связи",
    )

    await openFeedback()
    expect(
      document
        .querySelector('[data-testid="feedback-modal-close"]')
        ?.getAttribute("aria-label"),
    ).toBe("Закрыть форму обратной связи")
  })

  it("never leaks raw Feedback.* keys across a full walk-through and submission", async () => {
    // The vitest next-intl mock renders `Feedback.<key>` for any missing key,
    // so this guard fails when a t() call points at a key absent from en.json.
    // No \b anchor: textContent concatenates nodes without separators, so the
    // fallback can be glued to the preceding word.
    const assertNoRawKeys = () =>
      expect(document.body.textContent).not.toMatch(/Feedback\.[A-Za-z]/)

    feedbackAction.submit.mockResolvedValueOnce({
      ok: true,
      receipt: "walk-through-receipt",
    })
    feedbackAction.addEmail
      .mockResolvedValueOnce({
        ok: false,
        reason: "delivery_failed",
        message: "RAW SERVER FOLLOW-UP COPY - must not render",
      })
      .mockResolvedValueOnce({ ok: true })

    await openFeedback()
    assertNoRawKeys()
    selectFeedbackCategory("problem")
    submitCurrentStep()
    assertNoRawKeys()
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "Playback failed after I pressed Watch.",
    )
    // Expand the diagnostics preview so its labels are covered by the guard.
    act(() => {
      ;(
        document.querySelector('input[type="checkbox"]') as HTMLInputElement
      ).click()
    })
    const details = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("View details"),
    ) as HTMLButtonElement
    act(() => details.click())
    assertNoRawKeys()
    submitCurrentStep()
    assertNoRawKeys()
    submitCurrentStep()
    assertNoRawKeys()
    submitCurrentStep()
    assertNoRawKeys()
    setValue(
      document.querySelector('input[autocomplete="name"]') as HTMLInputElement,
      "Alex Morgan",
    )
    await sendFeedback()
    expect(document.body.textContent).toContain("Thank you")
    assertNoRawKeys()

    // Follow-up email surface: error state, then confirmation copy.
    const form = document.querySelector(
      '[data-testid="feedback-follow-up-email-form"]',
    ) as HTMLFormElement
    setValue(form.querySelector("input") as HTMLInputElement, "not-an-email")
    act(() => form.requestSubmit())
    assertNoRawKeys()
    setValue(form.querySelector("input") as HTMLInputElement, "a@example.com")
    await act(async () => {
      form.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })
    // Typed follow-up failure renders translated copy plus the support link.
    assertNoRawKeys()
    await act(async () => {
      form.requestSubmit()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain(
      "We’ll email you when the problem is resolved.",
    )
    assertNoRawKeys()
  })
})
