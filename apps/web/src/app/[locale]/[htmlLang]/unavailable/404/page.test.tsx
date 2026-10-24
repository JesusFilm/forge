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

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}))

vi.mock("next-intl/server", () => ({
  getTranslations: getTranslationsMock,
  setRequestLocale: setRequestLocaleMock,
}))

import WatchUnavailableSentinel, { generateMetadata } from "./page"

beforeEach(() => {
  notFoundMock.mockClear()
  getTranslationsMock.mockReset()
  setRequestLocaleMock.mockClear()
})

describe("Watch unavailable sentinel", () => {
  it("sets the route locale before entering the not-found boundary", async () => {
    const renderSentinel = WatchUnavailableSentinel as unknown as (props: {
      params: Promise<{ locale: string }>
    }) => Promise<never>

    let thrown: unknown
    try {
      await renderSentinel({ params: Promise.resolve({ locale: "ar" }) })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual(new Error("NEXT_HTTP_ERROR_FALLBACK;404"))

    expect(setRequestLocaleMock).toHaveBeenCalledWith("ar")
    expect(setRequestLocaleMock.mock.invocationCallOrder[0]).toBeLessThan(
      notFoundMock.mock.invocationCallOrder[0]!,
    )
  })

  it("keeps the specialized recovery response out of search indexes", async () => {
    getTranslationsMock.mockResolvedValue((key: string) =>
      key === "metadataTitle" ? "Language version unavailable" : key,
    )

    await expect(
      generateMetadata({ params: Promise.resolve({ locale: "zh-Hans" }) }),
    ).resolves.toEqual({
      title: "Language version unavailable",
      robots: { index: false, follow: false },
    })
    expect(getTranslationsMock).toHaveBeenCalledWith({
      locale: "zh-Hans",
      namespace: "WatchUnavailableLanguage",
    })
  })
})
