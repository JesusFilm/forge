// AE12, KTD17: in a French UI the terms window keeps the terms in English, read
// by an English voice, while its own controls take the catalog's French.
import { act, type ReactElement } from "react"
import { StyleSheet } from "react-native"

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))
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
        fr: {
          DownloadSheet: {
            termsTitle: "Conditions d'utilisation",
            cancel: "Annuler",
            accept: "Accepter",
            acceptTermsAriaLabel: "Accepter les conditions d'utilisation",
            agreeAriaLabel: "J'accepte les conditions d'utilisation",
            agreeToTerms: "J'accepte les {terms}.",
            termsLink: "conditions d'utilisation",
            readTermsAriaLabel: "Lire les conditions d'utilisation",
          },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../i18n/pluralData.generated"),
      ["fr"],
    ),
)

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { TERMS_OF_USE_PARAGRAPHS } from "../../../lib/terms-of-use"
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
import { TermsAcceptanceRow, TermsModal } from "../DownloadSheet"

const mounted: TestInstance[] = []

async function mount(element: ReactElement): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  mounted.push(renderer)
  return renderer
}

function renderModal(): Promise<TestInstance> {
  return mount(<TermsModal visible onAccept={jest.fn()} onCancel={jest.fn()} />)
}

function renderRow(): Promise<TestInstance> {
  return mount(
    <TermsAcceptanceRow
      accepted={false}
      onToggle={jest.fn()}
      onOpenTerms={jest.fn()}
    />,
  )
}

function useLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  startLocaleSync()
  refreshLocale()
}

/** Host Text nodes whose whole content is one terms paragraph. */
function paragraphNodes(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll(
    (node) =>
      node.type === "Text" &&
      TERMS_OF_USE_PARAGRAPHS.includes(node.props.children as string),
  )
}

/** Host Text contents, in render order. */
function texts(renderer: TestInstance): string[] {
  return renderer.root
    .findAll((node) => node.type === "Text")
    .map((node) => String(node.props.children))
}

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
})
afterAll(() => resetLocaleStoreForTests())

describe("the terms window in a French UI (AE12)", () => {
  it("shows every paragraph in English, marked English and left to right", async () => {
    useLanguage("fr-FR")
    const renderer = await renderModal()

    const paragraphs = paragraphNodes(renderer)
    expect(paragraphs).toHaveLength(TERMS_OF_USE_PARAGRAPHS.length)
    for (const node of paragraphs) {
      expect(node.props.accessibilityLanguage).toBe("en")
      expect(StyleSheet.flatten(node.props.style)).toMatchObject({
        writingDirection: "ltr",
      })
    }
  })

  it("reads its title and buttons from the French catalog", async () => {
    useLanguage("fr-FR")
    const renderer = await renderModal()

    expect(hasText(renderer, "Conditions d'utilisation")).toBe(true)
    expect(hasText(renderer, "Terms of Use")).toBe(false)
    expect(hasText(renderer, "Accepter")).toBe(true)
    expect(hasText(renderer, "Annuler")).toBe(true)
  })

  it("keeps the button tap names in both languages", async () => {
    useLanguage("en-US")
    const renderer = await renderModal()
    const accept = tapActionName(
      pressableByLabel(renderer, "Accept terms of use"),
    )
    const cancel = tapActionName(pressableByLabel(renderer, "Cancel"))

    mockGetLocales.mockReturnValue(phoneLocales("fr-FR"))
    await act(async () => {
      refreshLocale()
    })

    expect(
      tapActionName(
        pressableByLabel(renderer, "Accepter les conditions d'utilisation"),
      ),
    ).toBe(accept)
    expect(tapActionName(pressableByLabel(renderer, "Annuler"))).toBe(cancel)
    expect([accept, cancel]).toEqual([
      "download-terms-accept",
      "download-terms-cancel",
    ])
  })
})

describe("the terms checkbox row", () => {
  it("reads the same English as before", async () => {
    const renderer = await renderRow()

    expect(texts(renderer)).toEqual(["I agree to the ", "Terms of Use"])
    expect(
      pressableByLabel(renderer, "I agree to the Terms of Use"),
    ).toBeTruthy()
    expect(pressableByLabel(renderer, "Read Terms of Use")).toBeTruthy()
  })

  it("puts the link where the French sentence puts it", async () => {
    useLanguage("fr-FR")
    const renderer = await renderRow()

    expect(texts(renderer)).toEqual([
      "J'accepte les ",
      "conditions d'utilisation",
      ".",
    ])
    expect(
      tapActionName(
        pressableByLabel(renderer, "Lire les conditions d'utilisation"),
      ),
    ).toBe("download-terms-read")
  })
})
