import { isValidElement, type ReactElement } from "react"
import { FlatList, Platform, Text } from "react-native"
import type { WatchChildLanguage } from "../../lib/normalizeVideo"
import type { TrackChoiceOption } from "../watch/androidTrackChoiceSession"
import { SeriesLanguagePanel } from "./SeriesLanguagePanel"
import { WatchOptionRow } from "../watch/WatchOptionRow"
import { PanelLoading } from "../watch/PanelLoading"

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useMemo: (calculate: () => unknown) => calculate(),
  useCallback: (callback: unknown) => callback,
  useEffect: jest.fn(),
  useRef: () => ({ current: null }),
  useState: () => [true, jest.fn()],
}))
// Inspect the panel's elements without RN's Modal mock importing its native
// presenter through requireActual, which needs a bridge absent on CI workers.
jest.mock("react-native/Libraries/Modal/Modal", () => ({
  __esModule: true,
  default: "Modal",
}))
jest.mock("../watch/AndroidTrackChoice", () => ({
  AndroidTrackChoice: () => null,
}))
jest.mock("../TVFocusGuideView", () => ({ TVFocusGuideView: () => null }))
jest.mock("../watch/WatchOptionRow", () => ({ WatchOptionRow: () => null }))

function panel(
  overrides: Partial<Parameters<typeof SeriesLanguagePanel>[0]> = {},
  platform: "android" | "ios" = "android",
) {
  jest.replaceProperty(Platform, "OS", platform)
  const props = {
    visible: true,
    languages: [] as WatchChildLanguage[],
    activeSlug: null,
    loading: false,
    error: false,
    onRetry: jest.fn(),
    onSelect: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  }
  const element = SeriesLanguagePanel(props) as ReactElement<{
    status: string | null
    selected: string | null
    options: TrackChoiceOption[]
    onSelect: (id: string) => void | false
  }> | null
  return { props, element }
}

afterEach(() => jest.restoreAllMocks())

it("shows loading rather than an empty result while the language query runs", () => {
  const { element } = panel({ loading: true })
  expect(element?.props.status).toBe("Loading languages…")
  expect(element?.props.options).toEqual([])
})

it("distinguishes a failed query and offers a pinned retry without closing", () => {
  const { props, element } = panel({ error: true })
  expect(element?.props.status).toBe("Couldn’t load languages")
  expect(element?.props.options).toEqual([
    { id: "__retry__", label: "Try again", pinned: true },
  ])
  expect(element?.props.onSelect("__retry__")).toBe(false)
  expect(props.onRetry).toHaveBeenCalledTimes(1)
  expect(props.onClose).not.toHaveBeenCalled()
})

it("does not offer a second retry while the first retry is loading", () => {
  const { element } = panel({ loading: true, error: true })
  expect(element?.props.status).toBe("Loading languages…")
  expect(element?.props.options).toEqual([])
})

it("reports an empty catalogue only after the query finishes successfully", () => {
  expect(panel().element?.props.status).toBe("No languages available")
})

it("selects stable language slugs without requiring a playable trailer", () => {
  const { props, element } = panel({
    languages: [{ slug: "thai", name: "Thai", bcp47: "th" }],
    activeSlug: "thai",
  })
  expect(element?.props.status).toBeNull()
  expect(element?.props.selected).toBe("thai")
  expect(element?.props.options).toEqual([
    { id: "thai", label: "Thai", searchText: "th" },
  ])
  element?.props.onSelect("thai")
  expect(props.onSelect).toHaveBeenCalledWith("thai")
})

it("rejects a stale choice absent from the current language union", () => {
  const { props, element } = panel()
  element?.props.onSelect("removed-language")
  expect(props.onSelect).not.toHaveBeenCalled()
  expect(props.onClose).toHaveBeenCalledTimes(1)
})

it("does not create a native picker while hidden", () => {
  expect(panel({ visible: false }).element).toBeNull()
})

type Element = ReactElement<Record<string, unknown>>
function descendants(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...descendants(node.props.children)]
}

function applePanel(
  overrides: Partial<Parameters<typeof SeriesLanguagePanel>[0]>,
) {
  const { props, element } = panel(overrides, "ios")
  const render = element?.type as (input: typeof props) => ReactElement
  const tree = render(props)
  const nodes = descendants(tree)
  const options = nodes.filter((node) => node.type === WatchOptionRow)
  return {
    props,
    tree,
    nodes,
    list: nodes.find((node) => node.type === FlatList),
    close: options.find((node) => node.props.label === "Close"),
    retry: options.find((node) => node.props.label === "Try again"),
    text: nodes
      .filter((node) => node.type === Text)
      .map((node) => node.props.children),
  }
}

it("Apple loading shows progress and keeps Close reachable without mounting the list", () => {
  const view = applePanel({ loading: true })
  expect(
    view.nodes.find((node) => node.type === PanelLoading)?.props.label,
  ).toBe("Loading languages…")
  expect(view.list).toBeUndefined()
  expect(view.retry).toBeUndefined()
  expect(view.text).not.toContain("No languages available")
  expect(view.close?.props.hasTVPreferredFocus).toBe(true)
  ;(view.close?.props.onPress as () => void)()
  expect(view.props.onClose).toHaveBeenCalledTimes(1)
})

it("Apple failed language requests expose retry and Close without a false empty state", () => {
  const view = applePanel({ error: true })
  expect(view.text).toContain("Couldn’t load languages")
  expect(view.text).not.toContain("No languages available")
  expect(view.list).toBeUndefined()
  expect(view.retry?.props.hasTVPreferredFocus).toBe(true)
  expect(view.close).toBeDefined()
  ;(view.retry?.props.onPress as () => void)()
  expect(view.props.onRetry).toHaveBeenCalledTimes(1)
  expect(view.props.onClose).not.toHaveBeenCalled()
})

it("Apple retry loading suppresses a previous error and duplicate retry", () => {
  const view = applePanel({ loading: true, error: true })
  expect(view.nodes.some((node) => node.type === PanelLoading)).toBe(true)
  expect(view.text).not.toContain("Couldn’t load languages")
  expect(view.retry).toBeUndefined()
})

it("Apple successful empty responses show an explicit message and focused Close", () => {
  const view = applePanel({})
  expect(view.text).toContain("No languages available")
  expect(view.list).toBeUndefined()
  expect(view.close?.props.hasTVPreferredFocus).toBe(true)
})

it("Apple async arrival mounts the list at the active language with a preferred focus row", () => {
  const languages = Array.from({ length: 20 }, (_, index) => ({
    slug: `language-${index}`,
    name: `Language ${String(index).padStart(2, "0")}`,
    bcp47: null,
  }))
  expect(
    applePanel({ languages, activeSlug: "language-18", loading: true }).list,
  ).toBeUndefined()
  const view = applePanel({ languages, activeSlug: "language-18" })
  expect(view.list?.props.initialScrollIndex).toBe(18)
  const rows = view.list?.props.data as {
    language: WatchChildLanguage
    active: boolean
  }[]
  const renderItem = view.list?.props.renderItem as (input: {
    item: (typeof rows)[number]
  }) => Element
  const active = renderItem({ item: rows[18] })
  expect(active.props.hasTVPreferredFocus).toBe(true)
  ;(active.props.onPress as () => void)()
  expect(view.props.onSelect).toHaveBeenCalledWith("language-18")
})
