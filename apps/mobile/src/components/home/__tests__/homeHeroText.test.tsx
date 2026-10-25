/** U10: the hero's own copy reads the catalog. Insert copy and fallback shelf
 *  titles read it at each read, and the selector rail relabels a card whose
 *  props did not change. Tap names stay the same in both languages. */
import { act, type ReactElement } from "react"

jest.mock("expo-image", () => ({ Image: () => null }))

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../i18n/catalogs.generated"),
      {
        es: {
          Home: {
            featuredSelectorAriaLabel: "Selector de videos destacados",
            featuredSelectorCardAriaHint:
              "Muestra este video en el espacio de arriba",
            slidePositionAriaLabel:
              "Diapositiva {current, number} de {count, number}",
          },
          HomeHero: {
            welcomeTitle: "Tus videos de hoy",
            morningTitle: "¡Buenos días! Te esperan momentos bíblicos.",
            joinUsAction: "Únete",
          },
          HomeShelves: { fullStoryTitle: "Descubre la historia completa" },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../i18n/pluralData.generated"),
      ["es"],
    ),
)

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import {
  mergeWatchHomeMuxInserts,
  overlayForInsert,
  type WatchHomeSlide,
  type WatchHomeVideoSlide,
} from "../../../lib/watchHome/carouselSequence"
import {
  WATCH_HOME_MUX_INSERTS,
  WATCH_HOME_SECTIONS,
} from "../../../lib/watchHome/config"
import {
  phoneLocales,
  tapActionName,
} from "../../../test-utils/uiLocaleFixture"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { HomeHeroSelectorRail } from "../HomeHeroSelectorRail"
import { HomePagerDots } from "../HomePagerDots"

// 12:00Z is 8am Eastern (EDT): the morning overlay's window.
const morningNow = new Date("2026-06-04T12:00:00.000Z")

function insert(id: string) {
  const found = WATCH_HOME_MUX_INSERTS.find((entry) => entry.id === id)
  if (!found) throw new Error(`${id} insert missing from config`)
  return found
}

const video: WatchHomeVideoSlide = {
  kind: "video",
  id: "video-1",
  title: "JESUS",
  description: null,
  label: "Feature film",
  slug: "jesus",
  parentSlug: null,
  posterUrl: "https://img.example/jesus.jpg",
  thumbnailUrl: "https://img.example/jesus-thumb.jpg",
  imageAlt: "JESUS",
  playbackId: null,
  durationSeconds: 7200,
}

const mounted: TestInstance[] = []

async function mount(element: ReactElement): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  mounted.push(renderer)
  return renderer
}

async function changePhoneLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
}

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
})
afterAll(() => resetLocaleStoreForTests())

describe("the hero's config copy", () => {
  it("reads the catalog in use at each read, and keeps series names", async () => {
    const welcome = insert("welcome-start")
    const titles = () => WATCH_HOME_SECTIONS.map((section) => section.title)
    expect(welcome.title).toBe("Today's Video Picks")
    expect(overlayForInsert(welcome, morningNow).title).toBe(
      "Good Morning! Today's Bible Moments Await.",
    )
    expect(insert("join-us").action?.label).toBe("Join Us")
    expect(titles()[0]).toBe("Discover the full story")

    await changePhoneLanguage("es-ES")

    expect(welcome.title).toBe("Tus videos de hoy")
    expect(overlayForInsert(welcome, morningNow).title).toBe(
      "¡Buenos días! Te esperan momentos bíblicos.",
    )
    expect(insert("join-us").action?.label).toBe("Únete")
    // A key the fixture lacks falls back to English, never to the key name.
    expect(welcome.label).toBe("Faith & Scripture")
    expect(titles()[0]).toBe("Descubre la historia completa")
    expect(titles()).toEqual(expect.arrayContaining(["NUA", "NUA Worth"]))
  })
})

describe("the hero selector rail", () => {
  function renderRail(slides: readonly WatchHomeSlide[]) {
    return mount(
      <HomeHeroSelectorRail
        slides={slides}
        activeIndex={0}
        onSelectSlide={() => {}}
      />,
    )
  }

  it("relabels an insert card whose props did not change", async () => {
    const slides = mergeWatchHomeMuxInserts(
      [video],
      [insert("welcome-start")],
      morningNow,
      "seed",
      "en",
    )
    const rail = await renderRail(slides)
    expect(hasText(rail, "Today's Video Picks")).toBe(true)
    const english = tapActionName(pressableByLabel(rail, "JESUS"))
    expect(pressableByLabel(rail, "JESUS").props.accessibilityHint).toBe(
      "Shows this video in the spotlight above",
    )

    await changePhoneLanguage("es-ES")

    expect(hasText(rail, "Tus videos de hoy")).toBe(true)
    expect(hasText(rail, "Today's Video Picks")).toBe(false)
    const spanish = pressableByLabel(rail, "JESUS")
    expect(spanish.props.accessibilityHint).toBe(
      "Muestra este video en el espacio de arriba",
    )
    expect(tapActionName(spanish)).toBe(english)
    expect(english).toBe("hero-selector-card")
    expect(
      rail.root.findAll(
        (node: RenderedNode) =>
          node.props.accessibilityLabel === "Selector de videos destacados",
      ).length,
    ).toBeGreaterThan(0)
  })
})

describe("the hero pager dots", () => {
  it("name the slide position in the UI language", async () => {
    const renderer = await mount(<HomePagerDots count={7} activeIndex={1} />)
    const label = () =>
      renderer.root.findAll(
        (node: RenderedNode) => node.props.accessible === true,
      )[0]?.props.accessibilityLabel
    expect(label()).toBe("Slide 2 of 7")

    await changePhoneLanguage("es-ES")

    expect(label()).toBe("Diapositiva 2 de 7")
  })
})
