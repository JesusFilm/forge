// The store, the translator, and useT together, with the real en.json and
// generated index. Only the native module is faked, and fixture `es` and `ar`
// catalogs join the real set so a language change can happen.
import { StrictMode, act, type ReactElement } from "react"
import { Text } from "react-native"

import * as localeStore from "../localeStore"
import {
  getLocaleEpoch,
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../localeStore"
import { useTextDirection } from "../textDirection"
import { getT, useDefaultAudioSlug, useT } from "../useT"
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
    CATALOG_TAGS: [...actual.CATALOG_TAGS, "es", "ar"],
    CATALOG_LOADERS: {
      ...actual.CATALOG_LOADERS,
      es: () => ({ Common: { goBackAriaLabel: "Volver" } }),
      ar: () => ({}),
    },
  }
})
jest.mock("../pluralData.generated", () => {
  const actual = jest.requireActual("../pluralData.generated")
  return {
    ...actual,
    PLURAL_DATA_TAG: { ...actual.PLURAL_DATA_TAG, es: "es", ar: "en" },
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

function startOn(tag: string) {
  mockGetLocales.mockReturnValue(phone(tag))
  startLocaleSync()
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

afterEach(() => {
  jest.restoreAllMocks()
})

describe("useT", () => {
  it("renders English with no setup", async () => {
    const renderer = await render(<BackLabel />)
    expect(hasText(renderer, "Go back")).toBe(true)
    expect(mockGetLocales).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it.each([
    ["plain", (element: ReactElement) => element],
    [
      "StrictMode",
      (element: ReactElement) => <StrictMode>{element}</StrictMode>,
    ],
  ])(
    "re-renders with the new text on each epoch change (%s)",
    async (_, wrap) => {
      startOn("en-US")
      const renderer = await render(wrap(<BackLabel />))
      expect(hasText(renderer, "Go back")).toBe(true)

      await changePhoneLanguage("es-MX")
      expect(getLocaleEpoch()).toBe(1)
      expect(hasText(renderer, "Volver")).toBe(true)
      expect(hasText(renderer, "Go back")).toBe(false)

      await changePhoneLanguage("en-GB")
      expect(hasText(renderer, "Go back")).toBe(true)
      await unmount(renderer)
    },
  )

  it("does not re-render when a refresh keeps the same catalog", async () => {
    startOn("es-ES")
    const renderer = await render(<BackLabel />)
    const before = renders

    // The tags change, so the store notifies; the epoch snapshot holds.
    await changePhoneLanguage("es-MX")

    expect(renders).toBe(before)
    expect(hasText(renderer, "Volver")).toBe(true)
    await unmount(renderer)
  })

  // A render count cannot rise after unmount, so the case watches the store's
  // calls to the listener that React subscribed.
  it("stops listening after unmount", async () => {
    const subscribe = localeStore.subscribeLocale
    const heard = jest.fn()
    jest.spyOn(localeStore, "subscribeLocale").mockImplementation((listener) =>
      subscribe(() => {
        heard()
        listener()
      }),
    )
    startOn("en-US")
    const renderer = await render(<BackLabel />)
    await changePhoneLanguage("es-MX")
    expect(heard).toHaveBeenCalled()

    await unmount(renderer)
    heard.mockClear()
    await changePhoneLanguage("en-GB")

    expect(heard).not.toHaveBeenCalled()
  })
})

describe("useDefaultAudioSlug", () => {
  function DefaultAudio() {
    return <Text>{useDefaultAudioSlug() ?? "none"}</Text>
  }

  it("follows a phone change that keeps the catalog", async () => {
    startOn("ha-NG")
    const renderer = await render(<DefaultAudio />)
    expect(hasText(renderer, "hausa")).toBe(true)

    await changePhoneLanguage("yo-NG")

    expect(getLocaleEpoch()).toBe(0)
    expect(hasText(renderer, "yoruba")).toBe(true)
    await unmount(renderer)
  })
})

describe("useTextDirection", () => {
  function FallbackText() {
    const { text } = useTextDirection()
    return <Text>{text("en").style?.direction ?? "none"}</Text>
  }

  it("re-reads the style for a live UI language change", async () => {
    startOn("en-US")
    const renderer = await render(<FallbackText />)
    expect(hasText(renderer, "none")).toBe(true)

    await changePhoneLanguage("ar-EG")

    expect(hasText(renderer, "ltr")).toBe(true)
    await unmount(renderer)
  })
})

describe("getT", () => {
  it("reads the catalog in use at call time, outside React", async () => {
    startOn("en-US")
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
