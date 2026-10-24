/**
 * @vitest-environment node
 *
 * Crawler contract: the collapsed transcript text must be present in the
 * SERVER-RENDERED markup, complete and as real text. Search and AI/chat
 * crawlers that do not execute JavaScript read it from this HTML, so a
 * client-only or truncated render would silently de-index every transcript.
 *
 * These run in the `node` environment on purpose: no DOM, no effects, no
 * hydration -- exactly what a non-executing crawler sees.
 */

import { createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { MuxPlayerRef } from "@forge/video-player"

import { SubtitleTranscript } from "@/components/watch/SubtitleTranscript"
import type { WatchSubtitle } from "@/lib/content"
import { formatCompactTranscript } from "@/lib/subtitle-transcript"

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string): string =>
      key,
}))

const subtitle: WatchSubtitle = {
  documentId: "subtitle-en",
  language: {
    slug: "english",
    name: "English",
    nativeName: null,
    bcp47: "en",
  },
  vttSrc: "https://cdn.example/en.vtt",
  primary: true,
  aiGenerated: false,
}

const cues = Array.from({ length: 600 }, (_, index) => ({
  start: index * 4,
  end: index * 4 + 3,
  text: `Cue ${index + 1} carries meaningful indexable words about Nazareth.`,
}))

function renderServerMarkup(): string {
  return renderToStaticMarkup(
    <SubtitleTranscript
      subtitles={[subtitle]}
      audioSlug={null}
      playerRef={createRef<MuxPlayerRef | null>()}
      initialTranscript={{
        vttSrc: subtitle.vttSrc,
        compactText: formatCompactTranscript(cues),
      }}
    />,
  )
}

describe("SubtitleTranscript server-rendered markup", () => {
  it("contains every cue's text in the initial HTML", () => {
    const html = renderServerMarkup()

    for (const cue of cues) {
      expect(html).toContain(cue.text)
    }
    expect(html).toContain("Cue 1 ")
    expect(html).toContain("Cue 600 ")
  })

  it("emits the transcript as text, not as a script payload or an empty shell", () => {
    const html = renderServerMarkup()

    // No <script> smuggling: the text is in the markup itself.
    expect(html).not.toContain("<script")
    // The clamp hides overflow visually; it must not shorten the text. Compare
    // against the full formatted string rather than a sampled substring.
    const full = formatCompactTranscript(cues)
    expect(html).toContain(full.split("\n")[0]!)
    expect(html).toContain(full.split("\n").at(-1)!)
    // A crawler-visible character budget: all 600 cues, not a first-N slice.
    expect(html.length).toBeGreaterThan(full.length)
  })

  it("does not nest the text inside an interactive element", () => {
    const html = renderServerMarkup()

    // The teaser must not be WRAPPED in a <button>: role=button is
    // children-presentational, which hides the text from assistive tech and
    // from crawlers that consume the accessibility tree. The header chevron is
    // legitimately a button and legitimately precedes the text, so counting
    // open vs closed tags before the text is the honest check: equal counts
    // mean every button opened so far is already closed.
    const textIndex = html.indexOf("Cue 1 ")
    expect(textIndex).toBeGreaterThan(-1)
    const before = html.slice(0, textIndex)
    const opened = before.split("<button").length - 1
    const closed = before.split("</button>").length - 1
    expect(opened).toBeGreaterThan(0) // the header chevron exists
    expect(opened).toBe(closed) // ...and the text sits outside it
  })
})
