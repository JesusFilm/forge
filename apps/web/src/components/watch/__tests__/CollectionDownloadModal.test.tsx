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
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}))

vi.mock("@/components/watch/WatchModalViewportCloseButton", () => ({
  WatchModalViewportCloseButton: () => null,
}))

import { CollectionDownloadModal } from "@/components/watch/CollectionDownloadModal"

let container: HTMLDivElement
let root: Root

const episodes = [
  { documentId: "episode-1", slug: "one", title: "Episode One" },
  { documentId: "episode-2", slug: "two", title: "Episode Two" },
]

const dubs = [
  {
    documentId: "dub-1",
    videoId: "episode-1",
    downloads: [
      { documentId: "download-1", height: 1080, quality: "high", size: 1 },
    ],
  },
  {
    documentId: "dub-2",
    videoId: "episode-2",
    downloads: [
      { documentId: "download-2", height: 1080, quality: "high", size: 1 },
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

beforeEach(() => {
  loadWatchCollectionDownloadsMock.mockReset()
  resolveDownloadSessionAccessMock.mockReset()
  runCollectionDownloadQueueMock.mockReset()
  loadWatchCollectionDownloadsMock.mockResolvedValue({ ok: true, dubs })
  resolveDownloadSessionAccessMock.mockResolvedValue({ ok: true })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
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
      (
        container.querySelector(
          '[data-testid="watch-collection-download-language"]',
        ) as HTMLSelectElement
      ).value,
    ).toBe("english")

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
  })

  it("reloads availability when the language changes", async () => {
    renderModal()
    await flush()
    const select = container.querySelector(
      '[data-testid="watch-collection-download-language"]',
    ) as HTMLSelectElement
    act(() => {
      select.value = "spanish"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await flush()
    expect(loadWatchCollectionDownloadsMock).toHaveBeenLastCalledWith({
      collectionSlug: "lumo-luke",
      languageSlug: "spanish",
    })
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
  })

  it("renders the sign-in state without starting media requests", async () => {
    renderModal({ authRequiredLoginUrl: "/login" })
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
    let resolveSession: ((value: { ok: true }) => void) | undefined
    resolveDownloadSessionAccessMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve
      }),
    )
    renderModal()
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
      resolveSession?.({ ok: true })
      await Promise.resolve()
    })

    expect(runCollectionDownloadQueueMock).not.toHaveBeenCalled()
  })
})
