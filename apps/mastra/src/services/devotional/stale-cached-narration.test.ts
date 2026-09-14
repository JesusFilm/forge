import { describe, expect, it } from "vitest"

import { buildNarrationSegments } from "./devotional-audio"
import { localeFor } from "./devotional-locale"
import type { GeneratedDevotional } from "./generate-devotional"

/**
 * `produceNarration` has a whole-bundle shortcut: if a complete cached bundle
 * exists, reuse it and skip production entirely. It used to check only that
 * every segment EXISTED, never that its text still matched.
 *
 * The consequence shipped silently: after an approved edit to the conclusion,
 * the card showed the new line while the voice read the old one, and the render
 * reported success. The same shortcut would have swallowed the change to the
 * spoken connector for the prayer card on every devotional that already had a
 * full cache.
 *
 * This test guards the comparison the shortcut now performs. It works on
 * `buildNarrationSegments` — the same function the shortcut calls — so it
 * fails if a text edit ever stops being visible in the narration segments.
 */
function devoWith(conclusion: string): GeneratedDevotional {
  return {
    date: "2026-09-04",
    clip: {
      id: "1_jf6131-0-0",
      title: "Parable of the Good Samaritan",
      index: 31,
    },
    passage: { reference: "Luke 10:29-37", osisRef: "Luke.10.29-Luke.10.37" },
    title: "For anyone who would hate to walk past what God is actually doing",
    scripture: {
      reference: "Luke 10:37",
      text: "Go and do likewise.",
      translation: "WEB",
    },
    reflection: {
      text: "One sentence of reflection.",
      source: "s",
      attribution: "a",
      flavor: "commentary",
    },
    reflectionHighlights: [""],
    conclusion,
    question: "q",
    prayer: "p",
    mood: "hope",
    voice: "male-d",
    sequence: 0,
  } as unknown as GeneratedDevotional
}

describe("cached narration staleness", () => {
  it("an edited conclusion changes its narration segment text", () => {
    const before = buildNarrationSegments(
      devoWith("Old line."),
      localeFor("en"),
    )
    const after = buildNarrationSegments(devoWith("New line."), localeFor("en"))
    const pick = (segs: { id: string; text: string }[]) =>
      segs.find((s) => s.id === "conclusion")?.text
    expect(pick(before)).toBeTruthy()
    expect(pick(after)).toBeTruthy()
    expect(pick(after)).not.toBe(pick(before))
  })

  it("every other segment is untouched by that edit, so only one is re-synthesised", () => {
    const before = buildNarrationSegments(
      devoWith("Old line."),
      localeFor("en"),
    )
    const after = buildNarrationSegments(devoWith("New line."), localeFor("en"))
    const cached = new Map(before.map((s) => [s.id, s.text]))
    const changed = after.filter(
      (s) => (cached.get(s.id) ?? "").trim() !== s.text.trim(),
    )
    expect(changed.map((s) => s.id)).toEqual(["conclusion"])
  })

  it("compares the SPOKEN text, so moving a connector is a real change", () => {
    // The check used to compare the DISPLAY text, which is exactly what a
    // moved connector leaves untouched: a reflection card shows its chunk
    // whether or not "Reflect on this." is glued to the front of the spoken
    // take. Comparing display text therefore read the move as "no change" and
    // the old audio — connector and all — was replayed. See
    // docs/solutions/logic-errors/narration-cache-keyed-on-display-instead-of-spoken-text-20260905.md
    const off = buildNarrationSegments(devoWith("c"), localeFor("en"))
    const on = buildNarrationSegments(devoWith("c"), localeFor("en"), {
      steps: true,
    })
    const reflOff = off.find((s) => s.id === "reflection-1")!
    const reflOn = on.find((s) => s.id === "reflection-1")!
    // Same card, same words on screen…
    expect(reflOn.display).toBe(reflOff.display)
    // …but a different script: with steps off the connector opens the spoken
    // take, with steps on it has moved to the step card.
    expect(reflOff.text).toContain("Reflect on this.")
    expect(reflOn.text).not.toContain("Reflect on this.")
    expect(on.find((s) => s.id === "step-reflect")?.text).toContain(
      "Reflect on this.",
    )
    // The comparison the staleness check makes: spoken vs spoken, which sees
    // the move. Display vs display, which is what it used to do, does not.
    expect(reflOn.text).not.toBe(reflOff.text)
  })

  it("the prayer step's spoken connector is part of its segment text", () => {
    // The connector wording is what the whole-bundle shortcut hid; if it ever
    // stops being baked into a segment's text, an edit to it becomes invisible
    // to the staleness check again.
    const segs = buildNarrationSegments(devoWith("c"), localeFor("en"), {
      steps: true,
    })
    expect(segs.find((s) => s.id === "step-pray")?.text).toContain(
      "Let's bring this to God.",
    )
  })
})
