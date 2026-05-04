/**
 * @vitest-environment jsdom
 *
 * U9 — DownloadModal tests.
 *
 * Covers the redesigned modal:
 *  - Header metadata (title, poster, duration, language) renders when provided.
 *  - Quality bucketing — the 8 raw quality keys collapse into Highest/High/Low.
 *  - Default selection is Highest, surfaced in the dropdown trigger.
 *  - AE4 gating: Download is disabled until ToS is checked. Size has a default,
 *    so the only blocker is the agreement checkbox.
 *  - Allowlist enforcement: blocked URLs surface an inline error and never
 *    create the `<a>` element that triggers the browser download.
 *  - Allowed URLs trigger a programmatic anchor with the correct attributes.
 *  - Empty-state defensive render when `downloads` is `[]`.
 *  - Terms-of-Use link opens in a new tab with safe rel attrs.
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
} from "@/components/watch/DownloadModal"

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
  // Drop any portal nodes left over from previous renders.
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

function makeDownload(
  overrides: Partial<DownloadModalDownload> & { documentId: string },
): DownloadModalDownload {
  return {
    quality: "high",
    size: 42 * 1024 * 1024,
    url: "https://stream.mux.com/sample.mp4",
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
        <DownloadModal
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
    expect(
      $('[data-testid="watch-download-modal-duration"]')?.textContent,
    ).toContain("02:07:54")
    expect($('[data-testid="watch-download-modal-poster"]')).not.toBeNull()
  })

  it("omits the duration overlay when durationSeconds is null/zero", () => {
    act(() => {
      root.render(
        <DownloadModal
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
        <DownloadModal open downloads={downloads} onClose={vi.fn()} />,
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
        <DownloadModal
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
        <DownloadModal
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
        <DownloadModal
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
  })

  it("formats sizes >= 1 GB as GB and < 1 GB as MB", () => {
    act(() => {
      root.render(
        <DownloadModal
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
})

describe("DownloadModal — AE4 gating (ToS only; size has a default)", () => {
  it("renders Download disabled by default", () => {
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
  })

  it("enables Download when ToS is checked (size already defaulted to Highest)", () => {
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })

    const tos = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    act(() => {
      tos.click()
    })

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    expect(tos.checked).toBe(true)
    expect(confirm.disabled).toBe(false)
  })

  it("closes the dialog after a successful download click", () => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <DownloadModal
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

    const tos = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    act(() => {
      tos.click()
    })

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    act(() => {
      confirm.click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("does NOT close the dialog when the URL is rejected by the allowlist", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const onClose = vi.fn()
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              quality: "fhd",
              url: "https://evil.com/bad.mp4",
            }),
          ]}
          onClose={onClose}
        />,
      )
    })

    const tos = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    act(() => {
      tos.click()
    })

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    act(() => {
      confirm.click()
    })

    expect(onClose).not.toHaveBeenCalled()
    // The inline error stays mounted so the user can see what went wrong.
    expect($('[data-testid="watch-download-modal-error"]')).not.toBeNull()
  })

  it("download click triggers a programmatic <a> pointing at the same-origin proxy with a filename", () => {
    const url = "https://stream.mux.com/abc.mp4"
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[
            makeDownload({ documentId: "dl-1", quality: "fhd", url }),
          ]}
          videoTitle="JESUS"
          onClose={vi.fn()}
        />,
      )
    })

    const tos = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    act(() => {
      tos.click()
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
    act(() => {
      confirm.click()
    })

    expect(created.length).toBe(1)
    const a = created[0]!
    // No more target=_blank — that was the workaround the proxy replaces.
    expect(a.target).toBe("")
    expect(a.rel).toBe("noopener")
    // Proxy route is same-origin, so the download attribute is honored.
    expect(a.getAttribute("href")).toContain("/watch/api/download?url=")
    expect(a.getAttribute("href")).toContain(encodeURIComponent(url))
    // Filename is derived from the video title + tier, with the source ext.
    const downloadAttr = a.getAttribute("download") ?? ""
    expect(downloadAttr).toBe("jesus-highest.mp4")
    expect(a.getAttribute("href")).toContain(
      `filename=${encodeURIComponent(downloadAttr)}`,
    )

    appendSpy.mockRestore()
  })
})

describe("DownloadModal — allowlist enforcement", () => {
  it("blocks a non-allowlisted origin: shows inline error, does NOT create anchor", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)

    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              quality: "fhd",
              url: "https://evil.com/bad.mp4",
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const tos = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    act(() => {
      tos.click()
    })

    const created: HTMLAnchorElement[] = []
    const realAppend = document.body.appendChild.bind(document.body)
    vi.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
      if (node instanceof HTMLAnchorElement) created.push(node)
      return realAppend(node)
    }) as typeof document.body.appendChild)

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    act(() => {
      confirm.click()
    })

    expect(created.length).toBe(0)
    expect(consoleError).toHaveBeenCalled()
    expect($('[data-testid="watch-download-modal-error"]')?.textContent).toBe(
      "Download unavailable from this source",
    )
  })
})

describe("DownloadModal — Terms of Use link", () => {
  it("renders the ToU link with target=_blank and safe rel attrs", () => {
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })

    const link = $(
      '[data-testid="watch-download-modal-tos-link"]',
    ) as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    expect(link!.tagName.toLowerCase()).toBe("a")
    expect(link!.getAttribute("href")).toContain("jesusfilm")
    expect(link!.getAttribute("href")).toContain("terms")
    expect(link!.getAttribute("target")).toBe("_blank")
    const rel = link!.getAttribute("rel") ?? ""
    expect(rel).toContain("noopener")
    expect(rel).toContain("noreferrer")
  })
})

describe("DownloadModal — empty + lifecycle", () => {
  it("shows an empty-state message when downloads is empty", () => {
    act(() => {
      root.render(<DownloadModal open downloads={[]} onClose={vi.fn()} />)
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
        <DownloadModal
          open={false}
          downloads={[makeDownload({ documentId: "dl-1", quality: "fhd" })]}
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-download-modal"]')).toBeNull()
  })
})
