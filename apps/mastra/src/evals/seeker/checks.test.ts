import { describe, expect, it } from "vitest"

import {
  countWords,
  extractNamedCitations,
  extractScriptureReferences,
  extractUrls,
  hardFailViolations,
  runAnswerChecks,
  WORD_COUNT_HARD_LIMIT,
} from "./checks"
import type { RagFixtureFile } from "./rag"
import type { AnswerRecord } from "./types"

const SERVED_URL =
  "https://www.cru.org/us/en/train-and-grow/why-does-god-allow-suffering.html"

const fixtures: RagFixtureFile = {
  kind: "chat-eval-rag-fixtures",
  capturedAt: "2026-08-01T00:00:00.000Z",
  baseUrl: "http://localhost:8080",
  topK: 5,
  corpusSha256: "test-corpus",
  fixtures: [
    {
      questionId: "q-suffering",
      query: "why suffering",
      capturedAt: "2026-08-01T00:00:00.000Z",
      result: {
        status: "ok",
        sources: [
          {
            text: "As John 3:16 says, God so loved the world. See also Romans 5:3-5 on perseverance.",
            sourceName: "Cru",
            title: "Why Does God Allow Suffering?",
            url: SERVED_URL,
            score: 0.7,
          },
        ],
      },
    },
  ],
}

function answer(text: string, extra: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    questionId: "q-suffering",
    category: "intellectual-doubt",
    model: "anthropic/claude-sonnet-5",
    ok: true,
    text,
    finishReason: "stop",
    usage: { input: 100, output: 100 },
    costUsd: 0.0001,
    latencyMs: 1000,
    ...extra,
  }
}

function checkById(results: ReturnType<typeof runAnswerChecks>, id: string) {
  const found = results.find((result) => result.checkId === id)
  if (!found) throw new Error(`no check ${id}`)
  return found
}

describe("cited-urls-grounded (hard-fail)", () => {
  it("passes a URL that was served, including with trailing punctuation", () => {
    const results = runAnswerChecks(
      answer(`Grounded in Cru's article: ${SERVED_URL}.`),
      fixtures,
    )
    expect(checkById(results, "cited-urls-grounded").status).toBe("pass")
  })

  it("flags a URL that was never served", () => {
    const results = runAnswerChecks(
      answer("See https://www.gotquestions.org/suffering.html for more."),
      fixtures,
    )
    const check = checkById(results, "cited-urls-grounded")
    expect(check.status).toBe("violated")
    expect(check.lane).toBe("hard-fail")
    expect(check.details).toEqual([
      "https://www.gotquestions.org/suffering.html",
    ])
  })

  it("is not-applicable without fixtures or text", () => {
    expect(
      checkById(runAnswerChecks(answer("hello"), null), "cited-urls-grounded")
        .status,
    ).toBe("not-applicable")
    expect(
      checkById(
        runAnswerChecks(answer("", { text: null, ok: false }), fixtures),
        "cited-urls-grounded",
      ).status,
    ).toBe("not-applicable")
  })
})

describe("cited-url-malformed-variant (report-only — the typo class)", () => {
  it("classifies a small-edit-distance variant of a served URL as malformed, NOT ungrounded", () => {
    // The exact defect the first green reruns measured: an answering model
    // citing `sightlinemiristry` for the served `sightlineministry`.
    const typod = SERVED_URL.replace("suffering", "sufering")
    const results = runAnswerChecks(answer(`See (Cru, ${typod}).`), fixtures)
    expect(checkById(results, "cited-urls-grounded").status).toBe("pass")
    const malformed = checkById(results, "cited-url-malformed-variant")
    expect(malformed.status).toBe("violated")
    expect(malformed.lane).toBe("report-only")
    expect(malformed.details).toEqual([typod])
  })

  it("classifies a RECONSTRUCTED deep link on a served host as malformed, NOT ungrounded", () => {
    // Measured in green rerun s3: an answering model expanded a served
    // cru.org slug to match the passage title — a broken link to a real
    // source.
    const reconstructed =
      "https://www.cru.org/us/en/train-and-grow/why-god-allows-pain-and-suffering-explained.html"
    const results = runAnswerChecks(
      answer(`See (Cru, ${reconstructed}).`),
      fixtures,
    )
    expect(checkById(results, "cited-urls-grounded").status).toBe("pass")
    expect(checkById(results, "cited-url-malformed-variant").status).toBe(
      "violated",
    )
  })

  it("keeps a wholly invented URL (foreign host) in the hard-fail lane", () => {
    const results = runAnswerChecks(
      answer("See (Cru, https://invented.example.com/totally-made-up)."),
      fixtures,
    )
    expect(checkById(results, "cited-urls-grounded").status).toBe("violated")
    expect(checkById(results, "cited-url-malformed-variant").status).toBe(
      "pass",
    )
  })
})

describe("cited-source-names-grounded (hard-fail — the wired names half)", () => {
  it("accepts a COMPOSITE citation of a served source ('Name: Title')", () => {
    const results = runAnswerChecks(
      answer(`[Cru: Why Does God Allow Suffering?](${SERVED_URL})`),
      fixtures,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "pass",
    )
  })

  it("accepts a SHORTENED form contained in a served name", () => {
    const shortened: RagFixtureFile = {
      ...fixtures,
      fixtures: [
        {
          ...fixtures.fixtures[0],
          result: {
            status: "ok",
            sources: [
              {
                ...fixtures.fixtures[0].result.sources[0],
                sourceName: "EveryStudent — Slovak (EveryStudent.sk)",
              },
            ],
          },
        },
      ],
    }
    const results = runAnswerChecks(
      answer(`[EveryStudent.sk](${SERVED_URL})`),
      shortened,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "pass",
    )
  })

  it("accepts a readable title shortened across structural punctuation", () => {
    const titled: RagFixtureFile = {
      ...fixtures,
      fixtures: [
        {
          ...fixtures.fixtures[0],
          result: {
            status: "ok",
            sources: [
              {
                ...fixtures.fixtures[0].result.sources[0],
                title:
                  "The Life :: Do Evil and Suffering Disprove the Existence of God? (Part 3) The Emotional Problem",
              },
            ],
          },
        },
      ],
    }
    const results = runAnswerChecks(
      answer(
        `[Do Evil and Suffering Disprove the Existence of God? Part 3](${SERVED_URL})`,
      ),
      titled,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "pass",
    )
  })

  it("still rejects an unrelated title after punctuation normalization", () => {
    const results = runAnswerChecks(
      answer(`[An Unrelated Explanation of Suffering](${SERVED_URL})`),
      fixtures,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "violated",
    )
  })

  it("accepts a URL-scoped alias assembled from served brand and locale words", () => {
    const localized: RagFixtureFile = {
      ...fixtures,
      fixtures: [
        {
          ...fixtures.fixtures[0],
          result: {
            status: "ok",
            sources: [
              {
                ...fixtures.fixtures[0].result.sources[0],
                sourceName: "EveryStudent — Vietnamese (EveryVietStudent.com)",
              },
            ],
          },
        },
      ],
    }
    const results = runAnswerChecks(
      answer(`[EveryVietStudent — Vietnamese](${SERVED_URL})`),
      localized,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "pass",
    )
  })

  it("rejects a served name paired with a different served URL", () => {
    const otherUrl = "https://example.org/other"
    const twoSources: RagFixtureFile = {
      ...fixtures,
      fixtures: [
        {
          ...fixtures.fixtures[0],
          result: {
            status: "ok",
            sources: [
              ...fixtures.fixtures[0].result.sources,
              {
                text: "Other source text",
                sourceName: "EveryStudent",
                title: "Another article",
                url: otherUrl,
                score: 0.6,
              },
            ],
          },
        },
      ],
    }
    const results = runAnswerChecks(
      answer(`[EveryStudent](${SERVED_URL})`),
      twoSources,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "violated",
    )
  })

  it("ignores a protocol-less URL used as link text — no name claim to check", () => {
    const bare = SERVED_URL.replace(/^https:\/\//, "")
    const results = runAnswerChecks(
      answer(`[${bare}](${SERVED_URL})`),
      fixtures,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "pass",
    )
  })

  it("does NOT let a word-fragment match a served name ('crucified' is not 'Cru')", () => {
    const results = runAnswerChecks(
      answer(`[Why Jesus Was Crucified Explained](${SERVED_URL})`),
      fixtures,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "violated",
    )
  })

  it("passes a markdown link whose text is a served source name", () => {
    const results = runAnswerChecks(
      answer(`According to [Cru](${SERVED_URL}), suffering is real.`),
      fixtures,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "pass",
    )
  })

  it("passes a link named by the served passage TITLE", () => {
    const results = runAnswerChecks(
      answer(`See [Why Does God Allow Suffering?](${SERVED_URL}).`),
      fixtures,
    )
    expect(checkById(results, "cited-source-names-grounded").status).toBe(
      "pass",
    )
  })

  it("flags a name that was never served even when its URL was", () => {
    // The exact gap the prototype left: citableSources() computed the names
    // set but only urls was ever consumed. A name-swap must now fail.
    const results = runAnswerChecks(
      answer(`According to [GotQuestions](${SERVED_URL}), suffering is real.`),
      fixtures,
    )
    const check = checkById(results, "cited-source-names-grounded")
    expect(check.status).toBe("violated")
    expect(check.details[0]).toContain("GotQuestions")
  })

  it("extracts parenthetical (Name, url) attributions too", () => {
    const results = runAnswerChecks(
      answer(`Suffering points to God (EveryStudent, ${SERVED_URL}).`),
      fixtures,
    )
    const check = checkById(results, "cited-source-names-grounded")
    expect(check.status).toBe("violated")
    expect(check.details[0]).toContain("EveryStudent")
  })

  it("ignores links whose text is itself a URL (no name claim)", () => {
    expect(
      extractNamedCitations(`[${SERVED_URL}](${SERVED_URL})`),
    ).toHaveLength(0)
  })
})

describe("tool-called (hard-fail)", () => {
  it("violates when the model skipped the tool", () => {
    const check = checkById(
      runAnswerChecks(answer("text", { skippedTool: true }), fixtures),
      "tool-called",
    )
    expect(check.status).toBe("violated")
    expect(check.promptSections).toEqual(["tool-usage"])
  })

  it("passes when the tool was called", () => {
    expect(
      checkById(
        runAnswerChecks(answer("text", { skippedTool: false }), fixtures),
        "tool-called",
      ).status,
    ).toBe("pass")
  })

  it("is not-applicable when the run carries no tool decision", () => {
    expect(
      checkById(runAnswerChecks(answer("text"), fixtures), "tool-called")
        .status,
    ).toBe("not-applicable")
  })

  it("is not-applicable on an infra-failed cell (ok: false) even when skippedTool is stamped", () => {
    // run-loop stamps `skippedTool: calls.length === 0` on ok:false cells too
    // (a 401/429/timeout before any tool round-trip), so gating on it would
    // read an outage as a model decision — never violated, not-applicable.
    const check = checkById(
      runAnswerChecks(
        answer("", { ok: false, text: null, skippedTool: true }),
        fixtures,
      ),
      "tool-called",
    )
    expect(check.status).toBe("not-applicable")
  })
})

describe("word-count (hard-fail, mechanical, ex-judge)", () => {
  it("passes exactly at the hard limit and violates one word over", () => {
    const atLimit = Array(WORD_COUNT_HARD_LIMIT).fill("word").join(" ")
    expect(
      checkById(runAnswerChecks(answer(atLimit), fixtures), "word-count")
        .status,
    ).toBe("pass")
    const overLimit = `${atLimit} extra`
    const check = checkById(
      runAnswerChecks(answer(overLimit), fixtures),
      "word-count",
    )
    expect(check.status).toBe("violated")
    expect(check.details[0]).toContain(String(WORD_COUNT_HARD_LIMIT + 1))
  })

  it("counts words across whitespace runs", () => {
    expect(countWords("  one\n two\tthree  ")).toBe(3)
    expect(countWords("   ")).toBe(0)
  })
})

describe("prose-format (hard-fail, mechanical, ex-judge)", () => {
  it("flags headings, bullets, and numbered lists", () => {
    for (const bad of [
      "# A heading\nprose",
      "prose\n- a bullet",
      "prose\n* another bullet",
      "prose\n1. a step",
    ]) {
      expect(
        checkById(runAnswerChecks(answer(bad), fixtures), "prose-format")
          .status,
        `expected violation for: ${JSON.stringify(bad)}`,
      ).toBe("violated")
    }
  })

  it("allows conversational prose with inline markdown links", () => {
    const results = runAnswerChecks(
      answer(
        `That question deserves honesty — [Cru](${SERVED_URL}) wrestles with it at length, and so should we.`,
      ),
      fixtures,
    )
    expect(checkById(results, "prose-format").status).toBe("pass")
  })
})

describe("scripture-grounded (REPORT-ONLY)", () => {
  it("stays in the report-only lane — structurally excluded from the gate", () => {
    const results = runAnswerChecks(
      answer("Jesus said in Matthew 11:28, come to me."),
      fixtures,
    )
    const check = checkById(results, "scripture-grounded")
    expect(check.lane).toBe("report-only")
    expect(check.status).toBe("violated")
    // The gate's projection must not contain it, no matter what it found.
    expect(
      hardFailViolations(results).some(
        (violation) => violation.checkId === "scripture-grounded",
      ),
    ).toBe(false)
  })

  it("passes references that appear in the served passages", () => {
    const results = runAnswerChecks(
      answer("As John 3:16 reminds us, God loved the world."),
      fixtures,
    )
    expect(checkById(results, "scripture-grounded").status).toBe("pass")
  })

  it("normalises book aliases (Jn 3:16 matches John 3:16)", () => {
    const results = runAnswerChecks(answer("See Jn 3:16."), fixtures)
    expect(checkById(results, "scripture-grounded").status).toBe("pass")
  })

  it("never lets '1 John' collapse into 'John'", () => {
    const references = extractScriptureReferences("Read 1 John 3:16 today.")
    expect(references).toHaveLength(1)
    expect(references[0].book).toBe("1-john")
    // And the passage only served John 3:16, so 1 John 3:16 is ungrounded.
    const results = runAnswerChecks(answer("Read 1 John 3:16 today."), fixtures)
    expect(checkById(results, "scripture-grounded").status).toBe("violated")
  })

  it("grounds a chapter-only citation in any served verse of that chapter", () => {
    const results = runAnswerChecks(
      answer("John 3 covers this at length."),
      fixtures,
    )
    expect(checkById(results, "scripture-grounded").status).toBe("pass")
  })

  it("requires verse ranges to be covered by the served range", () => {
    // Passage served Romans 5:3-5; 5:3-4 is inside it, 5:3-8 is not.
    const inside = runAnswerChecks(answer("Romans 5:3-4 says..."), fixtures)
    expect(checkById(inside, "scripture-grounded").status).toBe("pass")
    const outside = runAnswerChecks(answer("Romans 5:3-8 says..."), fixtures)
    expect(checkById(outside, "scripture-grounded").status).toBe("violated")
  })

  it("is not-applicable when the answer cites no scripture", () => {
    const results = runAnswerChecks(
      answer("A warm answer with no references."),
      fixtures,
    )
    expect(checkById(results, "scripture-grounded").status).toBe(
      "not-applicable",
    )
  })
})

describe("hardFailViolations projection", () => {
  it("collects only hard-fail violations", () => {
    const results = runAnswerChecks(
      answer("See https://invented.example.com/page and Matthew 11:28.", {
        skippedTool: true,
      }),
      fixtures,
    )
    const violations = hardFailViolations(results)
    const ids = violations.map((violation) => violation.checkId)
    expect(ids).toContain("cited-urls-grounded")
    expect(ids).toContain("tool-called")
    expect(ids).not.toContain("scripture-grounded")
    for (const violation of violations) {
      expect(violation.lane).toBe("hard-fail")
      expect(violation.status).toBe("violated")
    }
  })
})

describe("extractUrls", () => {
  it("strips trailing punctuation but keeps path characters", () => {
    expect(
      extractUrls("Read https://a.example.com/x/y.html, then reply."),
    ).toEqual(["https://a.example.com/x/y.html"])
  })
})
