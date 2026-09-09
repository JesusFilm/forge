import { generateKeyPairSync } from "node:crypto"
import { readFileSync } from "node:fs"
import { beforeEach, expect, it, vi } from "vitest"
import { signStudioRequest } from "@forge/studio-server"
import { StudioProposalFieldError } from "@forge/studio-contracts/production"
import { POST } from "./route"
const fixture = vi.hoisted(() => ({
  execute: vi.fn(),
  env: { STUDIO_INTERACTIVE_PUBLIC_KEYS: "{}", STUDIO_ENVIRONMENT: "test" },
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/config/env", () => ({ env: fixture.env }))
vi.mock("@/services/studio-authoring/delegated", () => ({
  executeStudioDelegated: fixture.execute,
}))
const pair = generateKeyPairSync("ed25519")
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString()
const project = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../../docs/validation/studio-458/native-hosted-followup-2/binding/bound-proposal.body",
      import.meta.url,
    ),
    "utf8",
  ),
).cases[0].project
const feedback = {
  code: "PROPOSAL_FIELD_TYPE_MISMATCH",
  issues: [
    { path: ["operations", 0, "properties", "fontSize"], expected: "number" },
  ],
} as const
const error = () =>
  new StudioProposalFieldError({
    code: feedback.code,
    issues: [
      { path: ["operations", 0, "properties", "fontSize"], expected: "number" },
    ],
  })
beforeEach(() => {
  fixture.env.STUDIO_INTERACTIVE_PUBLIC_KEYS = JSON.stringify({
    test: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  })
  fixture.execute
    .mockReset()
    .mockImplementation(async (_db, _caller, input) => {
      if (input.action === "read") return project
      throw error()
    })
})
async function request(
  action = "validate-proposal",
  projectId = project.projectId,
  tamper = false,
) {
  const body = JSON.stringify({ projectId: project.projectId, revision: 1 })
  const assertion = await signStudioRequest(
    body,
    "forge-admin:shorts:tools",
    {
      sub: "operator",
      authority: "delegated",
      clientId: "shorts-hosted",
      scopes: ["shorts:read", "shorts:edit"],
    },
    { privateKey, keyId: "test", environment: "test" },
  )
  return POST(
    new Request("http://localhost/api/shorts/tools", {
      method: "POST",
      body: JSON.stringify({
        grant: { body: tamper ? body + " " : body, assertion },
        action,
        input: {
          command: {
            projectId,
            expectedRevision: 1,
            idempotencyKey: "field-feedback",
            operations: [
              {
                kind: "set-properties",
                itemId: "reflection",
                properties: { fontSize: "private-value" },
              },
            ],
          },
        },
      }),
    }),
  )
}
it("returns only bounded field facts after a verified grant and admitted-project check", async () => {
  const response = await request()
  expect(response.status).toBe(400)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(await response.json()).toEqual({
    error: "Studio proposal fields rejected",
    feedback,
  })
  expect(fixture.execute.mock.calls.map((call) => call[2].action)).toEqual([
    "read",
    "validate-proposal",
  ])
})
it("does not expose field feedback for invalid authority, another project or an unrelated action", async () => {
  const invalid = await request("validate-proposal", project.projectId, true)
  expect(invalid.status).toBe(403)
  expect(fixture.execute).not.toHaveBeenCalled()
  const outside = await request("validate-proposal", "another-project")
  expect(outside.status).toBe(403)
  expect(fixture.execute).toHaveBeenCalledTimes(1)
  const unrelated = await request("assets")
  expect(await unrelated.text()).not.toContain("PROPOSAL_FIELD_TYPE_MISMATCH")
})
it("does not serialize malformed internal facts or arbitrary canonical errors", async () => {
  for (const failure of [
    Object.assign(error(), {
      feedback: { ...feedback, suppliedValue: "private-source" },
    }),
    Object.assign(error(), {
      feedback: { ...feedback, issues: Array(9).fill(feedback.issues[0]) },
    }),
    new Error("private database/source diagnostic"),
  ]) {
    fixture.execute.mockImplementation(async (_db, _caller, input) => {
      if (input.action === "read") return project
      throw failure
    })
    const response = await request()
    expect(await response.json()).toEqual({ error: "Studio tool rejected" })
  }
})
