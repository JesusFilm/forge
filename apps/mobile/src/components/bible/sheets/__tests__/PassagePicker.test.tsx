/**
 * The passage picker (feat-551 U10, R17, KD15, R42): a book, a chapter, and
 * a verse, in the shown translation's own numbers. The pick reaches the
 * caller in BSB numbering, which the saved position uses (R38).
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
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}))
jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: () => () => {} }),
}))

import { act } from "react"
import { StyleSheet } from "react-native"

import { BIBLE_BOOKS, type UsfmBookId } from "../../../../lib/bible/text/books"
import { readerTokens } from "../../../../lib/bible/theme/palettes"
import type { VerseRef } from "../../../../lib/bible/versification/convert"
import { READER_SHEET_COPY } from "../../../../lib/bible/sheets/copy"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../../test-utils/rnTestRenderer"
import { PassagePicker, type PassagePickerProps } from "../PassagePicker"

const COPY = READER_SHEET_COPY.passage
const TOKENS = readerTokens("classic", "light")
const ALL: ReadonlySet<UsfmBookId> = new Set(BIBLE_BOOKS.map((b) => b.usfm))
const NEW_TESTAMENT: ReadonlySet<UsfmBookId> = new Set(
  BIBLE_BOOKS.filter((b) => b.testament === "new").map((b) => b.usfm),
)
const SYNODAL = { id: "rus_syn", shortName: "SYN", books: ALL }

let mounted: TestInstance | null = null

async function render(
  overrides: Partial<PassagePickerProps> = {},
): Promise<{ renderer: TestInstance; onPick: jest.Mock; onClose: jest.Mock }> {
  const onPick = jest.fn()
  const onClose = jest.fn()
  await act(async () => {
    mounted = TestRenderer.create(
      <PassagePicker
        tokens={TOKENS}
        translation={SYNODAL}
        current={null}
        onPick={onPick}
        onClose={onClose}
        {...overrides}
      />,
    )
  })
  return { renderer: mounted!, onPick, onClose }
}

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
})

function pressables(renderer: TestInstance, label: string): RenderedNode[] {
  return renderer.root.findAll(
    (node) =>
      typeof node.type !== "string" &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )
}

async function press(renderer: TestInstance, label: string): Promise<void> {
  const [target] = pressables(renderer, label)
  if (!target) throw new Error(`no control labelled "${label}"`)
  await act(async () => {
    target.props.onPress?.()
  })
}

function labelsWithPrefix(renderer: TestInstance, prefix: string): string[] {
  return renderer.root
    .findAll(
      (node) =>
        typeof node.type !== "string" &&
        typeof node.props.onPress === "function" &&
        typeof node.props.accessibilityLabel === "string" &&
        node.props.accessibilityLabel.startsWith(prefix),
    )
    .map((node) => node.props.accessibilityLabel as string)
}

function isSelected(renderer: TestInstance, label: string): boolean {
  const [target] = pressables(renderer, label)
  const state = target?.props.accessibilityState as
    | { selected?: boolean }
    | undefined
  return state?.selected === true
}

describe("PassagePicker", () => {
  it("goes book, chapter, verse, and picks in BSB numbering (AE11)", async () => {
    const { renderer, onPick } = await render()
    expect(pressables(renderer, "Psalms")).toHaveLength(1)

    await press(renderer, "Psalms")
    // Synodal numbers the Psalms with the Greek count.
    expect(labelsWithPrefix(renderer, "Chapter ")).toHaveLength(150)
    await press(renderer, COPY.chapter(22))
    expect(labelsWithPrefix(renderer, "Verse ")).toHaveLength(6)
    expect(onPick).not.toHaveBeenCalled()

    await press(renderer, COPY.verse(1))
    expect(onPick).toHaveBeenCalledTimes(1)
    const expected: VerseRef = { book: "PSA", chapter: 23, verse: 1 }
    expect(onPick).toHaveBeenCalledWith(expected)
  })

  it("counts the verses in the shown numbering (AE17)", async () => {
    const { renderer, onPick } = await render()
    await press(renderer, "Psalms")
    await press(renderer, COPY.chapter(50))
    expect(labelsWithPrefix(renderer, "Verse ")).toHaveLength(21)
    await press(renderer, COPY.verse(3))
    expect(onPick).toHaveBeenCalledWith({ book: "PSA", chapter: 51, verse: 1 })
  })

  it("picks once on a fast double tap", async () => {
    const { renderer, onPick } = await render({ translation: null })
    await press(renderer, "John")
    await press(renderer, COPY.chapter(3))
    await press(renderer, COPY.verse(16))
    await press(renderer, COPY.verse(17))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith({ book: "JHN", chapter: 3, verse: 16 })
  })

  it("goes back a step at a time", async () => {
    const { renderer } = await render()
    await press(renderer, "John")
    await press(renderer, COPY.chapter(3))
    expect(labelsWithPrefix(renderer, "Verse ")).toHaveLength(36)

    await press(renderer, COPY.goBackTo(COPY.backToChapters))
    expect(labelsWithPrefix(renderer, "Chapter ")).toHaveLength(21)
    await press(renderer, COPY.goBackTo(COPY.backToBooks))
    expect(pressables(renderer, "Genesis")).toHaveLength(1)
    expect(labelsWithPrefix(renderer, "Chapter ")).toHaveLength(0)
  })

  it("marks the current book, chapter, and verse", async () => {
    const { renderer } = await render({
      current: { book: "PSA", chapter: 22, verse: 4 },
    })
    expect(isSelected(renderer, "Psalms")).toBe(true)
    expect(isSelected(renderer, "Genesis")).toBe(false)
    await press(renderer, "Psalms")
    expect(isSelected(renderer, COPY.chapter(22))).toBe(true)
    expect(isSelected(renderer, COPY.chapter(23))).toBe(false)
    await press(renderer, COPY.chapter(22))
    expect(isSelected(renderer, COPY.verse(4))).toBe(true)
  })

  it("keeps a book the translation lacks and numbers it as BSB (R25)", async () => {
    const { renderer, onPick } = await render({
      translation: { id: "xyz_nt", shortName: "XYZ", books: NEW_TESTAMENT },
    })
    const label = `Genesis, ${COPY.notInTranslation("XYZ")}`
    expect(pressables(renderer, label)).toHaveLength(1)
    expect(pressables(renderer, "Matthew")).toHaveLength(1)
    await press(renderer, label)
    expect(labelsWithPrefix(renderer, "Chapter ")).toHaveLength(50)
    await press(renderer, COPY.chapter(1))
    await press(renderer, COPY.verse(1))
    expect(onPick).toHaveBeenCalledWith({ book: "GEN", chapter: 1, verse: 1 })
  })

  it("closes from a button, not only a gesture", async () => {
    const { renderer, onClose } = await render()
    await press(renderer, READER_SHEET_COPY.close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("draws on the reader's page color", async () => {
    const { renderer } = await render()
    const [root] = renderer.root.findAll(
      (node) => node.props.testID === "reader-passage-picker",
    )
    const style = StyleSheet.flatten(root?.props.style as never) as {
      backgroundColor?: string
    }
    expect(style.backgroundColor).toBe(TOKENS.background)
  })
})
