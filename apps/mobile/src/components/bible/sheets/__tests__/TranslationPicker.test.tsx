/**
 * The translation picker (feat-553 U10, R23, R30, R41) over the real bundled
 * catalog: the viewer's language first, search, the offline filter, and the
 * download state of each row, which follows the store live.
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
// FlashList virtualizes against a layout jest never measures, so render the
// header and every row inline instead.
jest.mock("@shopify/flash-list", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  const react = jest.requireActual(
    path.dirname(r.resolve("react/package.json")),
  ) as {
    Fragment: unknown
    createElement: (
      type: unknown,
      props: unknown,
      ...children: unknown[]
    ) => unknown
  }
  return {
    FlashList: (props: {
      data: unknown[]
      renderItem: (args: { item: unknown; index: number }) => unknown
      ListHeaderComponent?: unknown
      ListEmptyComponent?: unknown
    }) =>
      react.createElement(
        react.Fragment,
        null,
        props.ListHeaderComponent,
        props.data.length === 0
          ? props.ListEmptyComponent
          : props.data.map((item, index) =>
              react.createElement(
                react.Fragment,
                { key: index },
                props.renderItem({ item, index }),
              ),
            ),
      ),
  }
})

import { StrictMode, act, type ReactElement } from "react"
import { StyleSheet } from "react-native"

import {
  parseCatalog,
  type Catalog,
  type CatalogTranslation,
} from "../../../../lib/bible/data/catalog"
import type { TranslationDownloadState } from "../../../../lib/bible/repository/translationDownloads"
import { READER_SHEET_COPY } from "../../../../lib/bible/sheets/copy"
import { translationStatusLabel } from "../../../../lib/bible/sheets/translationList"
import { readerTokens } from "../../../../lib/bible/theme/palettes"
import { datadogLog } from "../../../../lib/datadog"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../../test-utils/rnTestRenderer"
import {
  TranslationPicker,
  type TranslationPickerProps,
} from "../TranslationPicker"

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
const COPY = READER_SHEET_COPY.translation
const TOKENS = readerTokens("trueDark", "light")
const SPANISH = CATALOG.translations.filter((t) => t.language === "spa")
const SYNODAL = CATALOG.byId.get("rus_syn")!

/** A download store double: set a state, then emit like U4 does. */
function fakeDownloads(initial: Record<string, TranslationDownloadState> = {}) {
  const states = new Map(Object.entries(initial))
  const listeners = new Set<() => void>()
  return {
    getState: (id: string): TranslationDownloadState =>
      id === "BSB"
        ? { kind: "bundled" }
        : (states.get(id) ?? { kind: "not-downloaded" }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    check: jest.fn(() => Promise.resolve()),
    set(id: string, state: TranslationDownloadState) {
      states.set(id, state)
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

function downloadedState(translation: CatalogTranslation) {
  return {
    kind: "downloaded" as const,
    sha256: translation.sha256,
    books: translation.books,
    bytes: translation.downloadBytes,
  }
}

let mounted: TestInstance | null = null

async function render(
  overrides: Partial<TranslationPickerProps> = {},
  wrap: (element: ReactElement) => ReactElement = (element) => element,
) {
  const downloads = (overrides.downloads ?? fakeDownloads()) as ReturnType<
    typeof fakeDownloads
  >
  const onPick = jest.fn()
  const onClose = jest.fn()
  await act(async () => {
    mounted = TestRenderer.create(
      wrap(
        <TranslationPicker
          tokens={TOKENS}
          catalog={CATALOG}
          activeId={null}
          viewerLanguages={["spa"]}
          offline={false}
          onPick={onPick}
          onClose={onClose}
          {...overrides}
          downloads={downloads}
        />,
      ),
    )
  })
  return { renderer: mounted!, downloads, onPick, onClose }
}

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

/** The list rows (not the "Current" row), as their accessible names. */
function rowLabels(renderer: TestInstance): string[] {
  return renderer.root
    .findAll(
      (node) =>
        typeof node.type !== "string" &&
        node.props.accessibilityRole === "radio" &&
        typeof node.props.onPress === "function",
    )
    .map((node) => node.props.accessibilityLabel as string)
}

function rowLabel(
  translation: CatalogTranslation,
  state: TranslationDownloadState,
): string {
  return `${translation.name}, ${translationStatusLabel(translation, state)}`
}

function rowFor(renderer: TestInstance, label: string): RenderedNode {
  const [row] = renderer.root.findAll(
    (node) =>
      typeof node.type !== "string" &&
      node.props.accessibilityRole === "radio" &&
      node.props.accessibilityLabel === label,
  )
  if (!row) throw new Error(`no row "${label}"`)
  return row
}

async function search(renderer: TestInstance, text: string): Promise<void> {
  const [input] = renderer.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === COPY.searchLabel &&
      typeof node.props.onChangeText === "function",
  )
  if (!input) throw new Error("no search field")
  await act(async () => {
    ;(input.props.onChangeText as (value: string) => void)(text)
  })
}

function filterSwitch(renderer: TestInstance): RenderedNode {
  const [control] = renderer.root.findAll(
    (node) =>
      typeof node.type !== "string" &&
      node.props.accessibilityLabel === COPY.onDeviceOnly &&
      typeof node.props.onValueChange === "function",
  )
  if (!control) throw new Error("no filter switch")
  return control
}

const NOT_DOWNLOADED: TranslationDownloadState = { kind: "not-downloaded" }

describe("TranslationPicker", () => {
  it("lists Spanish entries first for a Spanish viewer", async () => {
    const { renderer } = await render()
    const labels = rowLabels(renderer)
    expect(labels).toHaveLength(CATALOG.translations.length)
    const spanishLabels = new Set(
      SPANISH.map((t) => rowLabel(t, NOT_DOWNLOADED)),
    )
    expect(
      labels.slice(0, SPANISH.length).every((l) => spanishLabels.has(l)),
    ).toBe(true)
    expect(spanishLabels.has(labels[SPANISH.length] ?? "")).toBe(false)
  })

  it("finds the Synodal Bible by search", async () => {
    const { renderer } = await render()
    await search(renderer, "Synodal")
    expect(rowLabels(renderer)).toEqual([rowLabel(SYNODAL, NOT_DOWNLOADED)])
  })

  it("finds a language by its English name", async () => {
    const { renderer } = await render()
    await search(renderer, "russian")
    const labels = rowLabels(renderer)
    expect(labels).toContain(rowLabel(SYNODAL, NOT_DOWNLOADED))
    expect(labels.length).toBeLessThan(CATALOG.translations.length)
  })

  it("offline, lists only BSB and downloaded translations", async () => {
    const downloads = fakeDownloads({ rus_syn: downloadedState(SYNODAL) })
    const { renderer } = await render({ offline: true, downloads })
    expect(filterSwitch(renderer).props.value).toBe(true)
    expect(rowLabels(renderer)).toEqual([
      rowLabel(CATALOG.byId.get("BSB")!, { kind: "bundled" }),
      rowLabel(SYNODAL, downloadedState(SYNODAL)),
    ])

    await act(async () => {
      ;(filterSwitch(renderer).props.onValueChange as (v: boolean) => void)(
        false,
      )
    })
    expect(rowLabels(renderer)).toHaveLength(CATALOG.translations.length)
  })

  it("online, starts with the whole catalog and can filter to the device", async () => {
    const { renderer } = await render()
    expect(filterSwitch(renderer).props.value).toBe(false)
    await act(async () => {
      ;(filterSwitch(renderer).props.onValueChange as (v: boolean) => void)(
        true,
      )
    })
    expect(rowLabels(renderer)).toEqual([
      rowLabel(CATALOG.byId.get("BSB")!, { kind: "bundled" }),
    ])
  })

  it("keeps the current translation in view when the filter hides it", async () => {
    const { renderer } = await render({ offline: true, activeId: "spa_r09" })
    const current = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessible === true &&
        node.props.accessibilityLabel ===
          rowLabel(CATALOG.byId.get("spa_r09")!, NOT_DOWNLOADED),
    )
    expect(current).toHaveLength(1)
  })

  it("shows the download state and follows it live", async () => {
    const { renderer, downloads } = await render()
    expect(downloads.check).toHaveBeenCalled()
    await act(async () => {
      downloads.set("rus_syn", {
        kind: "downloading",
        phase: "transfer",
        percent: 45,
        bytesWritten: 45,
        totalBytes: 100,
      })
    })
    expect(
      rowLabels(renderer).filter((label) =>
        label.startsWith(`${SYNODAL.name}, `),
      ),
    ).toEqual([`${SYNODAL.name}, ${COPY.complete}, ${COPY.downloading(45)}`])
  })

  it("hands the tapped translation to the caller", async () => {
    const { renderer, onPick } = await render()
    await search(renderer, "Synodal")
    await act(async () => {
      rowFor(renderer, rowLabel(SYNODAL, NOT_DOWNLOADED)).props.onPress?.()
    })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(SYNODAL)
  })

  // U14, R37: a pick is a translation change from the one on screen.
  it("logs a pick of another translation, from the shown one", async () => {
    const info = datadogLog.info as unknown as jest.Mock
    info.mockClear()
    const { renderer, onPick } = await render({ activeId: "BSB" })
    await search(renderer, "Synodal")
    await act(async () => {
      rowFor(renderer, rowLabel(SYNODAL, NOT_DOWNLOADED)).props.onPress?.()
    })
    expect(onPick).toHaveBeenCalledWith(SYNODAL)
    expect(info.mock.calls).toEqual([
      [
        "bible_reader.translation_changed",
        {
          reader_change: "picked",
          reader_from_translation_id: "BSB",
          reader_to_translation_id: "rus_syn",
        },
      ],
    ])
  })

  it("logs no change for a pick of the translation already shown", async () => {
    // SYNTHETIC: SearchableListSheet shows the active translation as a plain
    // "Current" row, so no tap reaches this. It pins the guard in case the
    // row ever becomes a tap target.
    const info = datadogLog.info as unknown as jest.Mock
    info.mockClear()
    const { renderer, onPick } = await render({ activeId: SYNODAL.id })
    const [list] = renderer.root.findAll(
      (node) => typeof node.props.onSelect === "function",
    )
    expect(list).toBeDefined()
    await act(async () => {
      ;(list!.props.onSelect as (item: CatalogTranslation) => void)(SYNODAL)
    })
    expect(onPick).toHaveBeenCalledWith(SYNODAL)
    expect(info).not.toHaveBeenCalled()
  })

  it("shows the credit under each row", async () => {
    const { renderer } = await render()
    await search(renderer, "Synodal")
    const credits = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" && node.props.children === SYNODAL.credit,
    )
    expect(credits).toHaveLength(1)
  })

  it("draws in the reader's colors", async () => {
    const { renderer } = await render()
    const [input] = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityLabel === COPY.searchLabel &&
        "placeholderTextColor" in node.props,
    )
    const style = StyleSheet.flatten(input?.props.style as never) as {
      color?: string
    }
    expect(style.color).toBe(TOKENS.text)
    expect(input?.props.placeholderTextColor).toBe(TOKENS.secondaryText)
  })

  it("closes from a button", async () => {
    const { renderer, onClose } = await render()
    const [close] = renderer.root.findAll(
      (node) =>
        typeof node.type !== "string" &&
        node.props.accessibilityLabel === READER_SHEET_COPY.close &&
        typeof node.props.onPress === "function",
    )
    await act(async () => {
      close?.props.onPress?.()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe("TranslationPicker under StrictMode", () => {
  it("subscribes once and still follows the store after the double mount", async () => {
    const { renderer, downloads } = await render({}, (element) => (
      <StrictMode>{element}</StrictMode>
    ))
    expect(downloads.listenerCount()).toBe(1)
    await act(async () => {
      downloads.set("rus_syn", { kind: "failed", reason: "network" })
    })
    expect(
      rowLabels(renderer).filter((label) =>
        label.startsWith(`${SYNODAL.name}, `),
      ),
    ).toEqual([`${SYNODAL.name}, ${COPY.complete}, ${COPY.downloadStopped}`])
    await unmount(renderer)
    mounted = null
    expect(downloads.listenerCount()).toBe(0)
  })
})
