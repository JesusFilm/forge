import { describe, expect, it } from "vitest"
import { parseManifest, sourceTimeMs, subtitlesAt } from "./manifest"
import { exampleManifest } from "./example"

describe("bounded component manifest", () => {
  it("round trips editable text and style with exact source identity", () => {
    const edited = structuredClone(exampleManifest)
    edited.props.title = "Changed title"
    edited.props.color = "#ff0000"
    expect(parseManifest(JSON.parse(JSON.stringify(edited)))).toEqual(edited)
  })
  it("rejects another dub language or subtitle edition rather than falling back", () => {
    const wrong = structuredClone(exampleManifest)
    wrong.asset.subtitle.editionId = "other"
    expect(() => parseManifest(wrong)).toThrow()
    wrong.asset.subtitle.editionId = wrong.asset.editionId
    wrong.asset.languageSlug = "french"
    expect(() => parseManifest(wrong)).toThrow()
  })
  it("uses half-open source trim and subtitle intervals in preview and export", () => {
    expect(sourceTimeMs(exampleManifest, 0)).toBe(1000)
    expect(sourceTimeMs(exampleManifest, 15)).toBe(1500)
    expect(subtitlesAt(exampleManifest, 0)).toEqual(["Exact source cue"])
    expect(subtitlesAt(exampleManifest, 30)).toEqual([])
    expect(() => sourceTimeMs(exampleManifest, 60)).toThrow()
  })
})
