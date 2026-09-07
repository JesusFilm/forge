import { describe, expect, it } from "vitest"
import { createStudioAdminAdapter } from "./studio-client"

describe("Studio Admin adapter", () => {
  it("validates mutation input and decodes the generated result contract", async () => {
    const adapter = createStudioAdminAdapter(async (_query, variables) => {
      expect(variables.input).toEqual({
        projectId: "project",
        expectedRevision: 2,
        idempotencyKey: "retry-key",
        operations: [{ kind: "set-metadata", title: "Edited" }],
      })
      return {
        applyStudioOperations: {
          projectId: "project",
          revision: 3,
          outcome: "ACCEPTED",
          attemptId: null,
          approvalId: null,
        },
      }
    })
    expect(
      await adapter.apply({
        projectId: "project",
        expectedRevision: 2,
        idempotencyKey: "retry-key",
        operations: [{ kind: "set-metadata", title: "Edited" }],
      }),
    ).toMatchObject({ revision: 3 })
    expect("publish" in adapter).toBe(false)
  })
  it("rejects malformed Admin data instead of passing an invalid project into the editor", async () => {
    const adapter = createStudioAdminAdapter(async () => ({
      studioProject: { projectId: "project", revision: 1 },
    }))
    await expect(adapter.read("project")).rejects.toBeDefined()
  })
})
