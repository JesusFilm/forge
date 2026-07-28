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
    const triggerDownload = vi.fn()
    const onProgress = vi.fn()

    const result = await runCollectionDownloadQueue({
      items,
      signal: new AbortController().signal,
      delayMs: 0,
      triggerDownload,
      onProgress,
    })

    expect(triggerDownload).toHaveBeenCalledTimes(3)
    expect(triggerDownload.mock.calls.map(([item]) => item.id)).toEqual([
      "one",
      "two",
      "three",
    ])
    expect(result.completed).toEqual(items)
    expect(result.failed).toEqual([])
    expect(result.authRequired).toBe(false)
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
      triggerDownload,
    })

    expect(result.canceled).toBe(true)
    expect(triggerDownload).toHaveBeenCalledTimes(1)
    expect(result.completed).toEqual([items[0]])
  })

  it("default trigger creates an anchor without fetching the response body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
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

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(clicks).toEqual(["http://localhost:3000/download/one|one.mp4"])
    expect(result.completed).toEqual([items[0]])
  })
})
