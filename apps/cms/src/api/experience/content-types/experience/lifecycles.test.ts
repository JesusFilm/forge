import { afterEach, describe, expect, it, vi } from "vitest"

import lifecycleHooks from "./lifecycles"

// Mock the embedder module before importing lifecycles
vi.mock("../../services/experience-embedder", () => ({
  indexExperience: vi.fn().mockResolvedValue(undefined),
  deleteExperienceEmbedding: vi.fn().mockResolvedValue(undefined),
}))

const EXPERIENCE_UID = "api::experience.experience"
const WATCH_SETTING_UID = "api::watch-setting.watch-setting"

function createStrapi({
  currentExperience = null,
  blockingWatchSettings = [],
}: {
  currentExperience?: {
    id: number
    documentId: string
    isTemplate: boolean
    blocks?: unknown[]
  } | null
  blockingWatchSettings?: unknown[]
} = {}) {
  const experienceFindOne = vi.fn(async () => currentExperience)
  const watchSettingFindMany = vi.fn(async () => blockingWatchSettings)

  const query = vi.fn((uid: string) => {
    if (uid === EXPERIENCE_UID) {
      return {
        findOne: experienceFindOne,
      }
    }

    if (uid === WATCH_SETTING_UID) {
      return {
        findMany: watchSettingFindMany,
      }
    }

    throw new Error(`Unexpected model query: ${uid}`)
  })

  return {
    db: {
      query,
      connection: {
        raw: vi.fn().mockResolvedValue(undefined),
      },
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }
}

function buildRouteBoundBlocks() {
  return [
    {
      __component: "sections.container",
      blocks: [
        {
          __component: "sections.video",
          useRouteVideo: true,
        },
        {
          __component: "sections.media-collection",
          itemsSource: "routeVideoChildren",
        },
      ],
    },
  ]
}

describe("experience lifecycles", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("rejects route-bound blocks when creating a non-template experience", () => {
    vi.stubGlobal("strapi", createStrapi())

    expect(() =>
      lifecycleHooks.beforeCreate({
        params: {
          data: {
            isTemplate: false,
            blocks: buildRouteBoundBlocks(),
          },
        },
      }),
    ).toThrow(
      "Route-bound video blocks require Experience.isTemplate to be enabled.",
    )
  })

  it("allows route-bound blocks when creating a template experience", () => {
    vi.stubGlobal("strapi", createStrapi())

    expect(() =>
      lifecycleHooks.beforeCreate({
        params: {
          data: {
            isTemplate: true,
            blocks: buildRouteBoundBlocks(),
          },
        },
      }),
    ).not.toThrow()
  })

  it("rejects route-bound blocks on update when the saved experience is not a template", async () => {
    const strapi = createStrapi({
      currentExperience: {
        id: 42,
        documentId: "experience-42",
        isTemplate: false,
      },
    })
    vi.stubGlobal("strapi", strapi)

    await expect(
      lifecycleHooks.beforeUpdate({
        params: {
          where: {
            documentId: "experience-42",
          },
          data: {
            blocks: buildRouteBoundBlocks(),
          },
        },
      }),
    ).rejects.toThrow(
      "Route-bound video blocks require Experience.isTemplate to be enabled.",
    )
  })

  it("rejects promoting a non-template experience that is selected as the homepage", async () => {
    const strapi = createStrapi({
      currentExperience: {
        id: 42,
        documentId: "experience-42",
        isTemplate: false,
      },
      blockingWatchSettings: [
        {
          id: 1,
          documentId: "watch-setting-1",
        },
      ],
    })
    vi.stubGlobal("strapi", strapi)

    await expect(
      lifecycleHooks.beforeUpdate({
        params: {
          where: {
            id: 42,
          },
          data: {
            isTemplate: true,
          },
        },
      }),
    ).rejects.toThrow(
      "Experience cannot be marked as template while it is selected as the homepage experience.",
    )
  })

  it("rejects demoting a template experience with saved route-bound blocks", async () => {
    const strapi = createStrapi({
      currentExperience: {
        id: 42,
        documentId: "experience-42",
        isTemplate: true,
        blocks: buildRouteBoundBlocks(),
      },
    })
    vi.stubGlobal("strapi", strapi)

    await expect(
      lifecycleHooks.beforeUpdate({
        params: {
          where: {
            id: 42,
          },
          data: {
            isTemplate: false,
          },
        },
      }),
    ).rejects.toThrow(
      "Route-bound video blocks require Experience.isTemplate to be enabled.",
    )
  })

  it("rejects demoting a template experience that is selected as the default template", async () => {
    const strapi = createStrapi({
      currentExperience: {
        id: 42,
        documentId: "experience-42",
        isTemplate: true,
      },
      blockingWatchSettings: [
        {
          id: 1,
          documentId: "watch-setting-1",
        },
      ],
    })
    vi.stubGlobal("strapi", strapi)

    await expect(
      lifecycleHooks.beforeUpdate({
        params: {
          where: {
            id: 42,
          },
          data: {
            isTemplate: false,
          },
        },
      }),
    ).rejects.toThrow(
      "Experience cannot be unmarked as template while it is selected as the default template experience.",
    )
  })
})

describe("experience embedding lifecycle hooks", () => {
  const originalKey = process.env.OPENROUTER_API_KEY

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    // Restore the API key after each test
    if (originalKey) {
      process.env.OPENROUTER_API_KEY = originalKey
    } else {
      process.env.OPENROUTER_API_KEY = "test-key"
    }
  })

  // Ensure API key is set for tests that expect embedding to fire
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-key"

  it("afterCreate triggers indexExperience for a published experience", async () => {
    const strapi = createStrapi()
    vi.stubGlobal("strapi", strapi)

    const { indexExperience } =
      await import("../../services/experience-embedder")

    lifecycleHooks.afterCreate({
      result: {
        id: 10,
        locale: "en",
        publishedAt: "2026-01-01T00:00:00Z",
      },
    })

    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 10))

    expect(indexExperience).toHaveBeenCalledWith(strapi, 10, "en")
  })

  it("afterCreate does not trigger for draft experiences", async () => {
    const strapi = createStrapi()
    vi.stubGlobal("strapi", strapi)

    const { indexExperience } =
      await import("../../services/experience-embedder")

    lifecycleHooks.afterCreate({
      result: {
        id: 10,
        locale: "en",
        publishedAt: null,
      },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(indexExperience).not.toHaveBeenCalled()
  })

  it("afterUpdate triggers indexExperience for a published experience", async () => {
    const strapi = createStrapi()
    vi.stubGlobal("strapi", strapi)

    const { indexExperience } =
      await import("../../services/experience-embedder")

    lifecycleHooks.afterUpdate({
      result: {
        id: 10,
        locale: "en",
        publishedAt: "2026-01-01T00:00:00Z",
      },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(indexExperience).toHaveBeenCalledWith(strapi, 10, "en")
  })

  it("afterUpdate triggers deleteExperienceEmbedding when unpublished", async () => {
    const strapi = createStrapi()
    vi.stubGlobal("strapi", strapi)

    const { deleteExperienceEmbedding } =
      await import("../../services/experience-embedder")

    lifecycleHooks.afterUpdate({
      result: {
        id: 10,
        locale: "en",
        publishedAt: null,
      },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(deleteExperienceEmbedding).toHaveBeenCalledWith(strapi, 10, "en")
  })

  it("afterCreate skips embedding when OPENROUTER_API_KEY is unset", async () => {
    const strapi = createStrapi()
    vi.stubGlobal("strapi", strapi)

    const originalKey = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY

    const { indexExperience } =
      await import("../../services/experience-embedder")

    lifecycleHooks.afterCreate({
      result: {
        id: 10,
        locale: "en",
        publishedAt: "2026-01-01T00:00:00Z",
      },
    })

    await new Promise((r) => setTimeout(r, 10))

    expect(indexExperience).not.toHaveBeenCalled()

    if (originalKey) process.env.OPENROUTER_API_KEY = originalKey
  })

  it("embedding failure does not propagate from afterCreate", async () => {
    const strapi = createStrapi()
    vi.stubGlobal("strapi", strapi)

    const embedder = await import("../../services/experience-embedder")
    vi.mocked(embedder.indexExperience).mockRejectedValue(
      new Error("OpenRouter down"),
    )

    // Should not throw
    lifecycleHooks.afterCreate({
      result: {
        id: 10,
        locale: "en",
        publishedAt: "2026-01-01T00:00:00Z",
      },
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(strapi.log.error).toHaveBeenCalledWith(
      expect.stringContaining("OpenRouter down"),
    )
  })
})
