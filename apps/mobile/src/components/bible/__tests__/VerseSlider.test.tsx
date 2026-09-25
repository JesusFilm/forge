// The verse slide across a chapter load (owner, 2026-09-25): the old verse
// waits in place while the next chapter loads, for at most 0.3 s.

import { act } from "react"

import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import type { VerseSlide } from "../../../lib/bible/movement/useReaderMovement"
import type { ChapterPosition } from "../../../lib/bible/text/types"
import { readerTokens } from "../../../lib/bible/theme/palettes"
import {
  VERSE_SLIDE_HOLD_MS,
  VerseSlider,
  type LiveVerse,
  type VerseSliderProps,
} from "../VerseSlider"
import type { VerseAppearance } from "../VerseView"

const TOKENS = readerTokens("classic", "dark")
const APPEARANCE: VerseAppearance = {
  chosenSize: 30,
  osFontScale: 1,
  typeface: "serif",
  lineSpacing: "normal",
  verseNumbers: true,
}
const COLUMN_WIDTH = 300

function verse(number: number, text: string): ChapterPosition {
  return { kind: "verse", verse: { number, lines: [{ text }] } }
}

const LAST = verse(36, "Whoever believes in the Son has eternal life.")
const FIRST = verse(1, "Now Jesus learned that the Pharisees had heard.")

function live(key: string, stop: ChapterPosition): LiveVerse {
  return {
    verseKey: key,
    view: {
      stop,
      textDirection: "ltr",
      appearance: APPEARANCE,
      tokens: TOKENS,
      boxes: {
        centered: { top: 200, height: 400 },
        free: { top: 112, height: 576 },
      },
      columnWidth: COLUMN_WIDTH,
    },
  }
}

const FORWARD: VerseSlide = { id: 1, direction: "forward" }

function props(overrides: Partial<VerseSliderProps>): VerseSliderProps {
  return {
    live: null,
    loading: false,
    slide: null,
    reduceMotion: false,
    clip: { top: 100, height: 600, containerHeight: 900 },
    appearance: APPEARANCE,
    tokens: TOKENS,
    columnWidth: COLUMN_WIDTH,
    ...overrides,
  }
}

let mounted: TestInstance | null = null

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
  jest.useRealTimers()
})

function hosts(predicate: (node: RenderedNode) => boolean) {
  return mounted!.root.findAll(
    (node) => typeof node.type === "string" && predicate(node),
  )
}

const copies = () =>
  hosts((node) => node.props.testID === "bible-verse-outgoing")

function textOf(node: RenderedNode): string {
  const { children } = node.props
  if (typeof children === "string") return children
  if (Array.isArray(children)) {
    return children.filter((child) => typeof child === "string").join("")
  }
  return ""
}

const copyText = () =>
  hosts((node) => node.props.testID === "bible-verse-outgoing-line")
    .map(textOf)
    .join(" ")

async function render(next: VerseSliderProps) {
  await act(async () => {
    if (mounted) mounted.update(<VerseSlider {...next} />)
    else mounted = TestRenderer.create(<VerseSlider {...next} />)
  })
}

/** Answers the fit's measuring copies, so the live verse shows. */
async function settle() {
  for (let pass = 0; pass < 4; pass += 1) {
    const measuring = hosts((node) =>
      String(node.props.testID ?? "").startsWith("bible-verse-measure-"),
    )
    if (measuring.length === 0) return
    await act(async () => {
      for (const copy of measuring) {
        const onLayout = copy.props.onLayout as (event: unknown) => void
        onLayout({
          nativeEvent: {
            layout: { x: 0, y: 0, width: COLUMN_WIDTH, height: 100 },
          },
        })
      }
    })
  }
}

describe("VerseSlider across a chapter load", () => {
  it("keeps the old verse in place while the chapter loads, then slides it out", async () => {
    await render(props({ live: live("JHN.3:35", LAST) }))
    await settle()
    expect(copies()).toHaveLength(0)

    await render(props({ live: null, loading: true, slide: FORWARD }))
    expect(copies()).toHaveLength(1)
    expect(copyText()).toContain("eternal life")

    await render(props({ live: live("JHN.4:0", FIRST), slide: FORWARD }))
    await settle()
    expect(copies()).toHaveLength(1)
    expect(copyText()).toContain("eternal life")
  })

  it("lets the old verse go after 0.3 s, and then does not slide", async () => {
    jest.useFakeTimers()
    await render(props({ live: live("JHN.3:35", LAST) }))
    await settle()
    await render(props({ live: null, loading: true, slide: FORWARD }))
    expect(copies()).toHaveLength(1)

    await act(async () => {
      jest.advanceTimersByTime(VERSE_SLIDE_HOLD_MS)
    })
    expect(copies()).toHaveLength(0)

    await render(props({ live: live("JHN.4:0", FIRST), slide: FORWARD }))
    await settle()
    expect(copies()).toHaveLength(0)
  })

  it("holds nothing while a failure shows", async () => {
    await render(props({ live: live("JHN.3:35", LAST) }))
    await settle()
    await render(props({ live: null, loading: false, slide: FORWARD }))
    expect(copies()).toHaveLength(0)
  })
})
