/**
 * @vitest-environment jsdom
 *
 * U9 — DownloadModal tests.
 *
 * Covers the redesigned modal:
 *  - Header metadata (title, poster, duration, language) renders when provided.
 *  - Quality bucketing — the 8 raw quality keys collapse into Highest/High/Low.
 *  - Default selection is Highest, surfaced in the dropdown trigger.
 *  - Terms gating: every downloadable viewer must agree before Download.
 *  - Account gating: flagged signed-in viewers re-check sessions before the
 *    proxy request.
 *  - Allowlist enforcement: blocked URLs surface an inline error and never
 *    create the `<a>` element that triggers the browser download.
 *  - Allowed URLs trigger a programmatic anchor with the correct attributes.
 *  - Empty-state defensive render when `downloads` is `[]`.
 *
 * Note: the `@base-ui/react` Dialog renders into a portal, so DOM queries use
 * `document` (not the local container) for elements inside the modal.
 */

import { setRequestLocale } from "next-intl/server"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DownloadModal,
  type DownloadModalDownload,
  type DownloadModalProps,
} from "@/components/watch/DownloadModal"
import { redirectToAuth } from "@/components/watch/download-session-client"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"

// next/image renders an <img> in tests; the modal otherwise tries to load the
// real image-optimization endpoint, which JSDOM can't serve. Preserve its
// layout-only props as data attributes without forwarding them to the DOM.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    fill,
    sizes,
    ...rest
  }: {
    src: string
    alt: string
    fill?: boolean
    sizes?: string
  } & Record<string, unknown>) => {
    // Bypass `<img>` lint warning — this mock is only loaded in jsdom
    // tests where next/image's optimization endpoint isn't available.
    const Img = "img"
    return (
      <Img
        src={src}
        alt={alt}
        data-fill={fill ? "true" : "false"}
        data-sizes={sizes}
        {...rest}
      />
    )
  },
}))

vi.mock(
  "@/components/watch/download-session-client",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/watch/download-session-client")
      >()
    return {
      ...actual,
      redirectToAuth: vi.fn(),
    }
  },
)

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ authenticated: true })),
  )
  vi.mocked(redirectToAuth).mockReset()
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  // Drop any portal nodes left over from previous renders.
  document.body.innerHTML = ""
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function TestDownloadModal({
  variantId = "variant-1",
  videoSlug = "jesus",
  ...props
}: Omit<DownloadModalProps, "variantId" | "videoSlug"> &
  Partial<Pick<DownloadModalProps, "variantId" | "videoSlug">>) {
  return (
    <DownloadModal variantId={variantId} videoSlug={videoSlug} {...props} />
  )
}

function makeDownload(
  overrides: Partial<DownloadModalDownload> & {
    documentId: string
    url?: string
  },
): DownloadModalDownload {
  return {
    quality: "high",
    size: 42 * 1024 * 1024,
    ...overrides,
  }
}

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector) as HTMLElement | null
}

function $$(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector)) as HTMLElement[]
}

function acceptTerms() {
  const checkbox = $(
    '[data-testid="watch-download-modal-tos"]',
  ) as HTMLInputElement
  act(() => {
    checkbox.click()
  })
}

describe("DownloadModal — header metadata", () => {
  it.each([
    { name: "download", accountGateEnabled: false, authRequiredLoginUrl: null },
    {
      name: "sign-in",
      accountGateEnabled: true,
      authRequiredLoginUrl: "/login",
    },
  ])(
    "scrolls the $name layout at the viewport edge instead of inside the modal",
    ({ accountGateEnabled, authRequiredLoginUrl }) => {
      act(() => {
        root.render(
          <TestDownloadModal
            open
            downloads={[makeDownload({ documentId: "dl-1" })]}
            accountGateEnabled={accountGateEnabled}
            authRequiredLoginUrl={authRequiredLoginUrl}
            onClose={vi.fn()}
          />,
        )
      })

      const modal = $('[data-testid="watch-download-modal"]')
      const viewport = modal?.parentElement
      const content = $('[data-testid="watch-download-modal-content"]')

      expect(viewport?.getAttribute("data-slot")).toBe("dialog-viewport")
      expect(viewport?.className).toContain("fixed")
      expect(viewport?.className).toContain("inset-0")
      expect(viewport?.className).toContain("overflow-y-auto")
      expect(modal?.className).toContain("m-auto")
      expect(modal?.className).toContain("shrink-0")
      expect(content?.className).not.toContain("overflow-y-auto")
      expect(content?.className).not.toContain("max-h-")
      expect(
        modal?.contains($('[data-testid="watch-download-modal-close"]')),
      ).toBe(true)
    },
  )

  it("renders title, language pill, and duration overlay when provided", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          videoTitle="JESUS"
          posterUrl="https://imagedelivery.net/poster.jpg"
          durationSeconds={2 * 3600 + 7 * 60 + 54}
          languageName="English"
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-download-modal-title"]')?.textContent).toBe(
      "JESUS",
    )
    expect(
      $('[data-testid="watch-download-modal-language"]')?.textContent,
    ).toContain("English")
    // `formatDuration` is the shared util at `@/lib/format-duration` —
    // hours render without zero-padding (`2:07:54`, not `02:07:54`) to
    // match the standard media-duration convention and the search-card
    // pill format.
    expect(
      $('[data-testid="watch-download-modal-duration"]')?.textContent,
    ).toContain("2:07:54")
    expect($('[data-testid="watch-download-modal-poster"]')).not.toBeNull()
    const poster = $(
      '[data-testid="watch-download-modal-poster"] img',
    ) as HTMLImageElement | null
    expect(poster?.getAttribute("src")).toBe(
      "https://imagedelivery.net/poster.jpg",
    )
    expect(poster?.dataset.fill).toBe("true")
    expect(poster?.dataset.sizes).toBe("(min-width: 640px) 224px, 100vw")
    // At large text the fixed-width poster leaves the title column too narrow;
    // the header row wraps so the title drops below instead of overflowing.
    const posterBox = $('[data-testid="watch-download-modal-poster"]')
    expect(posterBox?.parentElement?.className).toContain("sm:flex-wrap")
    expect(posterBox?.className).toContain("sm:max-w-full")
    expect(
      $('[data-testid="watch-download-modal-eyebrow"]')?.parentElement
        ?.className,
    ).toContain("min-w-[min(100%,12rem)]")
    expect($('[data-testid="watch-download-modal-eyebrow"]')?.className).toBe(
      WATCH_SECTION_EYEBROW_CLASS,
    )
  })

  it("omits the duration overlay when durationSeconds is null/zero", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          videoTitle="JESUS"
          durationSeconds={null}
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-download-modal-duration"]')).toBeNull()
  })
})

describe("DownloadModal — quality bucketing", () => {
  it("buckets raw qualities into at-most three tiers (Highest / High / Low)", () => {
    const downloads: DownloadModalDownload[] = [
      makeDownload({ documentId: "fhd", quality: "fhd" }), // -> Highest
      makeDownload({ documentId: "high", quality: "high" }), // -> High
      makeDownload({ documentId: "distroHigh", quality: "distroHigh" }), // legacy: never a tier
      makeDownload({ documentId: "low", quality: "low" }), // -> Low
      makeDownload({ documentId: "distroLow", quality: "distroLow" }), // legacy: never a tier
    ]
    act(() => {
      root.render(
        <TestDownloadModal open downloads={downloads} onClose={vi.fn()} />,
      )
    })

    // Open the dropdown so options render in the listbox.
    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.click()
    })

    const options = $$('[data-testid="watch-download-modal-size-option"]')
    expect(options.map((o) => o.getAttribute("data-tier"))).toEqual([
      "highest",
      "high",
      "low",
    ])
  })

  it("shows exactly one option (Highest) when only one download is available", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "only",
              quality: "high",
              size: 700 * 1024 * 1024,
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.click()
    })

    const options = $$('[data-testid="watch-download-modal-size-option"]')
    expect(options.length).toBe(1)
    expect(options[0]?.getAttribute("data-tier")).toBe("highest")
  })

  it("shows exactly two options (Highest + Low) when two downloads are available", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "high",
              quality: "high",
              size: 700 * 1024 * 1024,
            }),
            makeDownload({
              documentId: "low",
              quality: "low",
              size: 500 * 1024 * 1024,
            }),
            makeDownload({
              documentId: "distroSd",
              quality: "distroSd",
              size: 600 * 1024 * 1024,
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.click()
    })

    const options = $$('[data-testid="watch-download-modal-size-option"]')
    expect(options.length).toBe(2)
    expect(options.map((o) => o.getAttribute("data-tier"))).toEqual([
      "highest",
      "low",
    ])
  })

  it("preselects Highest as the default; trigger shows it without any user click", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "fhd",
              quality: "fhd",
              size: 5294 * 1024 * 1024,
            }),
            makeDownload({
              documentId: "low",
              quality: "low",
              size: 506 * 1024 * 1024,
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const trigger = $('[data-testid="watch-download-modal-size"]')
    expect(trigger?.textContent).toContain("Highest")
    expect(trigger?.parentElement?.parentElement?.className).toContain("-mx-2")
    expect(trigger?.parentElement?.parentElement?.className).toContain("px-2")
  })

  it("omits file sizes from the selected tier and every option", () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "fhd",
              quality: "fhd",
              // 5.14 GB
              size: Math.round(5.14 * 1024 * 1024 * 1024),
            }),
            makeDownload({
              documentId: "low",
              quality: "low",
              // 558.17 MB
              size: Math.round(558.17 * 1024 * 1024),
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    expect(trigger.textContent).toBe("Highest")
    act(() => {
      trigger.click()
    })
    const optionText = $$('[data-testid="watch-download-modal-size-option"]')
      .map((option) => option.textContent)
      .join(" ")
    expect(optionText).toContain("Highest")
    expect(optionText).toContain("Low")
    expect(optionText).not.toContain("MB")
    expect(optionText).not.toContain("GB")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps the open file-size list in document flow so the modal can scroll to it", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({ documentId: "fhd", quality: "fhd" }),
            makeDownload({ documentId: "hd", quality: "hd" }),
            makeDownload({ documentId: "low", quality: "low" }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    act(() => {
      ;(
        $('[data-testid="watch-download-modal-size"]') as HTMLButtonElement
      ).click()
    })

    const list = $('[data-testid="watch-download-modal-size-list"]')
    expect(list?.parentElement).toBe(document.body)
    expect(list?.className).toContain("fixed")
    expect(list?.className).toContain("max-h-72")
    expect(list?.className).toContain("transition-[opacity,transform]")
    expect(list?.className).toContain("duration-150")
    expect(list?.className).toContain("opacity-100")
    expect(list?.className).not.toContain("relative")
    expect(list?.className).not.toContain("absolute")
  })

  it("animates the file size dropdown closed before unmounting it", () => {
    vi.useFakeTimers()

    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({ documentId: "fhd", quality: "fhd" }),
            makeDownload({ documentId: "hd", quality: "hd" }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement

    act(() => {
      trigger.click()
    })

    const openList = $('[data-testid="watch-download-modal-size-list"]')
    expect(openList?.getAttribute("data-open")).toBe("true")
    expect(openList?.className).toContain("opacity-100")

    act(() => {
      trigger.click()
    })

    const closingList = $('[data-testid="watch-download-modal-size-list"]')
    expect(closingList).not.toBeNull()
    expect(closingList?.getAttribute("data-open")).toBe("false")
    expect(closingList?.className).toContain("opacity-0")
    expect(closingList?.className).toContain("scale-[0.98]")
    expect(closingList?.className).toContain("-translate-y-1")

    act(() => {
      vi.advanceTimersByTime(160)
    })

    expect($('[data-testid="watch-download-modal-size-list"]')).toBeNull()
  })
})

describe("DownloadModal — Terms of Use agreement", () => {
  it("renders the legacy confirmation row with Download disabled by default", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    const checkbox = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    const row = $('[data-testid="watch-download-modal-confirmation-row"]')
    expect(confirm.disabled).toBe(true)
    expect(checkbox.checked).toBe(false)
    expect(checkbox.getAttribute("aria-label")).toBe(
      "I agree to the Terms of Use",
    )
    expect(row?.textContent).toContain("I agree to the Terms of Use")
    expect(row?.className).toContain("rounded-2xl")
    // The row wraps so Terms and the buttons stack when large text or a narrow
    // dialog leaves no room to sit side by side (the old `sm:flex-row` forced
    // them beside each other and pushed Download past the dialog's edge).
    expect(row?.className).toContain("flex-wrap")
    expect(row?.className).not.toContain("sm:flex-row")
    const actions = confirm.parentElement
    expect(actions?.className).toContain("flex-wrap")
    expect(actions?.className).toContain("max-w-full")
    expect(actions?.className).toContain("ml-auto")
    expect(row?.firstElementChild?.className).toContain("flex-1")
    expect(row?.firstElementChild?.className).toContain(
      "min-w-[min(100%,12rem)]",
    )
    expect($('[data-testid="watch-download-modal"]')?.className).toContain(
      "sm:max-w-[min(608px,calc(100vw-10rem))]",
    )
    expect(row?.contains(confirm)).toBe(true)
  })

  it("enables Download only while the checkbox is checked", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    const checkbox = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement

    acceptTerms()
    expect(checkbox.checked).toBe(true)
    expect(confirm.disabled).toBe(false)

    act(() => {
      checkbox.click()
    })
    expect(checkbox.checked).toBe(false)
    expect(confirm.disabled).toBe(true)
  })

  // QA N65: the consent sentence used to be a translated prefix + link +
  // suffix, so verb-final languages lost the verb ("मैं उपयोग की शर्तों" =
  // "I … Terms of Use"). Render the dialog and pin the whole sentence: the
  // verb follows the linked phrase in hi/ur, which a prefix + link layout
  // cannot produce.
  it.each([
    {
      locale: "hi",
      sentence: "मैं उपयोग की शर्तों से सहमत हूँ",
      link: "उपयोग की शर्तों",
    },
    {
      locale: "ur",
      sentence: "میں استعمال کی شرائط سے متفق ہوں",
      link: "استعمال کی شرائط",
    },
    {
      locale: "ru",
      sentence: "Я принимаю Условия использования",
      link: "Условия использования",
    },
  ])(
    "renders the $locale consent as one sentence with the Terms link inside it",
    ({ locale, sentence, link }) => {
      setRequestLocale(locale)
      try {
        act(() => {
          root.render(
            <TestDownloadModal
              open
              downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
              onClose={vi.fn()}
            />,
          )
        })

        const label = $('[data-testid="watch-download-modal-tos-label"]')
        const trigger = $('[data-testid="watch-download-modal-tos-trigger"]')
        const checkbox = $(
          '[data-testid="watch-download-modal-tos"]',
        ) as HTMLInputElement
        expect(label?.textContent).toBe(sentence)
        expect(trigger?.textContent).toBe(link)
        expect(label?.contains(trigger)).toBe(true)
        expect(checkbox.getAttribute("aria-label")).toBe(sentence)
        // The Terms button is not nested inside a <label>.
        expect(trigger?.closest("label")).toBeNull()
      } finally {
        setRequestLocale("en")
      }
    },
  )

  it("toggles the checkbox from the sentence text but not from the Terms button", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })

    const label = $(
      '[data-testid="watch-download-modal-tos-label"]',
    ) as HTMLElement
    const checkbox = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement

    act(() => {
      label.click()
    })
    expect(checkbox.checked).toBe(true)

    act(() => {
      label.click()
    })
    expect(checkbox.checked).toBe(false)

    act(() => {
      label.click()
    })
    expect(checkbox.checked).toBe(true)

    act(() => {
      ;(
        $('[data-testid="watch-download-modal-tos-trigger"]') as HTMLElement
      ).click()
    })
    expect(checkbox.checked).toBe(true)
    expect(
      $('[data-testid="watch-download-modal-terms-dialog"]'),
    ).not.toBeNull()
  })

  it("opens Terms without accepting; Cancel keeps the outer modal disabled", () => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={onClose}
        />,
      )
    })

    act(() => {
      ;(
        $(
          '[data-testid="watch-download-modal-tos-trigger"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(
      $('[data-testid="watch-download-modal-terms-dialog"]'),
    ).not.toBeNull()
    expect(
      $('[data-testid="watch-download-modal-terms-body"]')?.textContent,
    ).toContain("PLEASE CAREFULLY REVIEW THE TERMS OF USE")
    const termsOverlay = $('[data-testid="watch-download-modal-terms-overlay"]')
    const termsDialog = $('[data-testid="watch-download-modal-terms-dialog"]')
    const termsBody = $('[data-testid="watch-download-modal-terms-body"]')
    expect(termsOverlay?.className).toContain("overflow-y-auto")
    expect(termsDialog?.className).toContain("m-auto")
    expect(termsDialog?.className).toContain("shrink-0")
    expect(termsDialog?.className).not.toContain("max-h-")
    expect(termsBody?.className).not.toContain("overflow-y-auto")
    const canonicalLink = $(
      '[data-testid="watch-download-modal-terms-canonical-notice"] a',
    ) as HTMLAnchorElement
    expect(canonicalLink.href).toBe("https://www.jesusfilm.org/terms-of-use/")
    expect(canonicalLink.target).toBe("_blank")
    expect(canonicalLink.rel).toContain("noopener")
    expect(canonicalLink.rel).toContain("noreferrer")
    expect(
      ($('[data-testid="watch-download-modal-tos"]') as HTMLInputElement)
        .checked,
    ).toBe(false)

    act(() => {
      ;(
        $(
          '[data-testid="watch-download-modal-terms-cancel"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect($('[data-testid="watch-download-modal-terms-dialog"]')).toBeNull()
    expect($('[data-testid="watch-download-modal"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(
      ($('[data-testid="watch-download-modal-confirm"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it.each([
    {
      name: "X button",
      dismiss: () =>
        (
          $(
            '[data-testid="watch-download-modal-terms-close"]',
          ) as HTMLButtonElement
        ).click(),
    },
    {
      name: "backdrop",
      dismiss: () =>
        (
          $('[data-testid="watch-download-modal-terms-overlay"]') as HTMLElement
        ).click(),
    },
    {
      name: "Escape",
      dismiss: () =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
        ),
    },
  ])("$name dismisses Terms without accepting", ({ dismiss }) => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={onClose}
        />,
      )
    })
    act(() => {
      ;(
        $(
          '[data-testid="watch-download-modal-tos-trigger"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(document.activeElement).toBe(
      $('[data-testid="watch-download-modal-terms-close"]'),
    )
    act(() => {
      dismiss()
    })

    expect($('[data-testid="watch-download-modal-terms-dialog"]')).toBeNull()
    expect(document.activeElement).toBe(
      $('[data-testid="watch-download-modal-tos-trigger"]'),
    )
    expect($('[data-testid="watch-download-modal"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(
      ($('[data-testid="watch-download-modal-tos"]') as HTMLInputElement)
        .checked,
    ).toBe(false)
  })

  it("leaves focus alone when the user moved it before Terms closes", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })
    act(() => {
      ;(
        $(
          '[data-testid="watch-download-modal-tos-trigger"]',
        ) as HTMLButtonElement
      ).click()
    })
    const elsewhere = document.createElement("button")
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    act(() => {
      ;(
        $(
          '[data-testid="watch-download-modal-terms-cancel"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  describe("keyboard focus containment", () => {
    function openTerms() {
      act(() => {
        root.render(
          <TestDownloadModal
            open
            downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
            onClose={vi.fn()}
          />,
        )
      })
      act(() => {
        ;(
          $(
            '[data-testid="watch-download-modal-tos-trigger"]',
          ) as HTMLButtonElement
        ).click()
      })
    }

    function pressTab(shiftKey = false) {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Tab",
        shiftKey,
      })
      const target = document.activeElement ?? document.body
      act(() => {
        target.dispatchEvent(event)
      })
      return event
    }

    it("wraps Tab and Shift+Tab at the ends of Terms instead of leaving it", () => {
      openTerms()
      const close = $('[data-testid="watch-download-modal-terms-close"]')
      const accept = $('[data-testid="watch-download-modal-terms-accept"]')
      const cancel = $('[data-testid="watch-download-modal-terms-cancel"]')
      const canonical = $(
        '[data-testid="watch-download-modal-terms-canonical-notice"] a',
      )
      expect(document.activeElement).toBe(close)

      // Shift+Tab from the first control wraps to the last, Accept.
      expect(pressTab(true).defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(accept)

      // Tab from the last control wraps to the first, Close.
      expect(pressTab().defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(close)

      // Interior steps are left to the browser's natural tab order.
      for (const element of [canonical, cancel]) {
        element?.focus()
        expect(pressTab().defaultPrevented).toBe(false)
        expect(pressTab(true).defaultPrevented).toBe(false)
      }
    })

    it("pulls focus back into Terms when it is on the page behind it", () => {
      openTerms()
      const close = $('[data-testid="watch-download-modal-terms-close"]')
      const accept = $('[data-testid="watch-download-modal-terms-accept"]')

      ;(document.activeElement as HTMLElement).blur()
      expect(document.activeElement).toBe(document.body)
      expect(pressTab().defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(close)
      ;(document.activeElement as HTMLElement).blur()
      expect(pressTab(true).defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(accept)
    })

    it("does not trap Tab once Terms is closed", () => {
      openTerms()
      act(() => {
        ;(
          $(
            '[data-testid="watch-download-modal-terms-cancel"]',
          ) as HTMLButtonElement
        ).click()
      })
      expect(pressTab().defaultPrevented).toBe(false)
      expect(pressTab(true).defaultPrevented).toBe(false)
    })

    it("makes the page behind Terms inert and restores it on close", () => {
      const page = document.createElement("div")
      const alreadyInert = document.createElement("div")
      alreadyInert.setAttribute("inert", "")
      document.body.append(page, alreadyInert)

      openTerms()
      const overlay = $('[data-testid="watch-download-modal-terms-overlay"]')
      expect(page.hasAttribute("inert")).toBe(true)
      // The outer download modal is part of the page behind Terms.
      const outerModal = $('[data-testid="watch-download-modal"]')
      expect(outerModal?.closest("[inert]")).not.toBeNull()
      expect(overlay?.hasAttribute("inert")).toBe(false)
      expect(overlay?.closest("[inert]")).toBeNull()

      act(() => {
        ;(
          $(
            '[data-testid="watch-download-modal-terms-close"]',
          ) as HTMLButtonElement
        ).click()
      })
      expect(page.hasAttribute("inert")).toBe(false)
      expect(
        $('[data-testid="watch-download-modal"]')?.closest("[inert]"),
      ).toBe(null)
      // Elements that were inert before Terms opened stay inert.
      expect(alreadyInert.hasAttribute("inert")).toBe(true)
    })

    it("returns focus to the Terms link once the page is no longer inert", () => {
      openTerms()
      const trigger = $('[data-testid="watch-download-modal-tos-trigger"]')
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
        )
      })
      expect(trigger?.closest("[inert]")).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })

    it("drops the open size list when Terms opens, so one Escape closes Terms alone", () => {
      const onClose = vi.fn()
      act(() => {
        root.render(
          <TestDownloadModal
            open
            downloads={[
              makeDownload({ documentId: "fhd", quality: "fhd" }),
              makeDownload({ documentId: "hd", quality: "hd" }),
            ]}
            onClose={onClose}
          />,
        )
      })
      act(() => {
        ;(
          $('[data-testid="watch-download-modal-size"]') as HTMLButtonElement
        ).click()
      })
      expect($('[data-testid="watch-download-modal-size-list"]')).not.toBeNull()

      // Keyboard path: focus the Terms link and press Enter (a click on a
      // button). The list is a body portal; it must not outlive this click.
      const trigger = $(
        '[data-testid="watch-download-modal-tos-trigger"]',
      ) as HTMLButtonElement
      trigger.focus()
      act(() => {
        trigger.click()
      })
      expect(
        $('[data-testid="watch-download-modal-terms-dialog"]'),
      ).not.toBeNull()
      // Unmounted at once: no closing animation window that could paint it
      // over the Terms text.
      expect($('[data-testid="watch-download-modal-size-list"]')).toBeNull()

      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape",
          }),
        )
      })
      expect($('[data-testid="watch-download-modal-terms-dialog"]')).toBeNull()
      expect($('[data-testid="watch-download-modal"]')).not.toBeNull()
      expect(onClose).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(trigger)
    })
  })

  it("lets the footer actions wrap inside their pills at 200% text", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })
    act(() => {
      ;(
        $(
          '[data-testid="watch-download-modal-tos-trigger"]',
        ) as HTMLButtonElement
      ).click()
    })

    // A label (or a single word of it) wider than the dialog's content column
    // must wrap or break inside the button instead of painting past the pill.
    // The layout itself is checked in the browser at 320 px / 200% text.
    for (const testId of [
      "watch-download-modal-confirm",
      "watch-download-modal-terms-accept",
    ]) {
      const className = $(`[data-testid="${testId}"]`)?.className ?? ""
      for (const token of [
        "flex-wrap",
        "whitespace-normal",
        "[overflow-wrap:anywhere]",
        "max-w-full",
      ]) {
        expect(className, `${testId} ${token}`).toContain(token)
      }
      expect(className, testId).not.toContain("whitespace-nowrap")
    }
    expect(
      $('[data-testid="watch-download-modal-terms-cancel"]')?.className,
    ).toContain("[overflow-wrap:anywhere]")
    expect(
      $('[data-testid="watch-download-modal-terms-body"]')?.className,
    ).toContain("[overflow-wrap:anywhere]")
  })

  it("Accept checks the agreement and enables Download", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })

    act(() => {
      ;(
        $(
          '[data-testid="watch-download-modal-tos-trigger"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
      ;(
        $(
          '[data-testid="watch-download-modal-terms-accept"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect($('[data-testid="watch-download-modal-terms-dialog"]')).toBeNull()
    expect(
      ($('[data-testid="watch-download-modal-tos"]') as HTMLInputElement)
        .checked,
    ).toBe(true)
    expect(
      ($('[data-testid="watch-download-modal-confirm"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it("resets agreement after the outer modal closes and reopens", () => {
    const onClose = vi.fn()
    const render = (open: boolean) => (
      <TestDownloadModal
        open={open}
        downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
        onClose={onClose}
      />
    )
    act(() => {
      root.render(render(true))
    })
    acceptTerms()

    act(() => {
      ;(
        $('[data-testid="watch-download-modal-close"]') as HTMLButtonElement
      ).click()
    })
    act(() => {
      root.render(render(false))
    })
    act(() => {
      root.render(render(true))
    })

    expect(
      ($('[data-testid="watch-download-modal-tos"]') as HTMLInputElement)
        .checked,
    ).toBe(false)
    expect(
      ($('[data-testid="watch-download-modal-confirm"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})

describe("DownloadModal — account-authenticated downloads", () => {
  it("closes the dialog after a successful download click", async () => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              quality: "fhd",
              url: "https://stream.mux.com/abc.mp4",
            }),
          ]}
          videoTitle="JESUS"
          onClose={onClose}
        />,
      )
    })

    acceptTerms()
    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    await act(async () => {
      confirm.click()
    })

    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/watch/api/auth/session"),
      expect.anything(),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["high", "dl-high"],
    ["low", "dl-low"],
  ] as const)(
    "downloading the %s tier requests the real %s row, never a distro row",
    async (tier, expectedDownloadId) => {
      act(() => {
        root.render(
          <TestDownloadModal
            open
            downloads={[
              makeDownload({
                documentId: "dl-fhd",
                quality: "fhd",
                size: 5521959728,
              }),
              // Misleading sizes: legacy rows sit where the size middle/tail was.
              makeDownload({
                documentId: "dl-distroSd",
                quality: "distroSd",
                size: 1561752518,
              }),
              makeDownload({
                documentId: "dl-high",
                quality: "high",
                size: 2962849007,
              }),
              makeDownload({
                documentId: "dl-sd",
                quality: "sd",
                size: 658922306,
              }),
              makeDownload({
                documentId: "dl-distroLow",
                quality: "distroLow",
                size: 207141494,
              }),
              makeDownload({
                documentId: "dl-low",
                quality: "low",
                size: 585287114,
              }),
            ]}
            onClose={vi.fn()}
          />,
        )
      })

      act(() => {
        ;(
          $('[data-testid="watch-download-modal-size"]') as HTMLButtonElement
        ).click()
      })
      const option = $$(
        '[data-testid="watch-download-modal-size-option"]',
      ).find((o) => o.getAttribute("data-tier") === tier)
      act(() => {
        option?.click()
      })
      acceptTerms()
      const created: HTMLAnchorElement[] = []
      const realAppend = document.body.appendChild.bind(document.body)
      const appendSpy = vi
        .spyOn(document.body, "appendChild")
        .mockImplementation(((node: Node) => {
          if (node instanceof HTMLAnchorElement) created.push(node)
          return realAppend(node)
        }) as typeof document.body.appendChild)

      await act(async () => {
        ;(
          $('[data-testid="watch-download-modal-confirm"]') as HTMLButtonElement
        ).click()
      })

      expect(created.length).toBe(1)
      const href = created[0]?.getAttribute("href") ?? ""
      expect(href).toContain(`downloadId=${expectedDownloadId}&`)
      expect(href).not.toContain("distro")
      appendSpy.mockRestore()
    },
  )

  it("download click triggers a programmatic <a> pointing at the same-origin proxy with a filename", async () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              height: 360,
              quality: "fhd",
            }),
          ]}
          languageCode="eng"
          languageName="English"
          languageSlug="english"
          downloadSequence={{ position: 1, total: 61 }}
          variantId="variant-1"
          videoSlug="jesus"
          videoTitle="Jesus Film"
          onClose={vi.fn()}
        />,
      )
    })

    acceptTerms()
    const created: HTMLAnchorElement[] = []
    const realAppend = document.body.appendChild.bind(document.body)
    const appendSpy = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation(((node: Node) => {
        if (node instanceof HTMLAnchorElement) created.push(node)
        return realAppend(node)
      }) as typeof document.body.appendChild)

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    await act(async () => {
      confirm.click()
    })

    expect(created.length).toBe(1)
    const a = created[0]!
    // No more target=_blank — that was the workaround the proxy replaces.
    expect(a.target).toBe("")
    expect(a.rel).toBe("noopener")
    // Proxy route is same-origin, so the download attribute is honored.
    expect(a.getAttribute("href")).toContain("/watch/api/download?")
    expect(a.getAttribute("href")).toContain("downloadId=dl-1")
    expect(a.getAttribute("href")).toContain("variantId=variant-1")
    expect(a.getAttribute("href")).toContain("videoSlug=jesus")
    expect(a.getAttribute("href")).not.toContain("stream.mux.com")
    // Filename is derived from title, selected audio language, code, and height.
    const downloadAttr = a.getAttribute("download") ?? ""
    expect(downloadAttr).toBe("01_Jesus-Film_English_eng_360p.mp4")
    expect(a.getAttribute("href")).toContain(
      `filename=${encodeURIComponent(downloadAttr)}`,
    )

    appendSpy.mockRestore()
  })

  it("re-checks auth before final download and blocks the anchor when the session is stale", async () => {
    const loginUrl =
      "http://localhost/api/auth/login?returnTo=http%3A%2F%2Flocalhost%2Fwatch%2Fjesus.html%2Fenglish.html"
    const fetchMock = vi.fn(async () =>
      Response.json({
        accountGateEnabled: true,
        authenticated: false,
        loginUrl,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const created: HTMLAnchorElement[] = []
    const realAppend = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
      if (node instanceof HTMLAnchorElement) created.push(node)
      return realAppend(node)
    }) as typeof document.body.appendChild)

    act(() => {
      root.render(
        <TestDownloadModal
          open
          accountGateEnabled
          downloads={[
            makeDownload({
              documentId: "dl-1",
              quality: "fhd",
              url: "https://stream.mux.com/abc.mp4",
            }),
          ]}
          videoTitle="JESUS"
          onClose={vi.fn()}
        />,
      )
    })

    acceptTerms()
    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    await act(async () => {
      confirm.click()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/watch/api/auth/session"),
      expect.objectContaining({ credentials: "include" }),
    )
    expect(created).toHaveLength(0)
    const authRequiredCopy =
      $('[data-testid="watch-download-modal-auth-required"]')?.textContent ?? ""
    expect(authRequiredCopy).toContain("Want to download this video?")
    expect(authRequiredCopy.indexOf("Sign in to download")).toBeLessThan(
      authRequiredCopy.indexOf("Want to download this video?"),
    )
    expect(authRequiredCopy).toContain(
      "A free Jesus Film account is required to download videos.",
    )
    expect(authRequiredCopy).toContain("Keep watching")
    expect($('[data-testid="watch-download-modal-error"]')).toBeNull()
    expect(redirectToAuth).not.toHaveBeenCalled()

    await act(async () => {
      ;(
        $('[data-testid="watch-download-modal-sign-in"]') as HTMLButtonElement
      ).click()
    })
    expect(redirectToAuth).toHaveBeenCalledWith(loginUrl, {
      reopenDownload: true,
    })
  })

  it("shows a sign-in explanation when opened for a signed-out viewer", async () => {
    const loginUrl =
      "http://localhost/api/auth/login?returnTo=http%3A%2F%2Flocalhost%2Fwatch%2Fjesus.html%2Fenglish.html"
    const onClose = vi.fn()
    act(() => {
      root.render(
        <TestDownloadModal
          open
          accountGateEnabled
          authRequiredLoginUrl={loginUrl}
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          videoTitle="JESUS"
          onClose={onClose}
        />,
      )
    })

    const authRequiredCopy =
      $('[data-testid="watch-download-modal-auth-required"]')?.textContent ?? ""
    expect(authRequiredCopy).toContain("Want to download this video?")
    expect(authRequiredCopy.indexOf("Sign in to download")).toBeLessThan(
      authRequiredCopy.indexOf("Want to download this video?"),
    )
    expect(authRequiredCopy).toContain(
      "A free Jesus Film account is required to download videos.",
    )
    expect(authRequiredCopy).toContain("Keep watching")
    expect($('[data-testid="watch-download-modal-sign-in"]')?.textContent).toBe(
      "Sign in to download",
    )
    expect($('[data-testid="watch-download-modal-tos"]')).toBeNull()
    expect($('[data-testid="watch-download-modal-confirm"]')).toBeNull()
    const close = $(
      '[data-testid="watch-download-modal-close"]',
    ) as HTMLButtonElement
    // From sm up it floats at the safe-area top right; below sm it is a row of
    // the dialog so it cannot sit over the scrolled form.
    expect(close.className).toContain("safe-area-inset-top")
    expect(close.className).toContain("safe-area-inset-right")
    expect(close.className).toContain("max-sm:relative")
    expect($('[data-testid="watch-download-modal-mobile-close"]')).toBeNull()

    await act(async () => {
      ;(
        $(
          '[data-testid="watch-download-modal-keep-watching"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(onClose).toHaveBeenCalledOnce()

    await act(async () => {
      ;(
        $('[data-testid="watch-download-modal-sign-in"]') as HTMLButtonElement
      ).click()
    })
    expect(redirectToAuth).toHaveBeenCalledWith(loginUrl, {
      reopenDownload: true,
    })

    await act(async () => close.click())
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it("does not probe sizes while flagged signed-out viewers see sign-in state", () => {
    const fetchMock = vi.fn(async () => Response.json({ authenticated: true }))
    vi.stubGlobal("fetch", fetchMock)
    const loginUrl =
      "http://localhost/api/auth/login?returnTo=http%3A%2F%2Flocalhost%2Fwatch%2Fjesus.html%2Fenglish.html"

    act(() => {
      root.render(
        <TestDownloadModal
          open
          accountGateEnabled
          authRequiredLoginUrl={loginUrl}
          downloads={[
            makeDownload({
              documentId: "dl-1",
              quality: "fhd",
              size: 0,
            }),
          ]}
          videoTitle="JESUS"
          onClose={vi.fn()}
        />,
      )
    })

    expect(
      $('[data-testid="watch-download-modal-auth-required"]')?.textContent,
    ).toContain("Want to download this video?")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows a visible error instead of no-oping when the session check fails", async () => {
    const fetchMock = vi.fn(
      async () => new Response("unavailable", { status: 500 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const created: HTMLAnchorElement[] = []
    const realAppend = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
      if (node instanceof HTMLAnchorElement) created.push(node)
      return realAppend(node)
    }) as typeof document.body.appendChild)

    act(() => {
      root.render(
        <TestDownloadModal
          open
          accountGateEnabled
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          videoTitle="JESUS"
          onClose={vi.fn()}
        />,
      )
    })

    acceptTerms()
    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    await act(async () => {
      confirm.click()
    })

    expect(created).toHaveLength(0)
    expect($('[data-testid="watch-download-modal-error"]')?.textContent).toBe(
      "Unable to check your session. Please try again.",
    )
  })
})

describe("DownloadModal — empty + lifecycle", () => {
  it("keeps the shared top-right close icon visible on mobile", () => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={onClose}
        />,
      )
    })

    const close = $(
      '[data-testid="watch-download-modal-close"]',
    ) as HTMLButtonElement
    expect(close).not.toBeNull()
    expect(close.className).not.toContain("hidden")
    // From sm up it floats at the safe-area top right; below sm it is a row of
    // the dialog so it cannot sit over the scrolled form.
    expect(close.className).toContain("safe-area-inset-top")
    expect(close.className).toContain("safe-area-inset-right")
    expect(close.className).toContain("max-sm:relative")
    expect($("[data-testid='watch-download-modal-mobile-close']")).toBeNull()

    act(() => close.click())
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("shows an empty-state message when downloads is empty", () => {
    act(() => {
      root.render(<TestDownloadModal open downloads={[]} onClose={vi.fn()} />)
    })

    expect($('[data-testid="watch-download-modal-empty"]')).not.toBeNull()
    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    const checkbox = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    expect(confirm.disabled).toBe(true)
    expect(checkbox.disabled).toBe(true)
  })

  it("does not render any modal contents when open is false", () => {
    act(() => {
      root.render(
        <TestDownloadModal
          open={false}
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-download-modal"]')).toBeNull()
  })
})

describe("DownloadModal — hidden size metadata", () => {
  it("renders no size label and makes no probe when CMS size is 0", () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({ documentId: "dl-1", quality: "fhd", size: 0 }),
          ]}
          videoTitle="JESUS"
          onClose={vi.fn()}
        />,
      )
    })
    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    expect(trigger.textContent).toContain("Highest")
    expect(trigger.textContent).not.toContain("(")
    expect(trigger.textContent).not.toContain("MB")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("DownloadModal — no lazy HEAD probe", () => {
  it("does not probe unique download ids when CMS size is missing", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": "12582912" }, // 12 MB
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              quality: "fhd",
              size: 0,
            }),
            makeDownload({
              documentId: "dl-2",
              quality: "high",
              size: 0,
            }),
            makeDownload({
              documentId: "dl-3",
              quality: "low",
              size: 0,
            }),
          ]}
          variantId="variant-1"
          videoTitle="JESUS"
          videoSlug="jesus"
          onClose={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    expect(trigger.textContent).toBe("Highest")
  })

  it("does not probe duplicate download ids", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": "10000000" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    act(() => {
      root.render(
        <TestDownloadModal
          open
          // Two tiers with the SAME download id (defensive duplicate input).
          downloads={[
            makeDownload({
              documentId: "shared",
              quality: "fhd",
              size: 0,
            }),
            makeDownload({
              documentId: "shared",
              quality: "highest",
              size: 0,
            }),
            makeDownload({
              documentId: "low",
              quality: "low",
              size: 0,
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not display a valid CMS size", () => {
    const fetchMock = vi.fn(() => new Promise(() => undefined))
    vi.stubGlobal("fetch", fetchMock)
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              quality: "fhd",
              size: 50 * 1024 * 1024, // 50 MB from CMS
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })
    expect(fetchMock).not.toHaveBeenCalled()
    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    expect(trigger.textContent).toBe("Highest")
  })

  it("does not issue a HEAD after repeated effect flushes", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": "5000000" },
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              quality: "fhd",
              size: 0,
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not expose a probed size on the option element", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": "9437184" }, // 9 MB
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              quality: "fhd",
              size: 0,
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    // Open the dropdown to reveal the option element.
    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.click()
    })
    const option = $(
      '[data-testid="watch-download-modal-size-option"][data-tier="highest"]',
    ) as HTMLButtonElement
    expect(option).not.toBeNull()
    expect(option.getAttribute("data-size-bytes")).toBeNull()
    expect(option.textContent).not.toMatch(/\d\s*(MB|GB)/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("DownloadModal — keyboard quality selection", () => {
  function renderThreeTiers() {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <TestDownloadModal
          open
          downloads={[
            makeDownload({ documentId: "dl-fhd", quality: "fhd" }),
            makeDownload({ documentId: "dl-hd", quality: "hd" }),
            makeDownload({ documentId: "dl-low", quality: "low" }),
          ]}
          onClose={onClose}
        />,
      )
    })
    const trigger = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.focus()
    })
    return { trigger, onClose }
  }

  function press(target: HTMLElement, key: string) {
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      )
    })
  }

  function activeOptionTier(trigger: HTMLElement): string | null {
    const id = trigger.getAttribute("aria-activedescendant")
    return id
      ? (document.getElementById(id)?.getAttribute("data-tier") ?? null)
      : null
  }

  it("names the quality trigger with its visible label and the selected tier", () => {
    const { trigger } = renderThreeTiers()
    const labelText = (trigger.getAttribute("aria-labelledby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .join(" ")

    expect(trigger.getAttribute("role")).toBe("combobox")
    expect(labelText).toBe("Select a file size Highest")
  })

  it("lets a keyboard user choose a lower quality and downloads that file", async () => {
    const { trigger } = renderThreeTiers()

    press(trigger, "ArrowDown")
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(activeOptionTier(trigger)).toBe("highest")

    press(trigger, "ArrowDown")
    press(trigger, "ArrowDown")
    expect(activeOptionTier(trigger)).toBe("low")

    press(trigger, "Enter")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(trigger.textContent).toContain("Low")
    expect(document.activeElement).toBe(trigger)

    acceptTerms()
    const created: HTMLAnchorElement[] = []
    const realAppend = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
      if (node instanceof HTMLAnchorElement) created.push(node)
      return realAppend(node)
    }) as typeof document.body.appendChild)
    await act(async () => {
      ;(
        $('[data-testid="watch-download-modal-confirm"]') as HTMLButtonElement
      ).click()
    })

    expect(created).toHaveLength(1)
    expect(created[0]?.getAttribute("href")).toContain("downloadId=dl-low&")
  })

  it("closes only the quality list on Escape and keeps the dialog open", () => {
    const { trigger, onClose } = renderThreeTiers()

    press(trigger, "ArrowDown")
    press(trigger, "ArrowDown")
    press(trigger, "Escape")

    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(trigger.textContent).toContain("Highest")
    expect(onClose).not.toHaveBeenCalled()
    expect($('[data-testid="watch-download-modal"]')).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it("keeps the selected quality when Terms resets the popup", () => {
    const { trigger } = renderThreeTiers()
    press(trigger, "ArrowDown")
    press(trigger, "End")
    press(trigger, "Enter")
    expect(trigger.textContent).toContain("Low")
    const terms = $(
      '[data-testid="watch-download-modal-tos-trigger"]',
    ) as HTMLButtonElement
    act(() => terms.click())
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
    const restored = $(
      '[data-testid="watch-download-modal-size"]',
    ) as HTMLButtonElement
    expect(restored.textContent).toContain("Low")
    expect(restored.getAttribute("aria-expanded")).toBe("false")
  })
})
