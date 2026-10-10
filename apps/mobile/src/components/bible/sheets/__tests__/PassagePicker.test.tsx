/**
 * The passage picker (feat-553 U10, R17, KD15, R42): a book, a chapter, and
 * a verse, in the shown translation's own numbers. The pick reaches the
 * caller in BSB numbering, which the saved position uses (R38).
 */

// tsconfig maps `react` to its .d.ts; re-point it (see MyWatchHeader.test.tsx).
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
// A fixture catalog's missing key logs once through Datadog; keep it quiet.
jest.mock("../../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
// A fixture `es` catalog joins the real set; English cases never start the
// store, so they read en.json as before.
jest.mock("../../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../../i18n/catalogs.generated"),
      {
        es: {
          BiblePassagePicker: {
            chooseBook: "Elige un libro",
            chapterAriaLabel: "Capítulo {chapter}",
            verseAriaLabel: "Versículo {verse}",
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
import { StyleSheet } from "react-native"

import type { BookNames } from "../../../../lib/bible/repository/bookNames"
import { BIBLE_BOOKS, type UsfmBookId } from "../../../../lib/bible/text/books"
import { readerTokens } from "../../../../lib/bible/theme/palettes"
import type { VerseRef } from "../../../../lib/bible/versification/convert"
import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../../i18n/localeStore"
import { getT } from "../../../../i18n/useT"
import { phoneLocales } from "../../../../test-utils/uiLocaleFixture"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../../test-utils/rnTestRenderer"
import { PassagePicker, type PassagePickerProps } from "../PassagePicker"

const passageT = getT("BiblePassagePicker")
const readerT = getT("BibleReader")
const COPY = {
  chapter: (chapter: number) => passageT("chapterAriaLabel", { chapter }),
  verse: (verse: number) => passageT("verseAriaLabel", { verse }),
  goBackTo: (label: string) => readerT("sheetBackAriaLabel", { label }),
  backToBooks: passageT("books"),
  backToChapters: passageT("chapters"),
  notInTranslation: (shortName: string) =>
    passageT("notInTranslation", { shortName }),
  chapterTitle: (bookName: string, chapter: number) => `${bookName} ${chapter}`,
}
const TOKENS = readerTokens("light")
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
        standIn={null}
        bookNames={null}
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

  // The owner (2026-09-28): a Korean reader must see 창세기, not Genesis.
  describe("book names in the shown translation", () => {
    const KOREAN: BookNames = new Map<UsfmBookId, string>([
      ["GEN", "창세기"],
      ["EXO", "출애굽기"],
      ["MAT", "마태복음"],
    ])
    const texts = (renderer: TestInstance, text: string) =>
      renderer.root.findAll(
        (node) => node.type === "Text" && node.props.children === text,
      )

    it("names each book, and each step's title, as the translation does", async () => {
      const { renderer } = await render({ bookNames: KOREAN })
      expect(pressables(renderer, "창세기")).toHaveLength(1)
      expect(pressables(renderer, "출애굽기")).toHaveLength(1)
      expect(pressables(renderer, "Genesis")).toHaveLength(0)
      // A book with no name from the translation keeps its English name.
      expect(pressables(renderer, "Leviticus")).toHaveLength(1)

      await press(renderer, "창세기")
      expect(texts(renderer, "창세기")).not.toHaveLength(0)
      await press(renderer, COPY.chapter(3))
      expect(texts(renderer, COPY.chapterTitle("창세기", 3))).not.toHaveLength(
        0,
      )
    })

    it("keeps the English name, and the note, for a book the translation lacks", async () => {
      const { renderer } = await render({
        translation: { id: "xyz_nt", shortName: "XYZ", books: NEW_TESTAMENT },
        bookNames: new Map([["MAT", "마태복음"]]),
      })
      const label = `Genesis, ${COPY.notInTranslation("XYZ")}`
      expect(pressables(renderer, label)).toHaveLength(1)
      expect(pressables(renderer, "마태복음")).toHaveLength(1)
    })
  })

  it("closes from a button, not only a gesture", async () => {
    const { renderer, onClose } = await render()
    await press(renderer, readerT("sheetCloseAriaLabel"))
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

describe("PassagePicker in another UI language", () => {
  afterEach(() => {
    resetLocaleStoreForTests()
    mockGetLocales.mockReset()
  })

  it("formats each chapter's label with its number from the catalog", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("es-ES"))
    startLocaleSync()
    const { renderer } = await render()

    const title = renderer.root.findAll(
      (node) =>
        node.type === "Text" && node.props.children === "Elige un libro",
    )
    expect(title).toHaveLength(1)
    await press(renderer, "Psalms")

    expect(pressables(renderer, "Capítulo 23")).toHaveLength(1)
    expect(pressables(renderer, "Capítulo 150")).toHaveLength(1)
    expect(labelsWithPrefix(renderer, "Chapter ")).toEqual([])
    await press(renderer, "Capítulo 23")
    expect(pressables(renderer, "Versículo 6")).toHaveLength(1)
  })

  it("keeps each cell's Datadog name when the language changes", async () => {
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
    const { renderer } = await render()
    await press(renderer, "Psalms")
    const english = pressables(renderer, "Chapter 23")[0]?.props[
      "dd-action-name"
    ]

    mockGetLocales.mockReturnValue(phoneLocales("es-ES"))
    await act(async () => {
      refreshLocale()
    })

    const cell = pressables(renderer, "Capítulo 23")[0]
    expect(english).toBe("bible-passage-chapter")
    expect(cell?.props["dd-action-name"]).toBe(english)
  })
})
