import { describe, expect, it, vi } from "vitest"

import type { UsedClipsStore } from "../used-clips-ledger"
import type { DevotionalWorkspaceRuntime } from "./config"
import type { DevotionalDatabase, QueryExecutor } from "./database"
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
    const repository = {
      reconcile: vi.fn(async () => {
        events.push("reconcile")
        return {
          generation: 7,
          inventoryDigest: "b".repeat(64),
          inventory: {
            discovered: 1,
            decodedTextBytes: 12,
            excluded: [],
            eligibleByCategory: {},
            eligible: [
              {
                path: "/inputs/scripture/john.md",
                category: "scripture" as const,
                digest: "a".repeat(64),
                size: 12,
                modifiedAt: "2026-07-31T12:00:00.000Z",
                title: "John",
                content: "Source body",
              },
            ],
          },
        }
      }),
    } as unknown as Pick<DevotionalWorkspaceRepository, "reconcile">
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

    await expect(runtime.reconcileAttempt()).resolves.toEqual({
      generation: 7,
      selectedSources: [
        {
          path: "/inputs/scripture/john.md",
          category: "scripture",
          digest: "a".repeat(64),
          size: 12,
          modifiedAt: "2026-07-31T12:00:00.000Z",
          title: "John",
        },
      ],
    })
    expect(events).toEqual(["lease", "ready", "reconcile", "retire"])
    expect(writeFile).toHaveBeenCalledTimes(2)
  })

  it("does not reconcile when fail-closed readiness rejects", async () => {
    const database = databaseFixture([])
    const repository = {
      reconcile: vi.fn(),
    } as unknown as Pick<DevotionalWorkspaceRepository, "reconcile">
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
