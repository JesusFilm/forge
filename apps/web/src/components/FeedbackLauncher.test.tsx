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
import { buttonVariants } from "@/components/ui/button-variants"
import { WATCH_PILL_BUTTON_CLASS } from "@/components/watch/watch-section-styles"
import { resetQueuedGoogleAnalyticsEvents } from "@/components/GoogleAnalytics"
import { FEEDBACK_INTRO_MAX_SESSIONS } from "@/components/useFeedbackLauncherIntro"
import { requestWatchFeedback } from "@/lib/watch-feedback-events"

let container: HTMLDivElement
let root: Root

function launcher() {
  return document.querySelector(
    '[data-testid="feedback-launcher"]',
  ) as HTMLButtonElement | null
}

function gtagEvents(): Array<[string, Record<string, unknown>]> {
  const gtag = window.gtag as unknown as ReturnType<typeof vi.fn>
  return gtag.mock.calls
    .filter(([kind]) => kind === "event")
    .map(([, name, params]) => [
      name as string,
      (params ?? {}) as Record<string, unknown>,
    ])
}

function gtagEvent(name: string) {
  return gtagEvents().filter(([eventName]) => eventName === name)
}

function launcherLabel() {
  return document.querySelector(
    '[data-testid="feedback-launcher-label"]',
  ) as HTMLElement | null
}

// The introduction is measured in seconds, so every test of it re-renders
// under fake timers: the timers `beforeEach` already armed belong to the
// real clock and `vi.useFakeTimers()` cannot reach back and take them.
/**
 * Makes every storage access throw, the way a locked-down browser profile
 * does. `vi.spyOn(Storage.prototype, ...)` does NOT work here — jsdom does
 * not route `window.sessionStorage.getItem` through the prototype, so a
 * prototype spy leaves the real storage in the path and the test proves
 * nothing. Replacing the accessor is what actually denies it.
 */
async function withDeniedStorageAsync(run: () => Promise<void>) {
  const restore = denyStorage()
  try {
    await run()
  } finally {
    restore()
  }
}

function denyStorage(): () => void {
  const original = {
    session: Object.getOwnPropertyDescriptor(window, "sessionStorage"),
    local: Object.getOwnPropertyDescriptor(window, "localStorage"),
  }
  const deny = {
    get() {
      throw new Error("SecurityError")
    },
    configurable: true,
  }
  Object.defineProperty(window, "sessionStorage", deny)
  Object.defineProperty(window, "localStorage", deny)
  return () => {
    if (original.session)
      Object.defineProperty(window, "sessionStorage", original.session)
    if (original.local)
      Object.defineProperty(window, "localStorage", original.local)
  }
}

function withDeniedStorage(run: () => void) {
  const restore = denyStorage()
  try {
    run()
  } finally {
    restore()
  }
}

function setScrollY(scrollY: number) {
  Object.defineProperty(window, "scrollY", {
    value: scrollY,
    configurable: true,
    writable: true,
  })
}

function renderIntroOnFakeTimers({
  freshSession = true,
}: { freshSession?: boolean } = {}) {
  act(() => root.unmount())
  // The intro is claimed once per SESSION, and `beforeEach` already spent
  // this one on its own render. Clearing sessionStorage — and only that —
  // makes the remount below a NEW visit in the SAME browser, so the
  // localStorage allowance keeps counting up across calls.
  // `freshSession: false` keeps it a remount within one visit, which is the
  // cross-layout navigation case.
  if (freshSession) window.sessionStorage.clear()
  // The launcher reads the scroll baseline at mount, and jsdom carries a
  // stubbed `scrollY` across tests — without this reset a later test
  // inherits the previous one's offset and its "jitter" scroll reads as a
  // 33px jump.
  setScrollY(0)
  vi.useFakeTimers()
  root = createRoot(container)
  act(() => root.render(<FeedbackLauncher />))
}

function scrollTo(scrollY: number) {
  setScrollY(scrollY)
  act(() => {
    window.dispatchEvent(new Event("scroll"))
  })
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
  // jsdom shares one storage pair across the whole file, and the launcher now
  // keeps two things in it: the composer's draft, and the count of sessions
  // that have already seen the intro label. Without this reset each test
  // inherits the previous test's half-written report and its spent intro.
  window.sessionStorage.clear()
  window.localStorage.clear()
  // The funnel queues events fired before the Google tag exists, and that
  // queue is module-scoped by design (it outlives any one component). Tests
  // that never install a `gtag` leave entries in it, which would otherwise
  // flush into the next test's spy.
  resetQueuedGoogleAnalyticsEvents()
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
    // Shape comes from the download CTA's own pill recipe, so these are
    // the classes that recipe contributes rather than a parallel set.
    expect(button?.className).toContain("rounded-full")
    expect(button?.className).toContain("bg-white")
    expect(button?.className).toContain("text-black")
    expect(button?.className).toContain("hover:bg-red-500")
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

  it("requires a useful message, and validates the email only when given", async () => {
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
    setValue(
      document.querySelector('input[autocomplete="email"]') as HTMLInputElement,
      "not-an-email",
    )
    submitCurrentStep()
    expect(document.body.textContent).toContain("Enter a valid email address.")
    expect(feedbackAction.submit).not.toHaveBeenCalled()
  })

  it("sends without a name, and omits the field rather than inventing one", async () => {
    // The name used to be required on the LAST step, after the reporter had
    // already written everything else. Absent must reach the action as absent,
    // so "chose not to say" stays distinguishable from a typed "Anonymous".
    await openFeedback()
    selectFeedbackCategory("problem")
    submitCurrentStep()
    setValue(
      document.querySelector("textarea") as HTMLTextAreaElement,
      "Playback failed after I pressed Watch.",
    )
    submitCurrentStep()
    submitCurrentStep()
    submitCurrentStep()

    expect(document.body.textContent).not.toContain("Name is required.")
    await sendFeedback()

    expect(feedbackAction.submit).toHaveBeenCalledTimes(1)
    const payload = feedbackAction.submit.mock.calls[0][0]
    expect(payload).not.toHaveProperty("name")
    expect(payload.message).toBe("Playback failed after I pressed Watch.")
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

  it("shares the download pill's own height recipe instead of a copy of it", () => {
    // Height is padding plus the label's line box on both controls. If a
    // future edit overrides either on the launcher, the two stop matching
    // and this fails — which is the whole claim the design rests on.
    const pill = buttonVariants({
      variant: "pill",
      className: WATCH_PILL_BUTTON_CLASS,
    })
    for (const shapeClass of [
      "py-2",
      "sm:py-3.5",
      "text-xs",
      "rounded-full",
      "[&_svg]:size-3.5",
      "sm:[&_svg]:size-4",
    ]) {
      expect(pill).toContain(shapeClass)
      expect(launcher()?.className).toContain(shapeClass)
    }
    // The pill's flex gap is deliberately neutralised at BOTH tiers: a gap
    // survives a zero-width label and would knock the settled icon off
    // centre, and tailwind-merge does not fold `sm:gap-2` into `gap-0`.
    expect(pill).toContain("sm:gap-2")
    expect(launcher()?.className).toContain("sm:gap-0")
    expect(launcher()?.className).not.toContain("sm:gap-2")
  })

  it("introduces itself with the label showing, at the pill's full width", () => {
    const button = launcher()
    expect(button?.getAttribute("data-intro")).toBe("visible")
    expect(launcherLabel()?.textContent).toBe("Feedback")
    expect(launcherLabel()?.className).toContain("max-w-[16rem]")
    expect(launcherLabel()?.className).not.toContain("max-w-0")
    // Still wearing the pill's own horizontal padding, not the settled
    // circle's.
    expect(button?.className).toContain("px-3")
    expect(button?.className).not.toContain("px-2")
  })

  it("settles to an icon-only circle once the reader scrolls", () => {
    renderIntroOnFakeTimers()
    act(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(launcher()?.getAttribute("data-intro")).toBe("visible")

    scrollTo(40)

    const button = launcher()
    expect(button?.getAttribute("data-intro")).toBe("settled")
    // Settled padding is half the gap between the pill's height and its
    // 16px icon at each tier — 8px of 34px, 14px of 46px — so the button
    // lands as a circle exactly as tall as the download pill. Both
    // numbers were measured in Chrome, not derived from the class names.
    expect(button?.className).toContain("px-2")
    expect(button?.className).toContain("sm:px-3.5")
    expect(launcherLabel()?.className).toContain("max-w-0")
    expect(launcherLabel()?.className).toContain("opacity-0")
    // The label is still reachable — hover and focus reopen the pill.
    expect(button?.className).toContain("hover:px-3")
    expect(button?.className).toContain("sm:hover:px-5")
    expect(button?.className).toContain("focus-visible:px-3")
    expect(launcherLabel()?.className).toContain("group-hover:max-w-[16rem]")
    expect(launcherLabel()?.className).toContain(
      "group-focus-visible:max-w-[16rem]",
    )
  })

  it("holds the label for its minimum dwell even when the page scrolls at once", () => {
    renderIntroOnFakeTimers()

    // A scroll position restored on navigation fires before anyone could
    // have read the label. It must arm the retirement, not perform it.
    scrollTo(600)
    expect(launcher()?.getAttribute("data-intro")).toBe("visible")

    act(() => {
      vi.advanceTimersByTime(1199)
    })
    expect(launcher()?.getAttribute("data-intro")).toBe("visible")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(launcher()?.getAttribute("data-intro")).toBe("settled")
  })

  it("ignores scroll jitter below the movement threshold", () => {
    renderIntroOnFakeTimers()
    act(() => {
      vi.advanceTimersByTime(1200)
    })

    scrollTo(7)

    expect(launcher()?.getAttribute("data-intro")).toBe("visible")
  })

  it("settles a grace period after the first interaction, with no scroll", () => {
    renderIntroOnFakeTimers()
    act(() => {
      vi.advanceTimersByTime(1200)
    })

    act(() => {
      window.dispatchEvent(new Event("pointerdown"))
    })
    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(launcher()?.getAttribute("data-intro")).toBe("visible")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(launcher()?.getAttribute("data-intro")).toBe("settled")
  })

  it("settles on the backstop dwell when nothing on the page is touched", () => {
    renderIntroOnFakeTimers()

    act(() => {
      vi.advanceTimersByTime(5999)
    })
    expect(launcher()?.getAttribute("data-intro")).toBe("visible")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(launcher()?.getAttribute("data-intro")).toBe("settled")
  })

  it("stays settled once it has settled", () => {
    renderIntroOnFakeTimers()
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(launcher()?.getAttribute("data-intro")).toBe("settled")

    scrollTo(0)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(launcher()?.getAttribute("data-intro")).toBe("settled")
  })

  describe("draft safety", () => {
    async function typeAMessage(text: string) {
      await openFeedback()
      selectFeedbackCategory("problem")
      submitCurrentStep()
      setValue(document.querySelector("textarea") as HTMLTextAreaElement, text)
    }

    function dismiss() {
      const close = document.querySelector(
        '[data-testid="feedback-modal-close"]',
      ) as HTMLButtonElement
      act(() => close.click())
    }

    it("keeps what someone wrote when they dismiss the composer", async () => {
      const written = "I spent five minutes writing this description."
      await typeAMessage(written)

      dismiss()
      await openFeedback()

      expect(
        (document.querySelector("#feedback-message") as HTMLTextAreaElement)
          .value,
      ).toBe(written)
      // And on the step they left, not back at the beginning.
      expect(
        document.querySelector('[data-testid="feedback-step-2"]'),
      ).not.toBeNull()
    })

    it("survives the composer being torn down entirely", async () => {
      const written = "A reload must not cost someone their report."
      await typeAMessage(written)

      // A remount is the closest this harness gets to a page reload: it
      // discards every piece of React state, leaving only storage.
      act(() => root.unmount())
      root = createRoot(container)
      act(() => root.render(<FeedbackLauncher />))
      await openFeedback()

      expect(
        (document.querySelector("#feedback-message") as HTMLTextAreaElement)
          .value,
      ).toBe(written)
    })

    it("does not carry a draft from one page onto another", async () => {
      // Feedback is ABOUT a page. Restoring here would file someone's report
      // against a URL they never looked at.
      await typeAMessage("Something is broken on the page I was just on.")
      dismiss()

      window.history.replaceState({}, "", "/watch/another-video.html")
      act(() => root.unmount())
      root = createRoot(container)
      act(() => root.render(<FeedbackLauncher />))
      await openFeedback()

      expect(document.querySelector("#feedback-message")).toBeNull()
      expect(
        document.querySelector('[data-testid="feedback-step-1"]'),
      ).not.toBeNull()
    })

    it("drops the draft once the report has actually landed", async () => {
      await fillMinimalFeedback("idea")
      await sendFeedback()

      expect(
        window.sessionStorage.getItem("forge.watch.feedback_draft"),
      ).toBeNull()
    })

    it("keeps the draft when the send fails, so it can be retried", async () => {
      feedbackAction.submit.mockResolvedValueOnce({
        ok: false,
        reason: "delivery_failed",
        message: "nope",
      })
      await fillMinimalFeedback("problem")
      await sendFeedback()

      expect(
        window.sessionStorage.getItem("forge.watch.feedback_draft"),
      ).not.toBeNull()
    })

    it("still opens when storage refuses to cooperate", async () => {
      // The denial has to span the modal's OWN draft load, which happens in
      // an effect after the lazy chunk resolves. An earlier version of this
      // test restored storage before that point and so proved nothing about
      // the composer — only about the click.
      await withDeniedStorageAsync(async () => {
        act(() => root.unmount())
        root = createRoot(container)
        act(() => root.render(<FeedbackLauncher />))
        act(() => launcher()?.click())
        await flushDynamicModal()

        expect(
          document.querySelector('[data-testid="feedback-modal"]'),
        ).not.toBeNull()
        expect(
          document.querySelector('[data-testid="feedback-step-1"]'),
        ).not.toBeNull()
      })
    })
  })

  describe("optional steps announce themselves as optional", () => {
    async function reachStep3() {
      await openFeedback()
      selectFeedbackCategory("problem")
      submitCurrentStep()
      setValue(
        document.querySelector("textarea") as HTMLTextAreaElement,
        "Playback failed after I pressed Watch.",
      )
      submitCurrentStep()
    }

    function advanceLabel() {
      return document
        .querySelector('button[type="submit"]')
        ?.textContent?.trim()
    }

    it("offers to skip an untouched context step", async () => {
      // Step 3 used to read "Continue", which makes optional work look
      // required — only step 4 said otherwise.
      await reachStep3()

      expect(
        document.querySelector('[data-testid="feedback-step-3"]'),
      ).not.toBeNull()
      expect(advanceLabel()).toBe("Skip for now")
    })

    it("asks to continue once that step has been answered", async () => {
      await reachStep3()
      selectThemed("feedback-language-area", "subtitles")

      expect(advanceLabel()).toBe("Continue")
    })
  })

  describe("reopening after the modal stopped unmounting", () => {
    // Closing the composer no longer tears it down, so every piece of state
    // React used to discard on unmount now has to be reset deliberately.
    // Each test here failed before that reset existed.
    function dismiss() {
      const close = document.querySelector(
        '[data-testid="feedback-modal-close"]',
      ) as HTMLButtonElement
      act(() => close.click())
    }

    it("offers a fresh composer after a successful report, not the thank-you pane", async () => {
      await fillMinimalFeedback("praise")
      await sendFeedback()
      expect(document.body.textContent).toContain("Thank you")

      dismiss()
      await openFeedback()

      expect(document.body.textContent).not.toContain("Thank you")
      expect(
        document.querySelector('[data-testid="feedback-step-1"]'),
      ).not.toBeNull()
    })

    it("does not carry one page's words onto another during client-side navigation", async () => {
      // Deliberately NOT a remount: the launcher lives in a Watch layout that
      // survives navigation inside its section, so the composer stays mounted
      // and only the URL changes. Unmounting the root here would test a page
      // reload instead — a different, already-safe path.
      await openFeedback()
      selectFeedbackCategory("problem")
      submitCurrentStep()
      setValue(
        document.querySelector("textarea") as HTMLTextAreaElement,
        "Something is wrong on the page I was just reading.",
      )
      dismiss()

      window.history.replaceState({}, "", "/watch/another-video.html")
      await openFeedback()

      expect(document.querySelector("#feedback-message")).toBeNull()
      expect(
        document.querySelector('[data-testid="feedback-step-1"]'),
      ).not.toBeNull()
      // And the stale text must not have been re-persisted under the new path.
      expect(
        window.sessionStorage.getItem("forge.watch.feedback_draft"),
      ).toBeNull()
    })

    it("reports the first step of every session, not just the first session", async () => {
      window.gtag = vi.fn()
      await openFeedback()
      const close = document.querySelector(
        '[data-testid="feedback-modal-close"]',
      ) as HTMLButtonElement
      await act(async () => {
        close.click()
        await new Promise((resolve) => window.setTimeout(resolve, 120))
      })
      await openFeedback()

      expect(gtagEvent("feedback_step_viewed")).toEqual([
        ["feedback_step_viewed", { step: 1, step_name: "type" }],
        ["feedback_step_viewed", { step: 1, step_name: "type" }],
      ])
      window.gtag = undefined
    })

    it("takes the element picker away with the composer", async () => {
      await openFeedback()
      selectFeedbackCategory("problem")
      submitCurrentStep()
      setValue(
        document.querySelector("textarea") as HTMLTextAreaElement,
        "Playback failed after I pressed Watch.",
      )
      submitCurrentStep()
      submitCurrentStep()
      act(() =>
        (
          document.querySelector(
            '[data-testid="feedback-select-element"]',
          ) as HTMLButtonElement
        ).click(),
      )
      expect(
        document.querySelector('[data-testid="feedback-element-picker"]'),
      ).not.toBeNull()

      // Global search takes precedence and closes the composer mid-pick.
      searchState.searchOpen = true
      act(() => root.render(<FeedbackLauncher />))
      await act(async () => {
        await new Promise((resolve) => window.requestAnimationFrame(resolve))
      })

      // A full-screen picker with document listeners must not outlive the
      // composer that opened it — unmounting used to guarantee that.
      expect(
        document.querySelector('[data-testid="feedback-element-picker"]'),
      ).toBeNull()
    })

    it("does not carry a diagnostics opt-in into the next report", async () => {
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
      act(() => diagnostics.click())
      expect(
        (document.querySelector('input[type="checkbox"]') as HTMLInputElement)
          .checked,
      ).toBe(true)

      dismiss()
      await openFeedback()

      // The draft legitimately brings the category and message back — and
      // lands on the same step, which is why the checkbox is in reach here.
      expect(
        document.querySelector('[data-testid="feedback-step-2"]'),
      ).not.toBeNull()
      // But attaching browser, device, viewport, URL and time zone is a
      // decision about ONE report, and does not come back with it.
      expect(
        (document.querySelector('input[type="checkbox"]') as HTMLInputElement)
          .checked,
      ).toBe(false)
    })

    it("clears a validation error rather than greeting the next session with it", async () => {
      await openFeedback()
      submitCurrentStep()
      expect(document.body.textContent).toContain(
        "Choose a feedback type to continue.",
      )

      dismiss()
      await openFeedback()

      expect(document.body.textContent).not.toContain(
        "Choose a feedback type to continue.",
      )
    })
  })

  describe("intro label frequency", () => {
    it("introduces itself while the reader still has an allowance", () => {
      // `beforeEach` already rendered once, which spent session 1. This is
      // session 2, and FEEDBACK_INTRO_MAX_SESSIONS is 2.
      renderIntroOnFakeTimers()

      expect(launcher()?.getAttribute("data-intro")).toBe("visible")
      expect(
        window.localStorage.getItem("forge.watch.feedback_intro_sessions"),
      ).toBe(String(FEEDBACK_INTRO_MAX_SESSIONS))
    })

    it("stops introducing itself once the reader has seen it enough", () => {
      renderIntroOnFakeTimers() // session 2 — the last one with an allowance
      renderIntroOnFakeTimers() // session 3 — over it

      expect(launcher()?.getAttribute("data-intro")).toBe("settled")
    })

    it("does not re-introduce itself on a remount within the same visit", () => {
      // The launcher is mounted per Watch section layout, so crossing from
      // /videos to /history remounts it. That must not count as a new visit.
      renderIntroOnFakeTimers()
      expect(launcher()?.getAttribute("data-intro")).toBe("visible")

      renderIntroOnFakeTimers({ freshSession: false })

      expect(launcher()?.getAttribute("data-intro")).toBe("settled")
    })

    it("introduces itself when storage cannot be read at all", () => {
      // A reader who cannot be counted should still be told what the button
      // is — the fallback favours the explanation, not the silence.
      withDeniedStorage(() => {
        act(() => root.unmount())
        root = createRoot(container)
        act(() => root.render(<FeedbackLauncher />))
        expect(launcher()?.getAttribute("data-intro")).toBe("visible")
      })
    })
  })

  describe("funnel analytics", () => {
    beforeEach(() => {
      window.gtag = vi.fn()
    })

    afterEach(() => {
      window.gtag = undefined
    })

    it("reports the open, with the affordance that opened it", async () => {
      await openFeedback()

      expect(gtagEvent("feedback_opened")).toEqual([
        ["feedback_opened", { open_source: "launcher" }],
      ])
    })

    it("distinguishes a page CTA open from a launcher open", async () => {
      act(() => {
        requestWatchFeedback()
      })
      await flushDynamicModal()

      expect(gtagEvent("feedback_opened")).toEqual([
        ["feedback_opened", { open_source: "page_cta" }],
      ])
    })

    it("counts one open per session, not one per CTA press", async () => {
      act(() => {
        requestWatchFeedback()
      })
      await flushDynamicModal()
      act(() => {
        requestWatchFeedback()
        requestWatchFeedback()
      })

      expect(gtagEvent("feedback_opened")).toHaveLength(1)
    })

    it("reports each step as it is reached, named as the reader saw it", async () => {
      await openFeedback()
      expect(gtagEvent("feedback_step_viewed")).toEqual([
        ["feedback_step_viewed", { step: 1, step_name: "type" }],
      ])

      selectFeedbackCategory("idea")
      submitCurrentStep()

      expect(gtagEvent("feedback_step_viewed")).toEqual([
        ["feedback_step_viewed", { step: 1, step_name: "type" }],
        [
          "feedback_step_viewed",
          { step: 2, step_name: "describe", category: "idea" },
        ],
      ])
    })

    it("does not re-report a step the reader is still on", async () => {
      await openFeedback()
      selectFeedbackCategory("problem")
      submitCurrentStep()
      // Every keystroke re-renders the modal with the same step.
      setValue(
        document.querySelector("textarea") as HTMLTextAreaElement,
        "Playback failed after I pressed Watch.",
      )
      setValue(
        document.querySelector("textarea") as HTMLTextAreaElement,
        "Playback failed after I pressed Watch again.",
      )

      expect(gtagEvent("feedback_step_viewed")).toHaveLength(2)
    })

    it("reports a step that refused to let the reader through", async () => {
      await openFeedback()
      // No category chosen: step 1 blocks.
      submitCurrentStep()

      expect(gtagEvent("feedback_step_blocked")).toEqual([
        [
          "feedback_step_blocked",
          { step: 1, step_name: "type", reason: "category" },
        ],
      ])
      expect(gtagEvent("feedback_step_viewed")).toHaveLength(1)
    })

    it("reports the field that blocked the last step", async () => {
      await openFeedback()
      selectFeedbackCategory("problem")
      submitCurrentStep()
      setValue(
        document.querySelector("textarea") as HTMLTextAreaElement,
        "Playback failed after I pressed Watch.",
      )
      submitCurrentStep()
      submitCurrentStep()
      submitCurrentStep()
      // An unparseable email is now the only thing that can hold step 5.
      // Multi-field ordering is pinned in the analytics module's own suite,
      // where a three-field fixture can actually discriminate a sort.
      setValue(
        document.querySelector(
          'input[autocomplete="email"]',
        ) as HTMLInputElement,
        "not-an-email",
      )
      submitCurrentStep()

      expect(gtagEvent("feedback_step_blocked")).toEqual([
        [
          "feedback_step_blocked",
          { step: 5, step_name: "about", reason: "email" },
        ],
      ])
    })

    it("reports which optional sections a submission carried", async () => {
      await fillMinimalFeedback("praise")
      await sendFeedback()

      expect(gtagEvent("feedback_submitted")).toEqual([
        [
          "feedback_submitted",
          {
            category: "praise",
            has_name: true,
            has_email: false,
            has_language_issue: false,
            has_content: false,
            has_selected_element: false,
            has_diagnostics: false,
          },
        ],
      ])
    })

    it("separates a failed send from an abandonment", async () => {
      feedbackAction.submit.mockResolvedValueOnce({
        ok: false,
        reason: "rate_limited",
        message: "Too many requests",
      })
      await fillMinimalFeedback("problem")
      await sendFeedback()

      expect(gtagEvent("feedback_submit_failed")).toEqual([
        [
          "feedback_submit_failed",
          { reason: "rate_limited", category: "problem" },
        ],
      ])
      expect(gtagEvent("feedback_abandoned")).toHaveLength(0)
    })

    it("reports the step someone abandoned on when they dismiss", async () => {
      await openFeedback()
      selectFeedbackCategory("confusing")
      submitCurrentStep()

      const close = document.querySelector(
        '[data-testid="feedback-modal-close"]',
      ) as HTMLButtonElement
      await act(async () => {
        close.click()
        await new Promise((resolve) => window.setTimeout(resolve, 120))
      })

      expect(gtagEvent("feedback_abandoned")).toEqual([
        [
          "feedback_abandoned",
          {
            step: 2,
            step_name: "describe",
            reason: "dismissed",
            category: "confusing",
          },
        ],
      ])
    })

    it("does not call a completed submission an abandonment", async () => {
      await fillMinimalFeedback("idea")
      await sendFeedback()

      const close = document.querySelector(
        '[data-testid="feedback-modal-close"]',
      ) as HTMLButtonElement
      await act(async () => {
        close.click()
        await new Promise((resolve) => window.setTimeout(resolve, 120))
      })

      expect(gtagEvent("feedback_submitted")).toHaveLength(1)
      expect(gtagEvent("feedback_abandoned")).toHaveLength(0)
    })

    it("tells global search taking over apart from a deliberate dismissal", async () => {
      await openFeedback()
      searchState.searchOpen = true
      act(() => root.render(<FeedbackLauncher />))
      await act(async () => {
        await new Promise((resolve) => window.requestAnimationFrame(resolve))
      })

      expect(gtagEvent("feedback_abandoned")).toEqual([
        [
          "feedback_abandoned",
          { step: 1, step_name: "type", reason: "search_opened" },
        ],
      ])
    })

    it("reports an abandonment once, however many close paths fire", async () => {
      await openFeedback()
      const close = document.querySelector(
        '[data-testid="feedback-modal-close"]',
      ) as HTMLButtonElement
      await act(async () => {
        close.click()
        await new Promise((resolve) => window.setTimeout(resolve, 120))
      })
      searchState.searchOpen = true
      act(() => root.render(<FeedbackLauncher />))
      await act(async () => {
        await new Promise((resolve) => window.requestAnimationFrame(resolve))
      })

      expect(gtagEvent("feedback_abandoned")).toHaveLength(1)
    })

    it("never puts what someone wrote on the analytics wire", async () => {
      const secrets = [
        "Playback failed after I pressed Watch.",
        "Alex Morgan",
        "alex@example.com",
      ]
      await fillMinimalFeedback("problem")
      setValue(
        document.querySelector(
          'input[autocomplete="email"]',
        ) as HTMLInputElement,
        "alex@example.com",
      )
      await sendFeedback()

      const emitted = gtagEvents()
      // Anti-vacuous: the sweep below proves nothing if nothing was emitted.
      expect(emitted.length).toBeGreaterThan(3)
      const serialized = JSON.stringify(emitted)
      for (const secret of secrets) {
        expect(serialized).not.toContain(secret)
      }
      // The email is recorded only as a yes/no.
      expect(gtagEvent("feedback_submitted")[0]?.[1].has_email).toBe(true)
      expect(gtagEvent("feedback_submitted")[0]?.[1].has_name).toBe(true)
    })
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

  it("opens for a page-level CTA and keeps yielding to global search", async () => {
    act(() => {
      requestWatchFeedback()
    })
    await flushDynamicModal()
    expect(
      document.querySelector('[data-testid="feedback-modal"]'),
    ).not.toBeNull()

    // Same precedence rule as the launcher button: search wins.
    const close = document.querySelector(
      '[data-testid="feedback-modal-close"]',
    ) as HTMLButtonElement
    await act(async () => {
      close.click()
      await new Promise((resolve) => window.setTimeout(resolve, 120))
    })
    searchState.searchOpen = true
    act(() => root.render(<FeedbackLauncher />))
    act(() => {
      requestWatchFeedback()
    })
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
    // fallback can be glued to the preceding word. innerHTML (not textContent)
    // so keys leaked into attributes (aria-label, placeholder, title) are
    // caught too — textContent excludes attribute values.
    const assertNoRawKeys = () =>
      expect(document.body.innerHTML).not.toMatch(/Feedback\.[A-Za-z]/)

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
