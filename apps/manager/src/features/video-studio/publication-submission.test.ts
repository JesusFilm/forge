import { expect, it, vi } from "vitest"
import { PublicationSubmission } from "./publication-submission"
const binding = {
  projectId: "project",
  expectedRevision: 1,
  idempotencyKey: "key",
  approvalId: "approval",
  renderAttemptId: "render",
  releaseId: "release",
}
it("retains an ambiguous command across changed bindings and allows only exact receipt retry", async () => {
  const submission = new PublicationSubmission()
  await submission.prepare(
    binding,
    async () => ({ releaseId: "release", readinessId: "ready" }),
    () => true,
  )
  const original = submission.command
  await expect(
    submission.submit(
      async () => {
        throw new Error("lost response")
      },
      () => false,
    ),
  ).rejects.toThrow()
  expect(() => submission.discardRejected()).toThrow()
  await expect(
    submission.prepare(
      { ...binding, expectedRevision: 2 },
      vi.fn(),
      () => true,
    ),
  ).rejects.toThrow()
  const retry = vi.fn(async () => ({ outcome: "ACCEPTED" }))
  await submission.submit(retry, () => false)
  expect(retry).toHaveBeenCalledWith(original)
  expect(submission.command).toBeNull()
})
it("allows explicit fresh preparation only after canonical confirmed non-commit rejection", async () => {
  const submission = new PublicationSubmission()
  await submission.prepare(
    binding,
    async () => ({ releaseId: "release", readinessId: "expired" }),
    () => true,
  )
  await expect(
    submission.submit(
      async () => {
        throw new Error("UNREADY")
      },
      () => true,
    ),
  ).rejects.toThrow()
  expect(submission.rejected).toBe(true)
  submission.discardRejected()
  const next = {
    ...binding,
    expectedRevision: 2,
    idempotencyKey: "new-key",
    approvalId: "new-approval",
    renderAttemptId: "new-render",
    releaseId: "new-release",
  }
  await submission.prepare(
    next,
    async () => ({ releaseId: "new-release", readinessId: "fresh" }),
    () => true,
  )
  expect(submission.command).toEqual({ ...next, readinessId: "fresh" })
})
it("does not mix an old approval/release with a revision changed during preparation", async () => {
  const submission = new PublicationSubmission()
  let current = true
  await expect(
    submission.prepare(
      binding,
      async () => {
        current = false
        return { releaseId: "release", readinessId: "ready" }
      },
      () => current,
    ),
  ).rejects.toThrow("changed")
  expect(submission.command).toBeNull()
})
