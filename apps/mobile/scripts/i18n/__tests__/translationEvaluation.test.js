/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// The report-only checks of evaluate-translations.mjs. Each rule has a clean
// case and a seeded error, so a rule that stops firing fails here.
const checks = require("../lib/catalogChecks")
const evaluation = require("../lib/translationEvaluation")

function evaluate(locale, english, translations, web = null) {
  return evaluation.evaluateLocale({ locale, english, translations, web })
    .result
}

function findingsOf(result, rule) {
  return result.findings.filter((item) => item.rule === rule)
}

/** `count` messages with a translation of the same length as the English. */
function evenMessages(count, english = "Open the downloads", value) {
  const source = {}
  const translations = {}
  for (let index = 0; index < count; index += 1) {
    source[`Even.message${index}`] = `${english} ${index}`
    translations[`Even.message${index}`] = `${value ?? english} ${index}`
  }
  return { source, translations }
}

describe("script", () => {
  it("passes a translation in the locale's script", () => {
    const result = evaluate(
      "ar",
      { "Watch.title": "Watch the film" },
      { "Watch.title": "شاهد الفيلم" },
    )
    expect(findingsOf(result, "script")).toEqual([])
    expect(result.expectedScript).toBe("Arab")
  })

  it("marks a message with no letter in the locale's script as an error", () => {
    const result = evaluate(
      "ar",
      { "Watch.title": "Watch the film" },
      { "Watch.title": "Watch the film" },
    )
    expect(findingsOf(result, "script")).toEqual([
      {
        rule: "script",
        severity: "error",
        key: "Watch.title",
        detail: "Only 0% of the letters are Arab; most are Latin.",
        value: "Watch the film",
      },
    ])
  })

  it("marks a loanword mix as a warning, not an error", () => {
    const result = evaluate(
      "ja",
      { "Consent.settings": "Cookie settings" },
      { "Consent.settings": "Cookie設定" },
    )
    expect(findingsOf(result, "script")).toMatchObject([
      { severity: "warning", key: "Consent.settings" },
    ])
  })

  it("ignores a kept name, also where it touches kana", () => {
    const result = evaluate(
      "ja",
      { "Library.title": "BibleProject collections in {language}" },
      { "Library.title": "{language}のBibleProjectコレクション" },
    )
    expect(findingsOf(result, "script")).toEqual([])
  })

  it("reads the words of plural branches and never the ICU keywords", () => {
    const result = evaluate(
      "ar",
      { "Count.videos": "{count, plural, one {# video} other {# videos}}" },
      {
        "Count.videos":
          "{count, plural, zero {لا فيديو} one {فيديو واحد} two {فيديوهان} few {# فيديوهات} many {# فيديو} other {# فيديو}}",
      },
    )
    expect(findingsOf(result, "script")).toEqual([])
  })

  it("reports a whole catalog in another script as one error", () => {
    const { source, translations } = evenMessages(12, "Open the downloads")
    const result = evaluate("sr", source, translations)
    const script = findingsOf(result, "script")
    expect(script).toHaveLength(1)
    expect(script[0]).toMatchObject({ severity: "error" })
    expect(script[0]).not.toHaveProperty("key")
    expect(script[0].detail).toMatch(
      /^12 of 12 messages are not mostly Cyrl; most of their letters are Latin\. Examples: Even\.message0, /,
    )
  })

  it("leaves a note when the locale's script is unknown", () => {
    expect(
      findingsOf(
        evaluate("xx", { "A.b": "Close" }, { "A.b": "Ferme" }),
        "script",
      ),
    ).toMatchObject([{ severity: "info" }])
  })

  it("knows the script of every web catalog", () => {
    const unknown = checks
      .catalogTagsIn(checks.REAL_PATHS.webMessagesDir)
      .filter(
        (tag) => !evaluation.SCRIPT_VALUES[evaluation.expectedScript(tag)],
      )
    expect(unknown).toEqual([])
  })
})

describe("script: Simplified and Traditional forms", () => {
  /** `count` Chinese messages built from one template. */
  function chinese(count, template) {
    const english = {}
    const translations = {}
    for (let index = 0; index < count; index += 1) {
      english[`Zh.message${index}`] = `Download this video ${index}`
      translations[`Zh.message${index}`] = `${template} ${index}`
    }
    return { english, translations }
  }

  it("reports a Traditional catalog written in Simplified as one error", () => {
    const { english, translations } = chinese(12, "下载这个视频")
    const result = evaluate("zh-Hant", english, translations)
    expect(findingsOf(result, "script")).toMatchObject([
      {
        severity: "error",
        detail: expect.stringMatching(
          /^12 of 12 Chinese messages use Simplified forms .*needs Traditional/,
        ),
      },
    ])
  })

  it("reports a Simplified catalog written in Traditional as one error", () => {
    const { english, translations } = chinese(12, "下載這個視頻")
    expect(
      findingsOf(evaluate("zh-Hans", english, translations), "script"),
    ).toMatchObject([
      {
        severity: "error",
        detail: expect.stringMatching(/use Traditional forms/),
      },
    ])
  })

  it("passes a Traditional catalog in Traditional", () => {
    const { english, translations } = chinese(12, "下載這個視頻")
    expect(
      findingsOf(evaluate("zh-Hant", english, translations), "script"),
    ).toEqual([])
  })

  it("warns about one Simplified message in a Traditional catalog", () => {
    const { english, translations } = chinese(12, "下載這個視頻")
    translations["Zh.message3"] = "下载这个视频"
    expect(
      findingsOf(evaluate("zh-Hant", english, translations), "script"),
    ).toMatchObject([{ severity: "warning", key: "Zh.message3" }])
  })

  it("accepts 个 in Hakka and Hokkien, and only there", () => {
    const english = { "Zh.mine": "My downloads" }
    const translations = { "Zh.mine": "我个下載" }
    expect(
      findingsOf(evaluate("hak-Hant", english, translations), "script"),
    ).toEqual([])
    expect(
      findingsOf(evaluate("nan-Hant", english, translations), "script"),
    ).toEqual([])
    expect(
      findingsOf(evaluate("zh-Hant", english, translations), "script"),
    ).toMatchObject([{ severity: "warning", key: "Zh.mine" }])
  })
})

describe("english-left", () => {
  it("warns when a run of three English words stays", () => {
    const result = evaluate(
      "fr",
      { "Legal.read": "Read the terms of use" },
      { "Legal.read": "Lire les Terms of Use" },
    )
    expect(findingsOf(result, "english-left")).toEqual([
      {
        rule: "english-left",
        severity: "warning",
        key: "Legal.read",
        detail: 'Keeps the English words "terms of use".',
        value: "Lire les Terms of Use",
      },
    ])
  })

  it("makes no run across punctuation, plural branches, or a kept name", () => {
    const result = evaluate(
      "es",
      {
        "Library.list": "Collections such as LUMO, JESUS, Magdalena, and Acts",
        "Library.count":
          "{count, plural, one {# video} other {# videos}} in {group}",
        "Library.brand": "Open Jesus Film Project now",
      },
      {
        "Library.list": "Colecciones como LUMO, JESUS, Magdalena y Hechos",
        "Library.count":
          "{count, plural, one {# video} other {# videos}} in {group}",
        "Library.brand": "Abrir Jesus Film Project ahora",
      },
    )
    expect(findingsOf(result, "english-left")).toEqual([])
  })
})

describe("length", () => {
  it("warns about a translation much longer or much shorter than usual", () => {
    const { source, translations } = evenMessages(10)
    source["Odd.long"] = "Open the downloads"
    translations["Odd.long"] = "Open the downloads ".repeat(5).trim()
    source["Odd.short"] = "Open the downloads"
    translations["Odd.short"] = "Open"
    const result = evaluate("es", source, translations)
    expect(findingsOf(result, "length")).toMatchObject([
      { key: "Odd.long", detail: expect.stringMatching(/times longer/) },
      { key: "Odd.short", detail: expect.stringMatching(/times shorter/) },
    ])
  })

  it("measures the longest plural branch, not the sum of the branches", () => {
    const { source, translations } = evenMessages(10)
    source["Count.videos"] =
      "{count, plural, one {# video downloaded} other {# videos downloaded}}"
    translations["Count.videos"] =
      "{count, plural, zero {# videos downloaded} one {# video downloaded} two {# videos downloaded} few {# videos downloaded} many {# videos downloaded} other {# videos downloaded}}"
    expect(findingsOf(evaluate("es", source, translations), "length")).toEqual(
      [],
    )
  })

  it("stays silent with fewer than ten long messages", () => {
    const result = evaluate(
      "es",
      { "Odd.long": "Open the downloads" },
      { "Odd.long": "Open the downloads ".repeat(9) },
    )
    expect(findingsOf(result, "length")).toEqual([])
  })

  it("warns about a translation with no words where the English has some", () => {
    const { source, translations } = evenMessages(10)
    source["Odd.empty"] = "Play the whole film {title}"
    translations["Odd.empty"] = "{title}"
    expect(
      findingsOf(evaluate("es", source, translations), "length"),
    ).toMatchObject([
      { key: "Odd.empty", detail: "Has no words, but the English has some." },
    ])
  })
})

describe("repeat", () => {
  it("notes one English text with two different translations", () => {
    const result = evaluate(
      "es",
      { "A.share": "Share", "B.share": "Share" },
      { "A.share": "Compartir", "B.share": "Enviar" },
    )
    expect(findingsOf(result, "repeat")).toMatchObject([
      { severity: "info", key: "A.share" },
    ])
  })

  it("treats case and end punctuation as the same translation", () => {
    const result = evaluate(
      "es",
      { "A.share": "Share", "B.share": "Share" },
      { "A.share": "Compartir", "B.share": "compartir." },
    )
    expect(findingsOf(result, "repeat")).toEqual([])
  })
})

describe("web", () => {
  const web = {
    english: { "W.share": "Share", "W.close": "Close" },
    // Web shows English for a pending key, which is no translation.
    catalog: { "W.share": "Compartir", "W.close": "Close" },
  }

  it("counts agreement with web's translation of the same English", () => {
    const result = evaluate(
      "es",
      { "M.share": "Share", "M.close": "Close" },
      { "M.share": "compartir.", "M.close": "Cerrar" },
      web,
    )
    expect(result.webAgreement).toEqual({
      compared: 1,
      agreed: 1,
      rate: 1,
      differences: [],
    })
  })

  it("lists a difference from web", () => {
    const result = evaluate(
      "es",
      { "M.share": "Share" },
      { "M.share": "Enviar" },
      web,
    )
    expect(result.webAgreement).toEqual({
      compared: 1,
      agreed: 0,
      rate: 0,
      differences: [
        {
          key: "M.share",
          english: "Share",
          value: "Enviar",
          web: ["Compartir"],
        },
      ],
    })
  })

  it("warns when web's catalog uses another script than the check expects", () => {
    const english = {}
    const catalog = {}
    for (let index = 0; index < 8; index += 1) {
      english[`W.m${index}`] = `Open the downloads ${index}`
      catalog[`W.m${index}`] = `Otvori preuzimanja ${index}`
    }
    const result = evaluate(
      "sr",
      { "M.close": "Close" },
      { "M.close": "Затвори" },
      { english, catalog },
    )
    expect(findingsOf(result, "web-script")).toMatchObject([
      {
        severity: "warning",
        detail: expect.stringMatching(/^Web's sr catalog is mostly Latin/),
      },
    ])
  })

  it("gives no web-script finding when web uses the expected script", () => {
    const english = {}
    const catalog = {}
    for (let index = 0; index < 8; index += 1) {
      english[`W.m${index}`] = `Open the downloads ${index}`
      catalog[`W.m${index}`] = `Отвори преузимања ${index}`
    }
    const result = evaluate(
      "sr",
      { "M.close": "Close" },
      { "M.close": "Затвори" },
      { english, catalog },
    )
    expect(findingsOf(result, "web-script")).toEqual([])
  })
})

describe("language ID", () => {
  it("sends readable text, and long messages one by one", () => {
    const long = "Одоо татаж авах боломжтой бүх видеог энд харах боломжтой"
    const { entries } = evaluation.evaluateLocale({
      locale: "mn",
      english: {
        "A.play": "Play {title} in Jesus Film",
        "A.long": "Every video that you can download now is here",
      },
      translations: {
        "A.play": "{title} тоглуулах Jesus Film",
        "A.long": long,
      },
    })
    expect(evaluation.languageIdRequest({ mn: entries }, ["en", "mn"])).toEqual(
      {
        shipped: ["en", "mn"],
        locales: {
          mn: { catalog: `тоглуулах ${long}`, messages: { "A.long": long } },
        },
      },
    )
  })

  const top = (label, probability, accepted = false) => ({
    label,
    probability,
    accepted,
  })

  it.each([
    ["sure, with its own language absent", [top("kal_Latn", 1)], "error"],
    [
      "sure, with its own language a close second",
      [top("bos_Latn", 0.54), top("srp_Latn", 0.17, true)],
      "warning",
    ],
    ["unsure", [top("ada_Latn", 0.4), top("gaa_Latn", 0.33)], "warning"],
  ])(
    "rates a catalog read as another language, %s",
    (_label, labels, severity) => {
      const findings = evaluation.languageIdFindings({
        expected: "iku",
        supported: true,
        verdict: "mismatch",
        top: labels,
        messages: { "A.long": { label: "kal_Latn", probability: 0.99 } },
      })
      // The catalog finding covers its messages, so it is the only one.
      expect(findings).toHaveLength(1)
      const [item] = findings
      expect(item).toMatchObject({ rule: "language", severity })
      expect(item).not.toHaveProperty("key")
      expect(item.detail).toMatch(
        /Long messages that also read as another language: 1\.$/,
      )
    },
  )

  it("warns about a sure message in another language in a matching catalog", () => {
    const findings = evaluation.languageIdFindings(
      {
        expected: "dgr",
        supported: true,
        verdict: "match",
        top: [top("dgr_Latn", 0.9, true)],
        messages: {
          "A.english": { label: "eng_Latn", probability: 0.96 },
          "A.unsure": { label: "eng_Latn", probability: 0.6 },
        },
      },
      { "A.english": "Someone who is ready to listen" },
    )
    expect(findings).toEqual([
      {
        rule: "language",
        severity: "warning",
        key: "A.english",
        detail: "GlotLID reads this message as eng_Latn 0.96; expected dgr.",
        value: "Someone who is ready to listen",
      },
    ])
  })

  it("leaves a note when GlotLID does not know the language", () => {
    expect(
      evaluation.languageIdFindings({
        expected: "xyz",
        supported: false,
        verdict: "unsupported",
        top: [top("eng_Latn", 0.5)],
        messages: {},
      }),
    ).toMatchObject([{ rule: "language", severity: "info" }])
  })

  it("adds an answer to a locale result in severity order", () => {
    const result = {
      findings: [{ rule: "length", severity: "warning", key: "A.b" }],
    }
    const answer = {
      expected: "iku",
      supported: true,
      verdict: "mismatch",
      top: [top("kal_Latn", 1)],
      messages: {},
    }
    evaluation.addLanguageId(result, answer, {})
    expect(result.languageId).toBe(answer)
    expect(result.findings.map((item) => item.rule)).toEqual([
      "language",
      "length",
    ])
  })
})

describe("summarize", () => {
  it("counts each severity and each rule", () => {
    expect(
      evaluation.summarize({
        ar: {
          findings: [
            { rule: "script", severity: "error" },
            { rule: "length", severity: "warning" },
          ],
        },
        es: { findings: [{ rule: "repeat", severity: "info" }] },
      }),
    ).toEqual({
      locales: 2,
      error: 1,
      warning: 1,
      info: 1,
      byRule: { script: 1, length: 1, repeat: 1 },
    })
  })
})
