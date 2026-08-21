import { describe, expect, it } from "vitest"
import { admitGraphqlRequest } from "./request-admission"

describe("GraphQL request admission", () => {
  it("rejects oversized and batched POST bodies before Yoga parses them", async () => {
    await expect(
      admitGraphqlRequest(
        new Request("https://admin.example.test/api/graphql", {
          method: "POST",
          body: "x".repeat(1_048_577),
        }),
      ),
    ).resolves.toMatchObject({ admitted: false, status: 413 })
    await expect(
      admitGraphqlRequest(
        new Request("https://admin.example.test/api/graphql", {
          method: "POST",
          body: '[{"query":"{ systemStatus }"}]',
        }),
      ),
    ).resolves.toMatchObject({ admitted: false, status: 400 })
  })

  it("admits a bounded single GraphQL request", async () => {
    await expect(
      admitGraphqlRequest(
        new Request("https://admin.example.test/api/graphql", {
          method: "POST",
          body: '{"query":"{ systemStatus }"}',
        }),
      ),
    ).resolves.toEqual({ admitted: true })
    await expect(
      admitGraphqlRequest(
        new Request("https://admin.example.test/api/graphql", {
          method: "POST",
          body: "x".repeat(1_048_576),
        }),
      ),
    ).resolves.toEqual({ admitted: true })
  })
})
