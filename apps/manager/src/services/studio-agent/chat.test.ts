import { beforeEach, expect, test, vi } from "vitest"
import { StudioBoundaryError } from "@forge/studio-server"
import { studioProjectSchema } from "@forge/studio-contracts"
import { studioChat } from "./chat"
import { studioServiceCall, studioServiceRequest } from "./transport"
vi.mock("./transport", () => ({
  studioServiceCall: vi.fn(),
  studioServiceRequest: vi.fn(),
  studioToolGrant: vi
    .fn()
    .mockResolvedValue({ body: "grant", assertion: "signed" }),
}))
const project = studioProjectSchema.parse({
  projectId: "project",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "operator" },
  document: {
    version: 1,
    title: "Before",
    language: "en",
    runtimeVersion: "test",
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 300,
    tracks: [],
    items: [],
    components: [],
    packRevisionIds: [],
  },
})
const caller = {
  sub: "operator",
  authority: "delegated" as const,
  clientId: "claude",
  scopes: ["shorts:read", "shorts:chat"],
}
const input = {
  projectId: "project",
  expectedRevision: 1,
  idempotencyKey: "same-key",
  message: "First message",
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(studioServiceCall).mockImplementation(
    async (_target, _caller, payload) => {
      const { action } = payload as { action: string }
      if (action === "read") return project
      if (action === "freeze")
        return {
          admission: "unsigned-attempt",
          provenance: {
            agentVersionId: "agent",
            blockVersionId: "block",
            digest: "a".repeat(64),
            agentDigest: "b".repeat(64),
            blockDigest: "c".repeat(64),
          },
        }
      if (action === "bind") return { admission: "bound-attempt" }
      return {
        projectId: "project",
        revision: 1,
        attemptId: "attempt",
        outcome: "ACCEPTED",
      }
    },
  )
})
test("a losing duplicate never finalizes another execution's canonical attempt", async () => {
  vi.mocked(studioServiceRequest).mockRejectedValue(
    new StudioBoundaryError("Already executed", 409),
  )
  const response = await studioChat(caller, input, new AbortController().signal)
  expect(await response.text()).toContain('"type":"error"')
  expect(
    vi
      .mocked(studioServiceCall)
      .mock.calls.some(
        ([, , p]) => (p as { action: string }).action === "finish",
      ),
  ).toBe(false)
})
test("canonical admission hashes effective message and project; successful execution uses bound token", async () => {
  vi.mocked(studioServiceRequest).mockImplementation(
    async () => new Response('{"type":"done"}\n'),
  )
  await (await studioChat(caller, input, new AbortController().signal)).text()
  await (
    await studioChat(
      caller,
      { ...input, message: "Changed message" },
      new AbortController().signal,
    )
  ).text()
  const requests = vi
    .mocked(studioServiceCall)
    .mock.calls.map(
      ([, , p]) =>
        p as { action: string; input: { executionInputDigest: string } },
    )
    .filter((p) => p.action === "request")
  expect(requests[0].input.executionInputDigest).not.toBe(
    requests[1].input.executionInputDigest,
  )
  expect(studioServiceRequest).toHaveBeenCalledWith(
    "mastra",
    caller,
    expect.objectContaining({
      admission: "bound-attempt",
      attemptId: "attempt",
    }),
    expect.any(AbortSignal),
  )
})
test("malformed stream after done records failure rather than success", async () => {
  vi.mocked(studioServiceRequest).mockResolvedValue(
    new Response('{"type":"done"}\ntruncated'),
  )
  const body = await (
    await studioChat(caller, input, new AbortController().signal)
  ).text()
  expect(body).toContain('"type":"error"')
  expect(studioServiceCall).toHaveBeenCalledWith(
    "admin",
    expect.anything(),
    expect.objectContaining({
      action: "finish",
      input: expect.objectContaining({ status: "FAILED" }),
    }),
  )
})

test("retains generation text and validated proposals alongside frozen attempt completion", async () => {
  const proposal = {
    summary: "Title update",
    command: {
      projectId: "project",
      expectedRevision: 1,
      idempotencyKey: "proposal",
      operations: [{ kind: "set-metadata", title: "After" }],
    },
  }
  vi.mocked(studioServiceRequest).mockResolvedValue(
    new Response(
      [
        JSON.stringify({ type: "text", text: "Source-based draft." }),
        JSON.stringify({ type: "proposal", proposal }),
        JSON.stringify({ type: "done" }),
        "",
      ].join("\n"),
    ),
  )
  await (await studioChat(caller, input, new AbortController().signal)).text()
  expect(studioServiceCall).toHaveBeenCalledWith(
    "admin",
    expect.anything(),
    expect.objectContaining({
      action: "finish",
      generation: {
        text: "Source-based draft.",
        proposals: [proposal],
        diagnostics: [],
      },
    }),
  )
})

test("retired Studio scopes cannot start a Shorts request", async () => {
  await expect(
    studioChat(
      { ...caller, scopes: ["studio:read", "studio:chat"] },
      input,
      new AbortController().signal,
    ),
  ).rejects.toThrow("insufficient_scope")
  expect(studioServiceCall).not.toHaveBeenCalled()
  expect(studioServiceRequest).not.toHaveBeenCalled()
})
