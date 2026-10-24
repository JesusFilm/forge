import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  boundedDiagnostic,
  createAttemptWriter,
  readAttemptArtifact,
  sanitizeEvidence,
  scanExperimentPackage,
  validateCompletedAttempt,
  writeLocalDebugPrompt,
} from "./artifacts"

const REQUIRED = [
  "resolved-identity.json",
  "answers.json",
  "transcripts.json",
  "judged.json",
  "score.json",
  "comparison.md",
  "gate-report.json",
] as const

async function completePackage(root: string) {
  const writer = await createAttemptWriter(root, "exp-one", "attempt-1")
  writer.registerSensitiveValues([
    "managed-prompt-sentinel",
    "credential-sentinel",
  ])
  for (const path of REQUIRED) {
    if (path.endsWith(".md")) await writer.writeText(path, "# comparison\n")
    else
      await writer.writeJson(path, {
        schemaVersion: "test/v1",
        traceId: "trace-1",
      })
  }
  await writer.complete(REQUIRED)
  return writer
}

describe("experiment attempt artifacts", () => {
  it("writes only beneath an immutable package-local attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    const writer = await createAttemptWriter(root, "exp-one", "attempt-1")
    await writer.writeJson("resolved-identity.json", { safe: true })
    await expect(
      writer.writeJson("../exp-two/stolen.json", {}),
    ).rejects.toThrow(/attempt-relative/)
    await expect(
      writer.writeJson("resolved-identity.json", {}),
    ).rejects.toThrow(/already exists/)
    expect(
      JSON.parse(
        await readFile(
          join(
            root,
            "exp-one",
            "attempts",
            "attempt-1",
            "resolved-identity.json",
          ),
          "utf8",
        ),
      ),
    ).toEqual({ safe: true })
  })

  it("finalizes atomically and refuses incomplete or already-complete attempts", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    const writer = await createAttemptWriter(root, "exp-one", "attempt-1")
    await writer.writeJson("diagnostic.json", { reason: "failed" })
    await expect(writer.complete(["resolved-identity.json"])).rejects.toThrow(
      /missing required artifact/,
    )
    await writer.writeJson("resolved-identity.json", { ok: true })
    for (const path of REQUIRED.slice(1)) {
      if (path.endsWith(".md")) await writer.writeText(path, "# comparison\n")
      else await writer.writeJson(path, {})
    }
    await writer.complete(REQUIRED)
    await expect(writer.writeJson("answers.json", {})).rejects.toThrow(
      /already complete/,
    )
  })

  it("rejects reads that escape or cross an attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    const writer = await createAttemptWriter(root, "exp-one", "attempt-1")
    await writer.writeJson("value.json", { attempt: 1 })
    await expect(
      readAttemptArtifact(
        root,
        "exp-one",
        "attempt-1",
        "../attempt-2/value.json",
      ),
    ).rejects.toThrow(/attempt-relative/)
  })

  it("recursively removes prompt, credential, and trace payload keys while retaining trace IDs", () => {
    expect(
      sanitizeEvidence(
        {
          promptText: "managed-prompt-sentinel",
          nested: {
            authorization: "Bearer credential-sentinel",
            tracePayload: { unrestricted: true },
            traceId: "trace-123",
            note: "prefix managed-prompt-sentinel suffix",
          },
        },
        ["managed-prompt-sentinel"],
      ),
    ).toEqual({
      promptText: "[REDACTED]",
      nested: {
        authorization: "[REDACTED]",
        tracePayload: "[REDACTED]",
        traceId: "trace-123",
        note: "[REDACTED]",
      },
    })
    expect(boundedDiagnostic(new Error(`Bearer ${"x".repeat(40)}`))).toBe(
      "[REDACTED]",
    )
    expect(boundedDiagnostic("x".repeat(700))).toHaveLength(500)
  })

  it("sanitizes registered sentinels at every JSON write boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    const writer = await createAttemptWriter(root, "exp-one", "attempt-1")
    writer.registerSensitiveValues(["managed-prompt-sentinel"])
    await writer.writeJson("transcripts.json", {
      promptBody: "managed-prompt-sentinel",
      nested: ["managed-prompt-sentinel"],
      traceId: "trace-safe",
    })
    const source = await readFile(
      join(writer.attemptDir, "transcripts.json"),
      "utf8",
    )
    expect(source).not.toContain("managed-prompt-sentinel")
    expect(source).toContain("trace-safe")
  })

  it("redacts Langfuse public and secret keys at the JSON write boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    const writer = await createAttemptWriter(root, "exp-one", "attempt-1")
    await writer.writeJson("transcripts.json", {
      langfusePublicKey: "pk-lf-publiccredential123",
      nested: "sk-lf-secretcredential123",
    })
    const source = await readFile(
      join(writer.attemptDir, "transcripts.json"),
      "utf8",
    )
    expect(source).not.toContain("pk-lf-")
    expect(source).not.toContain("sk-lf-")
    expect(source).toContain("[REDACTED]")
  })

  it("refuses Langfuse keys in text artifacts before package completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    const writer = await createAttemptWriter(root, "exp-one", "attempt-1")
    for (const path of REQUIRED) {
      if (path === "comparison.md")
        await writer.writeText(
          path,
          "# comparison\n\npk-lf-publiccredential123\n",
        )
      else await writer.writeJson(path, {})
    }
    await expect(writer.complete(REQUIRED)).rejects.toThrow(
      /unsafe content.*comparison/,
    )
  })

  it("validates inventory checksums and scans a complete package", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    await completePackage(root)
    await expect(
      validateCompletedAttempt(root, "exp-one", "attempt-1"),
    ).resolves.toBeUndefined()
    await expect(
      scanExperimentPackage(root, "exp-one", "attempt-1", [
        "managed-prompt-sentinel",
        "credential-sentinel",
      ]),
    ).resolves.toBeUndefined()
  })

  it("rejects checksum-mismatched completed evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    const writer = await completePackage(root)
    await writeFile(join(writer.attemptDir, "answers.json"), "corrupt\n")
    await expect(
      validateCompletedAttempt(root, "exp-one", "attempt-1"),
    ).rejects.toThrow(/checksum mismatch/)
  })

  it("refuses completion when terminal-package evidence is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    const writer = await createAttemptWriter(root, "exp-one", "attempt-1")
    await writer.writeJson("resolved-identity.json", {})
    await expect(writer.complete(["resolved-identity.json"])).rejects.toThrow(
      /incomplete artifact inventory/,
    )
  })

  it("allows prompt debug output only in the dedicated scratch tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-mastra-"))
    const path = await writeLocalDebugPrompt(
      root,
      "exp-one",
      "attempt-1",
      "managed prompt body",
    )
    expect(path).toBe(
      join(root, ".seeker-eval-debug", "exp-one", "attempt-1.prompt.txt"),
    )
    await expect(
      writeLocalDebugPrompt(root, "../evidence", "attempt-2", "secret"),
    ).rejects.toThrow()
  })

  it("rejects untracked partial artifacts in an otherwise valid package", async () => {
    const root = await mkdtemp(join(tmpdir(), "seeker-experiment-"))
    const writer = await completePackage(root)
    await writeFile(join(writer.attemptDir, "answers.json.partial"), "{}")
    await expect(
      scanExperimentPackage(root, "exp-one", "attempt-1"),
    ).rejects.toThrow(/forbidden or untracked/)
  })
})
