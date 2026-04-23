import { describe, expect, it, vi } from "vitest"
import {
  buildSharedAgentMetadataTranslationRequest,
  buildSharedAgentMetadataTranslationResult,
  translateSharedAgentMetadata,
} from "./shared-agent-translation"

describe("shared-agent translation helper", () => {
  it("builds a trimmed translation request from populated metadata fields", () => {
    const request = buildSharedAgentMetadataTranslationRequest({
      source: {
        videoDocumentId: "video-1",
        videoCoreId: "core-1",
        sourceLanguage: " English ",
        title: " Resurrection Hope ",
        description: " A message about hope in the resurrection. ",
        slug: " resurrection-hope ",
        snippet: "   ",
        imageAlt: null,
      },
      targetLanguage: " Spanish ",
      toneNotes: " Natural, clear Latin American Spanish ",
    })

    expect(request).toEqual({
      sourceLanguage: "English",
      targetLanguage: "Spanish",
      toneNotes: "Natural, clear Latin American Spanish",
      video: {
        documentId: "video-1",
        coreId: "core-1",
      },
      fields: [
        { key: "title", label: "Title", value: "Resurrection Hope" },
        {
          key: "description",
          label: "Description",
          value: "A message about hope in the resurrection.",
        },
        { key: "slug", label: "Slug", value: "resurrection-hope" },
      ],
    })
  })

  it("shapes translated metadata into a control-plane friendly result", async () => {
    const translateMock = vi.fn().mockResolvedValue({
      title: "Esperanza en la Resurreccion",
      description: "Un mensaje sobre la esperanza en la resurreccion.",
      slug: "esperanza-en-la-resurreccion",
      snippet: "should be ignored",
    })

    const output = await translateSharedAgentMetadata(
      {
        source: {
          sourceLanguage: "English",
          title: "Resurrection Hope",
          description: "A message about hope in the resurrection.",
          slug: "resurrection-hope",
          snippet: "",
        },
        targetLanguage: "Spanish",
        toneNotes: "Natural, clear Latin American Spanish",
      },
      {
        translate: translateMock,
      },
    )

    expect(translateMock).toHaveBeenCalledTimes(1)
    expect(translateMock).toHaveBeenCalledWith({
      sourceLanguage: "English",
      targetLanguage: "Spanish",
      toneNotes: "Natural, clear Latin American Spanish",
      video: {
        documentId: null,
        coreId: null,
      },
      fields: [
        { key: "title", label: "Title", value: "Resurrection Hope" },
        {
          key: "description",
          label: "Description",
          value: "A message about hope in the resurrection.",
        },
        { key: "slug", label: "Slug", value: "resurrection-hope" },
      ],
    })

    expect(output.draftPatch).toEqual({
      title: "Esperanza en la Resurreccion",
      description: "Un mensaje sobre la esperanza en la resurreccion.",
      slug: "esperanza-en-la-resurreccion",
      targetLanguage: "Spanish",
    })
    expect(output.result.draftPatch).toEqual(output.draftPatch)
    expect(output.result.summary).toBe(
      "Translated 3 metadata fields into Spanish.",
    )
    expect(output.result.markdown).toContain("Esperanza en la Resurreccion")
    expect(output.result.markdown).toContain(
      "Natural, clear Latin American Spanish",
    )
    expect(output.result.recommendations).toEqual([
      {
        label: "Review localized metadata in context",
        rationale:
          "Check the translated title, description, and slug in the final Manager preview before approving writeback.",
        appliesTo: ["title", "description", "slug"],
      },
      {
        label: "Confirm localized slug fit",
        rationale:
          "Make sure the translated slug matches how native speakers would search for this video.",
        appliesTo: ["slug"],
      },
    ])
    expect(output.result.followupActions).toEqual([
      "Approve the translated metadata patch if the localized wording looks right.",
    ])
    expect(output.output).toBe(output.result.markdown)
  })

  it("fails when translation output does not contain any editable fields", () => {
    expect(() =>
      buildSharedAgentMetadataTranslationResult({
        request: {
          sourceLanguage: "English",
          targetLanguage: "Spanish",
          toneNotes: null,
          video: {
            documentId: "video-1",
            coreId: null,
          },
          fields: [
            { key: "title", label: "Title", value: "Resurrection Hope" },
          ],
        },
        translatedFields: {
          title: "   ",
        },
      }),
    ).toThrow("Translator did not return any translated metadata fields.")
  })
})
