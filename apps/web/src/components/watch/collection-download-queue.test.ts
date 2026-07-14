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
  it("downloads one item at a time and continues after a failure", async () => {
    let active = 0
    let maxActive = 0
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
      return String(url).endsWith("two")
        ? new Response("bad", { status: 502 })
        : new Response("ok")
    }) as typeof fetch
    const saveBlob = vi.fn()

    const result = await runCollectionDownloadQueue({
      items,
      signal: new AbortController().signal,
      fetchImpl,
      saveBlob,
    })

    expect(maxActive).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(result.completed.map((item) => item.id)).toEqual(["one", "three"])
    expect(result.failed.map(({ item }) => item.id)).toEqual(["two"])
    expect(saveBlob).toHaveBeenCalledTimes(2)
    expect(failedCollectionDownloadItems(result)).toEqual([items[1]])
  })

  it("stops on authentication failure", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 401 }),
    ) as typeof fetch
    const result = await runCollectionDownloadQueue({
      items,
      signal: new AbortController().signal,
      fetchImpl,
      saveBlob: vi.fn(),
    })

    expect(result.authRequired).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("streams to a directory without creating a Blob", async () => {
    const writes: string[] = []
    const directory = {
      getFileHandle: vi.fn(async (name: string) => ({
        createWritable: async () =>
          new WritableStream<Uint8Array>({
            write: () => {
              writes.push(name)
            },
          }),
      })),
    }
    const saveBlob = vi.fn()

    const result = await runCollectionDownloadQueue({
      items: items.slice(0, 1),
      signal: new AbortController().signal,
      directory,
      fetchImpl: vi.fn(async () => new Response("ok")) as typeof fetch,
      saveBlob,
    })

    expect(result.completed).toHaveLength(1)
    expect(writes).toEqual(["one.mp4"])
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it("cancels the active request without starting the next item", async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL) => {
      controller.abort()
      throw new DOMException("Aborted", "AbortError")
    }) as typeof fetch

    const result = await runCollectionDownloadQueue({
      items,
      signal: controller.signal,
      fetchImpl,
      saveBlob: vi.fn(),
    })

    expect(result.canceled).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
