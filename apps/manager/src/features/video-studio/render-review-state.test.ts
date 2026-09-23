import { expect, it } from "vitest"
import {
  parseRenderHandoff,
  canApproveRenderedEvidence,
} from "./render-review-state"
import { NarrationAllowanceAuthorization } from "./narration-allowance"
it("keeps a precise historical handoff and refuses ambiguous query values", () => {
  expect(
    parseRenderHandoff({ renderAttemptId: "old-render", revision: "2" }),
  ).toEqual({ attemptId: "old-render", revision: 2 })
  for (const revision of ["0", "1.5", "1e2", "9007199254740992", ["1", "2"]])
    expect(
      parseRenderHandoff({ renderAttemptId: "render", revision }),
    ).toBeUndefined()
})
it("never approves prior bytes, dirty edits, or an advanced canonical revision", () => {
  const input = {
    selectedAttemptId: "render",
    reviewedAttemptId: "render",
    evidenceRevision: 2,
    currentRevision: 2,
    editorRevision: 2,
    editorStatus: "saved",
    stale: false,
    locked: false,
  }
  expect(canApproveRenderedEvidence(input)).toBe(true)
  for (const changed of [
    { currentRevision: 3 },
    { editorRevision: 3 },
    { editorStatus: "unsaved" },
    { editorStatus: "conflict" },
    { reviewedAttemptId: "other" },
    { stale: true },
    { locked: true },
  ])
    expect(canApproveRenderedEvidence({ ...input, ...changed })).toBe(false)
})
it("lost allowance response retries the exact authorization without granting twice", async () => {
  const authorization = new NarrationAllowanceAuthorization()
  const first = authorization.prepare("project", 2, 1)
  let passes = 0
  const receipts = new Set<string>()
  const call = async (command: typeof first) => {
    if (!receipts.has(command.idempotencyKey)) {
      receipts.add(command.idempotencyKey)
      passes += command.additionalPasses
      throw new TypeError("Lost response")
    }
  }
  await expect(authorization.submit(call)).rejects.toThrow("Lost response")
  expect(authorization.prepare("project", 3, 10)).toEqual(first)
  await authorization.submit(call)
  expect(passes).toBe(1)
  expect(authorization.command).toBeNull()
})

it("allows explicit recovery from rejected authorization but never discards uncertain grants", async () => {
  const { StudioClientError } = await import("./client")
  const authorization = new NarrationAllowanceAuthorization()
  const first = authorization.prepare("project", 2, 1)
  await expect(
    authorization.submit(async () => {
      throw new TypeError("Lost response")
    }),
  ).rejects.toThrow()
  authorization.discardRejected()
  expect(authorization.command).toEqual(first)
  await expect(
    authorization.submit(async () => {
      throw new StudioClientError(409, "CONFLICT")
    }),
  ).rejects.toThrow()
  expect(authorization.rejected).toBe(true)
  authorization.discardRejected()
  expect(authorization.command).toBeNull()
  const next = authorization.prepare("project", 3, 1)
  expect(next.idempotencyKey).not.toBe(first.idempotencyKey)
  expect(next.expectedRevision).toBe(3)
})
