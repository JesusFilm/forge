import { describe, expect, it } from "vitest"
import { buildReviewMetadataFields } from "./review-player-metadata"

describe("buildReviewMetadataFields", () => {
  it("returns every generated metadata field plus source context", () => {
    expect(
      buildReviewMetadataFields({
        job: {
          sourceCollectionTitle: "Life of Jesus, Parables",
          sourceMediaTitle: "Story clip",
        },
        metadata: {
          title: " Generated title ",
          description: "Generated description",
          language: "English",
          topics: ["Faith", ""],
          speakers: ["Jesus"],
          tags: ["hope"],
        },
      }),
    ).toEqual([
      { kind: "text", label: "Title", value: "Generated title" },
      {
        kind: "text",
        label: "Description",
        value: "Generated description",
      },
      { kind: "text", label: "Language", value: "English" },
      {
        kind: "text",
        label: "Collections",
        value: "Life of Jesus, Parables",
      },
      { kind: "text", label: "Source media", value: "Story clip" },
      { kind: "list", label: "Topics", values: ["Faith"] },
      { kind: "list", label: "Speakers", values: ["Jesus"] },
      { kind: "list", label: "Tags", values: ["hope"] },
    ])
  })

  it("keeps all metadata labels visible when values are missing", () => {
    expect(
      buildReviewMetadataFields({
        job: {},
        metadata: {},
      }).map((field) => field.label),
    ).toEqual([
      "Title",
      "Description",
      "Language",
      "Collections",
      "Source media",
      "Topics",
      "Speakers",
      "Tags",
    ])
  })
})
