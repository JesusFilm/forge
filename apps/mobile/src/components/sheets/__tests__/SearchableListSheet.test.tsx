/**
 * The shared list sheet (feat-553 U10, KTD12). Existing callers pass no
 * color set and must keep today's dark look; the reader's sheets pass the
 * reader's tokens, keep their own row order, and add a credit line.
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

import { act } from "react"
import { StyleSheet } from "react-native"

import { ACCENT, TEXT_PRIMARY, TEXT_SECONDARY } from "../../../lib/color"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  DEFAULT_LIST_SHEET_COLORS,
  SearchableListSheet,
  type SearchableListSheetColors,
  type SearchableListSheetProps,
} from "../SearchableListSheet"

type Row = { id: string; name: string; note?: string }

const ROWS: Row[] = [
  { id: "c", name: "Charlie" },
  { id: "a", name: "Alpha", note: "Copyright line A" },
  { id: "b", name: "Bravo" },
]

const SEARCH_LABEL = "Search rows"
const TODAY_SURFACE = "rgba(255, 255, 255, 0.06)"

const READER_COLORS: SearchableListSheetColors = {
  text: "#1c1917",
  secondaryText: "#57534e",
  accent: "#CB333B",
  surface: "rgba(231, 229, 228, 0.8)",
}

let mounted: TestInstance | null = null

async function render(
  overrides: Partial<SearchableListSheetProps<Row>> = {},
): Promise<TestInstance> {
  await act(async () => {
    mounted = TestRenderer.create(
      <SearchableListSheet<Row>
        rows={ROWS}
        activeId="b"
        getSelectionId={(row) => row.id}
        getKey={(row) => row.id}
        getPrimaryLabel={(row) => row.name}
        getSecondaryLabel={() => "Second line"}
        getSearchValues={(row) => [row.name]}
        onSelect={() => {}}
        searchPlaceholder="Search"
        searchAccessibilityLabel={SEARCH_LABEL}
        emptySearchMessage="Nothing here"
        {...overrides}
      />,
    )
  })
  return mounted!
}

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

function hosts(
  renderer: TestInstance,
  predicate: (node: RenderedNode) => boolean,
): RenderedNode[] {
  return renderer.root.findAll(
    (node) => typeof node.type === "string" && predicate(node),
  )
}

function styleOf(node: RenderedNode | undefined): Record<string, unknown> {
  return (StyleSheet.flatten(node?.props.style as never) ?? {}) as Record<
    string,
    unknown
  >
}

function textNode(renderer: TestInstance, text: string): RenderedNode {
  const [node] = hosts(
    renderer,
    (candidate) => candidate.props.children === text,
  )
  if (!node) throw new Error(`no text "${text}"`)
  return node
}

function searchInput(renderer: TestInstance): RenderedNode {
  const [node] = hosts(
    renderer,
    (candidate) =>
      candidate.props.accessibilityLabel === SEARCH_LABEL &&
      "placeholderTextColor" in candidate.props,
  )
  if (!node) throw new Error("no search input")
  return node
}

async function search(renderer: TestInstance, text: string): Promise<void> {
  const input = searchInput(renderer)
  await act(async () => {
    ;(input.props.onChangeText as (value: string) => void)(text)
  })
}

function iconColor(renderer: TestInstance, name: string): unknown {
  const [icon] = renderer.root.findAll((node) => node.props.name === name)
  return icon?.props.color
}

/** The parent of the search input: the rounded search field. */
function searchField(renderer: TestInstance): RenderedNode {
  const [field] = hosts(
    renderer,
    (node) =>
      styleOf(node).borderRadius === 8 &&
      styleOf(node).flexDirection === "row" &&
      styleOf(node).paddingVertical === 10,
  )
  if (!field) throw new Error("no search field")
  return field
}

function primaryLabels(renderer: TestInstance): string[] {
  return hosts(
    renderer,
    (node) =>
      node.props.accessibilityRole === "radio" &&
      typeof node.props.accessibilityLabel === "string",
  ).map((node) => node.props.accessibilityLabel as string)
}

describe("SearchableListSheet colors", () => {
  it("keeps today's dark colors when a caller passes no color set", async () => {
    const renderer = await render()
    expect(DEFAULT_LIST_SHEET_COLORS).toEqual({
      text: TEXT_PRIMARY,
      secondaryText: TEXT_SECONDARY,
      accent: ACCENT,
      surface: TODAY_SURFACE,
    })
    const input = searchInput(renderer)
    expect(styleOf(input).color).toBe(TEXT_PRIMARY)
    expect(input.props.placeholderTextColor).toBe(TEXT_SECONDARY)
    expect(styleOf(searchField(renderer)).backgroundColor).toBe(TODAY_SURFACE)
    expect(iconColor(renderer, "search-outline")).toBe(TEXT_SECONDARY)
    expect(iconColor(renderer, "checkmark")).toBe(ACCENT)
    expect(styleOf(textNode(renderer, "Alpha")).color).toBe(TEXT_PRIMARY)
    expect(styleOf(textNode(renderer, "Current")).color).toBe(TEXT_SECONDARY)
    const secondLines = hosts(
      renderer,
      (node) => node.props.children === "Second line",
    )
    expect(secondLines.length).toBeGreaterThan(0)
    for (const line of secondLines) {
      expect(styleOf(line).color).toBe(TEXT_SECONDARY)
    }
    const [activeRow] = hosts(
      renderer,
      (node) =>
        node.props.accessible === true &&
        node.props.accessibilityLabel === "Bravo",
    )
    expect(styleOf(activeRow).backgroundColor).toBe(TODAY_SURFACE)
  })

  it("draws every part in the color set a caller passes", async () => {
    const renderer = await render({ colors: READER_COLORS })
    const input = searchInput(renderer)
    expect(styleOf(input).color).toBe(READER_COLORS.text)
    expect(input.props.placeholderTextColor).toBe(READER_COLORS.secondaryText)
    expect(styleOf(searchField(renderer)).backgroundColor).toBe(
      READER_COLORS.surface,
    )
    expect(iconColor(renderer, "search-outline")).toBe(
      READER_COLORS.secondaryText,
    )
    expect(iconColor(renderer, "checkmark")).toBe(READER_COLORS.accent)
    expect(styleOf(textNode(renderer, "Alpha")).color).toBe(READER_COLORS.text)
    expect(styleOf(textNode(renderer, "Current")).color).toBe(
      READER_COLORS.secondaryText,
    )
    const [activeRow] = hosts(
      renderer,
      (node) =>
        node.props.accessible === true &&
        node.props.accessibilityLabel === "Bravo",
    )
    expect(styleOf(activeRow).backgroundColor).toBe(READER_COLORS.surface)
  })

  it("colors the empty-search message too", async () => {
    const renderer = await render({ colors: READER_COLORS, rows: [] })
    expect(styleOf(textNode(renderer, "Nothing here")).color).toBe(
      READER_COLORS.secondaryText,
    )
  })
})

describe("SearchableListSheet row order", () => {
  it("sorts rows by name by default", async () => {
    const renderer = await render({ activeId: null })
    expect(primaryLabels(renderer)).toEqual(["Alpha", "Bravo", "Charlie"])
  })

  it("keeps the caller's order when asked, still without the active row", async () => {
    const renderer = await render({ keepRowOrder: true })
    expect(primaryLabels(renderer)).toEqual(["Charlie", "Alpha"])
  })

  it("reads no hidden row's name on a search keystroke when it keeps the order", async () => {
    const rows: Row[] = [
      { id: "e", name: "Echo" },
      { id: "c", name: "Charlie" },
      { id: "a", name: "Alpha" },
      { id: "b", name: "Bravo" },
    ]
    const getPrimaryLabel = jest.fn((row: Row) => row.name)
    const renderer = await render({ rows, keepRowOrder: true, getPrimaryLabel })
    getPrimaryLabel.mockClear()

    await search(renderer, "c")

    expect(primaryLabels(renderer)).toEqual(["Echo", "Charlie"])
    expect(getPrimaryLabel).toHaveBeenCalled()
    // A sort compares every row by name, so it reads Alpha too.
    const read = getPrimaryLabel.mock.calls.map(([row]) => row.id)
    expect(read).not.toContain("a")
  })
})

describe("SearchableListSheet detail line", () => {
  it("shows a detail line under a row, on up to two lines", async () => {
    const renderer = await render({
      activeId: null,
      getDetailLabel: (row) => row.note ?? null,
    })
    const detail = textNode(renderer, "Copyright line A")
    expect(detail.props.numberOfLines).toBe(2)
    expect(styleOf(detail).color).toBe(TEXT_SECONDARY)
    // A screen reader hears the name and the status, not the credit.
    expect(primaryLabels(renderer)).toContain("Alpha")
  })
})
