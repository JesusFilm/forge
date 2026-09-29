/** U10: the mission page and the Home mission rail read the `Mission` catalog.
 *  The invite headline keeps its colored accent wherever a language puts it,
 *  and each moved control keeps one tap name in both languages. */
import { act, type ReactElement } from "react"

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("expo-glass-effect", () => ({ GlassView: () => null }))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
const mockRouter = { navigate: () => {}, back: () => {}, canGoBack: () => true }
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}))
jest.mock("../../src/lib/openExternalUrl", () => ({
  openExternalUrl: () => {},
}))

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../src/i18n/catalogs.generated", () =>
  jest
    .requireActual("../../src/test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../src/i18n/catalogs.generated"),
      {
        es: {
          Common: { goBackAriaLabel: "Volver" },
          Home: {
            shelfAriaLabel:
              "{count, plural, one {# tarjeta en {shelf}} other {# tarjetas en {shelf}}}",
          },
          Mission: {
            eyebrow: "Hecho para misiones globales",
            // The accent comes first, so the text before it is empty.
            inviteHeadline: "{accent} de herramientas misioneras",
            inviteHeadlineAccent: "La nueva generación",
            betaCta: "Prueba la beta",
            missionCardEyebrow: "Nuestra misión",
          },
        },
        tr: { Mission: { missionCardEyebrow: "Misyonumuz" } },
      },
    ),
)
jest.mock("../../src/i18n/pluralData.generated", () =>
  jest
    .requireActual("../../src/test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../src/i18n/pluralData.generated"),
      ["es", "tr"],
    ),
)

import MissionScreen from "../mission"
import { HomeMissionSection } from "../../src/components/home/HomeMissionSection"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../src/i18n/localeStore"
import {
  phoneLocales,
  tapActionName,
} from "../../src/test-utils/uiLocaleFixture"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type RenderedNode,
  type TestInstance,
} from "../../src/test-utils/rnTestRenderer"

const mounted: TestInstance[] = []

async function render(element: ReactElement): Promise<TestInstance> {
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

/** The children of the host Text that holds the accent, in order. */
function headlineParts(renderer: TestInstance, accent: string): unknown[] {
  const headline = renderer.root.findAll(
    (node: RenderedNode) =>
      typeof node.type === "string" &&
      Array.isArray(node.props.children) &&
      (node.props.children as unknown[]).some(
        (child) =>
          typeof child === "object" &&
          child !== null &&
          (child as { props?: { children?: unknown } }).props?.children ===
            accent,
      ),
  )[0]
  expect(headline).toBeDefined()
  return (headline!.props.children as unknown[]).map((child) =>
    typeof child === "string"
      ? child
      : (child as { props: { children: unknown } }).props.children,
  )
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

describe("the mission page", () => {
  it("renders the English text and the accent in the middle", async () => {
    const page = await render(<MissionScreen />)
    expect(hasText(page, "Built for global missions")).toBe(true)
    expect(hasText(page, "The most translated film library in the world")).toBe(
      true,
    )
    expect(headlineParts(page, "the next generation")).toEqual([
      "Help build ",
      "the next generation",
      " of mission tools",
    ])
  })

  it("puts the accent where the language puts it", async () => {
    await changePhoneLanguage("es-ES")
    const page = await render(<MissionScreen />)
    expect(headlineParts(page, "La nueva generación")).toEqual([
      "",
      "La nueva generación",
      " de herramientas misioneras",
    ])
  })

  it("keeps one tap name for the beta button and the back button", async () => {
    const page = await render(<MissionScreen />)
    const english = [
      tapActionName(pressableByLabel(page, "Become a beta tester")),
      tapActionName(pressableByLabel(page, "Go back")),
    ]

    await changePhoneLanguage("es-ES")

    const spanish = [
      tapActionName(pressableByLabel(page, "Prueba la beta")),
      tapActionName(pressableByLabel(page, "Volver")),
    ]
    expect(spanish).toEqual(english)
    expect(english).toEqual(["mission-beta-signup", "floating-back"])
  })
})

describe("the Home mission rail", () => {
  it("upper-cases a card eyebrow with the UI language's rules", async () => {
    await changePhoneLanguage("tr-TR")
    const rail = await render(<HomeMissionSection />)
    // Turkish upper-cases "i" to the dotted "İ"; the root rules give "I".
    expect(hasText(rail, "MİSYONUMUZ")).toBe(true)
  })

  it("relabels its cards and keeps their tap names", async () => {
    const rail = await render(<HomeMissionSection />)
    expect(hasText(rail, "OUR MISSION")).toBe(true)
    const list = rail.root.findAll(
      (node: RenderedNode) =>
        node.props.accessibilityLabel ===
        "3 items in Built for global missions",
    )
    expect(list.length).toBeGreaterThan(0)
    const english = tapActionName(
      pressableByLabel(rail, "Become a beta tester"),
    )

    await changePhoneLanguage("es-ES")

    expect(hasText(rail, "NUESTRA MISIÓN")).toBe(true)
    expect(
      rail.root.findAll(
        (node: RenderedNode) =>
          node.props.accessibilityLabel ===
          "3 tarjetas en Hecho para misiones globales",
      ).length,
    ).toBeGreaterThan(0)
    expect(tapActionName(pressableByLabel(rail, "Prueba la beta"))).toBe(
      english,
    )
    expect(english).toBe("home-mission-beta")
  })
})
