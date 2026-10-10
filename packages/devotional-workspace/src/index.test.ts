import { describe, expect, it } from "vitest"

import {
  devotionalWorkspaceArtifactRefSchema,
  devotionalWorkspaceManifestSchema,
  devotionalWorkspaceTransferSchema,
} from "."

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

describe("devotional Workspace contracts", () => {
  it("accepts immutable references and manifests", () => {
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

  it("defines the exact Mastra-to-Worker capability envelope", () => {
    const readGrant = {
      ref: artifact,
      url: "https://workspace.example/artifact?signed=secret",
      expiresAt: "2026-08-01T13:25:00.000Z",
    }
    const transfer = {
      schemaVersion: "1",
      attempt,
      manifest: readGrant,
      inputs: [
        {
          ...readGrant,
          artifactType: "devotional-render-input-v1",
          ext: "json",
        },
        {
          ...readGrant,
          artifactType: "devotional-narration-cover-v1",
          ext: "mp3",
        },
      ],
      outputs: [
        {
          artifactType: "devotional-output-portrait-v1",
          ext: "mp4",
          key: "runs/g7/token/worker-upload/hash/portrait.mp4",
          contentType: "video/mp4",
          url: "https://workspace.example/portrait?signed=secret",
          expiresAt: "2026-08-01T13:25:00.000Z",
        },
        {
          artifactType: "devotional-output-wide-v1",
          ext: "mp4",
          key: "runs/g7/token/worker-upload/hash/wide.mp4",
          contentType: "video/mp4",
          url: "https://workspace.example/wide?signed=secret",
          expiresAt: "2026-08-01T13:25:00.000Z",
        },
      ],
    }

    expect(devotionalWorkspaceTransferSchema.parse(transfer)).toEqual(transfer)
    expect(
      devotionalWorkspaceTransferSchema.safeParse({
        ...transfer,
        unexpected: true,
      }).success,
    ).toBe(false)
  })
})
