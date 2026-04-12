import { afterEach, describe, expect, it, vi } from "vitest"

import lifecycleHooks from "./lifecycles"

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
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
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
