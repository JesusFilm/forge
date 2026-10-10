/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  loadWatchCollectionDownloadsMock,
  resolveDownloadSessionAccessMock,
  runCollectionDownloadQueueMock,
} = vi.hoisted(() => ({
  loadWatchCollectionDownloadsMock: vi.fn(),
  resolveDownloadSessionAccessMock: vi.fn(),
  runCollectionDownloadQueueMock: vi.fn(),
}))

vi.mock("@/lib/watch-collection-download-actions", () => ({
  loadWatchCollectionDownloads: loadWatchCollectionDownloadsMock,
}))

vi.mock("@/components/watch/download-session-access", () => ({
  resolveDownloadSessionAccess: resolveDownloadSessionAccessMock,
}))

vi.mock("@/components/watch/collection-download-queue", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/watch/collection-download-queue")
  >("@/components/watch/collection-download-queue")
  return {
    ...actual,
    runCollectionDownloadQueue: runCollectionDownloadQueueMock,
  }
})

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({
    children,
    overlayClassName: _overlayClassName,
    showCloseButton: _showCloseButton,
    viewportClassName,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    overlayClassName?: string
    showCloseButton?: boolean
    viewportClassName?: string
  }) => (
    <div data-slot="dialog-viewport" className={viewportClassName}>
      <div {...props}>{children}</div>
    </div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}))

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => {
    const Img = "img"
    return <Img src={src} alt={alt} />
  },
}))

vi.mock("@/components/watch/WatchModalViewportCloseButton", () => ({
  WatchModalViewportCloseButton: ({
    open,
    renderInline,
    testId,
  }: {
    open: boolean
    renderInline?: boolean
    testId: string
  }) =>
    open ? (
      <button
        type="button"
        data-testid={testId}
        data-render-inline={String(renderInline)}
      />
    ) : null,
}))

import { CollectionDownloadModal } from "@/components/watch/CollectionDownloadModal"
import type { CollectionDownloadQueueItem } from "@/components/watch/collection-download-options"

let container: HTMLDivElement
let root: Root

const episodes = [
  {
    documentId: "episode-1",
    slug: "one",
    title: "Episode One",
    thumbnailUrl: "https://cdn.example/episode-one.jpg",
  },
  {
    documentId: "episode-2",
    slug: "two",
    title: "Episode Two",
    thumbnailUrl: "https://cdn.example/episode-two.jpg",
  },
]

const dubs = [
  {
    documentId: "dub-1",
    videoId: "episode-1",
    downloads: [
      {
        documentId: "download-1",
        capability: "capability-1",
        height: 1080,
        quality: "high",
        size: 600_000_000,
      },
    ],
  },
  {
    documentId: "dub-2",
    videoId: "episode-2",
    downloads: [
      {
        documentId: "download-2",
        capability: "capability-2",
        height: 1080,
        quality: "high",
        size: 600_000_000,
      },
    ],
  },
]

function renderModal(overrides = {}) {
  act(() => {
    root.render(
      <CollectionDownloadModal
        open
        collectionSlug="lumo-luke"
        collectionTitle="LUMO Luke"
        episodes={episodes}
        languages={[
          { slug: "english", name: "English", bcp47: "en" },
          { slug: "spanish", name: "Spanish", bcp47: "es" },
        ]}
        currentLanguageSlug="english"
        accountGateEnabled={false}
        onClose={vi.fn()}
        {...overrides}
      />,
    )
  })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

// `bucketDownloads` yields only `highest` for a single download, so tier
// selection needs three downloads per dub (highest / high / low).
const threeTierDubs = ["episode-1", "episode-2"].map((videoId, index) => ({
  documentId: `dub-${index + 1}`,
  videoId,
  downloads: [2160, 1080, 480].map((height) => ({
    documentId: `download-${index + 1}-${height}`,
    capability: `capability-${index + 1}-${height}`,
    height,
    quality: height >= 1080 ? "high" : "low",
    size: height * 1000,
  })),
}))

function qualityTrigger(): HTMLButtonElement {
  return container.querySelector(
    '[data-testid="watch-collection-download-quality"]',
  ) as HTMLButtonElement
}

// The listbox is portaled to `document.body`, so query the document.
function qualityOptions(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll(
      '[data-testid="watch-collection-download-quality-option"]',
    ),
  ) as HTMLButtonElement[]
}

beforeEach(() => {
  Reflect.deleteProperty(window, "showDirectoryPicker")
  window.sessionStorage.clear()
  loadWatchCollectionDownloadsMock.mockReset()
  resolveDownloadSessionAccessMock.mockReset()
  runCollectionDownloadQueueMock.mockReset()
  loadWatchCollectionDownloadsMock.mockResolvedValue({ ok: true, dubs })
  resolveDownloadSessionAccessMock.mockResolvedValue({
    ok: true,
    accountGateEnabled: true,
  })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  Reflect.deleteProperty(window, "showDirectoryPicker")
  container.remove()
})

describe("CollectionDownloadModal", () => {
  it("loads the current language and builds the batch in episode order", async () => {
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        deliveryMode: "directory",
        failed: [],
        total: items.length,
      }),
    )
    renderModal()
    await flush()

    expect(loadWatchCollectionDownloadsMock).toHaveBeenCalledWith({
      collectionSlug: "lumo-luke",
      languageSlug: "english",
    })
    expect(
      container.querySelector('[data-testid="language-combobox-trigger"]')
        ?.textContent,
    ).toContain("English")

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(runCollectionDownloadQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({ id: "episode-1" }),
          expect.objectContaining({ id: "episode-2" }),
        ],
      }),
    )
    expect(loadWatchCollectionDownloadsMock).toHaveBeenCalledTimes(2)
    expect(resolveDownloadSessionAccessMock).not.toHaveBeenCalled()
  })

  it("promotes Close and makes Download again secondary after completion", async () => {
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        deliveryMode: "directory",
        failed: [],
        total: items.length,
      }),
    )
    renderModal()
    await flush()

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    const actions = container.querySelector(
      '[data-testid="watch-collection-download-actions"]',
    )
    const downloadAgain = actions?.querySelector(
      '[data-testid="watch-collection-download-start"]',
    )
    const close = actions?.querySelector(
      '[data-testid="watch-collection-download-close"]',
    )

    expect(downloadAgain?.textContent).toContain("Download again")
    expect(downloadAgain?.className).not.toContain("bg-white")
    expect(close?.className).toContain("bg-white")
    expect(Array.from(actions?.children ?? [])).toEqual([downloadAgain, close])
  })

  it("labels native browser handoff without claiming files finished", async () => {
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        deliveryMode: "browser",
        failed: [],
        total: items.length,
      }),
    )
    renderModal()
    await flush()

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-progress"]',
      )?.textContent,
    ).toContain("Your browser will save each file")
    expect(
      container.querySelector('[data-testid="watch-collection-download-close"]')
        ?.className,
    ).toContain("bg-white")
  })

  it("streams into a viewer-selected directory when the browser supports it", async () => {
    const directory = {
      name: "Episodes",
      getFileHandle: vi.fn(),
    }
    const showDirectoryPicker = vi.fn(async () => directory)
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: showDirectoryPicker,
    })
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        failed: [],
        total: items.length,
      }),
    )
    renderModal()
    await flush()

    expect(container.textContent).not.toContain("Choose download folder")
    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: "readwrite" })
    expect(runCollectionDownloadQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ directory }),
    )
    expect(container.textContent).toContain("Save to Episodes")
  })

  it("shows skipped episode titles before and after a partial batch", async () => {
    loadWatchCollectionDownloadsMock.mockResolvedValue({
      ok: true,
      dubs: dubs.slice(0, 1),
    })
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        failed: [],
        total: items.length,
      }),
    )
    renderModal()
    await flush()

    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-skipped"]',
      )?.textContent,
    ).toContain("Episode Two")

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-skipped"]',
      )?.textContent,
    ).toContain("Episode Two")
  })

  it("rechecks the session before starting when the account gate is enabled", async () => {
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        failed: [],
        total: items.length,
      }),
    )
    renderModal({ accountGateEnabled: true })
    await flush()

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(resolveDownloadSessionAccessMock).toHaveBeenCalledTimes(1)
    expect(runCollectionDownloadQueueMock).toHaveBeenCalledTimes(1)
  })

  it("shows sign-in instead of starting when the enabled gate rejects the session", async () => {
    resolveDownloadSessionAccessMock.mockResolvedValueOnce({
      ok: false,
      accountGateEnabled: true,
      reason: "auth-required",
      loginUrl: "/login",
    })
    renderModal({ accountGateEnabled: true })
    await flush()

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-sign-in"]',
      ),
    ).not.toBeNull()
    expect(runCollectionDownloadQueueMock).not.toHaveBeenCalled()
  })

  it("shows sign-in when capability refresh reports an expired session", async () => {
    loadWatchCollectionDownloadsMock
      .mockResolvedValueOnce({ ok: true, dubs })
      .mockResolvedValueOnce({ ok: false, reason: "auth-required" })
    resolveDownloadSessionAccessMock
      .mockResolvedValueOnce({ ok: true, accountGateEnabled: true })
      .mockResolvedValueOnce({
        ok: false,
        accountGateEnabled: true,
        reason: "auth-required",
        loginUrl: "/login",
      })
    renderModal({ accountGateEnabled: true })
    await flush()

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-sign-in"]',
      ),
    ).not.toBeNull()
    expect(runCollectionDownloadQueueMock).not.toHaveBeenCalled()
  })

  it("reloads availability when the language changes", async () => {
    renderModal()
    await flush()
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-language"]',
      ),
    ).toBeNull()

    const trigger = container.querySelector(
      '[data-testid="language-combobox-trigger"]',
    ) as HTMLButtonElement
    expect(trigger.textContent).toContain("English")

    act(() => trigger.click())
    const spanishOption = document.querySelector(
      '[data-testid="language-combobox-option"][data-language-slug="spanish"]',
    ) as HTMLButtonElement
    expect(spanishOption).not.toBeNull()

    act(() => {
      spanishOption.click()
    })
    await flush()
    expect(loadWatchCollectionDownloadsMock).toHaveBeenLastCalledWith({
      collectionSlug: "lumo-luke",
      languageSlug: "spanish",
    })
  })

  it("renders video quality as an app-styled listbox, not a native select", async () => {
    renderModal()
    await flush()

    const quality = qualityTrigger()
    expect(quality.tagName).toBe("BUTTON")
    expect(quality.getAttribute("aria-haspopup")).toBe("listbox")
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-modal"] select',
      ),
    ).toBeNull()
    const [labelId, valueId] = (
      quality.getAttribute("aria-labelledby") ?? ""
    ).split(" ")
    expect(document.getElementById(labelId ?? "")?.textContent).toBe(
      "Video quality",
    )
    // Accessible name also carries the current tier (review finding #1).
    expect(document.getElementById(valueId ?? "")?.textContent).toBe("Highest")
  })

  it("lists every common tier in order with the highest selected", async () => {
    loadWatchCollectionDownloadsMock.mockResolvedValue({
      ok: true,
      dubs: threeTierDubs,
    })
    renderModal()
    await flush()

    expect(qualityTrigger().textContent).toContain("Highest")
    await act(async () => {
      qualityTrigger().click()
    })

    const options = qualityOptions()
    expect(options.map((option) => option.textContent)).toEqual([
      "Highest",
      "High",
      "Low",
    ])
    expect(
      options.map((option) => option.getAttribute("aria-selected")),
    ).toEqual(["true", "false", "false"])
  })

  it("builds the queue for the chosen tier", async () => {
    loadWatchCollectionDownloadsMock.mockResolvedValue({
      ok: true,
      dubs: threeTierDubs,
    })
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        failed: [],
        total: items.length,
      }),
    )
    renderModal()
    await flush()

    await act(async () => {
      qualityTrigger().click()
    })
    await act(async () => {
      ;(
        qualityOptions().find(
          (option) => option.getAttribute("data-tier") === "high",
        ) as HTMLButtonElement
      ).click()
    })
    expect(qualityTrigger().textContent).toContain("High")
    expect(
      document
        .querySelector('[data-testid="watch-collection-download-quality-list"]')
        ?.getAttribute("data-open"),
    ).toBe("false")

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    const call = runCollectionDownloadQueueMock.mock.calls[0]?.[0] as {
      items: Array<{ id: string; url: string }>
    }
    expect(call.items.map((item) => item.id)).toEqual([
      "episode-1",
      "episode-2",
    ])
    expect(call.items[0]?.url).toContain("downloadId=download-1-1080")
    expect(call.items[1]?.url).toContain("downloadId=download-2-1080")
  })

  it("disables the quality trigger while the queue is running", async () => {
    runCollectionDownloadQueueMock.mockImplementationOnce(
      () => new Promise(() => {}),
    )
    renderModal()
    await flush()
    expect(qualityTrigger().disabled).toBe(false)

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(qualityTrigger().disabled).toBe(true)
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-modal-close"]',
      ),
    ).toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-close"]',
      ),
    ).toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-cancel"]',
      ),
    ).not.toBeNull()
  })

  it("shows the placeholder on a disabled trigger when no tier is available", async () => {
    loadWatchCollectionDownloadsMock.mockResolvedValue({ ok: true, dubs: [] })
    renderModal()
    await flush()

    const quality = qualityTrigger()
    expect(quality.disabled).toBe(true)
    expect(quality.textContent).toContain("Video quality")
    expect(
      (
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it("renders the form without parent container chrome", async () => {
    renderModal()
    await flush()

    const modal = container.querySelector(
      '[data-testid="watch-collection-download-modal"]',
    )
    expect(modal?.className).toContain("bg-transparent")
    expect(modal?.className).toContain("rounded-none")
    expect(modal?.className).not.toContain("bg-stone-950")
    expect(modal?.className).toContain("sm:max-w-[960px]")
  })

  it("scrolls at the viewport edge instead of inside the modal", async () => {
    renderModal()
    await flush()

    const modal = container.querySelector(
      '[data-testid="watch-collection-download-modal"]',
    )
    const viewport = modal?.parentElement
    const content = container.querySelector(
      '[data-testid="watch-collection-download-modal-content"]',
    )

    expect(viewport?.getAttribute("data-slot")).toBe("dialog-viewport")
    expect(viewport?.className).toContain("fixed")
    expect(viewport?.className).toContain("inset-0")
    expect(viewport?.className).toContain("overflow-y-auto")
    expect(modal?.className).toContain("m-auto")
    expect(modal?.className).toContain("shrink-0")
    expect(content?.className).not.toContain("overflow-y-auto")
    expect(content?.className).not.toContain("max-h-")
    const close = container.querySelector(
      '[data-testid="watch-collection-download-modal-close"]',
    )
    expect(modal?.contains(close)).toBe(true)
    expect(close?.getAttribute("data-render-inline")).toBe("true")
  })

  it("places the unboxed thumbnail summary beside the heading copy", async () => {
    const extraEpisodes = Array.from({ length: 4 }, (_, index) => ({
      documentId: `episode-${index + 3}`,
      slug: `episode-${index + 3}`,
      title: `Episode ${index + 3}`,
      thumbnailUrl: `https://cdn.example/episode-${index + 3}.jpg`,
    }))
    const extraDubs = extraEpisodes.map((episode, index) => ({
      documentId: `dub-${index + 3}`,
      videoId: episode.documentId,
      downloads: [
        {
          documentId: `download-${index + 3}`,
          capability: `capability-${index + 3}`,
          height: 1080,
          quality: "high",
          size: 600_000_000,
        },
      ],
    }))
    loadWatchCollectionDownloadsMock.mockResolvedValueOnce({
      ok: true,
      dubs: [...dubs, ...extraDubs],
    })
    renderModal({ episodes: [...episodes, ...extraEpisodes] })
    await flush()

    const header = container.querySelector(
      '[data-testid="watch-collection-download-header"]',
    )
    const summary = container.querySelector(
      '[data-testid="watch-collection-download-ready"]',
    )
    expect(header?.contains(summary)).toBe(true)
    expect(header?.className).toContain("gap-x-8")
    expect(header?.className).toContain(
      "min-[900px]:grid-cols-[minmax(0,1fr)_26rem]",
    )
    const description = container.querySelector(
      '[data-testid="watch-collection-download-description"]',
    )
    expect(description?.parentElement?.querySelector("h2")?.textContent).toBe(
      "LUMO Luke",
    )
    expect(description?.parentElement?.parentElement).toBe(header)
    const eyebrow = summary?.parentElement?.querySelector(
      '[data-testid="watch-collection-download-eyebrow"]',
    )
    expect(eyebrow?.className).toContain("font-semibold")
    expect(eyebrow?.className).toContain("tracking-[0.28em]")
    expect(eyebrow?.className).toContain("text-red-100/70")
    expect(summary?.getAttribute("aria-label")).toBe("6 episodes are ready")
    expect(summary?.className).not.toContain("rounded")
    expect(summary?.className).not.toContain("border")
    expect(summary?.className).not.toContain("bg-")
    expect(summary?.className).not.toContain("flex-col")
    expect(summary?.className).toContain("justify-self-center")
    expect(summary?.className).toContain("min-[900px]:justify-self-end")
    const thumbnailStack = summary?.querySelector(
      '[data-testid="watch-collection-download-thumbnail-stack"]',
    )
    expect(thumbnailStack?.className).toContain("relative")
    expect(thumbnailStack?.className).toContain("min-[900px]:h-[10.5rem]")
    expect(thumbnailStack?.className).toContain("min-[900px]:w-64")
    expect(thumbnailStack?.className).not.toContain("-space-x")
    const thumbnails = summary?.querySelectorAll(
      '[data-testid="watch-collection-download-thumbnail"]',
    )
    expect(thumbnails).toHaveLength(3)
    thumbnails?.forEach((thumbnail) => {
      expect(thumbnail.className).toContain("absolute")
      expect(thumbnail.className).toContain("left-1/2")
      expect(thumbnail.className).toContain("-translate-x-1/2")
      expect(thumbnail.className).toContain("rounded-xl")
    })
    expect(thumbnails?.[0]?.className).toContain("min-[900px]:w-56")
    expect(thumbnails?.[0]?.className).toContain("min-[900px]:top-10")
    expect(thumbnails?.[0]?.className).toContain("border-2")
    expect(thumbnails?.[1]?.className).toContain("min-[900px]:w-[13.25rem]")
    expect(thumbnails?.[1]?.className).toContain("brightness-[0.64]")
    expect(thumbnails?.[1]?.className).toContain("saturate-[0.55]")
    expect(thumbnails?.[2]?.className).toContain("min-[900px]:w-[12.5rem]")
    expect(thumbnails?.[2]?.className).toContain("brightness-[0.42]")
    expect(thumbnails?.[2]?.className).toContain("saturate-[0.3]")
    const decorativeLayers = summary?.querySelectorAll(
      '[data-testid="watch-collection-download-stack-layer"]',
    )
    expect(decorativeLayers).toHaveLength(2)
    decorativeLayers?.forEach((layer) => {
      expect(layer.querySelector("img")).toBeNull()
      expect(layer.className).toContain("left-1/2")
      expect(layer.className).toContain("-translate-x-1/2")
    })
    const count = summary?.querySelector(
      '[data-testid="watch-collection-download-ready-count"]',
    )
    expect(count?.className).toContain("text-center")
    expect(count?.className).toContain("flex-col")
    expect(count?.className).toContain("items-center")
    expect(count?.className).toContain("rounded-2xl")
    expect(count?.className).toContain("border-2")
    expect(count?.className).toContain("border-white/15")
    expect(
      Array.from(count?.querySelectorAll("span") ?? []).map(
        (line) => line.textContent,
      ),
    ).toEqual(["6", "videos", "3.6 GB"])
    const totalSize = summary?.querySelector(
      '[data-testid="watch-collection-download-total-size"]',
    )
    expect(totalSize?.textContent).toBe("3.6 GB")
    expect(totalSize?.className).toContain("font-semibold")
    expect(totalSize?.className).toContain("tracking-[0.08em]")
    expect(totalSize?.className).toContain("mt-0.5")
    expect(totalSize?.className).toContain("text-red-100/70")
  })

  it("strengthens the form hierarchy without changing action shapes", async () => {
    renderModal()
    await flush()

    const fields = container.querySelector(
      '[data-testid="watch-collection-download-fields"]',
    )
    expect(fields?.className).toContain("gap-5")

    const language = container.querySelector(
      '[data-testid="language-combobox-trigger"]',
    )
    expect(language?.className).toContain("border-white/15")
    expect(language?.className).toContain("bg-stone-900")

    const quality = container.querySelector(
      '[data-testid="watch-collection-download-quality"]',
    )
    expect(quality?.className).toContain("border-white/15")
    expect(quality?.className).toContain("bg-stone-900")

    const actions = container.querySelector(
      '[data-testid="watch-collection-download-actions"]',
    )
    expect(actions?.className).not.toContain("border-t")
    expect(actions?.className).toContain("items-center")
    expect(actions?.className).toContain("pt-5")
    expect(
      actions?.querySelector('[data-testid="watch-collection-download-start"]')
        ?.className,
    ).toContain("rounded-full")
  })

  it("recovers when loading availability rejects", async () => {
    loadWatchCollectionDownloadsMock
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ ok: true, dubs })
    renderModal()
    await flush()

    expect(container.textContent).toContain(
      "Downloads could not be loaded for this language.",
    )

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-load-retry"]',
        ) as HTMLButtonElement
      ).click()
    })
    await flush()

    expect(loadWatchCollectionDownloadsMock).toHaveBeenCalledTimes(2)
    expect(
      (
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })

  it("retries only failed items", async () => {
    runCollectionDownloadQueueMock
      .mockImplementationOnce(async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: [items[0]],
        failed: [{ item: items[1], reason: "http-502" }],
        total: items.length,
      }))
      .mockImplementationOnce(async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        failed: [],
        total: items.length,
      }))
    renderModal()
    await flush()
    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })
    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(runCollectionDownloadQueueMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        items: [expect.objectContaining({ id: "episode-2" })],
      }),
    )
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-progress"]',
      )?.textContent,
    ).toContain("2 of 2")
  })

  it("keeps the failed batch summary when retry session preflight is unavailable", async () => {
    resolveDownloadSessionAccessMock
      .mockResolvedValueOnce({ ok: true, accountGateEnabled: true })
      .mockResolvedValueOnce({
        ok: false,
        accountGateEnabled: true,
        reason: "session-unavailable",
      })
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: [items[0]],
        failed: [{ item: items[1], reason: "http-502" }],
        total: items.length,
      }),
    )
    renderModal({ accountGateEnabled: true })
    await flush()

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })
    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(runCollectionDownloadQueueMock).toHaveBeenCalledTimes(1)
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-progress"]',
      )?.textContent,
    ).toContain("1 of 2")
    expect(container.textContent).toContain(
      "Unable to check your session. Please try again.",
    )
  })

  it("keeps the failed batch summary when retry session preflight is canceled", async () => {
    let resolveRetrySession:
      | ((value: { ok: true; accountGateEnabled: true }) => void)
      | undefined
    resolveDownloadSessionAccessMock
      .mockResolvedValueOnce({ ok: true, accountGateEnabled: true })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRetrySession = resolve
        }),
      )
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: [items[0]],
        failed: [{ item: items[1], reason: "http-502" }],
        total: items.length,
      }),
    )
    renderModal({ accountGateEnabled: true })
    await flush()

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-cancel"]',
        ) as HTMLButtonElement
      ).click()
    })
    await act(async () => {
      resolveRetrySession?.({ ok: true, accountGateEnabled: true })
      await Promise.resolve()
    })

    expect(runCollectionDownloadQueueMock).toHaveBeenCalledTimes(1)
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-progress"]',
      )?.textContent,
    ).toContain("1 of 2")
  })

  it("renders the sign-in state without starting media requests", async () => {
    renderModal({
      accountGateEnabled: true,
      authRequiredLoginUrl: "/login",
    })
    await flush()
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-sign-in"]',
      ),
    ).not.toBeNull()
    expect(runCollectionDownloadQueueMock).not.toHaveBeenCalled()
  })

  it("shows the unavailable state when the collection has no languages", async () => {
    renderModal({ languages: [], currentLanguageSlug: "" })
    await flush()

    expect(loadWatchCollectionDownloadsMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      "No downloadable episodes are available in this language.",
    )
  })

  it("cancels a pending session preflight before the queue can start", async () => {
    let resolveSession:
      | ((value: { ok: true; accountGateEnabled: true }) => void)
      | undefined
    resolveDownloadSessionAccessMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve
      }),
    )
    renderModal({ accountGateEnabled: true })
    await flush()

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-cancel"]',
        ) as HTMLButtonElement
      ).click()
    })
    await act(async () => {
      resolveSession?.({ ok: true, accountGateEnabled: true })
      await Promise.resolve()
    })

    expect(runCollectionDownloadQueueMock).not.toHaveBeenCalled()
  })

  it("cancels an active queue and keeps its settled summary closable", async () => {
    const onClose = vi.fn()
    let queueSignal: AbortSignal | undefined
    runCollectionDownloadQueueMock.mockImplementationOnce(
      ({ items, signal }) =>
        new Promise((resolve) => {
          queueSignal = signal
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                active: null,
                authRequired: false,
                canceled: true,
                completed: [items[0]],
                deliveryMode: "browser",
                failed: items
                  .slice(1)
                  .map((item: CollectionDownloadQueueItem) => ({
                    item,
                    reason: "canceled",
                  })),
                total: items.length,
              }),
            { once: true },
          )
        }),
    )
    renderModal({ onClose })
    await flush()

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-cancel"]',
        ) as HTMLButtonElement
      ).click()
    })
    await flush()

    expect(queueSignal?.aborted).toBe(true)
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-progress"]',
      )?.textContent,
    ).toContain("1 of 2")
    expect(container.textContent).toContain("Downloads canceled")
    expect(
      container.querySelector('[data-testid="watch-collection-download-start"]')
        ?.textContent,
    ).toContain("Download again")

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-close"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("ignores a stale post-401 session refresh after close", async () => {
    const onClose = vi.fn()
    let resolveRefreshedSession:
      | ((value: {
          ok: false
          accountGateEnabled: true
          reason: "auth-required"
          loginUrl: string
        }) => void)
      | undefined
    resolveDownloadSessionAccessMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefreshedSession = resolve
      }),
    )
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: true,
        canceled: false,
        completed: [],
        failed: [{ item: items[0], reason: "auth-required" }],
        total: items.length,
      }),
    )
    renderModal({ onClose })
    await flush()

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })
    await flush()
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-close"]',
        ) as HTMLButtonElement
      ).click()
    })
    await act(async () => {
      resolveRefreshedSession?.({
        ok: false,
        accountGateEnabled: true,
        reason: "auth-required",
        loginUrl: "/login",
      })
      await Promise.resolve()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-sign-in"]',
      ),
    ).toBeNull()
  })

  it("ignores retries stored before sequence-prefixed filenames", async () => {
    window.sessionStorage.setItem(
      "forge.watch.collection-download-resume:lumo-luke:english",
      JSON.stringify({
        completed: [],
        failed: [
          {
            item: {
              id: "episode-1",
              filename: "Episode-One_English_eng_1080p.mp4",
              title: "Episode One",
              url: "/watch/api/download?downloadId=download-1",
            },
            reason: "auth-required",
          },
        ],
        total: 2,
      }),
    )

    renderModal()
    await flush()

    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-progress"]',
      ),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="watch-collection-download-start"]')
        ?.textContent,
    ).toContain("Download all")
  })

  it("restores the saved language and tier but refreshes retry capabilities", async () => {
    loadWatchCollectionDownloadsMock.mockResolvedValue({
      ok: true,
      dubs: threeTierDubs,
    })
    window.sessionStorage.setItem(
      "forge.watch.collection-download-resume.v3:lumo-luke",
      JSON.stringify({
        version: 3,
        canceled: true,
        deliveryMode: "directory",
        languageSlug: "spanish",
        tier: "high",
        completed: [
          { id: "episode-1", filename: "one.mp4", title: "Episode One" },
        ],
        pending: [
          { id: "episode-2", filename: "two.mp4", title: "Episode Two" },
        ],
        total: 2,
      }),
    )
    runCollectionDownloadQueueMock.mockImplementationOnce(
      async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        deliveryMode: "browser",
        failed: [],
        total: items.length,
      }),
    )

    renderModal()
    await flush()
    await flush()

    expect(loadWatchCollectionDownloadsMock).toHaveBeenLastCalledWith({
      collectionSlug: "lumo-luke",
      languageSlug: "spanish",
    })
    expect(qualityTrigger().textContent).toContain("High")
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-progress"]',
      )?.textContent,
    ).toContain("1 of 2")
    const restoredProgress = container.querySelector(
      '[data-testid="watch-collection-download-progress"]',
    )?.textContent
    expect(restoredProgress).toContain("Downloads canceled")
    expect(restoredProgress).not.toContain("Your browser will save each file")

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    const retryItems = runCollectionDownloadQueueMock.mock.calls[0]?.[0]
      .items as CollectionDownloadQueueItem[]
    expect(retryItems).toEqual([expect.objectContaining({ id: "episode-2" })])
    expect(retryItems[0]?.url).toContain("capability-2-1080")
  })

  it("restores a failed-only retry after signing in mid-batch", async () => {
    const resumedEpisodes = [
      ...episodes,
      { documentId: "episode-3", slug: "three", title: "Episode Three" },
    ]
    const resumedDubs = [
      ...dubs,
      {
        documentId: "dub-3",
        videoId: "episode-3",
        downloads: [
          {
            documentId: "download-3",
            capability: "capability-3",
            height: 1080,
            quality: "high",
            size: 1,
          },
        ],
      },
    ]
    loadWatchCollectionDownloadsMock.mockResolvedValue({
      ok: true,
      dubs: resumedDubs,
    })
    resolveDownloadSessionAccessMock
      .mockResolvedValueOnce({ ok: true, accountGateEnabled: true })
      .mockResolvedValueOnce({
        ok: false,
        accountGateEnabled: true,
        reason: "auth-required",
        loginUrl: "/login",
      })
      .mockResolvedValueOnce({ ok: true, accountGateEnabled: true })
    runCollectionDownloadQueueMock
      .mockImplementationOnce(async ({ items }) => ({
        active: null,
        authRequired: true,
        canceled: false,
        completed: [items[0]],
        deliveryMode: "directory",
        failed: items.slice(1).map((item: CollectionDownloadQueueItem) => ({
          item,
          reason: "auth-required",
        })),
        total: items.length,
      }))
      .mockImplementationOnce(async ({ items }) => ({
        active: null,
        authRequired: false,
        canceled: false,
        completed: items,
        deliveryMode: "directory",
        failed: [],
        total: items.length,
      }))
    renderModal({
      accountGateEnabled: true,
      episodes: resumedEpisodes,
    })
    await flush()

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-sign-in"]',
      ),
    ).not.toBeNull()
    expect(window.sessionStorage).toHaveLength(1)
    expect(window.sessionStorage.key(0)).toContain("lumo-luke")
    expect(
      window.sessionStorage.getItem(window.sessionStorage.key(0)!),
    ).not.toContain("https://")
    expect(
      window.sessionStorage.getItem(window.sessionStorage.key(0)!),
    ).not.toContain("capability-")

    act(() => root.unmount())
    root = createRoot(container)
    renderModal({
      accountGateEnabled: true,
      episodes: resumedEpisodes,
    })
    await flush()

    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-progress"]',
      )?.textContent,
    ).toContain("1 of 3")
    expect(
      container.querySelector('[data-testid="watch-collection-download-start"]')
        ?.textContent,
    ).toContain("Download again")

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="watch-collection-download-start"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(runCollectionDownloadQueueMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        items: [
          expect.objectContaining({ id: "episode-2" }),
          expect.objectContaining({ id: "episode-3" }),
        ],
      }),
    )
    expect(window.sessionStorage).toHaveLength(0)
    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-progress"]',
      )?.textContent,
    ).toContain("3 of 3")
  })
})
