import { expect, it, vi } from "vitest"
import { studioGenerationBatch } from "./generation"
import { studioChat } from "./chat"
vi.mock("./chat", () => ({ studioChat: vi.fn() }))
const caller = {
  sub: "operator",
  authority: "interactive" as const,
  clientId: "studio-manager",
  scopes: ["studio:read", "studio:edit", "studio:chat"],
}
const requests = ["first", "second"].map((projectId) => ({
  projectId,
  expectedRevision: 1,
  idempotencyKey: `batch-${projectId}`,
  message: "Generate a source-led script and composition.",
}))
it("runs only explicit bounded targets and preserves independent failures without retry", async () => {
  vi.mocked(studioChat).mockImplementation(async (_caller, input) => {
    if (requests[0] === input) throw new Error("Should validate a fresh object")
    const projectId = Reflect.get(Object(input), "projectId")
    if (projectId === "first") throw new Error("Revision conflict")
    return new Response(
      '{"type":"admitted","attemptId":"attempt","instructions":{}}\n{"type":"done"}\n',
    )
  })
  const response = await studioGenerationBatch(
    caller,
    { requests, confirmed: true },
    new AbortController().signal,
  )
  const lines = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  expect(studioChat).toHaveBeenCalledTimes(2)
  expect(lines).toContainEqual(
    expect.objectContaining({ type: "target-error", projectId: "first" }),
  )
  expect(lines).toContainEqual(
    expect.objectContaining({
      type: "target-event",
      projectId: "second",
      event: expect.objectContaining({ type: "admitted" }),
    }),
  )
})
it("rejects duplicate targets and planner authority before dispatch", async () => {
  vi.mocked(studioChat).mockClear()
  await expect(
    studioGenerationBatch(
      caller,
      { requests: [requests[0], requests[0]], confirmed: true },
      new AbortController().signal,
    ),
  ).rejects.toThrow()
  await expect(
    studioGenerationBatch(
      { ...caller, clientId: "studio-planner", authority: "delegated" },
      { requests, confirmed: true },
      new AbortController().signal,
    ),
  ).rejects.toThrow("Interactive")
  expect(studioChat).not.toHaveBeenCalled()
})
it("keeps a native prerequisite failure visible in the target outcome", async () => {
  vi.mocked(studioChat).mockResolvedValue(
    new Response(
      '{"type":"error","message":"Activate the pinned instruction version before running"}\n',
    ),
  )
  const response = await studioGenerationBatch(
    caller,
    { requests: [requests[0]], confirmed: true },
    new AbortController().signal,
  )
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  expect(events).toContainEqual({
    type: "target-error",
    projectId: "first",
    message: "Activate the pinned instruction version before running",
  })
})
