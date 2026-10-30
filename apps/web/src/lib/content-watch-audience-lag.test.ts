import { afterEach, describe, expect, it, vi } from "vitest"
import { print, type DocumentNode } from "graphql"

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  }
})

vi.mock("@/lib/admin-client", () => ({ default: { query: queryMock } }))

const validation = (message: string) => ({
  message,
  extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
})
const audienceLag = validation('Unknown type "WatchAudienceBlock".')
const copyLag = ["eyebrow", "title", "description", "ctaLabel"].map((field) =>
  validation(
    `Cannot query field "${field}" on type "WatchHomeCategoryRailBlock".`,
  ),
)
const homepage = (blocks: unknown[] = []) => ({
  data: {
    watchSetting: {
      documentId: "watch-settings-1",
      homepageExperience: {
        __typename: "ExperienceLocale",
        id: "exp-home-1",
        slug: "home",
        title: "Home",
        blocks,
      },
      defaultTemplateExperience: null,
    },
  },
})
const queryOf = (call: number): string =>
  print(queryMock.mock.calls[call][0].query as DocumentNode)

afterEach(() => {
  queryMock.mockReset()
  vi.resetModules()
})

describe("Admin that predates the WatchAudienceBlock union member", () => {
  it("retries the same selection without the block, keeping the rail copy", async () => {
    queryMock
      .mockResolvedValueOnce({ errors: [audienceLag] })
      .mockResolvedValueOnce(homepage([{ __typename: "WatchHomeHeroBlock" }]))
    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en")

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryOf(0)).toContain("... on WatchAudienceBlock")
    const retry = queryOf(1)
    expect(retry).not.toContain("WatchAudience")
    // Only the block was dropped: the rail and its authored copy survive.
    expect(retry).toContain("... on WatchHomeCategoryRailBlock")
    expect(retry).toContain("ctaLabel")
    expect(result).toMatchObject({
      error: null,
      data: {
        kind: "experience",
        watchHomeCategoryRailCompatibility: "supported",
      },
    })
  })

  it("recognises the lag when the client throws it", async () => {
    queryMock
      .mockRejectedValueOnce(
        Object.assign(new Error('Unknown type "WatchAudienceBlock".'), {
          errors: [audienceLag],
        }),
      )
      .mockResolvedValueOnce(homepage())
    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en")
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryOf(1)).not.toContain("WatchAudience")
    expect(result.error).toBeNull()
  })

  it("defers to the existing copy tier when the rail copy lags too", async () => {
    queryMock
      .mockResolvedValueOnce({ errors: [audienceLag, ...copyLag] })
      .mockResolvedValueOnce(homepage())
    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en")
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryOf(1)).toContain("AdminPreCopyWatchHomeCategoryRail")
    expect(queryOf(1)).not.toContain("WatchAudience")
    expect(result.error).toBeNull()
  })

  it("defers to the legacy tier when the rail itself is missing too", async () => {
    queryMock
      .mockResolvedValueOnce({
        errors: [
          audienceLag,
          validation('Unknown type "WatchHomeCategoryRailBlock".'),
        ],
      })
      .mockResolvedValueOnce(homepage())
    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en")
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryOf(1)).not.toContain("WatchHomeCategoryRailBlock")
    expect(result).toMatchObject({
      data: { watchHomeCategoryRailCompatibility: "legacy-schema" },
    })
  })

  it("does not hide an unrelated error mixed with the lag", async () => {
    queryMock.mockResolvedValueOnce({
      errors: [
        audienceLag,
        { message: "Database unavailable", path: ["watchSetting"] },
      ],
    })
    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en")
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(result.data).toBeNull()
    expect(result.error?.message).toContain("Database unavailable")
  })

  it("does not treat an execution error that quotes the message as lag", async () => {
    queryMock.mockResolvedValueOnce({
      errors: [
        {
          message: 'Unknown type "WatchAudienceBlock".',
          path: ["watchSetting"],
        },
      ],
    })
    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en")
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(result.error).not.toBeNull()
  })

  it("retries once at most", async () => {
    queryMock
      .mockResolvedValueOnce({ errors: [audienceLag] })
      .mockResolvedValueOnce({ errors: [validation("Retry also failed")] })
    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en")
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(result.error?.message).toBe("Retry also failed")
  })

  it("applies the same compatibility selection to a curated Experience lookup", async () => {
    queryMock
      .mockResolvedValueOnce({ errors: [audienceLag] })
      .mockResolvedValueOnce({
        data: {
          experienceBySlug: {
            __typename: "ExperienceLocale",
            id: "exp-1",
            slug: "christmas",
            title: "Christmas",
            blocks: [],
          },
        },
      })
    const { resolveWatchExperiencePage } = await import("./content")
    const result = await resolveWatchExperiencePage("en", "christmas")
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryOf(0)).toContain("... on WatchAudienceBlock")
    expect(queryOf(1)).not.toContain("WatchAudience")
    expect(queryOf(1)).toContain("experienceBySlug")
    expect(result).toMatchObject({
      error: null,
      data: { experience: { slug: "christmas" } },
    })
  })

  it("leaves a current Admin on the single full-selection query", async () => {
    queryMock.mockResolvedValueOnce(homepage())
    const { resolveWatchPage } = await import("./content")
    await resolveWatchPage("en")
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryOf(0)).toContain("... on WatchAudienceBlock")
  })
})
