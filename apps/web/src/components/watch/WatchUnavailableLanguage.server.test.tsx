import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { getLocaleMock, getMessagesMock, headersMock, resolveRecoveryMock } =
  vi.hoisted(() => ({
    getLocaleMock: vi.fn(),
    getMessagesMock: vi.fn(),
    headersMock: vi.fn(),
    resolveRecoveryMock: vi.fn(),
  }))

vi.mock("next/headers", () => ({ headers: headersMock }))
vi.mock("next-intl/server", () => ({
  getLocale: getLocaleMock,
  getMessages: getMessagesMock,
}))
vi.mock("@/lib/watch-unavailable-recovery-actions", () => ({
  EMPTY_WATCH_UNAVAILABLE_RECOVERY: {
    verifiedGap: false,
    contentTitle: null,
    targetImageUrl: null,
    audioOptions: [],
  },
  resolveWatchUnavailableRecovery: resolveRecoveryMock,
}))
import { WatchUnavailableLanguage } from "./WatchUnavailableLanguage"

type ClientProps = {
  parsed: {
    contentSlug: string
    requestedLanguageSlug: string
  } | null
  initialResolution: {
    verifiedGap: boolean
    contentTitle: string | null
    targetImageUrl: string | null
    audioOptions: unknown[]
  }
}

function clientProps(tree: ReactElement): ClientProps {
  return (tree.props as { children: ReactElement<ClientProps> }).children.props
}

beforeEach(() => {
  getLocaleMock.mockResolvedValue("zh-Hans")
  getMessagesMock.mockResolvedValue({
    WatchUnavailableLanguage: { eyebrow: "暂无此语言版本" },
    LanguageCombobox: { selectLanguage: "选择语言" },
  })
})

afterEach(() => {
  getLocaleMock.mockReset()
  getMessagesMock.mockReset()
  headersMock.mockReset()
  resolveRecoveryMock.mockReset()
  vi.restoreAllMocks()
})

describe("WatchUnavailableLanguage", () => {
  it("resolves the verified public path before rendering the client boundary", async () => {
    headersMock.mockResolvedValue(
      new Headers([
        [
          "x-forge-watch-internal-rewrite",
          "/good-friday-live.html/chinese-simplified.html",
        ],
      ]),
    )
    const resolution = {
      verifiedGap: true,
      contentTitle: "耶稣受难日直播",
      targetImageUrl: "https://example.com/good-friday-live.jpg",
      audioOptions: [{ slug: "english" }],
    }
    resolveRecoveryMock.mockResolvedValue(resolution)

    const tree = (await WatchUnavailableLanguage()) as ReactElement

    expect(clientProps(tree)).toEqual({
      parsed: {
        contentSlug: "good-friday-live",
        requestedLanguageSlug: "chinese-simplified",
      },
      initialResolution: resolution,
    })
    expect(resolveRecoveryMock).toHaveBeenCalledWith({
      contentSlug: "good-friday-live",
      requestedLanguageSlug: "chinese-simplified",
    })
    expect(getMessagesMock).toHaveBeenCalledWith({ locale: "zh-Hans" })
  })

  it("renders one stable fallback when server recovery resolution fails", async () => {
    headersMock.mockResolvedValue(
      new Headers([
        [
          "x-forge-watch-internal-rewrite",
          "/good-friday-live.html/chinese-simplified.html",
        ],
      ]),
    )
    resolveRecoveryMock.mockRejectedValue(new Error("manifest unavailable"))
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const tree = (await WatchUnavailableLanguage()) as ReactElement

    expect(clientProps(tree).initialResolution).toEqual({
      verifiedGap: false,
      contentTitle: null,
      targetImageUrl: null,
      audioOptions: [],
    })
  })

  it("does not resolve data for an invalid internal claim", async () => {
    headersMock.mockResolvedValue(
      new Headers([["x-forge-watch-internal-rewrite", "/404"]]),
    )

    const tree = (await WatchUnavailableLanguage()) as ReactElement

    expect(clientProps(tree).parsed).toBeNull()
    expect(resolveRecoveryMock).not.toHaveBeenCalled()
  })
})
