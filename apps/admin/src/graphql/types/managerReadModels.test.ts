import { describe, expect, it } from "vitest"
import { schema } from "@/graphql/schema"

type FieldsHolder = { getFields(): Record<string, unknown> }

function fieldsOf(typeName: string): Record<string, unknown> {
  const type = schema.getType(typeName)
  expect(type, `type ${typeName} should exist`).toBeTruthy()
  return (type as unknown as FieldsHolder).getFields()
}

describe("Manager read-model GraphQL contracts", () => {
  it("exposes Manager-scoped read-model entry points", () => {
    const fields = schema.getQueryType()!.getFields()
    expect(fields.managerLanguageGeo).toBeDefined()
    expect(fields.managerVideoCoverage).toBeDefined()
    expect(fields.managerCoverageSnapshots).toBeDefined()
  })

  it("exposes Manager language geo payload fields", () => {
    const fields = fieldsOf("ManagerLanguageGeo")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["continents", "countries", "languages"]),
    )
  })

  it("exposes Manager video coverage payload fields", () => {
    const fields = fieldsOf("ManagerVideoCoverage")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "documentId",
        "coreId",
        "title",
        "label",
        "slug",
        "aiMetadata",
        "imageUrl",
        "parentDocumentIds",
        "parentRelations",
        "coverage",
      ]),
    )
  })

  it("exposes Manager coverage snapshot payload fields", () => {
    const fields = fieldsOf("ManagerCoverageSnapshot")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "documentId",
        "date",
        "computedAt",
        "totalVideos",
        "videosWithAiMetadata",
        "videosWithHumanMetadata",
        "subtitlesHumanTotal",
        "subtitlesAiTotal",
        "audioHumanTotal",
        "audioAiTotal",
        "languageCoverage",
      ]),
    )
  })
})
