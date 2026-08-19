/**
 * The provider's variant gate: no variant surfaces before the default dub
 * resolves for THIS video. A 0-index default exposed `dubs[0]` for the window
 * between the video publish and the reconciler effect — for a multi-dub video
 * (considering-christmas carries Thai first) that published the WRONG
 * language's stream: an audible flash on a fresh visit, and a restart on an
 * expand, because the transient reads as a dub switch and defeats R4 adoption.
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})

jest.mock("@apollo/client/react", () => ({
  useApolloClient: () => ({ query: jest.fn() }),
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Driveable preferences: `state` is mutated by tests; the provider reads it on
// each render, so a flip lands with the next act that re-renders it.
jest.mock("../WatchPreferencesProvider", () => {
  const state = { ready: true, audio: "english" as string | null }
  return {
    useWatchPreferences: () => ({
      audioLanguageSlug: state.audio,
      subtitleLanguageSlug: null,
      subtitleLanguageName: null,
      subtitlesEnabled: false,
      isReady: state.ready,
      setPreferredAudioLanguage: jest.fn(),
      setPreferredSubtitleLanguage: jest.fn(),
      setPreferredSubtitleName: jest.fn(),
      setSubtitlesEnabled: jest.fn(),
    }),
    __prefState: state,
  }
})

import { act } from "react"

import { WatchSessionProvider, useWatchSession } from "../WatchSessionProvider"
import type { WatchVariant, WatchVideoRecord } from "../../lib/normalizeVideo"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const prefs = jest.requireMock("../WatchPreferencesProvider") as {
  __prefState: { ready: boolean; audio: string | null }
}

function variant(languageSlug: string, id: string): WatchVariant {
  return {
    documentId: id,
    slug: `considering-christmas/${languageSlug}`,
    published: true,
    hls: `https://stream.mux.com/${id}.m3u8`,
    duration: 120,
    languageCoreId: null,
    languageBcp47: languageSlug === "english" ? "en" : null,
    languageSlug,
    languageName: languageSlug,
    languageNameNative: null,
    muxPlaybackId: id,
  }
}

function record(
  documentId: string,
  variants: WatchVariant[],
): WatchVideoRecord {
  return {
    documentId,
    slug: "considering-christmas",
    label: "SHORT_FILM",
    title: "Considering Christmas",
    description: null,
    snippet: null,
    posterUrl: null,
    // The record-level fallback IS the first dub — the wrong-language hazard.
    streamingUrl: variants[0]?.hls ?? null,
    muxPlaybackId: null,
    duration: null,
    primaryLanguageBcp47: "en",
    parentSeries: null,
    siblings: [],
    variants,
    studyQuestions: [],
    bibleCitations: [],
    episodes: [],
    languages: [],
  }
}

// Thai FIRST — the shape that made `dubs[0]` the wrong language.
const MULTI_DUB = [variant("thai", "dubThai"), variant("english", "dubEnglish")]

type Session = ReturnType<typeof useWatchSession>

let session!: Session
// Every render's surfaced dub, in order — the transient the gate exists to
// kill is a single RENDER, which post-act assertions alone cannot see.
let variantHistory: Array<string | null> = []
function Probe() {
  session = useWatchSession()
  variantHistory.push(session.activeVariant?.languageSlug ?? null)
  return null
}

let mounted: TestInstance | null = null

async function renderProvider() {
  await act(async () => {
    mounted = TestRenderer.create(
      <WatchSessionProvider>
        <Probe />
      </WatchSessionProvider>,
    )
  })
}

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  variantHistory = []
  prefs.__prefState.ready = true
  prefs.__prefState.audio = "english"
})

describe("the variant gate (no dub before resolution)", () => {
  it("never surfaces the first dub on any render before resolution", async () => {
    // The live defect: for one render between the video publish and the
    // reconciler effect, `dubs[0]` (Thai) stood in as the active variant, the
    // route published its stream, and the host swapped to it — an audible
    // wrong-language flash on a fresh visit, and a restart on an expand.
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(session.activeVariant?.languageSlug).toBe("english")
    // The transient is a RENDER, so the per-render history is the assertion.
    expect(variantHistory).not.toContain("thai")
  })

  it("surfaces no variant while preferences are hydrating, then the preferred dub", async () => {
    prefs.__prefState.ready = false
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    // Unresolved: `dubs[0]` (Thai) must NOT stand in for the selection.
    expect(session.video?.documentId).toBe("video-cc")
    expect(session.activeVariant).toBeNull()

    // Preferences hydrate; the partial->full republish re-renders the provider.
    prefs.__prefState.ready = true
    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(session.activeVariant?.languageSlug).toBe("english")
  })

  it("never leaks the previous video's pick into the next video", async () => {
    await renderProvider()
    await act(async () => {
      session.setVideo(record("video-a", MULTI_DUB))
    })
    expect(session.activeVariant?.languageSlug).toBe("english")

    // An explicit pick on video A (index 0 = Thai).
    await act(async () => {
      session.setActiveVariantIndex(0)
    })
    expect(session.activeVariant?.languageSlug).toBe("thai")

    // Video B lands while its resolution cannot run yet: the stale index (or a
    // clamp of it) must not surface B's first dub.
    prefs.__prefState.ready = false
    await act(async () => {
      session.setVideo(record("video-b", [variant("korean", "dubKorean")]))
    })

    expect(session.activeVariant).toBeNull()
  })

  it("surfaces an explicit pick immediately", async () => {
    await renderProvider()
    await act(async () => {
      session.setVideo(record("video-a", MULTI_DUB))
    })

    await act(async () => {
      session.setActiveVariantIndex(0)
    })

    expect(session.activeVariant?.languageSlug).toBe("thai")
    expect(session.activeVariantIndex).toBe(0)
  })
})
