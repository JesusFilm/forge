import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"

import { DEVOTIONAL_AUTHORED_PATHS } from "../authored-data"
import {
  InMemoryCatalogStore,
  InMemoryGenerationVectorIndex,
  createDeterministicTestEmbedder,
} from "./catalog"
import { DevotionalWorkspaceRepository } from "./repository"
import type { InventoryFilesystem } from "./inventory"

function filesystem(values: Record<string, string>): InventoryFilesystem {
  const modifiedAt = new Date("2026-07-31T12:00:00.000Z")
  return {
    async listFiles() {
      return Object.keys(values)
    },
    async readFile(path) {
      const value = values[path]
      if (value === undefined) throw new Error("missing")
      return Buffer.from(value)
    },
    async stat(path) {
      const value = values[path]
      if (value === undefined) throw new Error("missing")
      return { size: Buffer.byteLength(value), modifiedAt }
    },
  }
}

const authoredFiles = Object.fromEntries(
  Object.values(DEVOTIONAL_AUTHORED_PATHS).map((workspacePath) => [
    workspacePath,
    readFileSync(
      new URL(
        `../../../../devotional-workspace${workspacePath}`,
        import.meta.url,
      ),
      "utf8",
    ),
  ]),
)

const files: Record<string, string> = {
  ...authoredFiles,
  "/inputs/reflections/grace.md": "Grace is a gift, received through faith.",
  "/inputs/reflections/hope.md": "Hope remains when the night is long.",
}

describe("DevotionalWorkspaceRepository", () => {
  it("fails closed when any hybrid-search capability is unavailable", async () => {
    const repository = new DevotionalWorkspaceRepository({
      filesystem: filesystem(files),
      catalog: new InMemoryCatalogStore(),
    })

    await expect(repository.reconcile()).rejects.toMatchObject({
      code: "hybrid-search-unavailable",
    })
  })

  it("commits a generation only after keyword and vector indexing complete", async () => {
    const catalog = new InMemoryCatalogStore()
    const vectors = new InMemoryGenerationVectorIndex()
    const repository = new DevotionalWorkspaceRepository({
      filesystem: filesystem(files),
      catalog,
      vectorIndex: vectors,
      embedder: createDeterministicTestEmbedder(),
    })

    const reconciled = await repository.reconcile()
    const results = await repository.search("gift grace", {
      category: "reflections",
      topK: 2,
    })

    expect(reconciled.generation).toBe(1)
    await expect(catalog.getHead()).resolves.toMatchObject({ generation: 1 })
    expect(results[0]).toMatchObject({ path: "/inputs/reflections/grace.md" })
  })

  it("filters stale vector hits whose path and digest are not in the committed head", async () => {
    const catalog = new InMemoryCatalogStore()
    const vectors = new InMemoryGenerationVectorIndex()
    const repository = new DevotionalWorkspaceRepository({
      filesystem: filesystem(files),
      catalog,
      vectorIndex: vectors,
      embedder: createDeterministicTestEmbedder(),
    })
    await repository.reconcile()
    vectors.injectSearchResult({
      generation: 1,
      path: "/inputs/reflections/deleted.md",
      digest: "0".repeat(64),
      score: 1,
    })

    const results = await repository.search("deleted", {
      category: "reflections",
      topK: 10,
    })

    expect(results).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/inputs/reflections/deleted.md" }),
      ]),
    )
  })

  it("does not advance the head when vector indexing fails", async () => {
    const catalog = new InMemoryCatalogStore()
    const vectors = new InMemoryGenerationVectorIndex()
    vectors.failNextWrite(new Error("vector unavailable"))
    const repository = new DevotionalWorkspaceRepository({
      filesystem: filesystem(files),
      catalog,
      vectorIndex: vectors,
      embedder: createDeterministicTestEmbedder(),
    })

    await expect(repository.reconcile()).rejects.toMatchObject({
      code: "reconciliation-failed",
    })
    await expect(catalog.getHead()).resolves.toBeUndefined()
  })

  it("bounds embedding concurrency while preserving catalog order", async () => {
    let active = 0
    let peak = 0
    const repository = new DevotionalWorkspaceRepository({
      filesystem: filesystem(files),
      catalog: new InMemoryCatalogStore(),
      vectorIndex: new InMemoryGenerationVectorIndex(),
      embedder: async (text) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        active -= 1
        return createDeterministicTestEmbedder()(text)
      },
    })

    await repository.reconcile()

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(5)
  })

  it("reuses embeddings for byte-identical documents across attempts", async () => {
    const embedder = vi.fn(createDeterministicTestEmbedder())
    const repository = new DevotionalWorkspaceRepository({
      filesystem: filesystem(files),
      catalog: new InMemoryCatalogStore(),
      vectorIndex: new InMemoryGenerationVectorIndex(),
      embedder,
    })

    await repository.reconcile()
    const firstPassCalls = embedder.mock.calls.length
    await repository.reconcile()

    expect(firstPassCalls).toBeGreaterThan(0)
    expect(embedder).toHaveBeenCalledTimes(firstPassCalls)
  })

  it("fails reconciliation when embedding exceeds the shared deadline", async () => {
    const repository = new DevotionalWorkspaceRepository({
      filesystem: filesystem(files),
      catalog: new InMemoryCatalogStore(),
      vectorIndex: new InMemoryGenerationVectorIndex(),
      embedder: async () => new Promise<number[]>(() => undefined),
      limits: { deadlineMs: 5 },
    })

    await expect(repository.reconcile()).rejects.toMatchObject({
      code: "inventory-deadline-exceeded",
    })
  })
})
