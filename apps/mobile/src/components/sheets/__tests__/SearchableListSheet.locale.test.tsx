/**
 * The list sheet after a UI language change (KTD5, KTD15). The list keeps its
 * rows mounted, so a recycled row must redraw in the new language, and its tap
 * must keep one RUM name in every language.
 */

// tsconfig maps `react` to its .d.ts; re-point it (see AccountSection.test.tsx).
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
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: () => () => {} }),
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
type MockRowProps = {
  item: unknown
  index: number
  extraData: unknown
  renderItem: (args: { item: unknown; index: number }) => unknown
}
// FlashList v2's ViewHolder redraws a mounted row only when its item, the
// list's extraData, or renderItem changes. This mock keeps that rule.
jest.mock("@shopify/flash-list", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  const react = jest.requireActual(
    path.dirname(r.resolve("react/package.json")),
  ) as {
    Fragment: unknown
    memo: (
      component: (props: MockRowProps) => unknown,
      same: (a: MockRowProps, b: MockRowProps) => boolean,
    ) => unknown
    createElement: (
      type: unknown,
      props: unknown,
      ...children: unknown[]
    ) => unknown
  }
  const Row = react.memo(
    ({ item, index, renderItem }: MockRowProps) => renderItem({ item, index }),
    (a, b) =>
      a.item === b.item &&
      a.extraData === b.extraData &&
      a.renderItem === b.renderItem,
  )
  return {
    FlashList: (props: {
      data: unknown[]
      renderItem: MockRowProps["renderItem"]
      extraData?: unknown
      ListHeaderComponent?: unknown
    }) =>
      react.createElement(
        react.Fragment,
        null,
        props.ListHeaderComponent,
        props.data.map((item, index) =>
          react.createElement(Row, {
            key: index,
            item,
            index,
            extraData: props.extraData,
            renderItem: props.renderItem,
          }),
        ),
      ),
  }
})
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
          ListSheet: {
            current: "Текущий",
            clearSearchAriaLabel: "Очистить поиск",
            rowWithStatusAriaLabel: "{name} — {status}",
          },
          Watch: { downloadedStatus: "Скачано" },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../i18n/pluralData.generated"),
      ["ru"],
    ),
)

import { act } from "react"
import { TextInput } from "react-native"

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { getT } from "../../../i18n/useT"
import {
  TestRenderer,
  hasText,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  phoneLocales,
  tapActionName,
} from "../../../test-utils/uiLocaleFixture"
import { SearchableListSheet } from "../SearchableListSheet"

type Row = { id: string; name: string }

const ROWS: Row[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
]

// Module scope on purpose: stable getters give renderItem no new identity, so
// only the list's own inputs can make a mounted row redraw.
const getId = (row: Row) => row.id
const getName = (row: Row) => row.name
const getSearch = (row: Row) => [row.name]
const getStatus = (row: Row) =>
  row.id === "a" ? getT("Watch")("downloadedStatus") : null
const onSelect = () => {}

let mounted: TestInstance | null = null

async function render(): Promise<TestInstance> {
  await act(async () => {
    mounted = TestRenderer.create(
      <SearchableListSheet<Row>
        rows={ROWS}
        activeId="b"
        getSelectionId={getId}
        getKey={getId}
        getPrimaryLabel={getName}
        getStatusLabel={getStatus}
        getSearchValues={getSearch}
        onSelect={onSelect}
        searchPlaceholder="Search"
        searchAccessibilityLabel="Search rows"
        emptySearchMessage="Nothing here"
      />,
    )
  })
  return mounted!
}

async function changePhoneLanguage(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
}

function rowFor(renderer: TestInstance, name: string): RenderedNode {
  const [row] = renderer.root.findAll(
    (node) =>
      typeof node.type !== "string" &&
      node.props.accessibilityRole === "radio" &&
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith(name),
  )
  expect(row).toBeDefined()
  return row
}

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
})

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

describe("SearchableListSheet after a language change", () => {
  it("redraws a mounted row in the new language", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
    const renderer = await render()
    expect(rowFor(renderer, "Alpha").props.accessibilityLabel).toBe(
      "Alpha, Downloaded",
    )
    expect(hasText(renderer, "Current")).toBe(true)

    await changePhoneLanguage("ru-RU")

    expect(rowFor(renderer, "Alpha").props.accessibilityLabel).toBe(
      "Alpha — Скачано",
    )
    expect(hasText(renderer, "Скачано")).toBe(true)
    expect(hasText(renderer, "Downloaded")).toBe(false)
    expect(hasText(renderer, "Текущий")).toBe(true)
  })

  it("keeps one RUM name for a row tap in every language", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
    const renderer = await render()
    expect(tapActionName(rowFor(renderer, "Alpha"))).toBe("list-sheet-row")

    await changePhoneLanguage("ru-RU")

    expect(tapActionName(rowFor(renderer, "Alpha"))).toBe("list-sheet-row")
  })

  it("keeps one RUM name for the clear-search tap in every language", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    startLocaleSync()
    const renderer = await render()
    const [search] = renderer.root.findAll((node) => node.type === TextInput)
    await act(async () => {
      ;(search.props.onChangeText as (text: string) => void)("Al")
    })

    const [clear] = renderer.root.findAll(
      (node) =>
        typeof node.type !== "string" &&
        node.props.accessibilityLabel === "Очистить поиск",
    )
    expect(clear).toBeDefined()
    expect(tapActionName(clear)).toBe("list-sheet-clear-search")
  })
})
