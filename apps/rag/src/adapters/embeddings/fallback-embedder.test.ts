import { describe, expect, it, vi } from "vitest"

import type { Embedder } from "../../contracts/index.js"
import { FallbackEmbedder } from "./fallback-embedder.js"

function embedder(
  result: number[],
  failure?: Error,
): Embedder & {
  embed: ReturnType<typeof vi.fn>
  embedQuery: ReturnType<typeof vi.fn>
} {
  return {
    model: "canonical-model",
    dimensions: result.length,
    embed: vi.fn(async (texts: string[]) => {
      if (failure) throw failure
      return texts.map(() => result)
    }),
    embedQuery: vi.fn(async () => {
      if (failure) throw failure
      return result
    }),
  }
}

describe("FallbackEmbedder", () => {
  it("reports the primary failure before serving the query from fallback", async () => {
    const failure = new Error("gateway unavailable")
    const primary = embedder([1, 0], failure)
    const fallback = embedder([0, 1])
    const onFallback = vi.fn()
    const subject = new FallbackEmbedder({ primary, fallback, onFallback })

    await expect(subject.embedQuery("hope")).resolves.toEqual([0, 1])

    expect(onFallback).toHaveBeenCalledOnce()
    expect(onFallback).toHaveBeenCalledWith(failure)
    expect(fallback.embedQuery).toHaveBeenCalledWith("hope")
  })

  it("does not report or invoke fallback when the primary succeeds", async () => {
    const primary = embedder([1, 0])
    const fallback = embedder([0, 1])
    const onFallback = vi.fn()
    const subject = new FallbackEmbedder({ primary, fallback, onFallback })

    await expect(subject.embed(["hope"])).resolves.toEqual([[1, 0]])

    expect(onFallback).not.toHaveBeenCalled()
    expect(fallback.embed).not.toHaveBeenCalled()
  })
})
