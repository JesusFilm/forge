import { describe, expect, it } from "vitest"
import { schema } from "@/graphql/schema"

type FieldsHolder = { getFields(): Record<string, unknown> }

function fieldsOf(typeName: string): Record<string, unknown> {
  const type = schema.getType(typeName)
  expect(type, `type ${typeName} should exist`).toBeTruthy()
  return (type as unknown as FieldsHolder).getFields()
}

describe("Manager job GraphQL contract", () => {
  it("exposes Manager job query and mutation entry points", () => {
    const query = schema.getQueryType()!.getFields()
    const mutation = schema.getMutationType()!.getFields()
    expect(query.managerJobs).toBeDefined()
    expect(query.managerJob).toBeDefined()
    expect(mutation.createManagerJob).toBeDefined()
    expect(mutation.updateManagerJob).toBeDefined()
  })

  it("exposes the Manager JobRecord-compatible fields", () => {
    const fields = fieldsOf("ManagerJob")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "id",
        "muxAssetId",
        "muxPlaybackId",
        "videoDocumentId",
        "languages",
        "options",
        "status",
        "currentStep",
        "retries",
        "createdAt",
        "updatedAt",
        "startedAt",
        "completedAt",
        "artifacts",
        "steps",
        "errors",
      ]),
    )
  })
})
