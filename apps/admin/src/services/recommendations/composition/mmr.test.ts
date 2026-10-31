import { describe, expect, it } from "vitest"
import type { CandidateNomination } from "../candidate"
import { runCandidatePlatform } from "../orchestration"
import { composeStructurallyValidMmrSlate } from "./live-structure"
import { composeMmrSlate, MMR_SLATE_POLICY_VERSION } from "./mmr"
import { context, nominations } from "./test-helpers"

function fixture() {
  const [original, second, third] = nominations()
  const selected: CandidateNomination = {
    ...original!,
    nominationKey: "semantic-a",
    presentation: { ...original!.presentation, themes: [] },
    source: { ...original!.source, generator: "semantic", rank: 1 },
  }
  const alternate: CandidateNomination = {
    ...original!,
    nominationKey: "profile-a",
    presentation: {
      ...original!.presentation,
      themes: [" Hope "],
      sceneIndex: 1,
      startSeconds: 30,
    },
    action: { kind: "scene_start", startSeconds: 30 },
    source: { ...original!.source, rank: 2 },
  }
  return { selected, alternate, second: second!, third: third! }
}

function slate(rows: CandidateNomination[], limit = 3) {
  return {
    ordered: runCandidatePlatform({
      nominations: rows,
      context,
      limit,
      generatorVersion: "theme-contract-fixture",
    }).ordered,
    context,
    limit,
  }
}

function structurallyCompose(rows: CandidateNomination[]) {
  return composeStructurallyValidMmrSlate({
    slate: slate(rows, 1),
    historyAvailable: true,
    composerVersion: MMR_SLATE_POLICY_VERSION,
    graphGeneratorVersion: "fixture",
  })
}

describe("MMR theme input recovery", () => {
  it("uses real same-video alternate labels for similarity and availability without replacing the selected scene", () => {
    const { selected, alternate, second, third } = fixture()
    const input = slate([selected, alternate, second, third])
    const snapshot = JSON.stringify(input)
    const result = composeMmrSlate(input)
    expect(result.composed.map((candidate) => candidate.targetMediaId)).toEqual(
      ["a", "c", "b"],
    )
    expect(result.coverage.itemsWithThemes).toBe(3)
    expect(
      result.evidence.find((entry) => entry.targetMediaId === "b"),
    ).toMatchObject({ themeSimilarity: 1 })
    expect(result.composed[0]!.selectedNomination).toBe(selected)
    expect(result.composed[0]!.presentation).toBe(selected.presentation)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(structurallyCompose([selected, alternate]).status).toBe("composed")
  })

  it("prefers the selected presentation's existing labels over alternate scenes", () => {
    const { selected, alternate, second, third } = fixture()
    const result = composeMmrSlate(
      slate([
        {
          ...selected,
          presentation: { ...selected.presentation, themes: ["hope"] },
        },
        {
          ...alternate,
          presentation: { ...alternate.presentation, themes: ["faith"] },
        },
        second,
        third,
      ]),
    )
    expect(result.composed.map((candidate) => candidate.targetMediaId)).toEqual(
      ["a", "c", "b"],
    )
  })

  it("chooses the highest-ranked usable alternate deterministically", () => {
    const { selected, alternate, second, third } = fixture()
    const lowerRanked = {
      ...alternate,
      nominationKey: "lower-ranked",
      presentation: { ...alternate.presentation, themes: ["faith"] },
      source: { ...alternate.source, rank: 3 },
    }
    for (const alternatives of [
      [lowerRanked, alternate],
      [alternate, lowerRanked],
    ]) {
      const result = composeMmrSlate(
        slate([selected, ...alternatives, second, third]),
      )
      expect(
        result.composed.map((candidate) => candidate.targetMediaId),
      ).toEqual(["a", "c", "b"])
    }
  })

  it.each([
    "canonical-sibling",
    "other-playback",
    "rejected-source",
    "wrong-locale",
    "wrong-audio",
    "unpublished",
    "unplayable",
    "blank-labels",
    "past-label-bound",
  ])("does not borrow themes from %s", (kind) => {
    const { selected, alternate } = fixture()
    const invalid: CandidateNomination = {
      ...alternate,
      ...(kind === "canonical-sibling"
        ? {
            targetMediaId: "a-sibling",
            canonicalIdentity: {
              ...alternate.canonicalIdentity,
              videoId: "a-sibling",
            },
          }
        : {}),
      presentation: {
        ...alternate.presentation,
        ...(kind === "other-playback"
          ? { playbackId: "other-edition-playback" }
          : {}),
        ...(kind === "wrong-locale" ? { locale: "es" } : {}),
        ...(kind === "wrong-audio" ? { audioLanguageSlug: "spanish" } : {}),
        ...(kind === "unpublished" ? { localePublished: false } : {}),
        ...(kind === "unplayable" ? { watchPlayable: false } : {}),
        ...(kind === "blank-labels"
          ? { themes: ["", " \t\n", " ".repeat(64) + "hope"] }
          : {}),
        ...(kind === "past-label-bound"
          ? { themes: [...Array<string>(16).fill(""), "hope"] }
          : {}),
      },
      source: {
        ...alternate.source,
        ...(kind === "rejected-source"
          ? { rejectionReason: "source_unavailable" }
          : {}),
      },
    }
    const result = structurallyCompose([selected, invalid])
    expect(result).toMatchObject({
      status: "fallback",
      reason: "composition_required_input_unavailable",
      compositionInputDiagnostic: {
        missingTheme: true,
        themedSelectedCount: 0,
      },
    })
  })

  it("keeps genuinely absent themes unavailable", () => {
    const { selected } = fixture()
    expect(structurallyCompose([selected])).toMatchObject({
      status: "fallback",
      compositionInputDiagnostic: { missingTheme: true },
    })
  })
})
