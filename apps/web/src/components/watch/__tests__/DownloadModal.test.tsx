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
      makeDownload({ documentId: "distroHigh", quality: "distroHigh" }), // collapsed under High
      makeDownload({ documentId: "low", quality: "low" }), // -> Low
      makeDownload({ documentId: "distroLow", quality: "distroLow" }), // collapsed under Low
    ]
    act(() => {
      root.render(
        <TestDownloadModal open downloads={downloads} onClose={vi.fn()} />,
      )
    })

    // Open the dropdown so options render in the listbox.
    const trigger = $(
      '[data-testid="watch-download-modal-size-trigger"]',
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
      '[data-testid="watch-download-modal-size-trigger"]',
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
              documentId: "distroHigh",
              quality: "distroHigh",
              size: 500 * 1024 * 1024,
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const trigger = $(
      '[data-testid="watch-download-modal-size-trigger"]',
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

    const trigger = $('[data-testid="watch-download-modal-size-trigger"]')
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
      '[data-testid="watch-download-modal-size-trigger"]',
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
        $(
          '[data-testid="watch-download-modal-size-trigger"]',
        ) as HTMLButtonElement
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
      '[data-testid="watch-download-modal-size-trigger"]',
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
    expect(row?.className).toContain("sm:flex-row")
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
    act(() => {
      dismiss()
    })

    expect($('[data-testid="watch-download-modal-terms-dialog"]')).toBeNull()
    expect($('[data-testid="watch-download-modal"]')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(
      ($('[data-testid="watch-download-modal-tos"]') as HTMLInputElement)
        .checked,
    ).toBe(false)
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
    expect(close.style.top).toContain("safe-area-inset-top")
    expect(close.style.right).toContain("safe-area-inset-right")
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
    expect(close.style.top).toContain("safe-area-inset-top")
    expect(close.style.right).toContain("safe-area-inset-right")
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
      '[data-testid="watch-download-modal-size-trigger"]',
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
      '[data-testid="watch-download-modal-size-trigger"]',
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
      '[data-testid="watch-download-modal-size-trigger"]',
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
      '[data-testid="watch-download-modal-size-trigger"]',
    ) as HTMLButtonElement
    act(() => {
      trigger.click()
    })
    const option = $(
      '[data-testid="watch-download-modal-size-option"][data-tier="highest"]',
    ) as HTMLButtonElement
    expect(option).not.toBeNull()
    expect(option.getAttribute("data-size-bytes")).toBe("")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
