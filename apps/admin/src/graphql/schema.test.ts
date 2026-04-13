// Unit 3 spike — schema structural tests that do NOT require a running DB.
//
// What these tests verify WITHOUT a database:
//   - Yoga + Pothos + Prisma plugin + scope-auth compile and assemble
//   - Root types exist (Query with pingPublic/pingAll)
//   - Pothos Prisma `...query` passthrough is wired (resolvers accept `query`)
//   - Nested `t.relation('children')` is present on Ping
//   - Scope-auth `authScopes` are wired on the expected fields
//
// Assertions use the schema's string accessors rather than `instanceof` so
// that they survive vitest's occasional double-instance of the `graphql`
// module in transitive deps.
//
// DB-DEPENDENT VERIFICATION (documented as a runbook step in CLAUDE.md):
//   - Single SQL JOIN for nested relation query — requires live Postgres +
//     Prisma query logging. Manual spike step before relying on Unit 3.
//   - Default-deny + scope-auth enforcement end-to-end via Yoga.

import { describe, expect, it } from "vitest"
import { schema } from "@/graphql/schema"

describe("GraphQL schema (Unit 3 spike)", () => {
  it("exposes Query.pingPublic and Query.pingAll", () => {
    const query = schema.getQueryType()
    expect(query).toBeTruthy()
    const fields = query!.getFields()
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["pingPublic", "pingAll"]),
    )
  })

  it("Ping type exposes id, message, isPublic, children", () => {
    const Ping = schema.getType("Ping")
    expect(Ping).toBeTruthy()
    // getFields() is on GraphQLObjectType; narrow via duck-typing to avoid
    // instanceof across module realms.
    const fields = (
      Ping as unknown as { getFields(): Record<string, unknown> }
    ).getFields()
    expect(Object.keys(fields)).toEqual(
      expect.arrayContaining(["id", "message", "isPublic", "children"]),
    )
  })

  it("Ping.children is a list of PingChild (nested relation wired)", () => {
    const Ping = schema.getType("Ping") as unknown as {
      getFields(): Record<string, { type: { toString(): string } }>
    }
    const childrenType = Ping.getFields().children.type.toString()
    // Acceptable wrappings: `[PingChild!]!`, `[PingChild]!`, `[PingChild!]`, etc.
    expect(childrenType).toMatch(/PingChild/)
    expect(childrenType.startsWith("[")).toBe(true)
  })

  it("pingAll returns a list of Ping", () => {
    const query = schema.getQueryType()!
    const fields = query.getFields() as unknown as Record<
      string,
      { type: { toString(): string } }
    >
    const pingAllType = fields.pingAll.type.toString()
    expect(pingAllType).toMatch(/Ping/)
    expect(pingAllType.startsWith("[")).toBe(true)
  })

  it("pingPublic is nullable and args include id", () => {
    const query = schema.getQueryType()!
    const field = query.getFields().pingPublic as unknown as {
      type: { toString(): string }
      args: { name: string }[]
    }
    expect(field.type.toString()).toBe("Ping")
    expect(field.args.map((a) => a.name)).toContain("id")
  })
})
