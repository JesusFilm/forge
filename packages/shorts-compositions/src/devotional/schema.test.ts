import { describe, expect, it } from "vitest"
import {
  devotionalWorkspaceArtifactRefSchema,
  devotionalWorkspaceManifestSchema,
} from "./schema"

const attempt = {
  workspaceGeneration: 7,
  attemptId: "attempt_1",
  runId: "run_1",
}
const artifact = {
  schemaVersion: "2",
  key: `runs/g7/0123456789abcdef01234567/attempt-output/${"a".repeat(64)}/portrait.mp4`,
  digest: "a".repeat(64),
  size: 123,
  contentType: "video/mp4",
  attempt,
}

describe("devotional Workspace schemas", () => {
  it("accepts immutable v2 references and complete manifests", () => {
    expect(devotionalWorkspaceArtifactRefSchema.parse(artifact)).toEqual(
      artifact,
    )
    expect(
      devotionalWorkspaceManifestSchema.parse({
        schemaVersion: "2",
        kind: "attempt-output",
        attempt,
        artifacts: [
          {
            artifactType: "devotional-output-portrait-v1",
            ext: "mp4",
            ref: artifact,
          },
        ],
      }),
    ).toBeTruthy()
  })

  it("rejects refs without digest-bound attempt identity", () => {
    expect(
      devotionalWorkspaceArtifactRefSchema.safeParse({
        ...artifact,
        digest: "not-a-digest",
      }).success,
    ).toBe(false)
    expect(
      devotionalWorkspaceArtifactRefSchema.safeParse({
        ...artifact,
        attempt: { ...attempt, workspaceGeneration: 0 },
      }).success,
    ).toBe(false)
  })
})
