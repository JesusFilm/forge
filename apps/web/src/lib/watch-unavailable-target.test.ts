import { beforeEach, describe, expect, it, vi } from "vitest"
import { print } from "graphql"

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))
vi.mock("@/lib/admin-client", () => ({ default: { query: queryMock } }))
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }))

const snapshot = {
  documentId: "jesus",
  slug: "jesus",
  label: "FEATURE_FILM",
  images: [],
  parents: [],
  children: [],
  bibleCitations: [],
  exactLocales: [
    {
      documentId: "copy-fr",
      locale: "fr",
      languageSlug: "french-african",
      title: "JESUS",
    },
  ],
  broadLocales: [],
  englishLocales: [],
  exactStudyQuestions: [],
  broadStudyQuestions: [],
  englishStudyQuestions: [],
  preferredVariant: null,
  requestedLanguage: {
    slug: "french-african",
    name: { en: "French, African" },
    bcp47: "fra",
  },
}

beforeEach(() => {
  vi.resetModules()
  queryMock.mockReset()
})

describe("unavailable target requested language and schema lag", () => {
  it("projects the exact catalog record with no second request", async () => {
    queryMock.mockResolvedValue({
      data: { watchVideoRouteSnapshotBySlug: snapshot },
    })
    const { resolveWatchUnavailableRecoveryTarget } = await import("./content")
    const result = await resolveWatchUnavailableRecoveryTarget(
      "jesus",
      "french-african",
    )
    expect(result?.requestedLanguage).toEqual({
      publicSlug: "french-african",
      englishName: "French, African",
      nativeName: null,
      bcp47: "fra",
      regionNames: [],
    })
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0]?.[0].variables.languageSlug).toBe(
      "french-african",
    )
  })

  it("keeps the existing provider-English fallback for plain French", async () => {
    queryMock.mockResolvedValue({
      data: {
        watchVideoRouteSnapshotBySlug: {
          ...snapshot,
          requestedLanguage: {
            slug: "french",
            name: { en: "French", fr: "Français" },
            bcp47: "fr",
          },
        },
      },
    })
    const { resolveWatchUnavailableRecoveryTarget } = await import("./content")
    const target = await resolveWatchUnavailableRecoveryTarget(
      "jesus",
      "french",
    )
    expect(target?.requestedLanguage).toMatchObject({
      englishName: "French",
      nativeName: null,
    })
    const { localizedSearchLanguageName } =
      await import("./search-language-display-name")
    expect(
      localizedSearchLanguageName(
        target?.requestedLanguage,
        "ht",
        "French",
        "catalog-identity",
      ),
    ).toBe("French")
  })

  it("ignores a fallback language identity", async () => {
    queryMock.mockResolvedValue({
      data: {
        watchVideoRouteSnapshotBySlug: {
          ...snapshot,
          requestedLanguage: {
            slug: "english",
            name: { en: "English" },
            bcp47: "en",
          },
        },
      },
    })
    const { resolveWatchUnavailableRecoveryTarget } = await import("./content")
    expect(
      (await resolveWatchUnavailableRecoveryTarget("jesus", "french-african"))
        ?.requestedLanguage,
    ).toBeNull()
  })

  it("retries only the additive-field validation failure and cools down probes", async () => {
    const legacySnapshot = { ...snapshot, requestedLanguage: undefined }
    queryMock
      .mockResolvedValueOnce({
        errors: [
          {
            message:
              'Cannot query field "requestedLanguage" on type "WatchRouteSnapshot".',
            extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
          },
        ],
      })
      .mockResolvedValue({
        data: { watchVideoRouteSnapshotBySlug: legacySnapshot },
      })
    const { resolveWatchUnavailableRecoveryTarget } = await import("./content")
    expect(
      (await resolveWatchUnavailableRecoveryTarget("jesus", "french-african"))
        ?.requestedLanguage,
    ).toBeNull()
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(print(queryMock.mock.calls[0]?.[0].query)).toContain(
      "requestedLanguage",
    )
    expect(print(queryMock.mock.calls[1]?.[0].query)).not.toContain(
      "requestedLanguage",
    )
    await resolveWatchUnavailableRecoveryTarget("jesus", "french-african")
    expect(queryMock).toHaveBeenCalledTimes(3)
    expect(print(queryMock.mock.calls[2]?.[0].query)).not.toContain(
      "requestedLanguage",
    )
  })

  it("handles a thrown Apollo validation error and probes again after cooldown", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000)
    try {
      queryMock
        .mockRejectedValueOnce({
          errors: [
            {
              message:
                'Cannot query field "requestedLanguage" on type "WatchRouteSnapshot".',
            },
          ],
        })
        .mockResolvedValue({
          data: { watchVideoRouteSnapshotBySlug: snapshot },
        })
      const { resolveWatchUnavailableRecoveryTarget } =
        await import("./content")
      await resolveWatchUnavailableRecoveryTarget("jesus", "french-african")
      expect(queryMock).toHaveBeenCalledTimes(2)
      expect(print(queryMock.mock.calls[1]?.[0].query)).not.toContain(
        "requestedLanguage",
      )
      now.mockReturnValue(160_001)
      await resolveWatchUnavailableRecoveryTarget("jesus", "french-african")
      expect(print(queryMock.mock.calls[2]?.[0].query)).toContain(
        "requestedLanguage",
      )
    } finally {
      now.mockRestore()
    }
  })

  it("does not hide a mixed schema-validation and server failure", async () => {
    queryMock.mockResolvedValue({
      errors: [
        {
          message:
            'Cannot query field "requestedLanguage" on type "WatchRouteSnapshot".',
        },
        {
          message: "Database unavailable",
          path: ["watchVideoRouteSnapshotBySlug"],
        },
      ],
    })
    const { resolveWatchUnavailableRecoveryTarget } = await import("./content")
    await expect(
      resolveWatchUnavailableRecoveryTarget("jesus", "french-african"),
    ).rejects.toThrow("Database unavailable")
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it("does not retry unrelated server or validation errors", async () => {
    queryMock.mockResolvedValue({
      errors: [
        {
          message: "Database unavailable",
          path: ["watchVideoRouteSnapshotBySlug"],
        },
      ],
    })
    const { resolveWatchUnavailableRecoveryTarget } = await import("./content")
    await expect(
      resolveWatchUnavailableRecoveryTarget("jesus", "french-african"),
    ).rejects.toThrow("Database unavailable")
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
