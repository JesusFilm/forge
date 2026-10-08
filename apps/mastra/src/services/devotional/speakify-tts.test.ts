import { describe, expect, it } from "vitest"

import { applyStressOverrides, ruUnmarkedHomographs } from "./speakify-tts"

describe("applyStressOverrides", () => {
  const overrides = [
    ["потерянных", "поте́рянных"],
    ["стоит в стороне", "стои́т в стороне"],
  ] as const

  it("applies the accent to a flagged word", () => {
    const out = applyStressOverrides("Он ищет потерянных людей.", overrides)
    expect(out).toBe("Он ищет поте́рянных людей.")
  })

  it("is phrase-scoped: fixes 'стоит в стороне' but leaves other 'стоит' alone", () => {
    const out = applyStressOverrides(
      "Он не стоит в стороне. Об этом стоит подумать.",
      overrides,
    )
    expect(out).toContain("не стои́т в стороне")
    expect(out).toContain("Об этом стоит подумать") // untouched (is-worth sense)
  })

  it("no-ops when nothing matches or the list is empty", () => {
    expect(applyStressOverrides("Бог всегда рядом.", overrides)).toBe(
      "Бог всегда рядом.",
    )
    expect(applyStressOverrides("Он не стоит в стороне.", [])).toBe(
      "Он не стоит в стороне.",
    )
  })
})

describe("ruUnmarkedHomographs", () => {
  it("reports a homograph the overrides left unmarked", () => {
    expect(ruUnmarkedHomographs("Дома переходят в чужие руки.")).toEqual([
      "дома",
    ])
  })
  it("is quiet once the override marked it", () => {
    expect(
      ruUnmarkedHomographs(
        applyStressOverrides("Дома переходят в чужие руки.", [
          ["Дома переходят", "Дома́ переходят"],
        ]),
      ),
    ).toEqual([])
  })
})
