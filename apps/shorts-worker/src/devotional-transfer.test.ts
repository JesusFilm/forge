import { createHash } from "node:crypto"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  devotionalWorkspaceTransferSchema,
  downloadDevotionalWorkspaceGrant,
  readDevotionalWorkspaceGrant,
  validateDevotionalWorkspaceTransfer,
} from "./devotional-transfer.js"

const attempt = {
  workspaceGeneration: 3,
  attemptId: "attempt_3",
  runId: "run_3",
}
const token = createHash("sha256")
  .update(attempt.attemptId)
  .digest("hex")
  .slice(0, 24)
const expiresAt = "2029-01-01T01:00:00.000Z"
const allowedOrigin = "https://bucket.example"

function capabilityUrl(key: string, origin = allowedOrigin): string {
  return `${origin}/${key}?signed=secret`
}

function ref(fileName: string, body: string) {
  return {
    schemaVersion: "2" as const,
    key: `runs/g3/${token}/run-input/${createHash("sha256").update(body).digest("hex")}/${fileName}`,
    digest: createHash("sha256").update(body).digest("hex"),
    size: Buffer.byteLength(body),
    contentType: fileName.endsWith(".json") ? "application/json" : "audio/mpeg",
    attempt,
  }
}

function transfer() {
  const manifestRef = {
    ...ref("manifest.json", "manifest"),
    key: `runs/g3/${token}/run-input/manifest.json`,
  }
  const inputRef = ref("input.json", "input")
  return devotionalWorkspaceTransferSchema.parse({
    schemaVersion: "1",
    attempt,
    manifest: {
      ref: manifestRef,
      url: capabilityUrl(manifestRef.key),
      expiresAt,
    },
    inputs: [
      {
        artifactType: "devotional-render-input-v1",
        ext: "json",
        ref: inputRef,
        url: capabilityUrl(inputRef.key),
        expiresAt,
      },
      {
        artifactType: "devotional-narration-cover-v1",
        ext: "mp3",
        ref: ref("cover.mp3", "audio"),
        url: capabilityUrl(ref("cover.mp3", "audio").key),
        expiresAt,
      },
    ],
    outputs: [
      {
        artifactType: "devotional-output-portrait-v1",
        ext: "mp4",
        key: `runs/g3/${token}/worker-upload/upload_1/portrait.mp4`,
        contentType: "video/mp4",
        url: capabilityUrl(
          `runs/g3/${token}/worker-upload/upload_1/portrait.mp4`,
        ),
        expiresAt,
      },
      {
        artifactType: "devotional-output-wide-v1",
        ext: "mp4",
        key: `runs/g3/${token}/worker-upload/upload_1/wide.mp4`,
        contentType: "video/mp4",
        url: capabilityUrl(`runs/g3/${token}/worker-upload/upload_1/wide.mp4`),
        expiresAt,
      },
    ],
  })
}

describe("devotional signed Workspace transfer", () => {
  it("accepts one bounded same-origin capability set", () => {
    expect(() =>
      validateDevotionalWorkspaceTransfer(transfer(), {
        nodeEnv: "production",
        allowedOrigin,
        now: new Date("2029-01-01T00:00:00.000Z"),
      }),
    ).not.toThrow()
  })

  it("rejects private, mixed-origin, expired, and cross-attempt capabilities", () => {
    const cases = [
      {
        ...transfer(),
        manifest: {
          ...transfer().manifest,
          url: capabilityUrl(
            transfer().manifest.ref.key,
            "https://169.254.169.254",
          ),
        },
      },
      {
        ...transfer(),
        outputs: transfer().outputs.map((output, index) =>
          index === 0
            ? {
                ...output,
                url: capabilityUrl(output.key, "https://other.example"),
              }
            : output,
        ),
      },
      {
        ...transfer(),
        manifest: {
          ...transfer().manifest,
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      },
      {
        ...transfer(),
        manifest: {
          ...transfer().manifest,
          expiresAt: "2029-01-02T00:00:00.000Z",
        },
      },
      {
        ...transfer(),
        manifest: {
          ...transfer().manifest,
          url: capabilityUrl("runs/g3/not-the-manifest.json"),
        },
      },
      {
        ...transfer(),
        inputs: transfer().inputs.map((input, index) =>
          index === 0
            ? {
                ...input,
                ref: {
                  ...input.ref,
                  attempt: { ...attempt, attemptId: "another_attempt" },
                },
              }
            : input,
        ),
      },
      {
        ...transfer(),
        outputs: transfer().outputs.map((output, index) =>
          index === 0
            ? {
                ...output,
                key: output.key.replace("upload_1", "another_upload"),
              }
            : output,
        ),
      },
    ]
    for (const value of cases) {
      expect(() =>
        validateDevotionalWorkspaceTransfer(
          devotionalWorkspaceTransferSchema.parse(value),
          {
            nodeEnv: "production",
            allowedOrigin,
            now: new Date("2029-01-01T00:00:00.000Z"),
          },
        ),
      ).toThrow()
    }
  })

  it.each(["https://169.254.169.254", "https://[::ffff:7f00:1]"])(
    "rejects an allowlisted IP-literal capability origin %s",
    (origin) => {
      const value = transfer()
      const replaceOrigin = (url: string) => url.replace(allowedOrigin, origin)
      const privateTransfer = {
        ...value,
        manifest: { ...value.manifest, url: replaceOrigin(value.manifest.url) },
        inputs: value.inputs.map((input) => ({
          ...input,
          url: replaceOrigin(input.url),
        })),
        outputs: value.outputs.map((output) => ({
          ...output,
          url: replaceOrigin(output.url),
        })),
      }

      expect(() =>
        validateDevotionalWorkspaceTransfer(
          devotionalWorkspaceTransferSchema.parse(privateTransfer),
          {
            nodeEnv: "production",
            allowedOrigin: origin,
            now: new Date("2029-01-01T00:00:00.000Z"),
          },
        ),
      ).toThrow(/host is private/u)
    },
  )

  it("rejects downloaded bytes that do not match the granted digest", async () => {
    const grant = transfer().inputs[0]!
    await expect(
      readDevotionalWorkspaceGrant({
        grant,
        maxBytes: 1_000,
        fetchImpl: async () =>
          new Response("tampered", {
            headers: { "content-type": "application/json" },
          }),
        nodeEnv: "production",
      }),
    ).rejects.toThrow(/does not match/u)
  })

  it("removes a partial file when a streamed download fails integrity", async () => {
    const root = await mkdtemp(join(tmpdir(), "devotional-transfer-"))
    const filePath = join(root, "cover.mp3")
    try {
      await expect(
        downloadDevotionalWorkspaceGrant({
          grant: transfer().inputs[1]!,
          filePath,
          maxBytes: 1_000,
          fetchImpl: async () =>
            new Response("tampered", {
              headers: { "content-type": "audio/mpeg" },
            }),
          nodeEnv: "production",
        }),
      ).rejects.toThrow(/does not match/u)
      await expect(access(filePath)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
