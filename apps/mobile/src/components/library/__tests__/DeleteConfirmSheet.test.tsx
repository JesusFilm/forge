// The delete confirmation counts with the catalog's plural forms (R7). The
// fixture `ru` catalog loads the real Russian plural data, which has three
// forms for whole numbers, so a two-form rule cannot pass.
import { act } from "react"

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
        ru: {
          Library: {
            deleteTitle:
              "{count, plural, one {Удалить # ролик?} few {Удалить # ролика?} many {Удалить # роликов?} other {Удалить # ролика?}}",
            deleteBody:
              "Они исчезнут из загрузок и освободят {size}. Их можно загрузить снова.",
            delete: "Удалить",
            cancel: "Отмена",
            dismissAriaLabel: "Закрыть",
          },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () => {
  const actual = jest.requireActual("../../../i18n/pluralData.generated")
  return {
    ...actual,
    PLURAL_DATA_TAG: { ...actual.PLURAL_DATA_TAG, ru: "ru" },
    PLURAL_DATA_LOADERS: {
      ...actual.PLURAL_DATA_LOADERS,
      ru: () =>
        jest.requireActual("@formatjs/intl-pluralrules/locale-data/ru.js"),
    },
  }
})

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import {
  phoneLocales,
  tapActionName,
} from "../../../test-utils/uiLocaleFixture"
import {
  TestRenderer,
  hasText,
  pressableByLabel,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { DeleteConfirmSheet } from "../DeleteConfirmSheet"

const MB = 1024 * 1024
const mounted: TestInstance[] = []

function sheet(count: number, visible = true) {
  return (
    <DeleteConfirmSheet
      visible={visible}
      count={count}
      combinedBytes={74 * MB}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
    />
  )
}

async function render(count: number): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(sheet(count))
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

describe("DeleteConfirmSheet", () => {
  it("counts one video and three videos in English", async () => {
    const one = await render(1)
    expect(hasText(one, "Delete 1 video?")).toBe(true)
    expect(
      hasText(
        one,
        "They'll be removed from your downloads and free up 74 MB. You can download them again anytime.",
      ),
    ).toBe(true)

    const three = await render(3)
    expect(hasText(three, "Delete 3 videos?")).toBe(true)
  })

  it("stays on screen through the close animation, then unmounts", async () => {
    jest.useFakeTimers()
    try {
      const renderer = await render(3)
      act(() => renderer.update(sheet(3, false)))
      expect(hasText(renderer, "Delete 3 videos?")).toBe(true)

      // Longer than the sheet's 280 ms close animation.
      act(() => {
        jest.advanceTimersByTime(1000)
      })
      expect(renderer.toJSON()).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it.each([
    [1, "Удалить 1 ролик?"],
    [3, "Удалить 3 ролика?"],
    [5, "Удалить 5 роликов?"],
    [21, "Удалить 21 ролик?"],
  ])("takes the Russian form for %i", async (count, title) => {
    await changePhoneLanguage("ru-RU")
    const renderer = await render(count)

    expect(hasText(renderer, title)).toBe(true)
    expect(
      hasText(
        renderer,
        "Они исчезнут из загрузок и освободят 74 MB. Их можно загрузить снова.",
      ),
    ).toBe(true)
  })

  it("keeps each tap name when the labels change language", async () => {
    const renderer = await render(3)
    const names = (labels: string[]) =>
      labels.map((label) => tapActionName(pressableByLabel(renderer, label)))
    const english = names(["Delete", "Cancel", "Dismiss"])

    await changePhoneLanguage("ru-RU")

    expect(hasText(renderer, "Удалить 3 ролика?")).toBe(true)
    expect(names(["Удалить", "Отмена", "Закрыть"])).toEqual(english)
    expect(english).toEqual([
      "library-delete-confirm",
      "library-delete-cancel",
      "library-delete-dismiss",
    ])
  })
})
