/**
 * @vitest-environment jsdom
 *
 * U9 — DownloadModal tests.
 *
 * Covers:
 *  - AE4 gating: Download button disabled until ToS checked AND quality picked.
 *  - Allowlist enforcement: blocked URLs surface an inline error and never
 *    create the `<a>` element that triggers the browser download.
 *  - Allowed URLs trigger a programmatic anchor with the correct attributes.
 *  - Sort order: downloads are rendered in the canonical quality priority
 *    order regardless of input order.
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
} from "@/components/watch/DownloadModal"

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

describe("DownloadModal — AE4 gating (ToU + quality)", () => {
  it("renders the modal when open and shows the Download button as disabled by default", () => {
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1" })]}
          onClose={vi.fn()}
        />,
      )
    })

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    expect(confirm).not.toBeNull()
    expect(confirm.disabled).toBe(true)
  })

  it("keeps Download disabled when only ToS is checked (no quality picked)", () => {
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1" })]}
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
    expect(confirm.disabled).toBe(true)
  })

  it("keeps Download disabled when only quality is picked (no ToS)", () => {
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1" })]}
          onClose={vi.fn()}
        />,
      )
    })

    const radio = $(
      '[data-testid="watch-download-modal-radio"]',
    ) as HTMLInputElement
    act(() => {
      radio.click()
    })

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    expect(radio.checked).toBe(true)
    expect(confirm.disabled).toBe(true)
  })

  it("enables Download when both ToS and quality are set; click triggers a download anchor", () => {
    const url = "https://stream.mux.com/abc.mp4"
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", url })]}
          onClose={vi.fn()}
        />,
      )
    })

    const radio = $(
      '[data-testid="watch-download-modal-radio"]',
    ) as HTMLInputElement
    const tos = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    act(() => {
      radio.click()
      tos.click()
    })

    const confirm = $(
      '[data-testid="watch-download-modal-confirm"]',
    ) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)

    // Spy on the anchor creation by intercepting `appendChild` on body.
    const created: HTMLAnchorElement[] = []
    const realAppend = document.body.appendChild.bind(document.body)
    const appendSpy = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation(((node: Node) => {
        if (node instanceof HTMLAnchorElement) {
          created.push(node)
        }
        return realAppend(node)
      }) as typeof document.body.appendChild)

    act(() => {
      confirm.click()
    })

    expect(created.length).toBe(1)
    const a = created[0]!
    expect(a.href).toBe(url)
    expect(a.getAttribute("download")).toBe("")
    expect(a.target).toBe("_blank")
    expect(a.rel).toBe("noopener")

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
              url: "https://evil.com/bad.mp4",
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const radio = $(
      '[data-testid="watch-download-modal-radio"]',
    ) as HTMLInputElement
    const tos = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    act(() => {
      radio.click()
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

    expect(created.length).toBe(0)
    expect(consoleError).toHaveBeenCalled()

    const error = $('[data-testid="watch-download-modal-error"]')
    expect(error?.textContent).toBe("Download unavailable from this source")

    appendSpy.mockRestore()
  })

  it("blocks an http: downgrade and shows the inline error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)

    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              url: "http://jesusfilm.org/file.mp4",
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const radio = $(
      '[data-testid="watch-download-modal-radio"]',
    ) as HTMLInputElement
    const tos = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    act(() => {
      radio.click()
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
    expect($('[data-testid="watch-download-modal-error"]')).not.toBeNull()
  })

  it("allows an api-media-core.jesusfilm.org URL via the .jesusfilm.org suffix rule", () => {
    const url = "https://api-media-core.jesusfilm.org/x.mp4"
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1", url })]}
          onClose={vi.fn()}
        />,
      )
    })

    const radio = $(
      '[data-testid="watch-download-modal-radio"]',
    ) as HTMLInputElement
    const tos = $(
      '[data-testid="watch-download-modal-tos"]',
    ) as HTMLInputElement
    act(() => {
      radio.click()
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

    expect(created.length).toBe(1)
    expect(created[0]!.href).toBe(url)
    expect($('[data-testid="watch-download-modal-error"]')).toBeNull()
  })
})

describe("DownloadModal — quality sort + display labels", () => {
  it("renders downloads in the canonical priority order regardless of input order", () => {
    // Input order is intentionally scrambled so we verify the output sort.
    const downloads: DownloadModalDownload[] = [
      makeDownload({ documentId: "low", quality: "low" }),
      makeDownload({ documentId: "fhd", quality: "fhd" }),
      makeDownload({ documentId: "highest", quality: "highest" }),
    ]
    act(() => {
      root.render(
        <DownloadModal open downloads={downloads} onClose={vi.fn()} />,
      )
    })

    const options = $$('[data-testid="watch-download-modal-option"]')
    expect(options.map((o) => o.getAttribute("data-quality"))).toEqual([
      "fhd",
      "highest",
      "low",
    ])
  })

  it("renders the correct human display labels (incl. 'ministry' qualifier)", () => {
    const downloads: DownloadModalDownload[] = [
      makeDownload({ documentId: "fhd", quality: "fhd" }),
      makeDownload({ documentId: "distroHigh", quality: "distroHigh" }),
    ]
    act(() => {
      root.render(
        <DownloadModal open downloads={downloads} onClose={vi.fn()} />,
      )
    })

    const labels = $$('[data-testid="watch-download-modal-option"]').map(
      (el) => el.textContent ?? "",
    )
    expect(labels.some((t) => t.includes("1080p HD"))).toBe(true)
    expect(labels.some((t) => t.includes("720p (ministry)"))).toBe(true)
  })

  it("formats the file size as whole MB", () => {
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[
            makeDownload({
              documentId: "dl-1",
              size: 123 * 1024 * 1024,
            }),
          ]}
          onClose={vi.fn()}
        />,
      )
    })

    const size = $('[data-testid="watch-download-modal-size"]')
    expect(size?.textContent).toBe("123 MB")
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

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn()
    act(() => {
      root.render(
        <DownloadModal
          open
          downloads={[makeDownload({ documentId: "dl-1" })]}
          onClose={onClose}
        />,
      )
    })

    act(() => {
      ;(
        $('[data-testid="watch-download-modal-cancel"]') as HTMLButtonElement
      ).click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("does not render any modal contents when open is false", () => {
    act(() => {
      root.render(
        <DownloadModal
          open={false}
          downloads={[makeDownload({ documentId: "dl-1" })]}
          onClose={vi.fn()}
        />,
      )
    })

    expect($('[data-testid="watch-download-modal"]')).toBeNull()
  })
})
