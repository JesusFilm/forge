import { describe, expect, it } from "vitest"
import { schema } from "@/graphql/schema"

type FieldsHolder = { getFields(): Record<string, unknown> }

function fieldsOf(typeName: string): Record<string, unknown> {
  const type = schema.getType(typeName)
  expect(type, `type ${typeName} should exist`).toBeTruthy()
  return (type as unknown as FieldsHolder).getFields()
}

describe("Manager session GraphQL contract", () => {
  it("exposes a Manager-scoped viewer query", () => {
    const fields = schema.getQueryType()!.getFields()
    expect(fields.managerViewer).toBeDefined()
    expect(fields.managerSession).toBeDefined()
  })

  it("exposes Manager logout as a mutation", () => {
    const fields = schema.getMutationType()!.getFields()
    expect(fields.managerLogout).toBeDefined()
  })

  it("returns the stable user/session shape Manager needs", () => {
    const fields = fieldsOf("ManagerViewer")
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining([
        "id",
        "email",
        "role",
        "managerRole",
        "permission",
      ]),
    )
  })

  it("exposes managerRole as the ManagerRole enum", () => {
    const fields = fieldsOf("ManagerViewer")
    expect(String((fields.managerRole as { type: unknown }).type)).toBe(
      "ManagerRole!",
    )
  })
})
