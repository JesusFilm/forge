import type { ReactElement } from "react"
import { Platform } from "react-native"
import { useWatchSession } from "../../contexts/WatchSessionProvider"
import type { WatchVideoRecord, WatchVariant } from "../../lib/normalizeVideo"
import { NativeDetailsTrackPanel } from "./NativeDetailsTrackPanel"
import type { NativeTrackChoiceProps } from "./NativeTrackChoice"
import { LanguagePanel } from "./LanguagePanel"
import { SubtitlePanel } from "./SubtitlePanel"

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useMemo: (calculate: () => unknown) => calculate(),
}))
jest.mock("../../contexts/WatchSessionProvider", () => ({
  useWatchSession: jest.fn(),
}))
jest.mock("./NativeTrackChoice", () => ({ NativeTrackChoice: () => null }))
jest.mock("../TVFocusGuideView", () => ({ TVFocusGuideView: () => null }))
jest.mock("./WatchOptionRow", () => ({ WatchOptionRow: () => null }))

function variant(id: string, hls: string | null): WatchVariant {
  return {
    documentId: id,
    slug: id,
    published: true,
    hls,
    duration: 120,
    languageCoreId: id,
    languageBcp47: id,
    languageSlug: id,
    languageName: id === "th" ? "Thai" : "English",
    languageNameNative: id === "th" ? "ภาษาไทย" : "English",
    muxPlaybackId: null,
  }
}

function setup() {
  const variants = [
    variant("th", "https://stream.mux.com/thai.m3u8"),
    variant("en", "https://stream.mux.com/english.m3u8"),
    variant("unavailable", null),
  ]
  const video: WatchVideoRecord = {
    documentId: "video",
    slug: "video",
    label: "featureFilm",
    title: "Film",
    description: null,
    snippet: null,
    posterUrl: null,
    streamingUrl: null,
    muxPlaybackId: null,
    duration: 120,
    primaryLanguageBcp47: "en",
    siblings: [],
    upNext: null,
    chapters: [],
    variants,
    studyQuestions: [],
    bibleCitations: [],
  }
  const session: ReturnType<typeof useWatchSession> = {
    video,
    setVideo: jest.fn(),
    recommendationAttribution: undefined,
    playbackEntry: undefined,
    activeVariant: variants[1],
    activeVariantIndex: 1,
    setActiveVariantIndex: jest.fn(),
    subtitleEnabled: false,
    setSubtitleEnabled: jest.fn(),
    activeSubtitleSlug: null,
    setActiveSubtitleSlug: jest.fn(),
    activeVariantMedia: null,
    activeVariantMediaLoading: false,
    activeVariantMediaError: false,
    activeVariantMediaState: {
      loading: false,
      error: false,
      media: {
        downloads: [],
        subtitles: [
          {
            documentId: "subtitle-th",
            languageSlug: "thai",
            languageName: "Thai",
            languageNameNative: "ภาษาไทย",
            languageBcp47: "th",
            vttSrc: "https://example.test/th.vtt",
            primary: false,
            aiGenerated: false,
          },
        ],
      },
    },
    ensureActiveVariantMedia: jest.fn(),
  }
  jest.mocked(useWatchSession).mockReturnValue(session)
  const onClose = jest.fn()
  const onRetry = jest.fn()
  const render = (
    kind: "audio" | "subtitles" = "audio",
    dataState: "ready" | "loading" | "error" = "ready",
  ) => {
    const element = NativeDetailsTrackPanel({
      kind,
      dataState,
      onClose,
      onRetry,
    }) as ReactElement<NativeTrackChoiceProps & { nativeModuleName: string }>
    return element.props
  }
  return { session, onClose, onRetry, render }
}

afterEach(() => jest.restoreAllMocks())

it.each(["ios", "android"] as const)(
  "routes %s to its native module without changing the option identity",
  (platform) => {
    jest.replaceProperty(Platform, "OS", platform)
    const test = setup()
    const props = test.render()
    expect(props.nativeModuleName).toBe(
      platform === "ios" ? "NativeSwiftPlayer" : "NativeAndroidPlayer",
    )
    expect(props.selected).toBe("en")
    expect(props.options[0]).toMatchObject({
      id: "th",
      detail: "ภาษาไทย",
      searchText: "th th",
    })
    expect(props.options[2].disabled).toBe(true)
    props.onSelect("th")
    expect(test.session.setActiveVariantIndex).toHaveBeenCalledWith(0)
    expect(test.session.setSubtitleEnabled).not.toHaveBeenCalled()
    expect(test.onClose).toHaveBeenCalledTimes(1)
  },
)

it.each([LanguagePanel, SubtitlePanel])(
  "opens the Apple detail picker only while visible",
  (Panel) => {
    jest.replaceProperty(Platform, "OS", "ios")
    const onClose = jest.fn()
    expect(Panel({ visible: false, onClose })).toBeNull()
    const element = Panel({ visible: true, onClose }) as ReactElement
    expect(element.type).toBe(NativeDetailsTrackPanel)
  },
)

it("keeps subtitle Off available and only changes subtitle state", () => {
  const test = setup()
  const props = test.render("subtitles")
  expect(props.options[0]).toEqual({
    id: "__off__",
    label: "Subtitles Off",
    pinned: true,
  })
  expect(props.selected).toBe("__off__")
  props.onSelect("thai")
  expect(test.session.setActiveSubtitleSlug).toHaveBeenCalledWith("thai")
  expect(test.session.setSubtitleEnabled).toHaveBeenCalledWith(true)
  expect(test.session.setActiveVariantIndex).not.toHaveBeenCalled()
})

it("turns subtitles off without selecting another audio language", () => {
  const test = setup()
  test.session.subtitleEnabled = true
  test.session.activeSubtitleSlug = "thai"
  const props = test.render("subtitles")
  expect(props.selected).toBe("thai")
  props.onSelect("__off__")
  expect(test.session.setSubtitleEnabled).toHaveBeenCalledWith(false)
  expect(test.session.setActiveSubtitleSlug).not.toHaveBeenCalled()
  expect(test.session.setActiveVariantIndex).not.toHaveBeenCalled()
})

it("shows loading instead of unfinished audio rows", () => {
  const test = setup()
  const props = test.render("audio", "loading")
  expect(props.status).toBe("Loading languages…")
  expect(props.options).toEqual([])
})

it("keeps Off and a pinned retry visible on subtitle failure and preserves the open query", () => {
  const test = setup()
  test.session.activeVariantMediaState = {
    loading: false,
    error: true,
    media: null,
  }
  const props = test.render("subtitles")
  expect(props.status).toBe("Couldn’t load languages")
  expect(props.options.map((row) => row.id)).toEqual(["__off__", "__retry__"])
  expect(props.options.every((row) => row.pinned)).toBe(true)
  expect(props.onSelect("__retry__")).toBe(false)
  expect(test.session.ensureActiveVariantMedia).toHaveBeenCalledTimes(1)
  expect(test.onClose).not.toHaveBeenCalled()
})

it("retries detail failure through the detail owner instead of the subtitle request", () => {
  const test = setup()
  const props = test.render("subtitles", "error")
  expect(props.onSelect("__retry__")).toBe(false)
  expect(test.onRetry).toHaveBeenCalledTimes(1)
  expect(test.session.ensureActiveVariantMedia).not.toHaveBeenCalled()
})

it("ignores a choice that is stale after the content changed", () => {
  const test = setup()
  test.render().onSelect("missing-dub")
  expect(test.session.setActiveVariantIndex).not.toHaveBeenCalled()
  expect(test.onClose).toHaveBeenCalledTimes(1)
})
