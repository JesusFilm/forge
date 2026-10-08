import { describe, expect, it } from "vitest"

import {
  buildDevotionalManifest,
  displayWordTimes,
  type StagedSegment,
} from "./devotional-manifest"
import type { GeneratedDevotional } from "./generate-devotional"

const DEVO: GeneratedDevotional = {
  date: "2026-07-10",
  clip: { index: 19, id: "1_jf6119-0-0", title: "Jesus Calms the Storm" },
  passage: { reference: "Luke 8:22-25", osisRef: "Luke.8.22-Luke.8.25" },
  title: "Peace in the Storm",
  scripture: {
    reference: "Luke 8:24",
    text: "He rebuked the wind and the raging water; and it was calm.",
    translation: "WEB",
    needsCanonicalSource: true,
  },
  reflection: {
    text: "Christ stilled the storm with a word. He is with you in the boat. Trust him.",
    source: "Matthew Henry, Commentary on the Whole Bible",
    attribution: "Adapted from Matthew Henry, Commentary on the Whole Bible",
    flavor: "commentary",
  },
  reflectionHighlights: ["with you in the boat", ""],
  conclusion: "The One who calms the sea is in your boat.",
  question: "What storm do you need to hand to Jesus today?",
  prayer: "Jesus, calm my storm.",
  mood: "peace",
  voice: "male-d",
  sequence: 0,
}

const ALL: StagedSegment[] = [
  {
    id: "cover",
    file: "01-cover.mp3",
    durationSec: 2,
    text: "Peace in the Storm",
  },
  { id: "scripture", file: "02-scripture.mp3", durationSec: 6 },
  {
    id: "reflection-1",
    file: "03-reflection-1.mp3",
    durationSec: 12,
    text: "He is with you in the boat.",
  },
  {
    id: "reflection-2",
    file: "04-reflection-2.mp3",
    durationSec: 11,
    text: "Trust him.",
  },
  { id: "conclusion", file: "05-conclusion.mp3", durationSec: 4 },
  { id: "questions", file: "06-questions.mp3", durationSec: 10 },
]

describe("buildDevotionalManifest", () => {
  const base = {
    devotional: DEVO,
    segments: ALL,
    clipFile: "clip.mp4",
    clipDurationSec: 120,
    musicFile: "music.mp3",
    headerDate: "Jul 10",
  }

  it("opens the stepper on ONE card carrying the spoken line", () => {
    const m = buildDevotionalManifest({
      ...base,
      settleLine: "Let's slow down and give Scripture our attention.",
      segments: [
        ALL[0],
        {
          id: "step-read",
          file: "01c-step-read.mp3",
          durationSec: 5,
          text: "Let’s pause and let Scripture speak",
        },
        { id: "step-watch", file: "02b-step-watch.mp3", durationSec: 2 },
        ...ALL.slice(1),
      ],
    })
    const opening = m.cards[1] as Record<string, unknown>
    expect(opening.kind).toBe("step")
    expect(opening.stepIndex).toBe(0)
    // The line is on screen; the light waits for it to be read.
    expect(opening.headline).toBe("Let’s pause and let Scripture speak")
    // No second stepper card between it and the scripture.
    expect((m.cards[2] as Record<string, unknown>).kind).toBe("scripture")
    // The settle line moved to that card, so the cover must not still show it,
    // and the cover leaves as soon as the hook is spoken (no held beat).
    expect(m.cards[0]).not.toHaveProperty("settleLine")
    expect(m.cards[0]).not.toHaveProperty("holdSec")
    const laterSteps = m.cards.filter(
      (c) => c.kind === "step" && Number(c.stepIndex) > 0,
    )
    expect(laterSteps.length).toBeGreaterThan(0)
    for (const c of laterSteps) expect(c).not.toHaveProperty("headline")
  })

  it("keeps the settle line on the cover when the stepper is off", () => {
    const m = buildDevotionalManifest({
      ...base,
      settleLine: "Let's slow down and give Scripture our attention.",
    })
    expect(m.cards[0]).toHaveProperty(
      "settleLine",
      "Let's slow down and give Scripture our attention.",
    )
  })

  it("produces cover→scripture→video→reflection×N→conclusion→questions (no CTA)", () => {
    const m = buildDevotionalManifest(base)
    expect(m.cards.map((c) => c.kind)).toEqual([
      "cover",
      "scripture",
      "video",
      "reflection-focus",
      "reflection-focus",
      "conclusion",
      "questions",
    ])
    expect(m.cards.some((c) => c.kind === "cta")).toBe(false)
    expect(m.musicFile).toBe("music.mp3")
  })

  it("leaves the video card un-narrated (clip audio only) and adds the conclusion card", () => {
    const m = buildDevotionalManifest(base)
    const video = m.cards.find((c) => c.kind === "video")!
    expect(video.audioFile).toBeUndefined() // "Let's watch" rides on the scripture card
    const conclusion = m.cards.find((c) => c.kind === "conclusion")!
    expect(conclusion.text).toBe(DEVO.conclusion)
    expect(conclusion.audioFile).toBe("05-conclusion.mp3")
  })

  it("puts the single question + invitation-to-pray on one card, with dwell time (5s base + 5s owner rule for the LAST card = 10s)", () => {
    const m = buildDevotionalManifest(base)
    const q = m.cards.find((c) => c.kind === "questions")!
    expect(q.questions).toEqual([DEVO.question])
    expect(q.prayer).toBe(DEVO.prayer)
    expect(q.audioFile).toBe("06-questions.mp3")
    expect(q.holdSec).toBe(10)
  })

  it("gives the +5s owner-rule hold to whichever card ends up LAST, not a hardcoded kind — 'conclusion' when 'questions' narration wasn't produced", () => {
    const withoutQuestions = base.segments.filter((s) => s.id !== "questions")
    const m = buildDevotionalManifest({ ...base, segments: withoutQuestions })
    expect(m.cards.map((c) => c.kind).at(-1)).toBe("conclusion")
    const conclusion = m.cards.find((c) => c.kind === "conclusion")!
    expect(conclusion.holdSec).toBe(7) // 2s base + 5s owner rule
  })

  it("attaches video captions to the video card, dropping any that start after it ends", () => {
    const m = buildDevotionalManifest({
      ...base,
      videoCardSec: 10,
      videoCaptions: [
        { text: "inside", startSec: 1, endSec: 3 },
        { text: "also inside", startSec: 9.5, endSec: 11 },
        { text: "past the card", startSec: 12, endSec: 14 },
      ],
    })
    const video = m.cards.find((c) => c.kind === "video")!
    expect(video.subtitles).toEqual([
      { text: "inside", startSec: 1, endSec: 3 },
      { text: "also inside", startSec: 9.5, endSec: 11 },
    ])
  })

  it("omits the subtitles field entirely when there are no captions", () => {
    const m = buildDevotionalManifest(base)
    const video = m.cards.find((c) => c.kind === "video")!
    expect(video.subtitles).toBeUndefined()
  })

  it("labels 'Reflect' on the first reflection card only + accents the highlight phrase", () => {
    const m = buildDevotionalManifest(base)
    const refl = m.cards.filter((c) => c.kind === "reflection-focus")
    expect(refl[0].text).toBe("He is with you in the boat.")
    expect(refl[0].sectionLabel).toBe("Reflect") // first → default English label
    expect(refl[0].highlight).toBe("with you in the boat") // accent phrase
    expect(refl[1].sectionLabel).toBe("") // rest → suppressed
    expect(refl[1].highlight).toBeUndefined() // "" → no accent
  })

  it("applies localized labels to the reflection + questions cards", () => {
    const m = buildDevotionalManifest({
      ...base,
      labels: {
        reflect: "Подумай",
        askYourself: "Спроси себя",
        pray: "Помолись",
      },
    })
    const refl = m.cards.filter((c) => c.kind === "reflection-focus")
    expect(refl[0].sectionLabel).toBe("Подумай")
    const q = m.cards.find((c) => c.kind === "questions")
    expect(q?.askLabel).toBe("Спроси себя")
    expect(q?.prayLabel).toBe("Помолись")
  })

  it("wires each card's narration file + duration and the clip background", () => {
    const m = buildDevotionalManifest(base)
    const cover = m.cards.find((c) => c.kind === "cover")!
    expect(cover.audioFile).toBe("01-cover.mp3")
    expect(cover.durationSec).toBe(2)
    expect(cover.bgFile).toBe("clip.mp4")
    const scripture = m.cards.find((c) => c.kind === "scripture")!
    expect(scripture.verse).toContain("rebuked the wind")
    expect(scripture.citation).toBe("Luke 8:24")
  })

  it("caps the clear video card at videoCardSec", () => {
    const m = buildDevotionalManifest({ ...base, videoCardSec: 15 })
    const video = m.cards.find((c) => c.kind === "video")!
    expect(video.durationSec).toBe(15)
    expect(video.videoFile).toBe("clip.mp4")
  })

  it("drops a card whose narration was skipped (best-effort)", () => {
    const m = buildDevotionalManifest({
      ...base,
      segments: ALL.filter((s) => s.id !== "questions"),
    })
    expect(m.cards.some((c) => c.kind === "questions")).toBe(false)
    // video always present
    expect(m.cards.some((c) => c.kind === "video")).toBe(true)
  })

  it("TWO-ACT: plays act 2 BETWEEN the halves, so each half follows the act it comments on", () => {
    const m = buildDevotionalManifest({
      ...base,
      segments: [
        ...ALL,
        {
          id: "reflection-3",
          file: "07-reflection-3.mp3",
          durationSec: 9,
          text: "And he stills it.",
        },
      ],
      devotional: {
        ...DEVO,
        reflection: {
          ...DEVO.reflection,
          // half 1 = 2 sentences, half 2 = 1 → act 2 lands at index 2
          parts: [
            "He is with you in the boat. Trust him.",
            "And he stills it.",
          ],
        },
      },
      act2: { clipFile: "clip2.mp4", durationSec: 12 },
    })
    expect(m.cards.map((c) => c.kind)).toEqual([
      "cover",
      "scripture",
      "video",
      "reflection-focus",
      "reflection-focus",
      "video",
      "reflection-focus",
      "conclusion",
      "questions",
    ])
    const videos = m.cards.filter((c) => c.kind === "video")
    expect(videos[1].videoFile).toBe("clip2.mp4")
    expect(videos[1].durationSec).toBe(12)
    // Each half re-shows the "Reflect" label; the middle card suppresses it.
    const refl = m.cards.filter((c) => c.kind === "reflection-focus")
    expect(refl.map((c) => c.sectionLabel)).toEqual(["Reflect", "", "Reflect"])
  })

  it("TWO-ACT: never silently drops act 2 — a boundary past the last chunk is clamped inside the run", () => {
    const m = buildDevotionalManifest({
      ...base,
      devotional: {
        ...DEVO,
        reflection: {
          ...DEVO.reflection,
          // 3 sentences in half 1 but only 2 narrated chunks exist
          parts: ["One. Two. Three.", "Four."],
        },
      },
      act2: { clipFile: "clip2.mp4", durationSec: 12 },
    })
    expect(m.cards.filter((c) => c.kind === "video")).toHaveLength(2)
  })

  it("TWO-ACT: falls back to the single-video layout when parts are absent", () => {
    const m = buildDevotionalManifest({
      ...base,
      act2: { clipFile: "clip2.mp4", durationSec: 12 },
    })
    expect(m.cards.filter((c) => c.kind === "video")).toHaveLength(1)
  })
})

describe("buildDevotionalManifest — clip-first structure", () => {
  it("opens on a full-frame film card and lays out a three-step stepper", () => {
    const segs = (ids: string[]) =>
      ids.map((id) => ({
        id,
        file: `${id}.mp3`,
        durationSec: 3,
        text: id === "step-reflect" ? "Let's reflect on this." : `${id} text`,
      }))
    const manifest = buildDevotionalManifest({
      devotional: DEVO,
      segments: segs([
        "step-reflect",
        "reflection-1",
        "conclusion",
        "scripture",
        "step-pray",
        "questions",
      ]) as never,
      clipFile: "clip.mp4",
      clipDurationSec: 30,
      videoCardSec: 25,
      headerDate: "x",
      structure: "clip-first",
    } as never)
    const kinds = manifest.cards.map((c) => c.kind)
    expect(kinds).toEqual([
      "video",
      "step",
      "reflection-focus",
      "conclusion",
      "scripture",
      "step",
      "questions",
    ])
    expect(manifest.cards[0].videoFill).toBe("full")
    expect(manifest.cards[0].mutedLeadSec).toBeUndefined()
    const steps = manifest.cards.filter((c) => c.kind === "step")
    expect(steps[0].steps).toEqual(["WATCH", "REFLECT", "PRAY"])
    expect(steps[0].stepIndex).toBe(1)
    expect(steps[1].stepIndex).toBe(2)
    // No cover to carry the source credit, so the closing card does.
    expect(manifest.cards.at(-1)?.attribution).toBe(DEVO.reflection.attribution)
  })

  it("gives the film card the hook's narration and no step labels", () => {
    const segs = ["hook", "step-reflect", "reflection-1", "questions"].map(
      (id) => ({ id, file: `${id}.mp3`, durationSec: 3, text: `${id} text` }),
    )
    const manifest = buildDevotionalManifest({
      devotional: DEVO,
      segments: segs as never,
      clipFile: "clip.mp4",
      clipDurationSec: 30,
      videoCardSec: 25,
      headerDate: "x",
      structure: "clip-first",
      intro: "hook",
      mutedLeadSec: 6,
    } as never)
    const film = manifest.cards[0]
    expect(film.kind).toBe("video")
    // The spoken question rides the film card itself — the only clip-first
    // opening that carries narration.
    expect(film.audioFile).toBe("hook.mp3")
    expect(film.intro).toBe("hook")
    expect(film.mutedLeadSec).toBe(6)
    // `hook` draws nothing, so it must not carry the stepper's labels.
    expect(film.steps).toBeUndefined()
  })

  it("carries the scripture translation tag onto the verse card", () => {
    const segs = ["scripture", "questions"].map((id) => ({
      id,
      file: `${id}.mp3`,
      durationSec: 3,
      text: `${id} text`,
    }))
    const input = {
      devotional: DEVO,
      segments: segs as never,
      clipFile: "clip.mp4",
      clipDurationSec: 30,
      headerDate: "x",
      structure: "clip-first",
    }
    const tagged = buildDevotionalManifest(input as never)
    const verse = tagged.cards.find((c) => c.kind === "scripture") as Record<
      string,
      unknown
    >
    expect(verse.translation).toBe("WEB")
    // The model's own wording (no corpus match) carries no tag: a tag would
    // claim a translation the text is not.
    const unverified = buildDevotionalManifest({
      ...input,
      devotional: {
        ...DEVO,
        scripture: { ...DEVO.scripture, translation: null },
      },
    } as never)
    const card = unverified.cards.find((c) => c.kind === "scripture") as Record<
      string,
      unknown
    >
    expect(card.translation).toBeUndefined()
  })
})

describe("displayWordTimes", () => {
  const w = (word: string, startSec: number, endSec: number) => ({
    word,
    startSec,
    endSec,
  })
  const spoken = "In this devotional, we look.\n\nLet's watch."
  const words = [
    w("In", 0, 0.2),
    w("this", 0.2, 0.4),
    w("devotional,", 0.4, 1),
    w("we", 1, 1.2),
    w("look.", 1.2, 1.6),
    w("Let's", 2, 2.3),
    w("watch.", 2.3, 2.8),
  ]

  it("spreads a line with a different word count over the spoken line", () => {
    const out = displayWordTimes(
      spoken,
      "In the full devotional, we look.\n\nLet's watch.",
      words,
    )
    expect(out.map((x) => x.word)).toEqual([
      "In",
      "the",
      "full",
      "devotional,",
      "we",
      "look.",
      "Let's",
      "watch.",
    ])
    expect(out[0].startSec).toBe(0)
    expect(out[5].endSec).toBeCloseTo(1.28)
    // The next line still starts where the voice starts it.
    expect(out[6]).toEqual(w("Let's", 2, 2.3))
  })

  it("keeps the spoken times when the lines cannot be matched", () => {
    expect(displayWordTimes(spoken, "One line only.", words)).toEqual(words)
  })
})
