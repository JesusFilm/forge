/**
 * @vitest-environment jsdom
 *
 * U9 — DownloadModal tests.
 *
 * Covers the redesigned modal:
 *  - Header metadata (title, poster, duration, language) renders when provided.
 *  - Quality bucketing — the 8 raw quality keys collapse into Highest/High/Low.
 *  - Default selection is Highest, surfaced in the dropdown trigger.
 *  - Account gating: signed-in viewers can download immediately; stale
 *    sessions are rechecked before the proxy request.
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
// real image-optimization endpoint, which JSDOM can't serve. Strip the
// next/image-only props (`fill`, `sizes`) so React doesn't warn about them
// being forwarded to a plain DOM <img>.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    fill: _fill,
    sizes: _sizes,
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
    return <Img src={src} alt={alt} {...rest} />
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

  it("formats sizes >= 1 GB as GB and < 1 GB as MB", () => {
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
    expect(trigger.textContent).toContain("5.14 GB")
    act(() => {
      trigger.click()
    })
    const lowOption = $$(
      '[data-testid="watch-download-modal-size-option"]',
    ).find((o) => o.getAttribute("data-tier") === "low")
    // 558.17 MB rounds to "558 MB" with 0-decimal formatting for >= 100 MB.
    expect(lowOption?.textContent).toContain("558 MB")
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

describe("DownloadModal — account-authenticated downloads", () => {
  it("renders Download enabled by default for signed-in viewers", () => {
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
    expect(confirm.disabled).toBe(false)
    expect($('[data-testid="watch-download-modal-tos"]')).toBeNull()
    expect($('[data-testid="watch-download-modal-tos-trigger"]')).toBeNull()
  })

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

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    await act(async () => {
      confirm.click()
    })

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
          variantId="variant-1"
          videoSlug="jesus"
          videoTitle="Jesus Film"
          onClose={vi.fn()}
        />,
      )
    })

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
    expect(downloadAttr).toBe("Jesus-Film_English_eng_360p.mp4")
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
    expect(
      $('[data-testid="watch-download-modal-auth-required"]')?.textContent,
    ).toContain("Downloads are available after you sign in")
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
    act(() => {
      root.render(
        <TestDownloadModal
          open
          authRequiredLoginUrl={loginUrl}
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          videoTitle="JESUS"
          onClose={vi.fn()}
        />,
      )
    })

    expect(
      $('[data-testid="watch-download-modal-auth-required"]')?.textContent,
    ).toContain("Sign in to download")
    expect($('[data-testid="watch-download-modal-tos"]')).toBeNull()
    expect($('[data-testid="watch-download-modal-confirm"]')).toBeNull()

    await act(async () => {
      ;(
        $('[data-testid="watch-download-modal-sign-in"]') as HTMLButtonElement
      ).click()
    })
    expect(redirectToAuth).toHaveBeenCalledWith(loginUrl, {
      reopenDownload: true,
    })
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
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          videoTitle="JESUS"
          onClose={vi.fn()}
        />,
      )
    })

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
  it("shows an empty-state message when downloads is empty", () => {
    act(() => {
      root.render(<TestDownloadModal open downloads={[]} onClose={vi.fn()} />)
    })

    expect($('[data-testid="watch-download-modal-empty"]')).not.toBeNull()
    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
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

describe("DownloadModal — formatSize edge cases", () => {
  // The CMS English variant ships with `size: 0` for all downloads; the
  // formatter must treat that as "no size known" (empty label) so the
  // lazy HEAD probe can fill in the real value. These tests pin the
  // negative-path of the formatter so a regression that resurrected
  // "0.00 MB" labels would fail.
  it("renders no size label when CMS size is 0 (waits for HEAD probe)", () => {
    // Stub fetch with a never-resolving promise so the probe stays in
    // flight and we observe the pre-probe label state.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    )
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
    // No parenthetical size — the empty `formatSize` return must hide
    // the `(...)` span entirely, not render `(0.00 MB)`.
    expect(trigger.textContent).not.toContain("(")
    expect(trigger.textContent).not.toContain("MB")
  })
})

describe("DownloadModal — lazy HEAD probe", () => {
  it("issues one HEAD per unique download id when CMS size is missing", async () => {
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
    // Flush probe pipeline (fetch → json → setState).
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // All three were HEAD requests through the same-origin proxy.
    for (const call of fetchMock.mock.calls) {
      const [url, init] = call as unknown as [string, RequestInit | undefined]
      expect(url).toContain("/watch/api/download?")
      expect(url).toContain("variantId=variant-1")
      expect(url).toContain("videoSlug=jesus")
      expect(url).not.toContain("stream.mux.com")
      expect(init?.method).toBe("HEAD")
    }
    // Probed size landed in the trigger label.
    const trigger = $(
      '[data-testid="watch-download-modal-size-trigger"]',
    ) as HTMLButtonElement
    expect(trigger.textContent).toContain("12.00 MB")
  })

  it("deduplicates HEADs across tiers that share a download id", async () => {
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
    // 2 unique download ids → 2 HEADs, not 3.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("skips the HEAD probe when CMS already provides a valid size", () => {
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
    expect(trigger.textContent).toContain("50.00 MB")
  })

  it("does not re-issue HEAD after probe completion (no dep-loop)", async () => {
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
    const callsAfterFirstSettle = fetchMock.mock.calls.length
    // Give the effect a couple more flushes — if `probedSizes` were in
    // the dep array, the effect would re-run and re-issue (or at least
    // re-construct an AbortController per cycle).
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstSettle)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("exposes probed size on the option element as data-size-bytes", async () => {
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
    // Machine-readable size for agents that want to pick by byte count.
    expect(option.getAttribute("data-size-bytes")).toBe("9437184")
  })
})
