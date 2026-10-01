import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  SHORT_MAX_SEC,
  SHORT_MIN_SEC,
  backgroundStarts,
  buildShortManifest,
  chooseFilmTurn,
  mapCardsToParagraphs,
  planCutdown,
  verseWindow,
  type DevotionalText,
  type Manifest,
} from "./shorts-cutdown"

// The real Prodigal Son long form (lumo-luke-15 seq 0, rendered 2026-10-01):
// its manifest and its paragraph roles, source evidence stripped.
const fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, "__fixtures__", "prodigal-cutdown.json"),
    "utf8",
  ),
) as { manifest: Manifest; devotional: DevotionalText }
const { manifest, devotional } = fixture
const text = (i: number) => manifest.cards[i].text

describe("mapCardsToParagraphs", () => {
  it("puts every reflection sentence in the paragraph it was cut from", () => {
    const map = mapCardsToParagraphs(
      manifest.cards,
      devotional.reflection!.paragraphs!,
    )
    // "Feeding pigs." is the history paragraph (2); "It means one must." the
    // language one (8).
    const pigs = manifest.cards.findIndex((c) => c.text === "Feeding pigs.")
    const must = manifest.cards.findIndex(
      (c) => c.text === "It means one must.",
    )
    expect(map.get(pigs)).toBe(2)
    expect(map.get(must)).toBe(8)
    const reflectionCards = manifest.cards.filter(
      (c) => c.kind === "reflection-focus",
    ).length
    expect(map.size).toBe(reflectionCards)
  })

  it("refuses text that is in no paragraph rather than guessing", () => {
    const cards = [
      { kind: "reflection-focus", text: "Something never written." },
    ]
    expect(() =>
      mapCardsToParagraphs(cards, devotional.reflection!.paragraphs!),
    ).toThrow(/does not continue|in no paragraph/)
  })
})

describe("planCutdown on the Prodigal Son", () => {
  const plan = planCutdown(manifest, devotional)
  const byKind = Object.fromEntries(plan.shorts.map((s) => [s.kind, s]))

  it("keeps every short between 15 and 45 seconds", () => {
    for (const s of plan.shorts) {
      expect(s.durationSec).toBeGreaterThanOrEqual(SHORT_MIN_SEC)
      expect(s.durationSec).toBeLessThanOrEqual(SHORT_MAX_SEC)
    }
  })

  it("opens the history short on the credited sentence and keeps one fact", () => {
    const h = byKind.history
    expect(text(h.cards[0])).toBe("Look at where the younger son had ended up.")
    expect(manifest.cards[h.cards[0]].sourceMark).toBeTruthy()
    // It stops before the second history paragraph (the best robe).
    const said = h.cards.map(text).join(" ")
    expect(said).not.toMatch(/best robe/)
  })

  it("opens the language short on verse 32 and lands on its point", () => {
    const l = byKind.language
    expect(text(l.cards[0])).toMatch(/^In verse 32/)
    expect(l.cards.map(text).join(" ")).toMatch(/celebration is not optional/)
  })

  it("takes the opening picture for the reflection and no credited fact", () => {
    const r = byKind.reflection
    expect(text(r.cards[0])).toBe(
      "Picture the older son coming in from the field.",
    )
    expect(r.cards.some((i) => manifest.cards[i].sourceMark)).toBe(false)
  })

  it("closes on the last line, the question and the prayer", () => {
    expect(byKind.question.cards.map((i) => manifest.cards[i].kind)).toEqual([
      "conclusion",
      "questions",
    ])
  })

  it("finds the quoted verse (Luke 15:24) in the film and starts on a whole line", () => {
    const f = byKind["film-verse"]
    const subs = manifest.cards[0].subtitles!
    const inWindow = subs.filter(
      (s) => s.startSec >= f.film!.fromSec && s.endSec <= f.film!.toSec,
    )
    expect(inWindow.map((s) => s.text).join(" ")).toMatch(
      /dead and is alive again/,
    )
    expect(inWindow[0].text).toMatch(/^But the father said/)
  })

  it("needs a person or a model for the turn of the scene", () => {
    expect(byKind["film-turn"]).toBeUndefined()
    expect(plan.skipped.map((s) => s.kind)).toContain("film-turn")
    const chosen = planCutdown(manifest, devotional, {
      filmTurn: { fromSec: 139.1, toSec: 172.6 },
    })
    expect(chosen.shorts.find((s) => s.kind === "film-turn")?.film).toEqual({
      fromSec: 139.1,
      toSec: 172.6,
    })
  })

  it("skips a kind the devotional does not have instead of inventing it", () => {
    const noLanguage: DevotionalText = {
      reflection: {
        paragraphs: devotional.reflection!.paragraphs!.map((p) =>
          p.role === "language" ? { ...p, role: "reflection" } : p,
        ),
      },
    }
    const p = planCutdown(manifest, noLanguage)
    expect(p.shorts.find((s) => s.kind === "language")).toBeUndefined()
    expect(p.skipped).toContainEqual({
      kind: "language",
      reason: "the devotional has no language paragraph",
    })
  })
})

describe("verseWindow", () => {
  it("returns null when the verse is not in the captions", () => {
    expect(
      verseWindow(
        manifest.cards[0].subtitles!,
        "In the beginning was the Word",
      ),
    ).toBeNull()
  })
})

describe("buildShortManifest", () => {
  const plan = planCutdown(manifest, devotional)
  const history = plan.shorts.find((s) => s.kind === "history")!
  const film = plan.shorts.find((s) => s.kind === "film-verse")!

  it("drops the music bed and the step clock, and opens with no cover", () => {
    const m = buildShortManifest(manifest, history)
    expect(m.musicFile).toBeUndefined()
    expect(m.stepRing).toBe(false)
    expect(m.introHoldSec).toBe(0)
    expect(m.cards).toHaveLength(history.cards.length)
  })

  it("starts the background where the long form had it at that sentence", () => {
    const m = buildShortManifest(manifest, history)
    expect(m.bgStartOffsetSec).toBeCloseTo(
      backgroundStarts(manifest)[history.cards[0]],
    )
    // Well into the take, not back at its first frame.
    expect(m.bgStartOffsetSec!).toBeGreaterThan(20)
  })

  it("re-times the film captions to the trimmed clip and strips the long-form opening", () => {
    const m = buildShortManifest(manifest, film)
    const card = m.cards[0]
    expect(card.durationSec).toBeCloseTo(film.film!.toSec - film.film!.fromSec)
    expect(card.subtitles![0].startSec).toBeGreaterThanOrEqual(0)
    expect(card.subtitles![0].startSec).toBeLessThan(1)
    expect(card.intro).toBeUndefined()
    expect(card.introParts).toBeUndefined()
    expect(card.videoFill).toBe("window")
  })
})

describe("chooseFilmTurn", () => {
  const subtitles = manifest.cards[0].subtitles!
  const fake = (answer: unknown) => ({
    complete: async <T>(input: { schema: { parse: (v: unknown) => T } }) =>
      input.schema.parse(answer),
  })

  it("turns the model's line numbers into a window on whole lines", async () => {
    // "Meanwhile, the older son..." through "So his father went out and
    // pleaded with him."
    const first = subtitles.findIndex((s) => s.text.startsWith("Meanwhile"))
    const last = subtitles.findIndex((s) => s.text.startsWith("So his father"))
    const w = await chooseFilmTurn(fake({ first, last, why: "he refuses" }), {
      subtitles,
      title: "The Prodigal Son",
    })
    expect(w).toEqual({
      fromSec: subtitles[first].startSec - 0.5,
      toSec: subtitles[last].endSec + 0.5,
      why: "he refuses",
    })
  })

  it("rejects a pick that is too long, backwards or the opening", async () => {
    const pick = (first: number, last: number) =>
      chooseFilmTurn(fake({ first, last, why: "x" }), {
        subtitles,
        title: "t",
      })
    expect(await pick(5, 30)).toBeNull() // minutes long
    expect(await pick(10, 9)).toBeNull() // backwards
    expect(await pick(0, 4)).toBeNull() // the opening lines
  })
})
