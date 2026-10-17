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

// Driveable: a test answers the per-dub media query to land its subtitles.
jest.mock("@apollo/client/react", () => {
  const client = { query: jest.fn() }
  return { useApolloClient: () => client, __client: client }
})
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
  const state = {
    ready: true,
    audio: "english" as string | null,
    audioIso3: null as string | null,
    subtitle: null as string | null,
    subtitleName: null as string | null,
    subtitleNameLocale: null as string | null,
    subtitlesEnabled: false,
    setAudio: jest.fn(),
    backfillAudioIso3: jest.fn(),
    setPreferredSubtitleLanguage: jest.fn(),
    setPreferredSubtitleName: jest.fn(),
    setSubtitlesEnabled: jest.fn(),
  }
  return {
    useWatchPreferences: () => ({
      audioLanguageSlug: state.audio,
      audioLanguageIso3: state.audioIso3,
      subtitleLanguageSlug: state.subtitle,
      subtitleLanguageName: state.subtitleName,
      subtitleLanguageNameLocale: state.subtitleNameLocale,
      subtitlesEnabled: state.subtitlesEnabled,
      isReady: state.ready,
      setPreferredAudioLanguage: state.setAudio,
      backfillAudioLanguageIso3: state.backfillAudioIso3,
      setPreferredSubtitleLanguage: state.setPreferredSubtitleLanguage,
      setPreferredSubtitleName: state.setPreferredSubtitleName,
      setSubtitlesEnabled: state.setSubtitlesEnabled,
    }),
    __prefState: state,
  }
})

// Driveable downloads store: a download is one dub, and the provider defaults
// to it over the preference, so the pill names the audio on disk.
jest.mock("../DownloadsProvider", () => {
  const state = {
    ready: true,
    copy: null as { path: string; dubDocumentId: string | null } | null,
  }
  return {
    useDownloads: () => ({
      isReady: state.ready,
      committedCopyFor: () => state.copy,
    }),
    __downloadsState: state,
  }
})

// Driveable mini-player session: a screen that remounts onto its floating
// video reads the dub the viewer picked back from here, ahead of a download.
jest.mock("../../lib/miniPlayer/store", () => {
  const state = {
    session: null as { videoSlug: string; languageSlug: string | null } | null,
  }
  return {
    getMiniPlayerStore: () => ({
      getSnapshot: () => ({ session: state.session }),
    }),
    __sessionState: state,
  }
})

import { act } from "react"

import { WatchSessionProvider, useWatchSession } from "../WatchSessionProvider"
import { adminFormsFor } from "../../i18n/adminLanguage"
import { getCatalogTag } from "../../i18n/localeStore"
import type { WatchVariant, WatchVideoRecord } from "../../lib/normalizeVideo"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const prefs = jest.requireMock("../WatchPreferencesProvider") as {
  __prefState: {
    ready: boolean
    audio: string | null
    audioIso3: string | null
    subtitle: string | null
    subtitleName: string | null
    subtitleNameLocale: string | null
    subtitlesEnabled: boolean
    setAudio: jest.Mock
    backfillAudioIso3: jest.Mock
    setPreferredSubtitleLanguage: jest.Mock
    setPreferredSubtitleName: jest.Mock
    setSubtitlesEnabled: jest.Mock
  }
}
const apollo = jest.requireMock("@apollo/client/react") as {
  __client: { query: jest.Mock }
}
const downloads = jest.requireMock("../DownloadsProvider") as {
  __downloadsState: {
    ready: boolean
    copy: { path: string; dubDocumentId: string | null } | null
  }
}
const miniPlayer = jest.requireMock("../../lib/miniPlayer/store") as {
  __sessionState: {
    session: { videoSlug: string; languageSlug: string | null } | null
  }
}

function variant(
  languageSlug: string,
  id: string,
  languageIso3: string | null = null,
): WatchVariant {
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
    languageIso3,
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
    primaryLanguageCoreId: "lang-en",
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
const OFFLINE_FILE =
  "file:///docs/offline-downloads/considering-christmas/a.mp4"

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
  prefs.__prefState.audioIso3 = null
  prefs.__prefState.subtitle = null
  prefs.__prefState.subtitleName = null
  prefs.__prefState.subtitleNameLocale = null
  prefs.__prefState.subtitlesEnabled = false
  prefs.__prefState.setAudio.mockClear()
  prefs.__prefState.backfillAudioIso3.mockClear()
  prefs.__prefState.setPreferredSubtitleLanguage.mockClear()
  prefs.__prefState.setPreferredSubtitleName.mockClear()
  prefs.__prefState.setSubtitlesEnabled.mockClear()
  apollo.__client.query.mockReset()
  downloads.__downloadsState.ready = true
  downloads.__downloadsState.copy = null
  miniPlayer.__sessionState.session = null
})

describe("a download's dub outranks the preference", () => {
  it("defaults to the downloaded dub, so the pill names the audio on disk", async () => {
    downloads.__downloadsState.copy = {
      path: OFFLINE_FILE,
      dubDocumentId: "dubThai",
    }
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(session.activeVariant?.languageSlug).toBe("thai")
    expect(variantHistory).not.toContain("english")
  })

  it("still surfaces an explicit pick of another dub", async () => {
    downloads.__downloadsState.copy = {
      path: OFFLINE_FILE,
      dubDocumentId: "dubThai",
    }
    await renderProvider()
    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    await act(async () => {
      session.setActiveVariantIndex(1)
    })

    expect(session.activeVariant?.languageSlug).toBe("english")
  })

  it("waits for the downloads store before resolving, then takes the download", async () => {
    downloads.__downloadsState.ready = false
    downloads.__downloadsState.copy = {
      path: OFFLINE_FILE,
      dubDocumentId: "dubThai",
    }
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })
    expect(session.activeVariant).toBeNull()

    downloads.__downloadsState.ready = true
    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(session.activeVariant?.languageSlug).toBe("thai")
    expect(variantHistory).not.toContain("english")
  })
})

describe("a remount onto the floating session keeps the viewer's pick", () => {
  it("seeds the default from the floating session's dub, ahead of the download", async () => {
    // The viewer picked English on a Thai download, minimized, and expanded:
    // the fresh provider must not hand the pill back to the download.
    downloads.__downloadsState.copy = {
      path: OFFLINE_FILE,
      dubDocumentId: "dubThai",
    }
    miniPlayer.__sessionState.session = {
      videoSlug: "considering-christmas",
      languageSlug: "english",
    }
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(session.activeVariant?.languageSlug).toBe("english")
    expect(variantHistory).not.toContain("thai")
  })

  it("ignores a floating session of another video", async () => {
    downloads.__downloadsState.copy = {
      path: OFFLINE_FILE,
      dubDocumentId: "dubThai",
    }
    miniPlayer.__sessionState.session = {
      videoSlug: "another-video",
      languageSlug: "english",
    }
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(session.activeVariant?.languageSlug).toBe("thai")
  })

  it("keeps the resolved dub when a download lands after the default", async () => {
    // The reconciler applies once per video: a copy that arrives later must
    // not snap a viewer already watching English onto the downloaded Thai.
    await renderProvider()
    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })
    expect(session.activeVariant?.languageSlug).toBe("english")

    downloads.__downloadsState.copy = {
      path: OFFLINE_FILE,
      dubDocumentId: "dubThai",
    }
    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(session.activeVariant?.languageSlug).toBe("english")
    expect(variantHistory).not.toContain("thai")
  })
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

/**
 * KTD11 and R43: a "Keep watching" page hands the session the clip's languages
 * as an explicit input. It leads the default chain and never writes the saved
 * preferences, so none of these cases may call a preference setter.
 */
describe("a Keep watching intent", () => {
  const DUBBED = {
    audioLanguageSlug: "english",
    subtitleLanguageSlug: null,
    subtitlesOn: false,
  }
  const SUBTITLE_ONLY = {
    audioLanguageSlug: "english",
    subtitleLanguageSlug: "thai",
    subtitlesOn: true,
  }

  /** One dub's media, in the wire shape `normalizeDubMedia` reads. */
  function answerMedia(slugs: string[]) {
    apollo.__client.query.mockResolvedValue({
      data: {
        videoDub: {
          downloads: [],
          videoEdition: {
            subtitles: slugs.map((slug) => ({
              documentId: `sub-${slug}`,
              vttSrc: `https://cdn.example/${slug}.vtt`,
              primary: false,
              aiGenerated: false,
              language: { slug, name: slug, bcp47: null },
            })),
          },
        },
      },
    })
  }

  function expectNoPreferenceWrite() {
    expect(prefs.__prefState.setAudio).not.toHaveBeenCalled()
    expect(
      prefs.__prefState.setPreferredSubtitleLanguage,
    ).not.toHaveBeenCalled()
    expect(prefs.__prefState.setSubtitlesEnabled).not.toHaveBeenCalled()
  }

  it("plays the clip's dub over a download in another language", async () => {
    // Both the download and the saved choice name Thai: only the intent
    // can make this English.
    prefs.__prefState.audio = "thai"
    downloads.__downloadsState.copy = {
      path: OFFLINE_FILE,
      dubDocumentId: "dubThai",
    }
    await renderProvider()

    await act(async () => {
      session.setSessionIntent(DUBBED)
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(session.activeVariant?.languageSlug).toBe("english")
    expect(variantHistory).not.toContain("thai")
    expectNoPreferenceWrite()
  })

  it("still plays the clip's dub when the record loads late", async () => {
    prefs.__prefState.audio = "thai"
    downloads.__downloadsState.copy = {
      path: OFFLINE_FILE,
      dubDocumentId: "dubThai",
    }
    await renderProvider()
    // The route takes the intent on its first render, long before the record.
    await act(async () => {
      session.setSessionIntent(DUBBED)
    })
    await act(async () => {})
    expect(session.activeVariant).toBeNull()

    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(session.activeVariant?.languageSlug).toBe("english")
    expect(variantHistory).not.toContain("thai")
  })

  it("selects the clip's subtitle language through the raw setter", async () => {
    prefs.__prefState.subtitle = "english"
    answerMedia(["english", "thai"])
    await renderProvider()
    await act(async () => {
      session.setSessionIntent(SUBTITLE_ONLY)
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    await act(async () => {
      session.ensureActiveVariantMedia()
    })

    expect(session.activeVariantMedia?.subtitles).toHaveLength(2)
    expect(session.activeSubtitleSlug).toBe("thai")
    expectNoPreferenceWrite()
  })

  it("turns subtitles on for this session only after a subtitle-only clip", async () => {
    await renderProvider()
    expect(session.subtitleEnabled).toBe(false)

    await act(async () => {
      session.setSessionIntent(SUBTITLE_ONLY)
    })
    expect(session.subtitleEnabled).toBe(true)

    // The page closes: its cleanup clears the input.
    await act(async () => {
      session.setSessionIntent(null)
    })
    expect(session.subtitleEnabled).toBe(false)
    expect(prefs.__prefState.subtitlesEnabled).toBe(false)
    expectNoPreferenceWrite()
  })

  it("keeps the saved subtitle setting after a dubbed clip", async () => {
    await renderProvider()
    await act(async () => {
      session.setSessionIntent(DUBBED)
    })
    expect(session.subtitleEnabled).toBe(false)

    prefs.__prefState.subtitlesEnabled = true
    await act(async () => {
      session.setSessionIntent({ ...DUBBED })
    })
    expect(session.subtitleEnabled).toBe(true)
  })

  it("lets the viewer turn the session's subtitles off", async () => {
    await renderProvider()
    await act(async () => {
      session.setSessionIntent(SUBTITLE_ONLY)
    })

    await act(async () => {
      session.setSubtitleEnabled(false)
    })

    expect(session.subtitleEnabled).toBe(false)
  })
})

describe("the audio language code (U6)", () => {
  const CODED_DUBS = [
    variant("thai", "dubThai", "tha"),
    variant("spanish", "dubSpanish", "spa"),
    variant("english", "dubEnglish", "eng"),
  ]

  it("stores the picked dub's code with its slug", async () => {
    await renderProvider()
    await act(async () => {
      session.setVideo(record("video-cc", CODED_DUBS))
    })

    await act(async () => {
      session.setActiveVariantIndex(1)
    })

    expect(prefs.__prefState.setAudio).toHaveBeenCalledTimes(1)
    expect(prefs.__prefState.setAudio).toHaveBeenCalledWith("spanish", "spa")
  })

  it("sends no code for a dub whose language carries none", async () => {
    await renderProvider()
    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    await act(async () => {
      session.setActiveVariantIndex(0)
    })

    expect(prefs.__prefState.setAudio).toHaveBeenCalledWith("thai", null)
  })

  it("fills a missing code from the loaded video's dub in the stored language", async () => {
    // A viewer who picked Spanish before the code existed: slug, no code.
    prefs.__prefState.audio = "spanish"
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", CODED_DUBS))
    })

    expect(prefs.__prefState.backfillAudioIso3).toHaveBeenCalledWith(
      "spanish",
      "spa",
    )
    // The fill never counts as a pick.
    expect(prefs.__prefState.setAudio).toHaveBeenCalledTimes(0)
  })

  it("leaves a stored code alone", async () => {
    prefs.__prefState.audio = "spanish"
    prefs.__prefState.audioIso3 = "spa"
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", CODED_DUBS))
    })

    expect(prefs.__prefState.backfillAudioIso3).toHaveBeenCalledTimes(0)
  })

  it("fills nothing when the stored language's dub carries no code", async () => {
    prefs.__prefState.audio = "thai"
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", MULTI_DUB))
    })

    expect(prefs.__prefState.backfillAudioIso3).toHaveBeenCalledTimes(0)
  })

  it("fills nothing from a dub in another language", async () => {
    // The video resolves to its English dub, but the stored language is Korean.
    prefs.__prefState.audio = "korean"
    await renderProvider()

    await act(async () => {
      session.setVideo(record("video-cc", CODED_DUBS))
    })

    expect(prefs.__prefState.backfillAudioIso3).toHaveBeenCalledTimes(0)
  })
})

// KTD16: an open watch screen keeps the language it captured through a live
// Android change. The store here stays on English, so this is the screen
// opened in Spanish after the phone moved back to English.
describe("the screen's captured language (U6)", () => {
  function answerFrenchTrack() {
    apollo.__client.query.mockResolvedValue({
      data: {
        videoDub: {
          downloads: [],
          videoEdition: {
            subtitles: [
              {
                documentId: "sub-fr",
                vttSrc: "https://cdn.example/fr.vtt",
                primary: false,
                aiGenerated: false,
                language: {
                  slug: "french",
                  name: { en: "French", es: "Francés" },
                  bcp47: "fr",
                },
              },
            ],
          },
        },
      },
    })
  }

  async function openSpanishScreen() {
    expect(getCatalogTag()).toBe("en")
    await renderProvider()
    await act(async () => {
      session.setVideo({
        ...record("video-cc", MULTI_DUB),
        adminForms: adminFormsFor("es"),
      })
    })
  }

  async function loadMedia() {
    await act(async () => {
      session.ensureActiveVariantMedia()
    })
  }

  it("names the subtitle languages in the screen's forms, and caches the name under the screen's tag", async () => {
    prefs.__prefState.subtitle = "french"
    answerFrenchTrack()
    await openSpanishScreen()
    await loadMedia()

    expect(session.activeVariantMedia?.subtitles[0]?.languageName).toBe(
      "Francés",
    )
    expect(prefs.__prefState.setPreferredSubtitleName).toHaveBeenCalledWith(
      "Francés",
      "es",
    )
  })

  // KTD16: the reader gates the cached name on the screen's tag, never the
  // live one, so the pill keeps its name and nothing writes it again.
  it("reads a name cached in the screen's tag while the UI tag differs", async () => {
    prefs.__prefState.subtitle = "french"
    prefs.__prefState.subtitleName = "Francés"
    prefs.__prefState.subtitleNameLocale = "es"
    answerFrenchTrack()
    await openSpanishScreen()
    expect(session.preferredSubtitleName).toBe("Francés")

    await loadMedia()

    expect(session.activeVariantMedia?.subtitles).toHaveLength(1)
    expect(prefs.__prefState.setPreferredSubtitleName).not.toHaveBeenCalled()
  })

  it("hides a name cached in another tag, even the live UI tag", async () => {
    prefs.__prefState.subtitleName = "French"
    prefs.__prefState.subtitleNameLocale = "en"
    await openSpanishScreen()

    expect(session.preferredSubtitleName).toBeNull()
  })
})
