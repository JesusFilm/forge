import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  FACT_MIN_SEC,
  SHORT_MAX_SEC,
  SHORT_OUTRO_SEC,
  SHORT_MIN_SEC,
  backgroundStarts,
  buildShortManifest,
  INTRO_CTA,
  chooseFilmTurn,
  questionClip,
  introTeaserArgs,
  openingLinesOf,
  chooseKineticRoles,
  heuristicRoles,
  kineticLines,
  shortComposition,
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

  it("keeps every short within its limits (a fact may be one 10s thought)", () => {
    for (const s of plan.shorts) {
      const min =
        s.kind === "history" || s.kind === "language"
          ? FACT_MIN_SEC
          : SHORT_MIN_SEC
      expect(s.durationSec).toBeGreaterThanOrEqual(min)
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
    expect(card.videoFill).toBe("full")
    expect(card.filmMark).toBeUndefined()
    expect(m.shortForm).toBe(true)
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

  it("keeps the model's start and fits a too-long pick to whole lines", async () => {
    // Haiku's real answer for the Prodigal Son: the older son's refusal,
    // lines 27-35, 50s long.
    const w = await chooseFilmTurn(fake({ first: 27, last: 35, why: "x" }), {
      subtitles,
      title: "t",
    })
    expect(w!.fromSec).toBeCloseTo(subtitles[27].startSec - 0.5)
    expect(w!.toSec - w!.fromSec).toBeLessThanOrEqual(SHORT_MAX_SEC)
    expect(w!.toSec - w!.fromSec).toBeGreaterThanOrEqual(SHORT_MIN_SEC)
    // It ends on a whole line.
    expect(
      subtitles.some((s) => Math.abs(s.endSec + 0.5 - w!.toSec) < 1e-9),
    ).toBe(true)
  })

  it("rejects a pick that is backwards or the opening", async () => {
    const pick = (first: number, last: number) =>
      chooseFilmTurn(fake({ first, last, why: "x" }), {
        subtitles,
        title: "t",
      })
    expect(await pick(10, 9)).toBeNull() // backwards
    expect(await pick(0, 4)).toBeNull() // the opening lines
  })
})

describe("fact shorts are one thought with their own layout", () => {
  const plan = planCutdown(manifest, devotional)
  const history = plan.shorts.find((s) => s.kind === "history")!
  const language = plan.shorts.find((s) => s.kind === "language")!

  it("cuts the history short to the credited paragraph alone", () => {
    expect(history.cards.map(text).at(-1)).toMatch(/as a son could fall\.$/)
    expect(history.durationSec).toBeLessThan(SHORT_MIN_SEC)
  })

  it("puts the credit on the history layout and the ringed word on the language one", () => {
    expect(buildShortManifest(manifest, history).shortFact).toEqual({
      layout: "history",
      label: "Historical context",
      source: "Easton's & Smith's Bible Dictionaries",
      emblem: "book",
    })
    const l = buildShortManifest(manifest, language).shortFact as {
      layout: string
      verse: string
      highlight: string
    }
    expect(l.layout).toBe("language")
    expect(l.highlight).toBe("fitting")
    expect(l.verse).toMatch(/^But it was fitting to celebrate/)
    expect(shortComposition(buildShortManifest(manifest, language))).toBe(
      "devotional-short",
    )
  })
})

describe("reflection short layout", () => {
  it("renders through the short composition, credited to the devotional's commentary", () => {
    const plan = planCutdown(manifest, devotional)
    const r = plan.shorts.find((s) => s.kind === "reflection")!
    const m = buildShortManifest(manifest, r)
    expect(m.shortFact).toEqual({
      layout: "reflection",
      label: "Commentary",
      source: "J. C. Ryle (1816–1900)",
      portrait: "ryle",
    })
    expect(shortComposition(m)).toBe("devotional-short")
  })
})

describe("history kinetic lines", () => {
  const plan = planCutdown(manifest, devotional)
  const history = plan.shorts.find((s) => s.kind === "history")!
  const cards = buildShortManifest(manifest, history).cards
  const lines = kineticLines(cards)

  it("keeps short sentences whole and splits a long one before a connector", () => {
    expect(lines.map((l) => l.text)).toContain("Feeding pigs.")
    expect(lines.map((l) => l.text)).toContain(
      "and the most abhorred of all animals.",
    )
    // Indices cover every spoken word once, in order.
    const total = cards.reduce(
      (n, c) => n + ((c.words as unknown[]) ?? []).length,
      0,
    )
    expect(lines[0].from).toBe(0)
    expect(lines.at(-1)!.to).toBe(total - 1)
    lines.slice(1).forEach((l, i) => expect(l.from).toBe(lines[i].to + 1))
  })

  it("checks the model's picks against each line and falls back when wrong", async () => {
    const llm = {
      complete: async <T>(input: { schema: { parse: (v: unknown) => T } }) =>
        input.schema.parse({
          lines: lines.map((l, i) =>
            i === 0
              ? { hero: "a word not in the line", accents: [] }
              : { hero: l.text.split(" ")[0], accents: ["nonsense"] },
          ),
        }),
    }
    const roles = await chooseKineticRoles(llm as never, lines)
    expect(roles[0].hero).toBe(heuristicRoles(lines[0].text).hero)
    expect(roles[1].accents).toEqual([])
  })
})

describe("intro teaser", () => {
  it("rebuilds the approved Prodigal teaser command from the devotional", () => {
    const film = manifest.cards[0]
    const lines = openingLinesOf({}, film)
    expect(lines).toHaveLength(4)
    expect(lines.at(-1)).toBe("The father steps out to him.")
    const args = introTeaserArgs({
      sourceKey: "lumo-luke-15",
      sequence: 0,
      lines,
      shots: [172.4, 194.9, 199.3, 181.6],
      focus: [0.5, 0.34, 0.16, 0.62, 0.55],
      kinetic: film.introKinetic as never,
      outDir: "/tmp/x",
    })
    expect(args).toContain("--teaser-intro")
    expect(args).toContain("--aspect=portrait")
    expect(args).toContain(
      "--intro-kinetic=0=outside/faithful/left;1=the best robe/squandered/right;2=one word/feast/right;3=steps out/father/left",
    )
    const hook = args.find((a) => a.startsWith("--hook="))!
    expect(hook.endsWith(`\n\n${INTRO_CTA}`)).toBe(true)
    expect(hook).not.toMatch(/Let's watch/)
  })
})

describe("film-verse question cards", () => {
  const cards = {
    open: "Is this worth celebrating?",
    close: "But someone had a good reason to stay outside.",
  }
  const plan = planCutdown(manifest, devotional, { filmVerseCards: cards })
  const film = plan.shorts.find((s) => s.kind === "film-verse")!
  const m = buildShortManifest(manifest, film)
  const subs = m.cards[0].subtitles!

  it("gives the opening question room before the first line, never cutting into one", () => {
    const open = (m.shortCards as { open: { fromSec: number; toSec: number } })
      .open
    expect(open.toSec - open.fromSec).toBeGreaterThanOrEqual(2.5)
    expect(open.toSec).toBeLessThan(subs[0].startSec)
    // The window opens after the previous line has finished.
    const before = manifest.cards[0].subtitles!.filter(
      (s) => s.endSec <= film.film!.fromSec + 0.01,
    )
    expect(before.at(-1)!.endSec).toBeLessThanOrEqual(film.film!.fromSec)
  })

  it("puts the closing turn after the last line and stops before the next one", () => {
    const close = (m.shortCards as { close: { fromSec: number } }).close
    expect(close.fromSec).toBeGreaterThan(subs.at(-1)!.endSec)
    const next = manifest.cards[0].subtitles!.find(
      (s) => s.startSec > film.film!.toSec - 0.5,
    )!
    expect(film.film!.toSec + SHORT_OUTRO_SEC).toBeLessThan(next.startSec)
  })
})

describe("history, hook-first version", () => {
  const plan = planCutdown(manifest, devotional, { historyHook: true })
  const h = plan.shorts.find((s) => s.kind === "history")!

  it("opens on the short line and keeps the paragraph's credit", () => {
    expect(text(h.cards[0])).toBe("Feeding pigs.")
    expect(buildShortManifest(manifest, h).shortFact).toMatchObject({
      layout: "history",
      source: "Easton's & Smith's Bible Dictionaries",
    })
  })

  it("cuts the personal question out of its recorded segment", () => {
    const words = [
      { word: "First,", startSec: 0, endSec: 0.4 },
      { word: "ask", startSec: 0.5, endSec: 0.7 },
      { word: "Whose", startSec: 1.97, endSec: 2.24 },
      { word: "turn?", startSec: 2.3, endSec: 2.9 },
      { word: "Talk", startSec: 4.0, endSec: 4.3 },
    ]
    const q = questionClip(words, "Whose turn?")!
    expect(q.fromSec).toBeCloseTo(1.89)
    expect(q.toSec).toBeCloseTo(3.15)
    expect(q.words[0]).toEqual({ word: "Whose", startSec: 0.08, endSec: 0.35 })
    expect(questionClip(words, "Not there")).toBeNull()
  })
})
