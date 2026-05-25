import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  DEFAULT_MOCK_MANAGER_CREDENTIALS,
  DEFAULT_MOCK_CMS_SEED,
  cloneMockCmsSeed,
  hashMockPassword,
} from "./mock-seed"
import {
  createCmsGateway,
  getCmsGateway,
  readModeFromEnv,
  registerLiveCmsGatewayAuthHandlers,
  resetCmsGatewayForTests,
} from "./gateway"

async function createTempStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "manager-cms-gateway-"))
  return join(directory, "store.json")
}

async function cleanupTempStorePath(dataPath: string) {
  await rm(join(dataPath, ".."), { recursive: true, force: true })
}

afterEach(() => {
  delete process.env.MANAGER_DATA_MODE
  delete process.env.MANAGER_MOCK_SESSION_SECRET
  delete process.env.MANAGER_MOCK_DATA_PATH
  resetCmsGatewayForTests()
})

describe("cms gateway auth foundation", () => {
  it("logs in and verifies a mock manager session", async () => {
    const dataPath = await createTempStorePath()

    try {
      const gateway = createCmsGateway({
        mode: "mock",
        mockSecret: "test-secret",
        mockDataPath: dataPath,
      })

      const session = await gateway.loginManagerUser(
        DEFAULT_MOCK_MANAGER_CREDENTIALS.email,
        DEFAULT_MOCK_MANAGER_CREDENTIALS.password,
      )

      expect(session).toMatchObject({
        user: {
          email: DEFAULT_MOCK_MANAGER_CREDENTIALS.email,
          role: { name: "Manager" },
        },
      })

      const verifiedUser = await gateway.verifyManagerSession(session!.token)
      expect(verifiedUser).toEqual(session!.user)
    } finally {
      await cleanupTempStorePath(dataPath)
    }
  })

  it("rejects invalid mock credentials and tampered sessions", async () => {
    const dataPath = await createTempStorePath()

    try {
      const gateway = createCmsGateway({
        mode: "mock",
        mockSecret: "test-secret",
        mockDataPath: dataPath,
      })

      await expect(
        gateway.loginManagerUser(
          DEFAULT_MOCK_MANAGER_CREDENTIALS.email,
          "wrong-password",
        ),
      ).resolves.toBeNull()

      const session = await gateway.loginManagerUser(
        DEFAULT_MOCK_MANAGER_CREDENTIALS.email,
        DEFAULT_MOCK_MANAGER_CREDENTIALS.password,
      )

      const tamperedToken = `${session!.token.slice(0, -1)}x`
      await expect(
        gateway.verifyManagerSession(tamperedToken),
      ).resolves.toBeNull()
    } finally {
      await cleanupTempStorePath(dataPath)
    }
  })

  it("rejects non-manager users in mock mode", async () => {
    const dataPath = await createTempStorePath()
    const seed = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    seed.users = [
      {
        id: 2,
        username: "viewer",
        email: "viewer@forge.test",
        passwordHash: hashMockPassword("viewer-password"),
        role: {
          name: "Viewer",
          type: "viewer",
        },
      },
    ]

    try {
      const gateway = createCmsGateway({
        mode: "mock",
        mockSecret: "test-secret",
        mockDataPath: dataPath,
        mockSeed: seed,
      })

      await expect(
        gateway.loginManagerUser("viewer@forge.test", "viewer-password"),
      ).resolves.toBeNull()
    } finally {
      await cleanupTempStorePath(dataPath)
    }
  })

  it("provides a singleton getter that can boot in mock mode from env", async () => {
    const dataPath = await createTempStorePath()
    process.env.MANAGER_DATA_MODE = "mock"
    process.env.MANAGER_MOCK_SESSION_SECRET = "singleton-secret"
    process.env.MANAGER_MOCK_DATA_PATH = dataPath

    try {
      const first = getCmsGateway()
      const second = getCmsGateway()

      expect(first).toBe(second)
      expect(first.mode).toBe("mock")

      const session = await first.loginManagerUser(
        DEFAULT_MOCK_MANAGER_CREDENTIALS.email,
        DEFAULT_MOCK_MANAGER_CREDENTIALS.password,
      )

      expect(session?.user.email).toBe(DEFAULT_MOCK_MANAGER_CREDENTIALS.email)
    } finally {
      await cleanupTempStorePath(dataPath)
    }
  })

  it("allows live auth handlers to be registered for later Strapi wiring", async () => {
    registerLiveCmsGatewayAuthHandlers({
      async loginManagerUser(email) {
        return {
          token: "live-token",
          user: {
            id: 99,
            username: "live-manager",
            email,
            role: {
              name: "Manager",
              type: "manager",
            },
          },
        }
      },
      async verifyManagerSession() {
        return {
          id: 99,
          username: "live-manager",
          email: "live@forge.test",
          role: {
            name: "Manager",
            type: "manager",
          },
        }
      },
    })

    const gateway = createCmsGateway({ mode: "live" })

    await expect(
      gateway.loginManagerUser("live@forge.test", "ignored"),
    ).resolves.toMatchObject({
      token: "live-token",
      user: { email: "live@forge.test" },
    })
    await expect(
      gateway.verifyManagerSession("live-token"),
    ).resolves.toMatchObject({ email: "live@forge.test" })
  })

  it("normalizes env mode values", () => {
    expect(readModeFromEnv(undefined)).toBe("admin")
    expect(readModeFromEnv("live")).toBe("admin")
    expect(readModeFromEnv("mock")).toBe("mock")
    expect(readModeFromEnv("unexpected")).toBe("admin")
  })

  it("derives different mock video coverage for different selected languages", async () => {
    const dataPath = await createTempStorePath()

    try {
      const gateway = createCmsGateway({
        mode: "mock",
        mockSecret: "test-secret",
        mockDataPath: dataPath,
      })

      const englishCoverage = await gateway.getVideoCoverage(["529"])
      const frenchCoverage = await gateway.getVideoCoverage(["6414"])

      expect(englishCoverage).not.toEqual(frenchCoverage)
      expect(
        englishCoverage.find(
          (video) => video.documentId === "video-doc-episode-1",
        )?.coverage.subtitles,
      ).toEqual({ human: 1, ai: 0 })
      expect(
        frenchCoverage.find(
          (video) => video.documentId === "video-doc-episode-1",
        )?.coverage.subtitles,
      ).toEqual({ human: 0, ai: 1 })
      expect(
        englishCoverage.find(
          (video) => video.documentId === "video-doc-standalone-1",
        )?.aiMetadata,
      ).toBe(false)
      expect(
        frenchCoverage.find(
          (video) => video.documentId === "video-doc-standalone-1",
        )?.aiMetadata,
      ).toBe(false)
    } finally {
      await cleanupTempStorePath(dataPath)
    }
  })

  it("keeps the mock video list stable for unknown language ids", async () => {
    const dataPath = await createTempStorePath()

    try {
      const gateway = createCmsGateway({
        mode: "mock",
        mockSecret: "test-secret",
        mockDataPath: dataPath,
      })

      const coverage = await gateway.getVideoCoverage(["does-not-exist"])

      expect(coverage).toHaveLength(
        DEFAULT_MOCK_CMS_SEED.readModels.videoCoverage.length,
      )
      expect(
        coverage.every(
          (video) =>
            video.coverage.subtitles.human === 0 &&
            video.coverage.subtitles.ai === 0 &&
            video.coverage.audio.human === 0 &&
            video.coverage.audio.ai === 0,
        ),
      ).toBe(true)
    } finally {
      await cleanupTempStorePath(dataPath)
    }
  })
})
