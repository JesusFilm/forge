/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest"

import {
  failedCollectionDownloadItems,
  runCollectionDownloadQueue,
} from "./collection-download-queue"

const items = ["one", "two", "three"].map((id) => ({
  id,
  filename: `${id}.mp4`,
  title: id,
  url: `/download/${id}`,
}))

describe("collection download queue", () => {
  it("hands each item to browser download navigation in order", async () => {
    const prepareDownload = vi.fn(
      async (
        _item: (typeof items)[number],
        _signal: AbortSignal,
      ): Promise<void> => undefined,
    )
    const triggerDownload = vi.fn()
    const onProgress = vi.fn()

    const result = await runCollectionDownloadQueue({
      items,
      signal: new AbortController().signal,
      delayMs: 0,
      prepareDownload,
      triggerDownload,
      onProgress,
    })

    expect(triggerDownload).toHaveBeenCalledTimes(3)
    expect(prepareDownload.mock.calls.map(([item]) => item.id)).toEqual([
      "one",
      "two",
      "three",
    ])
    expect(triggerDownload.mock.calls.map(([item]) => item.id)).toEqual([
      "one",
      "two",
      "three",
    ])
    expect(result.completed).toEqual(items)
    expect(result.failed).toEqual([])
    expect(result.authRequired).toBe(false)
    expect(result.deliveryMode).toBe("browser")
    expect(onProgress).toHaveBeenLastCalledWith({
      active: null,
      completed: items,
      failed: [],
      total: 3,
    })
  })

  it("records trigger failures and continues with the next item", async () => {
    const triggerDownload = vi.fn((item: (typeof items)[number]) => {
      if (item.id === "two") throw new Error("blocked")
    })

    const result = await runCollectionDownloadQueue({
      items,
      signal: new AbortController().signal,
      delayMs: 0,
      prepareDownload: async () => undefined,
      triggerDownload,
    })

    expect(result.completed.map((item) => item.id)).toEqual(["one", "three"])
    expect(result.failed).toEqual([{ item: items[1], reason: "blocked" }])
    expect(failedCollectionDownloadItems(result)).toEqual([items[1]])
  })

  it("cancels before starting the next item", async () => {
    const controller = new AbortController()
    const triggerDownload = vi.fn(() => {
      controller.abort()
    })

    const result = await runCollectionDownloadQueue({
      items,
      signal: controller.signal,
      delayMs: 1,
      prepareDownload: async () => undefined,
      triggerDownload,
    })

    expect(result.canceled).toBe(true)
    expect(triggerDownload).toHaveBeenCalledTimes(1)
    expect(result.completed).toEqual([items[0]])
    expect(result.failed).toEqual([
      { item: items[1], reason: "canceled" },
      { item: items[2], reason: "canceled" },
    ])
  })

  it("acknowledges the route with HEAD before creating the download anchor", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 302 }))
    const clicks: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click(this: HTMLAnchorElement) {
        clicks.push(`${this.href}|${this.download}`)
      },
    )

    const result = await runCollectionDownloadQueue({
      items: items.slice(0, 1),
      signal: new AbortController().signal,
      delayMs: 0,
    })

    expect(fetchSpy).toHaveBeenCalledWith("/download/one", {
      method: "HEAD",
      credentials: "same-origin",
      redirect: "manual",
      signal: expect.any(AbortSignal),
    })
    expect(clicks).toEqual(["http://localhost:3000/download/one|one.mp4"])
    expect(result.completed).toEqual([items[0]])
  })

  it("records a rejected route response and continues", async () => {
    const prepareDownload = vi.fn(async (item: (typeof items)[number]) => {
      if (item.id === "two") throw new Error("download-unavailable-503")
    })
    const triggerDownload = vi.fn()

    const result = await runCollectionDownloadQueue({
      items,
      signal: new AbortController().signal,
      delayMs: 0,
      prepareDownload,
      triggerDownload,
    })

    expect(triggerDownload.mock.calls.map(([item]) => item.id)).toEqual([
      "one",
      "three",
    ])
    expect(result.failed).toEqual([
      { item: items[1], reason: "download-unavailable-503" },
    ])
  })

  it("stops on authentication failure and preserves every unstarted item for retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 401,
        headers: { "x-watch-download-error": "auth-required" },
      }),
    )
    const triggerDownload = vi.fn()

    const result = await runCollectionDownloadQueue({
      items,
      signal: new AbortController().signal,
      delayMs: 0,
      triggerDownload,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(triggerDownload).not.toHaveBeenCalled()
    expect(result.authRequired).toBe(true)
    expect(result.failed).toEqual(
      items.map((item) => ({ item, reason: "auth-required" })),
    )
  })

  it("streams one completed response at a time into a selected directory", async () => {
    let activeResponses = 0
    let maxActiveResponses = 0
    const written: string[] = []
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => {
        activeResponses += 1
        maxActiveResponses = Math.max(maxActiveResponses, activeResponses)
        return new Response(String(url), { status: 200 })
      })
    const directory = {
      getFileHandle: vi.fn(
        async (filename: string, options?: { create?: boolean }) => {
          if (!options?.create) {
            throw new DOMException("Missing", "NotFoundError")
          }
          return {
            createWritable: async () =>
              new WritableStream<Uint8Array>({
                close() {
                  written.push(filename)
                  activeResponses -= 1
                },
              }),
          }
        },
      ),
    }
    const triggerDownload = vi.fn()

    const result = await runCollectionDownloadQueue({
      items,
      signal: new AbortController().signal,
      directory,
      triggerDownload,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/download/one", {
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    })
    expect(maxActiveResponses).toBe(1)
    expect(written).toEqual(["one.mp4", "two.mp4", "three.mp4"])
    expect(triggerDownload).not.toHaveBeenCalled()
    expect(result.completed).toEqual(items)
    expect(result.failed).toEqual([])
    expect(result.deliveryMode).toBe("directory")
  })

  it("chooses a new filename instead of overwriting an existing directory entry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("video", { status: 200 }),
    )
    const created: string[] = []
    const directory = {
      getFileHandle: vi.fn(
        async (filename: string, options?: { create?: boolean }) => {
          if (!options?.create) {
            if (filename === "one.mp4") {
              return { createWritable: vi.fn() }
            }
            throw new DOMException("Missing", "NotFoundError")
          }
          created.push(filename)
          return {
            createWritable: async () => new WritableStream<Uint8Array>(),
          }
        },
      ),
    }

    const result = await runCollectionDownloadQueue({
      items: items.slice(0, 1),
      signal: new AbortController().signal,
      directory,
    })

    expect(created).toEqual(["one (1).mp4"])
    expect(result.completed).toEqual([
      expect.objectContaining({ filename: "one (1).mp4" }),
    ])
  })

  it("removes a partial file when a directory write fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("video", { status: 200 }),
    )
    const removeEntry = vi.fn(async () => undefined)
    const directory = {
      getFileHandle: vi.fn(async (_filename, options) => {
        if (!options?.create) {
          throw new DOMException("Missing", "NotFoundError")
        }
        return {
          createWritable: async () =>
            new WritableStream<Uint8Array>({
              write() {
                throw new Error("disk-full")
              },
            }),
        }
      }),
      removeEntry,
    }

    const result = await runCollectionDownloadQueue({
      items: items.slice(0, 1),
      signal: new AbortController().signal,
      directory,
    })

    expect(removeEntry).toHaveBeenCalledWith("one.mp4")
    expect(result.failed).toEqual([{ item: items[0], reason: "disk-full" }])
  })

  it("demotes current and remaining items after a later pre-write CORS failure", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("one", { status: 200 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const directory = {
      getFileHandle: vi.fn(async (_filename, options) => {
        if (!options?.create) {
          throw new DOMException("Missing", "NotFoundError")
        }
        return {
          createWritable: async () => new WritableStream<Uint8Array>(),
        }
      }),
    }
    const prepareDownload = vi.fn(
      async (_item: (typeof items)[number]) => undefined,
    )
    const triggerDownload = vi.fn()

    const result = await runCollectionDownloadQueue({
      items,
      signal: new AbortController().signal,
      delayMs: 0,
      directory,
      prepareDownload,
      triggerDownload,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(prepareDownload.mock.calls.map(([item]) => item.id)).toEqual([
      "two",
      "three",
    ])
    expect(triggerDownload.mock.calls.map(([item]) => item.id)).toEqual([
      "two",
      "three",
    ])
    expect(result.completed.map((item) => item.id)).toEqual([
      "one",
      "two",
      "three",
    ])
    expect(result.deliveryMode).toBe("browser")
  })
})
