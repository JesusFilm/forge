import { useRef, useState } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useSheetListHeight } from "../../../hooks/useSheetListHeight"
import { useT, type UiT } from "../../../i18n/useT"
import { READER_TOUCH_TARGET } from "../../../lib/bible/reader/chrome"
import { chapterLabel } from "../../../lib/bible/reader/labels"
import {
  chapterNumbers,
  numberingFor,
  passageBooks,
  pickedBsbRef,
  verseNumbers,
  type PassageBook,
  type PassageTranslation,
} from "../../../lib/bible/sheets/passageSteps"
import { readerSheetControlColors } from "../../../lib/bible/sheets/theme"
import { bookNameIn } from "../../../lib/bible/reader/useBookNames"
import type { BookNames } from "../../../lib/bible/repository/bookNames"
import type { BibleBook } from "../../../lib/bible/text/books"
import type { ReaderTokens } from "../../../lib/bible/theme/palettes"
import type { VerseRef } from "../../../lib/bible/versification/convert"
import { acceptSheetTap } from "../../../lib/sheetListLogic"
import { feedback, HORIZONTAL_PADDING } from "../../../styles/shared"
import { ReaderSheetHeader } from "./ReaderSheetHeader"

type PassageT = UiT<"BiblePassagePicker">

export type PassagePickerProps = {
  tokens: ReaderTokens
  /** The shown translation; null shows BSB's numbers. */
  translation: (PassageTranslation & { shortName: string }) | null
  /** The translation on screen while a stand-in shows (R25). It numbers the
   *  books that `translation` lacks; null leaves them to BSB. */
  standIn: PassageTranslation | null
  /** The shown translation's own book names; null shows the English names. */
  bookNames: BookNames | null
  /** The current verse in the shown numbering, to mark it. */
  current: VerseRef | null
  /** Called once, in BSB numbering (R38). */
  onPick: (bsbRef: VerseRef) => void
  onClose: () => void
}

type Step =
  | { kind: "book" }
  | { kind: "chapter"; book: BibleBook }
  | { kind: "verse"; book: BibleBook; chapter: number }

// R17's picker: a book, a chapter, then a verse (KD15). The chapter and verse
// steps use the shown translation's own numbers (R42).
export function PassagePicker({
  tokens,
  translation,
  standIn,
  bookNames,
  current,
  onPick,
  onClose,
}: PassagePickerProps) {
  const t = useT("BiblePassagePicker")
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const height = useSheetListHeight(windowHeight)
  const [step, setStep] = useState<Step>({ kind: "book" })
  // A fast double tap must not pick twice and pop the reader under the sheet.
  const lastPickRef = useRef(0)

  // The chapter title is a reference, as in the reader's footer.
  const title =
    step.kind === "book"
      ? t("chooseBook")
      : step.kind === "chapter"
        ? bookNameIn(bookNames, step.book.usfm)
        : chapterLabel(bookNameIn(bookNames, step.book.usfm), step.chapter)
  const back =
    step.kind === "chapter"
      ? { label: t("books"), onPress: () => setStep({ kind: "book" }) }
      : step.kind === "verse"
        ? {
            label: t("chapters"),
            onPress: () => setStep({ kind: "chapter", book: step.book }),
          }
        : undefined

  function pickVerse(book: BibleBook, chapter: number, verse: number): void {
    const now = Date.now()
    if (!acceptSheetTap(now, lastPickRef.current)) return
    lastPickRef.current = now
    const numbering = numberingFor(translation, book.usfm, standIn)
    onPick(pickedBsbRef(numbering, { book: book.usfm, chapter, verse }))
  }

  let body
  if (step.kind === "book") {
    body = (
      <BookList
        t={t}
        tokens={tokens}
        books={passageBooks(translation)}
        currentBook={current?.book ?? null}
        shortName={translation?.shortName ?? null}
        bookNames={bookNames}
        onPress={(book) => setStep({ kind: "chapter", book })}
      />
    )
  } else {
    const numbering = numberingFor(translation, step.book.usfm, standIn)
    const inCurrentBook = current?.book === step.book.usfm
    body =
      step.kind === "chapter" ? (
        <NumberGrid
          tokens={tokens}
          numbers={chapterNumbers(numbering, step.book.usfm)}
          selected={inCurrentBook ? (current?.chapter ?? null) : null}
          label={(chapter) => t("chapterAriaLabel", { chapter })}
          actionName="bible-passage-chapter"
          onPress={(chapter) =>
            setStep({ kind: "verse", book: step.book, chapter })
          }
        />
      ) : (
        <NumberGrid
          tokens={tokens}
          numbers={verseNumbers(numbering, step.book.usfm, step.chapter)}
          selected={
            inCurrentBook && current?.chapter === step.chapter
              ? current.verse
              : null
          }
          label={(verse) => t("verseAriaLabel", { verse })}
          actionName="bible-passage-verse"
          onPress={(verse) => pickVerse(step.book, step.chapter, verse)}
        />
      )
  }

  const stepKey =
    step.kind === "book"
      ? "book"
      : step.kind === "chapter"
        ? `chapter-${step.book.usfm}`
        : `verse-${step.book.usfm}-${step.chapter}`

  return (
    <View
      testID="reader-passage-picker"
      style={[styles.root, { height, backgroundColor: tokens.background }]}
    >
      <View style={styles.header}>
        <ReaderSheetHeader
          tokens={tokens}
          title={title}
          back={back}
          onClose={onClose}
        />
      </View>
      {/* The key resets the scroll to the top at each step. */}
      <ScrollView
        key={stepKey}
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: HORIZONTAL_PADDING,
          paddingBottom: insets.bottom + 24,
        }}
      >
        {body}
      </ScrollView>
    </View>
  )
}

type BookListProps = {
  t: PassageT
  tokens: ReaderTokens
  books: PassageBook[]
  currentBook: string | null
  shortName: string | null
  bookNames: BookNames | null
  onPress: (book: BibleBook) => void
}

function BookList({
  t,
  tokens,
  books,
  currentBook,
  shortName,
  bookNames,
  onPress,
}: BookListProps) {
  const sections = [
    {
      key: "old",
      title: t("oldTestament"),
      books: books.filter((entry) => entry.book.testament === "old"),
    },
    {
      key: "new",
      title: t("newTestament"),
      books: books.filter((entry) => entry.book.testament === "new"),
    },
  ]
  return (
    <>
      {sections.map((section) => (
        <View key={section.key} style={styles.section}>
          <Text
            accessibilityRole="header"
            style={[styles.sectionTitle, { color: tokens.secondaryText }]}
          >
            {section.title}
          </Text>
          {section.books.map(({ book, inTranslation }) => {
            const name = bookNameIn(bookNames, book.usfm)
            const selected = book.usfm === currentBook
            const note =
              !inTranslation && shortName
                ? t("notInTranslation", { shortName })
                : null
            return (
              <Pressable
                key={book.usfm}
                onPress={() => onPress(book)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={
                  note ? t("bookWithNoteAriaLabel", { name, note }) : name
                }
                {...{ "dd-action-name": "bible-passage-book" }}
                style={({ pressed }) => [
                  styles.bookRow,
                  selected && { backgroundColor: tokens.buttonSurface },
                  pressed && feedback.pressed,
                ]}
              >
                <View style={styles.bookText}>
                  <Text
                    style={[
                      styles.bookName,
                      { color: tokens.text },
                      selected && styles.bookNameSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                  {note && (
                    <Text
                      style={[styles.bookNote, { color: tokens.secondaryText }]}
                      numberOfLines={1}
                    >
                      {note}
                    </Text>
                  )}
                </View>
                {selected && (
                  <Ionicons name="checkmark" size={18} color={tokens.icon} />
                )}
              </Pressable>
            )
          })}
        </View>
      ))}
    </>
  )
}

type NumberGridProps = {
  tokens: ReaderTokens
  numbers: number[]
  selected: number | null
  label: (value: number) => string
  /** The Datadog tap name; it never names the number or the language. */
  actionName: string
  onPress: (value: number) => void
}

function NumberGrid({
  tokens,
  numbers,
  selected,
  label,
  actionName,
  onPress,
}: NumberGridProps) {
  const controls = readerSheetControlColors(tokens)
  return (
    <View style={styles.grid}>
      {numbers.map((value) => {
        const isSelected = value === selected
        return (
          <Pressable
            key={value}
            onPress={() => onPress(value)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label(value)}
            {...{ "dd-action-name": actionName }}
            style={({ pressed }) => [
              styles.cell,
              {
                backgroundColor: isSelected
                  ? controls.selectedFill
                  : controls.fill,
              },
              pressed && feedback.pressed,
            ]}
          >
            <Text
              style={[
                styles.cellText,
                { color: isSelected ? controls.selectedText : controls.text },
              ]}
            >
              {value}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const CELL_WIDTH = 56

const styles = StyleSheet.create({
  root: {
    overflow: "hidden",
  },
  header: {
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  scroll: {
    flex: 1,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: "System",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  bookRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  bookText: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
  },
  bookName: {
    fontFamily: "System",
    fontSize: 17,
  },
  bookNameSelected: {
    fontWeight: "600",
  },
  bookNote: {
    fontFamily: "System",
    fontSize: 14,
    marginTop: 2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
  },
  cell: {
    width: CELL_WIDTH,
    minHeight: READER_TOUCH_TARGET + 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cellText: {
    fontFamily: "System",
    fontSize: 17,
    fontVariant: ["tabular-nums"],
  },
})
