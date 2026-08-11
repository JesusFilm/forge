import { describe, expect, it, vi } from "vitest"

import type { UsedClipsStore } from "../used-clips-ledger"
import { DEVOTIONAL_REQUIRED_AUTHORED_PATHS } from "../authored-data"
import type { DevotionalWorkspaceRuntime } from "./config"
import type { DevotionalDatabase, QueryExecutor } from "./database"
import type { EligibleDevotionalInput } from "./inventory"
import type { PostgresCatalogStore } from "./postgres-catalog"
import type { DevotionalWorkspaceRepository } from "./repository"
import type { DevotionalAttemptStore } from "./state"
import {
  createDevotionalDataPlaneRuntime,
  withDevotionalReconciliationLease,
} from "./runtime"

function databaseFixture(events: string[]): DevotionalDatabase {
  const client: QueryExecutor = {
    query: vi.fn(async (text: string) => {
      events.push(text.includes("pg_advisory_xact_lock") ? "lease" : text)
      return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] }
    }),
  }
  return {
    pool: {} as DevotionalDatabase["pool"],
    maxConnections: 3,
    query: client.query,
    transaction: async (work) => work(client),
    close: async () => {},
  }
}

function requiredEligible(): EligibleDevotionalInput[] {
  return [
    ...DEVOTIONAL_REQUIRED_AUTHORED_PATHS,
    "/inputs/scripture/john/3-16.md",
  ].map((path, index) => ({
    path,
    category: path.split("/")[2] as EligibleDevotionalInput["category"],
    digest: index.toString(16).padStart(64, "a").slice(-64),
    size: 12,
    modifiedAt: "2026-07-31T12:00:00.000Z",
    title: path,
    content: "Source body",
  }))
}

describe("devotional data-plane runtime", () => {
  it("holds the database lease across readiness and reconciliation", async () => {
    const events: string[] = []
    const database = databaseFixture(events)
    const catalog = {
      retireBefore: vi.fn(async () => {
        events.push("retire")
        return []
      }),
    } as unknown as PostgresCatalogStore
    const eligible = requiredEligible()
    eligible.push({
      path: "/inputs/reflections/grace.md",
      category: "reflections",
      digest: "f".repeat(64),
      size: 12,
      modifiedAt: "2026-07-31T12:00:00.000Z",
      title: "Grace",
      content: "Source body",
    })
    const repository = {
      reconcile: vi.fn(async () => {
        events.push("reconcile")
        return {
          generation: 7,
          inventoryDigest: "b".repeat(64),
          inventory: {
            discovered: eligible.length,
            decodedTextBytes: 12,
            excluded: [],
            eligibleByCategory: {},
            eligible,
          },
        }
      }),
      search: vi.fn(async (_query, options) =>
        eligible
          .filter((entry) => entry.category === options?.category)
          .map(({ content: _content, ...entry }) => ({ ...entry, score: 1 })),
      ),
      retireLocalGenerations: vi.fn(),
    } as unknown as Pick<
      DevotionalWorkspaceRepository,
      "reconcile" | "search" | "retireLocalGenerations"
    >
    const writeFile = vi.fn(async () => undefined)
    const runtime = createDevotionalDataPlaneRuntime({
      workspaceRuntime: {
        filesystem: { writeFile },
      } as unknown as DevotionalWorkspaceRuntime,
      database,
      catalog,
      repository,
      attempts: {} as DevotionalAttemptStore,
      usedClips: {} as UsedClipsStore,
      assertReady: async () => {
        events.push("ready")
      },
    })

    const result = await runtime.reconcileAttempt()
    expect(result.generation).toBe(7)
    expect(result.selectedSources).toHaveLength(eligible.length)
    expect(result.selectedSources).toContainEqual(
      expect.objectContaining({ path: "/inputs/reflections/grace.md" }),
    )
    expect(events).toEqual(["lease", "ready", "reconcile", "retire"])
    expect(writeFile).toHaveBeenCalledTimes(2)
  })

  it("does not reconcile when fail-closed readiness rejects", async () => {
    const database = databaseFixture([])
    const repository = {
      reconcile: vi.fn(),
      search: vi.fn(),
      retireLocalGenerations: vi.fn(),
    } as unknown as Pick<
      DevotionalWorkspaceRepository,
      "reconcile" | "search" | "retireLocalGenerations"
    >
    const runtime = createDevotionalDataPlaneRuntime({
      workspaceRuntime: {} as DevotionalWorkspaceRuntime,
      database,
      catalog: {} as PostgresCatalogStore,
      repository,
      attempts: {} as DevotionalAttemptStore,
      usedClips: {} as UsedClipsStore,
      assertReady: async () => {
        throw new Error("not ready")
      },
    })

    await expect(runtime.reconcileAttempt()).rejects.toThrow("not ready")
    expect(repository.reconcile).not.toHaveBeenCalled()
  })

  it("uses bounded hybrid results when more than 500 sources are eligible", async () => {
    const reflections: EligibleDevotionalInput[] = Array.from(
      { length: 501 },
      (_, index) => ({
        path: `/inputs/reflections/source-${index}.md`,
        category: "reflections",
        digest: index.toString(16).padStart(64, "0"),
        size: 12,
        modifiedAt: "2026-07-31T12:00:00.000Z",
        title: `Reflection ${index}`,
        content: `Reflection ${index}`,
      }),
    )
    const eligible = [...requiredEligible(), ...reflections]
    const repository = {
      reconcile: vi.fn(async () => ({
        generation: 9,
        inventoryDigest: "c".repeat(64),
        inventory: {
          discovered: eligible.length,
          decodedTextBytes: 12,
          excluded: [],
          eligibleByCategory: {},
          eligible,
        },
      })),
      search: vi.fn(async (_query, options) =>
        eligible
          .filter((entry) => entry.category === options?.category)
          .slice(0, options?.topK)
          .map(({ content: _content, ...entry }) => ({ ...entry, score: 1 })),
      ),
      retireLocalGenerations: vi.fn(),
    } as unknown as Pick<
      DevotionalWorkspaceRepository,
      "reconcile" | "search" | "retireLocalGenerations"
    >
    const runtime = createDevotionalDataPlaneRuntime({
      workspaceRuntime: {
        filesystem: { writeFile: vi.fn(async () => undefined) },
      } as unknown as DevotionalWorkspaceRuntime,
      database: databaseFixture([]),
      catalog: {
        retireBefore: vi.fn(async () => []),
      } as unknown as PostgresCatalogStore,
      repository,
      attempts: {} as DevotionalAttemptStore,
      usedClips: {} as UsedClipsStore,
      assertReady: async () => {},
    })

    const result = await runtime.reconcileAttempt({ query: "hope" })
    expect(result.selectedSources.length).toBeLessThanOrEqual(500)
    expect(
      result.selectedSources.filter(
        (source) => source.category === "reflections",
      ),
    ).toHaveLength(100)
  })

  it("uses one transaction-scoped Postgres advisory lock", async () => {
    const events: string[] = []
    await withDevotionalReconciliationLease(
      databaseFixture(events),
      async () => {
        events.push("work")
      },
    )
    expect(events).toEqual(["lease", "work"])
  })
})
