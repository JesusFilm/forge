/**
 * detect-language unit tests — locks the detection contract (ADR-0006): correct
 * ISO 639-1 code on article-length prose (incl. the FamilyLife `es` case the
 * `languages[0]` default mislabelled as `en`), a graded confidence that drops on
 * noisy input (the signal the normalize gate keys off), and a clean
 * `{ language: "", confidence: 0 }` for undetectable input. Pure; no I/O.
 */
import { describe, expect, it } from "vitest"
import { detectLanguage } from "./detect-language.js"

const EN =
  "God's grace is a gift we could never earn on our own. The gospel invites every " +
  "person to trust Jesus, to turn from sin, and to walk in the freedom that only " +
  "forgiveness can bring to a weary and broken heart."
const ES =
  "La gracia de Dios es un regalo que nunca podríamos ganar por nuestra cuenta. El " +
  "evangelio invita a cada persona a confiar en Jesús, a apartarse del pecado y a " +
  "caminar en la libertad que solo el perdón puede traer a un corazón cansado."
const FR =
  "La grâce de Dieu est un don que nous ne pourrions jamais mériter par nous-mêmes. " +
  "L'évangile invite chaque personne à faire confiance à Jésus, à se détourner du " +
  "péché et à marcher dans la liberté que seul le pardon peut apporter au cœur."
const ZH =
  "神的恩典是我们永远无法靠自己赚取的礼物。福音邀请每一个人信靠耶稣，" +
  "转离罪恶，并且行在唯有赦免才能带来的自由之中，让疲惫破碎的心得着安息。"

describe("detectLanguage", () => {
  it("detects English article prose as en", () => {
    expect(detectLanguage(EN).language).toBe("en")
  })

  it("detects the FamilyLife-style Spanish case as es (the mislabelled one)", () => {
    const { language, confidence } = detectLanguage(ES)
    expect(language).toBe("es")
    expect(confidence).toBeGreaterThan(0.5)
  })

  it("detects French as fr", () => {
    expect(detectLanguage(FR).language).toBe("fr")
  })

  it("detects Chinese as zh (639-1, no cmn→zh mapping needed)", () => {
    expect(detectLanguage(ZH).language).toBe("zh")
  })

  it("returns a graded, high confidence on clean prose", () => {
    const { confidence } = detectLanguage(EN)
    expect(confidence).toBeGreaterThan(0.5)
    expect(confidence).toBeLessThanOrEqual(1)
  })

  it("reports lower confidence on noisy/mixed input than on clean prose", () => {
    // URLs, scripture refs, code, @handles, a JSON blob — the ambiguous regime
    // the gate must catch. Confidence must drop below the clean-prose case.
    const noisy =
      "See https://ex.com/a?utm=1 John 3:16 `const x = f(y)` @handle " +
      '{"k":"v","n":42} #tag ROI KPI EOF 200 OK GET /v1 <div/>'
    expect(detectLanguage(noisy).confidence).toBeLessThan(
      detectLanguage(EN).confidence,
    )
  })

  it("returns {language:'', confidence:0} for empty or whitespace input", () => {
    expect(detectLanguage("")).toEqual({ language: "", confidence: 0 })
    expect(detectLanguage("   \n\t  ")).toEqual({ language: "", confidence: 0 })
  })
})
