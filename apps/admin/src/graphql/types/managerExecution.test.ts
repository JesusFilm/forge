import { createRequire } from "node:module"
import { describe, expect, it, vi } from "vitest"
import type { Principal } from "@/auth/principal"
import type { ContextShape } from "@/graphql/builder"
import { schema } from "@/graphql/schema"

// Pothos loads GraphQL through CJS; use the same instance in Vitest.
const { graphql } = createRequire(import.meta.url)(
  "graphql",
) as typeof import("graphql")

const input = {
  jobId: "job",
  runId: "run",
  inputDigest: "a".repeat(64),
  operationId: "run-admission",
  operationDigest: "b".repeat(64),
}

describe("Manager execution GraphQL service-only commands", () => {
  for (const [name, method] of [
    ["claimManagerExecutionOperation", "claim"],
    ["completeManagerExecutionOperation", "complete"],
  ] as const) {
    it(`${name} preserves the frozen JSON signature`, () => {
      const field = schema.getMutationType()!.getFields()[name]!
      expect(field.type.toString()).toBe("JSON!")
      expect(field.args.map((arg) => [arg.name, arg.type.toString()])).toEqual([
        ["input", "JSON!"],
      ])
    })

    it.each<Principal | null>([
      null,
      { id: "admin", role: "ADMIN" },
      { id: null, role: "SYSTEM" },
      { id: null, role: "WORKFLOW_TRIGGER" },
    ])(`${name} denies %j at GraphQL before service entry`, async (user) => {
      const call = vi.fn()
      const result = await graphql({
        schema,
        source: `mutation($input: JSON!) { ${name}(input: $input) }`,
        variableValues: { input },
        contextValue: {
          user,
          services: { managerExecution: { [method]: call } },
        } as unknown as ContextShape,
      })
      expect(result.errors).toHaveLength(1)
      expect(call).not.toHaveBeenCalled()
    })

    it(`${name} delegates Manager service claims verbatim`, async () => {
      const user: Principal = { id: null, role: "MANAGER_BACKEND" }
      const response = { status: "replayed", result: { key: "stored" } }
      const call = vi.fn().mockResolvedValue(response)
      const result = await graphql({
        schema,
        source: `mutation($input: JSON!) { ${name}(input: $input) }`,
        variableValues: { input },
        contextValue: {
          user,
          services: { managerExecution: { [method]: call } },
        } as unknown as ContextShape,
      })
      expect(result.errors).toBeUndefined()
      expect(result.data?.[name]).toEqual(response)
      expect(call).toHaveBeenCalledWith({ user, input })
    })
  }
})
