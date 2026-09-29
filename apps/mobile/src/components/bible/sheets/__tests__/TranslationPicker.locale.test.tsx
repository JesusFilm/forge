/**
 * The translation picker after a UI language change (KTD5, KTD16). The list
 * keeps its rows mounted, so a recycled row must redraw in the new language.
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
jest.mock("../../../../lib/datadog", () => ({
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
jest.mock("../../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../../i18n/catalogs.generated"),
      {
        es: {
          BibleTranslationPicker: {
            completeBible: "Biblia completa",
            onDevice: "En este dispositivo",
          },
        },
      },
    ),
)
jest.mock("../../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../../i18n/pluralData.generated"),
      ["es"],
    ),
)

import { act } from "react"

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../../i18n/localeStore"
import { parseCatalog, type Catalog } from "../../../../lib/bible/data/catalog"
import type { TranslationDownloadState } from "../../../../lib/bible/repository/translationDownloads"
import { readerTokens } from "../../../../lib/bible/theme/palettes"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../../test-utils/rnTestRenderer"
import { phoneLocales } from "../../../../test-utils/uiLocaleFixture"
import { TranslationPicker } from "../TranslationPicker"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
}>("fs")

function loadCatalog(): Catalog {
  const raw: unknown = JSON.parse(
    fs.readFileSync(
      `${__dirname}/../../../../../assets/bible/catalog.bible`,
      "utf8",
    ),
  )
  const catalog = parseCatalog(raw)
  if (!catalog) throw new Error("the bundled catalog did not parse")
  return catalog
}

const CATALOG = loadCatalog()
const SYNODAL = CATALOG.byId.get("rus_syn")!

const downloads = {
  getState: (id: string): TranslationDownloadState =>
    id === "BSB" ? { kind: "bundled" } : { kind: "not-downloaded" },
  subscribe: () => () => {},
  check: () => Promise.resolve(),
}

let mounted: TestInstance | null = null

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
})

function rowLabel(renderer: TestInstance, name: string): string | undefined {
  const [row] = renderer.root.findAll(
    (node) =>
      typeof node.type !== "string" &&
      node.props.accessibilityRole === "radio" &&
      typeof node.props.accessibilityLabel === "string" &&
      node.props.accessibilityLabel.startsWith(`${name}, `),
  )
  return row?.props.accessibilityLabel as string | undefined
}

describe("TranslationPicker after a language change", () => {
  it("redraws a mounted row in the new language", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
    await act(async () => {
      mounted = TestRenderer.create(
        <TranslationPicker
          tokens={readerTokens("light")}
          catalog={CATALOG}
          activeId={null}
          viewerLanguages={["rus"]}
          offline={false}
          downloads={downloads}
          onPick={() => {}}
          onClose={() => {}}
        />,
      )
    })
    const renderer = mounted!
    expect(rowLabel(renderer, SYNODAL.name)).toBe(
      `${SYNODAL.name}, Complete Bible`,
    )

    mockGetLocales.mockReturnValue(phoneLocales("es-MX"))
    await act(async () => {
      refreshLocale()
    })

    expect(rowLabel(renderer, SYNODAL.name)).toBe(
      `${SYNODAL.name}, Biblia completa`,
    )
  })
})
