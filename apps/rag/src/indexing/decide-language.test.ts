/**
 * decide-language unit tests — locks the #74 decision table over the pure
 * detector: (1) below the 500-char detection floor → null (sparse non-prose is
 * the only regime where tinyld goes confidently wrong); (2) below the 0.75
 * confidence gate → null (the detector is honestly unsure); (3) otherwise trust
 * the verdict — even outside the source's declared set (content wins, ADR-0006),
 * which stores the code AND surfaces a warning. `null` always means "not
 * confidently detected", never a guess. Pure; no I/O.
 */
import { describe, expect, it } from "vitest"
import {
  CONFIDENCE_GATE,
  DETECTION_FLOOR_CHARS,
  decideLanguage,
} from "./decide-language.js"

// Article-length prose fixtures (all comfortably above the 500-char floor).
const ES_PROSE =
  "La gracia de Dios es un regalo que nunca podríamos ganar por nuestra cuenta. El " +
  "evangelio invita a cada persona a confiar en Jesús, a apartarse del pecado y a " +
  "caminar en la libertad que solo el perdón puede traer a un corazón cansado y roto. " +
  "Cuando leemos las Escrituras descubrimos que el amor del Padre no depende de " +
  "nuestras obras ni de nuestros méritos, sino de su fidelidad eterna. Por eso la fe " +
  "cristiana no es una lista de reglas, sino una relación viva con el Dios que nos " +
  "creó, nos busca y nos llama por nombre cada día de nuestra vida."
const EN_PROSE =
  "God's grace is a gift we could never earn on our own. The gospel invites every " +
  "person to trust Jesus, to turn from sin, and to walk in the freedom that only " +
  "forgiveness can bring to a weary and broken heart. When we read the Scriptures " +
  "we discover that the Father's love does not depend on our works or our merits, " +
  "but on his everlasting faithfulness. That is why the Christian faith is not a " +
  "list of rules but a living relationship with the God who made us, who seeks us " +
  "out, and who calls each of us by name every single day of our lives."
const FR_PROSE =
  "La grâce de Dieu est un don que nous ne pourrions jamais mériter par nous-mêmes. " +
  "L'évangile invite chaque personne à faire confiance à Jésus, à se détourner du " +
  "péché et à marcher dans la liberté que seul le pardon peut apporter au cœur " +
  "fatigué et brisé. Lorsque nous lisons les Écritures, nous découvrons que l'amour " +
  "du Père ne dépend pas de nos œuvres ni de nos mérites, mais de sa fidélité " +
  "éternelle. C'est pourquoi la foi chrétienne n'est pas une liste de règles, mais " +
  "une relation vivante avec le Dieu qui nous a créés et nous appelle par notre nom."
// Sparse non-prose (URLs, refs, code, JSON) repeated past the floor — the
// low-confidence regime the gate must catch even when there is plenty of text.
const NOISY_LONG =
  'See https://ex.com/a?utm=1 John 3:16 `const x = f(y)` @handle {"k":"v","n":42} #tag ROI KPI EOF 200 OK GET /v1 <div/> '.repeat(
    5,
  )

describe("decideLanguage (#74 decision table)", () => {
  it("fixtures clear the detection floor (guard)", () => {
    for (const text of [ES_PROSE, EN_PROSE, FR_PROSE, NOISY_LONG]) {
      expect(text.length).toBeGreaterThanOrEqual(DETECTION_FLOOR_CHARS)
    }
  })

  it("labels confident Spanish prose es when es is declared", () => {
    expect(decideLanguage(ES_PROSE, { declared: ["en", "es"] })).toEqual({
      language: "es",
    })
  })

  it("labels confident English prose en", () => {
    expect(decideLanguage(EN_PROSE, { declared: ["en"] })).toEqual({
      language: "en",
    })
  })

  it("stores a confident detection OUTSIDE the declared set and warns (content wins)", () => {
    const out = decideLanguage(FR_PROSE, { declared: ["en", "es"] })
    expect(out.language).toBe("fr")
    expect(out.warning).toContain("'fr'")
    expect(out.warning).toContain("[en, es]")
  })

  it("returns null below the detection floor, even for clean prose", () => {
    const short = ES_PROSE.slice(0, DETECTION_FLOOR_CHARS - 1)
    expect(decideLanguage(short, { declared: ["en", "es"] })).toEqual({
      language: null,
    })
  })

  it("detects at exactly the floor (the floor is `< 500`, not `<= 500`)", () => {
    const atFloor = ES_PROSE.slice(0, DETECTION_FLOOR_CHARS)
    expect(decideLanguage(atFloor, { declared: ["en", "es"] }).language).toBe(
      "es",
    )
  })

  it("returns null when the detector is unsure (confidence below the gate)", () => {
    expect(decideLanguage(NOISY_LONG, { declared: ["en"] })).toEqual({
      language: null,
    })
  })

  it("returns null for empty content (floor catches it before detection)", () => {
    expect(decideLanguage("", { declared: ["en"] })).toEqual({
      language: null,
    })
  })

  it("exports the #74 defaults for #73's tuning pass to read", () => {
    expect(DETECTION_FLOOR_CHARS).toBe(500)
    expect(CONFIDENCE_GATE).toBe(0.75)
  })
})
