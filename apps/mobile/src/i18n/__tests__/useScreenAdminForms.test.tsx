/** KTD16, AE11: a watch screen keeps its opening language through a live
 *  Android language change and a mini-player expand; a new video opens in the
 *  new language. StrictMode runs the capture's double render and remount. */

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

// `ru` is a fixture catalog, so a phone change moves the locale epoch.
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../catalogs.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(jest.requireActual("../catalogs.generated"), {
      ru: {},
    }),
)
jest.mock("../pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(jest.requireActual("../pluralData.generated"), [
      "ru",
    ]),
)

import { StrictMode, act } from "react"

import {
  getLocaleEpoch,
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../localeStore"
import { useScreenAdminForms } from "../useScreenAdminForms"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
import { normalizeVideo, type VideoTextInput } from "../../lib/normalizeVideo"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const SLUG = "birth-of-jesus"

// The language-free document: one Spanish dub whose name map holds Russian.
const RAW = {
  documentId: "vid-birth",
  slug: SLUG,
  label: "SEGMENT",
  images: [],
  primaryLanguage: { coreId: "529", bcp47: "en" },
  parents: [],
  variants: [
    {
      documentId: "dub-es",
      slug: `${SLUG}/spanish`,
      published: true,
      hls: "https://stream.mux.com/es.m3u8",
      duration: 1,
      language: {
        coreId: "21028",
        bcp47: "es",
        slug: "spanish",
        name: { en: "Spanish", ru: "Испанский" },
        iso3: "spa",
      },
      muxVideo: null,
    },
  ],
  studyQuestions: [],
  bibleCitations: [],
} as unknown as Parameters<typeof normalizeVideo>[0]

// What each language's text companion answers.
function textFor(textSlug: string): VideoTextInput {
  const russian = textSlug === "russian"
  return {
    documentId: "vid-birth",
    locales: russian
      ? [{ languageSlug: "russian", title: "Рождение" }]
      : [{ languageSlug: "english", title: "The Birth" }],
    englishLocales: [{ languageSlug: "english", title: "The Birth" }],
  }
}

type Frame = { title: string | null; dub: string | null }
let frames: Frame[] = []

function Screen({ slug }: { slug: string }) {
  const forms = useScreenAdminForms(slug)
  const record = normalizeVideo(RAW, forms, textFor(forms.textSlug))
  frames.push({
    title: record?.title ?? null,
    dub: record?.variants[0]?.languageName ?? null,
  })
  return null
}

let mounted: TestInstance | null = null

async function mount(slug: string) {
  await act(async () => {
    mounted = TestRenderer.create(
      <StrictMode>
        <Screen slug={slug} />
      </StrictMode>,
    )
  })
}

async function unmount() {
  await act(async () => {
    mounted?.unmount()
  })
  mounted = null
}

async function changePhone(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
}

function lastFrame(): Frame {
  return frames[frames.length - 1]
}

beforeEach(() => {
  frames = []
  resetLocaleStoreForTests()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
})

afterEach(async () => {
  if (mounted != null) await unmount()
  getMiniPlayerStore().end("replaced")
  resetLocaleStoreForTests()
})

describe("useScreenAdminForms (KTD16, AE11)", () => {
  it("keeps the open screen's text and dub names through a live change", async () => {
    await mount(SLUG)
    expect(lastFrame()).toEqual({ title: "The Birth", dub: "Spanish" })

    await changePhone("ru-RU")
    expect(getLocaleEpoch()).toBe(1)
    // A re-render of the open screen must read the forms it captured.
    await act(async () => {
      mounted?.update(
        <StrictMode>
          <Screen slug={SLUG} />
        </StrictMode>,
      )
    })

    expect(lastFrame()).toEqual({ title: "The Birth", dub: "Spanish" })
  })

  it("keeps the text through a mini-player expand of the same video", async () => {
    await mount(SLUG)
    // The screen's playback earns a window, then the phone changes language.
    getMiniPlayerStore().start({ videoId: null, videoSlug: SLUG, title: "T" })
    await unmount()
    await changePhone("ru-RU")

    // The expand remounts the watch screen for the floating video.
    await mount(SLUG)

    expect(frames.every((frame) => frame.title === "The Birth")).toBe(true)
    expect(lastFrame()).toEqual({ title: "The Birth", dub: "Spanish" })
  })

  it("opens another video in the new language", async () => {
    await mount(SLUG)
    getMiniPlayerStore().start({ videoId: null, videoSlug: SLUG, title: "T" })
    await unmount()
    await changePhone("ru-RU")

    await mount("the-baptism")

    expect(lastFrame()).toEqual({ title: "Рождение", dub: "Испанский" })
  })

  it("reads the new language again when the same route gets a new slug", async () => {
    await mount(SLUG)
    await changePhone("ru-RU")

    await act(async () => {
      mounted?.update(
        <StrictMode>
          <Screen slug="the-baptism" />
        </StrictMode>,
      )
    })

    expect(lastFrame().dub).toBe("Испанский")
  })
})
