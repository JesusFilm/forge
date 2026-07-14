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
import type { CollectionDownloadQueueItem } from "@/components/watch/collection-download-options"

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

beforeEach(() => {
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
    expect(resolveDownloadSessionAccessMock).not.toHaveBeenCalled()
  })

  it("shows skipped episode titles before and after a partial batch", async () => {
    loadWatchCollectionDownloadsMock.mockResolvedValueOnce({
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

  it("uses a dark native menu for video quality options", async () => {
    renderModal()
    await flush()

    expect(
      container.querySelector(
        '[data-testid="watch-collection-download-quality"]',
      )?.className,
    ).toContain("scheme-dark")
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
                failed: [],
                total: items.length,
              }),
            { once: true },
          )
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
    expect(window.sessionStorage.key(0)).toContain("lumo-luke:english")
    expect(
      window.sessionStorage.getItem(window.sessionStorage.key(0)!),
    ).not.toContain("https://")

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
    ).toContain("Retry failed")

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
