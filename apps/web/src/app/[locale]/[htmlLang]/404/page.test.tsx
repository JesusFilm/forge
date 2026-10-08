import { beforeEach, describe, expect, it, vi } from "vitest"

const { getTranslationsMock, notFoundMock, setRequestLocaleMock } = vi.hoisted(
  () => ({
    getTranslationsMock: vi.fn(),
    notFoundMock: vi.fn(() => {
      throw new Error("NEXT_HTTP_ERROR_FALLBACK;404")
    }),
    setRequestLocaleMock: vi.fn(),
  }),
)

vi.mock("next/navigation", () => ({ notFound: notFoundMock }))
vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
  setRequestLocale: setRequestLocaleMock,
}))

import WatchNotFoundSentinel, { dynamic, generateMetadata } from "./page"
import WatchOrdinaryNotFound from "./not-found"
import { generateMetadata as generateNotFoundMetadata } from "./layout"
import { WatchNotFound } from "@/components/WatchNotFound"

beforeEach(() => {
  notFoundMock.mockClear()
  getTranslationsMock.mockReset()
  setRequestLocaleMock.mockClear()
})

describe("ordinary Watch not-found sentinel", () => {
  it("uses the Watch-native component as the local not-found boundary", () => {
    expect(WatchOrdinaryNotFound().type).toBe(WatchNotFound)
  })

  it("is dynamic and establishes the chrome locale before entering its boundary", async () => {
    expect(dynamic).toBe("force-dynamic")

    const renderSentinel = WatchNotFoundSentinel as unknown as (props: {
      params: Promise<{ locale: string }>
    }) => Promise<never>
    await expect(
      renderSentinel({ params: Promise.resolve({ locale: "es" }) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404")

    expect(setRequestLocaleMock).toHaveBeenCalledWith("es")
    expect(setRequestLocaleMock.mock.invocationCallOrder[0]).toBeLessThan(
      notFoundMock.mock.invocationCallOrder[0]!,
    )
  })

  it("keeps the rendered sentinel out of search indexes", async () => {
    getTranslationsMock.mockResolvedValue((key: string) =>
      key === "metadataTitle" ? "Page not found" : key,
    )

    await expect(
      generateMetadata({ params: Promise.resolve({ locale: "es" }) }),
    ).resolves.toEqual({
      title: "Page not found",
      robots: { index: false, follow: false },
    })
  })

  it("provides localized noindex metadata from the route layout", async () => {
    getTranslationsMock.mockResolvedValue((key: string) =>
      key === "metadataTitle" ? "Página no encontrada" : key,
    )

    await expect(
      generateNotFoundMetadata({ params: Promise.resolve({ locale: "es" }) }),
    ).resolves.toEqual({
      title: "Página no encontrada",
      robots: { index: false, follow: false },
    })
  })
})
