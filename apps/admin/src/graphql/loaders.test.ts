// Tests for the per-request DataLoader factory.
//
// The behavior we care about is contract-level — DataLoader's batching
// semantics are the responsibility of the library. We assert:
// - createLoaders returns the expected loader keys
// - each loader is fresh per call (no shared state across "requests")
// - the input-order projection helper preserves order and fills holes
//   with null
//
// Live-DB batching verification lands in the Unit 6d ABAC parity test
// where Prisma query logging confirms the IN-batched fetches.

import { describe, expect, it } from "vitest"
import { createLoaders } from "@/graphql/loaders"

// Minimal Prisma stub — each model only exposes findMany since that's
// what loaders use.
function makeFakePrisma(rowsByModel: Record<string, Array<{ id: string }>>) {
  const make = (key: string) => ({
    findMany: async (args: { where: { id: { in: string[] } } }) => {
      const wanted = new Set(args.where.id.in)
      return rowsByModel[key].filter((r) => wanted.has(r.id))
    },
  })
  return {
    experience: make("experience"),
    experienceLocale: make("experienceLocale"),
    video: make("video"),
    language: make("language"),
    // Loose typing — DataLoader factory only touches the four above.
  } as unknown as Parameters<typeof createLoaders>[0]
}

describe("createLoaders", () => {
  it("exposes the expected loader keys", () => {
    const loaders = createLoaders(makeFakePrisma({}))
    expect(Object.keys(loaders).sort()).toEqual([
      "experienceById",
      "experienceLocaleById",
      "languageById",
      "videoById",
    ])
  })

  it("returns rows in the same order as input keys, with null for missing", async () => {
    const prisma = makeFakePrisma({
      experience: [{ id: "x1" }, { id: "x3" }],
      experienceLocale: [],
      video: [],
      language: [],
    })
    const loaders = createLoaders(prisma)
    const rows = await loaders.experienceById.loadMany(["x1", "x2", "x3"])
    expect(rows).toHaveLength(3)
    expect((rows[0] as { id: string } | null)?.id).toBe("x1")
    expect(rows[1]).toBeNull()
    expect((rows[2] as { id: string } | null)?.id).toBe("x3")
  })

  it("each createLoaders() call is independent (no cross-request leakage)", async () => {
    let calls = 0
    const prisma = {
      experience: {
        findMany: async () => {
          calls++
          return [{ id: "x1" }]
        },
      },
      experienceLocale: { findMany: async () => [] },
      video: { findMany: async () => [] },
      language: { findMany: async () => [] },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loadersA = createLoaders(prisma)
    const loadersB = createLoaders(prisma)
    await loadersA.experienceById.load("x1")
    await loadersB.experienceById.load("x1")
    // Each request fires its own batched fetch — no cache sharing.
    expect(calls).toBe(2)
  })

  it("dedupes within a single request tick", async () => {
    let calls = 0
    const prisma = {
      experience: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          calls++
          return args.where.id.in.map((id) => ({ id }))
        },
      },
      experienceLocale: { findMany: async () => [] },
      video: { findMany: async () => [] },
      language: { findMany: async () => [] },
    } as unknown as Parameters<typeof createLoaders>[0]

    const loaders = createLoaders(prisma)
    // Three loads in the same tick — one batched fetch.
    await Promise.all([
      loaders.experienceById.load("x1"),
      loaders.experienceById.load("x2"),
      loaders.experienceById.load("x1"), // duplicate; batched + cached
    ])
    expect(calls).toBe(1)
  })
})
