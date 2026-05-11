import { describe, expect, it } from "vitest"
import {
  extractBriefAnswers,
  isBriefConfirmationPrompt,
  isCompleteBrief,
  isDiscoveryPrompt,
  isExplicitRebriefPrompt,
  isFullCreatePrompt,
  latestBriefMetadata,
  updateBriefFromTurn,
} from "./experience-ai-chat-brief"

describe("experience AI chat brief", () => {
  it("detects full-create, discovery, re-brief, and confirmation intents", () => {
    expect(isFullCreatePrompt("Create a Thai page about forgiveness")).toBe(
      true,
    )
    expect(
      isFullCreatePrompt("Build something about forgiveness with a video hero"),
    ).toBe(true)
    expect(isFullCreatePrompt("Create a guided reflection on doubt")).toBe(true)
    expect(isFullCreatePrompt("Make the title pop")).toBe(false)
    expect(isFullCreatePrompt("show me candidate videos about hope")).toBe(
      false,
    )
    expect(isDiscoveryPrompt("show me candidate videos about hope")).toBe(true)
    expect(isExplicitRebriefPrompt("re-brief this page from scratch")).toBe(
      true,
    )
    expect(
      isBriefConfirmationPrompt("looks good, generate from this brief"),
    ).toBe(true)
  })

  it("extracts supplied fields from an opening prompt", () => {
    const brief = extractBriefAnswers(
      "Create a Thai page about Matthew 11:28-30 for young adults",
    )

    expect(brief).toMatchObject({
      topicOrPassage: "Matthew 11:28-30",
      language: "Thai",
      audience: "young adults",
      pageType: "Topic page",
      scriptureEmphasis: "Center the page on Matthew 11:28-30.",
    })
    expect(isCompleteBrief(brief)).toBe(false)
  })

  it("asks for only the first missing field after preserving supplied fields", () => {
    const result = updateBriefFromTurn({
      previous: null,
      prompt: "Create a Thai page about Matthew 11:28-30 for young adults",
    })

    expect(result.confirmationRequired).toBe(false)
    expect(result.metadata.brief).toMatchObject({
      topicOrPassage: "Matthew 11:28-30",
      language: "Thai",
      audience: "young adults",
    })
    expect(result.metadata.questionField).toBe("desiredOutcome")
    expect(result.content).toContain("understand, feel, or do")
  })

  it("stores visible assumptions when the editor is unsure", () => {
    const first = updateBriefFromTurn({
      previous: null,
      prompt: "Create an English experience about prayer for new believers",
    })
    const second = updateBriefFromTurn({
      previous: first.metadata,
      prompt: "not sure",
    })

    expect(second.metadata.assumptions?.desiredOutcome).toBeDefined()
    expect(second.metadata.brief.desiredOutcome).toBe(
      second.metadata.assumptions?.desiredOutcome,
    )
  })

  it("summarizes a complete brief for confirmation", () => {
    const result = updateBriefFromTurn({
      previous: null,
      prompt:
        "Create an English experience about John 3:16 for seekers to help them understand God's love, tone warm, CTA pray today",
    })

    const filled = updateBriefFromTurn({
      previous: result.metadata,
      prompt: "Jesus Film-style topic page",
    })

    expect(filled.confirmationRequired).toBe(true)
    expect(filled.content).toContain("Here is the editorial brief")
    expect(filled.content).toContain("Topic or passage")
  })

  it("finds the latest valid brief metadata and ignores malformed values", () => {
    const first = updateBriefFromTurn({
      previous: null,
      prompt: "Create a Thai page about hope",
    })
    const latest = updateBriefFromTurn({
      previous: first.metadata,
      prompt: "young adults",
    })

    expect(
      latestBriefMetadata([{ nope: true }, first.metadata, latest.metadata]),
    ).toMatchObject({
      kind: "editorial_brief",
      brief: latest.metadata.brief,
    })
  })

  it("treats quality draft metadata as a confirmed brief", () => {
    const brief = {
      topicOrPassage: "Matthew 11:28-30",
      language: "English",
      audience: "young adults",
      desiredOutcome: "Trust Jesus with weariness.",
      tone: "Warm",
      pageType: "Experience page",
      scriptureEmphasis: "Center Matthew 11:28-30.",
      ctaOrNextStep: "Invite readers to pray.",
    }

    expect(
      latestBriefMetadata([
        {
          kind: "editorial_brief",
          status: "confirmation_required",
          brief,
          missingFields: [],
        },
        {
          kind: "quality_draft",
          brief,
        },
      ]),
    ).toMatchObject({ status: "confirmed", brief })
  })
})
