// The store, the translator, and useT together, with the real en.json and
// generated index. Only the native module is faked, and a fixture `es`
// catalog joins the real set so a language change can happen.
import { StrictMode, act, type ReactElement } from "react"
import { Text } from "react-native"

import {
  getLocaleEpoch,
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../localeStore"
import { getT, useT } from "../useT"
import {
  TestRenderer,
  hasText,
  unmount,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))

jest.mock("../catalogs.generated", () => {
  const actual = jest.requireActual("../catalogs.generated")
  return {
    CATALOG_TAGS: [...actual.CATALOG_TAGS, "es"],
    CATALOG_LOADERS: {
      ...actual.CATALOG_LOADERS,
      es: () => ({ Common: { goBackAriaLabel: "Volver" } }),
    },
  }
})
jest.mock("../pluralData.generated", () => {
  const actual = jest.requireActual("../pluralData.generated")
  return {
    ...actual,
    PLURAL_DATA_TAG: { ...actual.PLURAL_DATA_TAG, es: "es" },
    PLURAL_DATA_LOADERS: {
      ...actual.PLURAL_DATA_LOADERS,
      es: () =>
        jest.requireActual("@formatjs/intl-pluralrules/locale-data/es.js"),
    },
  }
})

const phone = (tag: string) => [{ languageTag: tag }]

let renders = 0

function BackLabel() {
  const t = useT("Common")
  renders += 1
  return <Text>{t("goBackAriaLabel")}</Text>
}

async function render(element: ReactElement): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  return renderer
}

async function changePhoneLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phone(tag))
  await act(async () => {
    refreshLocale()
  })
}

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
  renders = 0
})

describe("useT", () => {
  it("renders English with no setup", async () => {
    const renderer = await render(<BackLabel />)
    expect(hasText(renderer, "Go back")).toBe(true)
    expect(mockGetLocales).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("re-renders with the new text after an epoch change", async () => {
    mockGetLocales.mockReturnValue(phone("en-US"))
    startLocaleSync()
    const renderer = await render(<BackLabel />)
    expect(hasText(renderer, "Go back")).toBe(true)

    await changePhoneLanguage("es-MX")

    expect(getLocaleEpoch()).toBe(1)
    expect(hasText(renderer, "Volver")).toBe(true)
    expect(hasText(renderer, "Go back")).toBe(false)
    await unmount(renderer)
  })

  it("behaves the same under StrictMode", async () => {
    mockGetLocales.mockReturnValue(phone("en-US"))
    startLocaleSync()
    const renderer = await render(
      <StrictMode>
        <BackLabel />
      </StrictMode>,
    )
    expect(hasText(renderer, "Go back")).toBe(true)

    await changePhoneLanguage("es-MX")
    expect(hasText(renderer, "Volver")).toBe(true)

    await changePhoneLanguage("en-GB")
    expect(hasText(renderer, "Go back")).toBe(true)
    await unmount(renderer)
  })

  it("does not re-render when a refresh keeps the same catalog", async () => {
    mockGetLocales.mockReturnValue(phone("es-ES"))
    startLocaleSync()
    const renderer = await render(<BackLabel />)
    const before = renders

    await changePhoneLanguage("es-MX")

    expect(renders).toBe(before)
    expect(hasText(renderer, "Volver")).toBe(true)
    await unmount(renderer)
  })

  it("stops listening after unmount", async () => {
    mockGetLocales.mockReturnValue(phone("en-US"))
    startLocaleSync()
    const renderer = await render(<BackLabel />)
    await unmount(renderer)
    const before = renders

    await changePhoneLanguage("es-MX")

    expect(renders).toBe(before)
  })
})

describe("getT", () => {
  it("reads the catalog in use at call time, outside React", async () => {
    mockGetLocales.mockReturnValue(phone("en-US"))
    startLocaleSync()
    const t = getT("Common")
    expect(t("goBackAriaLabel")).toBe("Go back")

    await changePhoneLanguage("es-MX")

    expect(t("goBackAriaLabel")).toBe("Volver")
  })
})

// Compile-time only: tsc fails if a missing key or namespace stops erroring.
export function typedKeysAreEnforced() {
  const t = getT("Common")
  // @ts-expect-error: not a key in messages/en.json
  t("notAKey")
  // @ts-expect-error: not a namespace in messages/en.json
  getT("NotANamespace")
}
