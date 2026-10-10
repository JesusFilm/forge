import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  DEFAULT_MOCK_CMS_SEED,
  cloneMockCmsSeed,
  hashMockPassword,
} from "./mock-seed"
import { createMockCmsStore } from "./mock-store"

async function createTempStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "manager-mock-store-"))
  return join(directory, "store.json")
}

async function cleanupTempStorePath(dataPath: string) {
  await rm(join(dataPath, ".."), { recursive: true, force: true })
}

describe("mock cms store", () => {
  it("hydrates from seed and protects callers with cloned state", async () => {
    const dataPath = await createTempStorePath()

    try {
      const store = createMockCmsStore({ dataPath })
      const initial = await store.readState()
      initial.users[0]!.email = "changed@forge.test"

      const reread = await store.readState()
      expect(reread.users[0]!.email).toBe(DEFAULT_MOCK_CMS_SEED.users[0]!.email)
    } finally {
      await cleanupTempStorePath(dataPath)
    }
  })

  it("persists updates to disk and can be reloaded by a fresh store", async () => {
    const dataPath = await createTempStorePath()

    try {
      const store = createMockCmsStore({ dataPath })
      await store.updateState((current) => ({
        ...current,
        users: [
          ...current.users,
          {
            id: 2,
            username: "backup-manager",
            email: "backup@forge.test",
            passwordHash: hashMockPassword("backup-password"),
            role: {
              name: "Manager",
              type: "manager",
            },
          },
        ],
      }))

      const reloaded = createMockCmsStore({ dataPath })
      const user = await reloaded.findUserByEmail("backup@forge.test")
      expect(user?.username).toBe("backup-manager")
    } finally {
      await cleanupTempStorePath(dataPath)
    }
  })

  it("resets back to the provided seed", async () => {
    const dataPath = await createTempStorePath()
    const seed = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    seed.users[0]!.email = "seeded@forge.test"

    try {
      const store = createMockCmsStore({ dataPath, seed })
      await store.updateState((current) => ({
        ...current,
        users: [
          {
            ...current.users[0]!,
            email: "mutated@forge.test",
          },
        ],
      }))

      const reset = await store.reset()
      expect(reset.users[0]!.email).toBe("seeded@forge.test")
    } finally {
      await cleanupTempStorePath(dataPath)
    }
  })
})
