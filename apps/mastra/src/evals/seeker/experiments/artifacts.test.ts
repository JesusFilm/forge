import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createAttemptWriter, readAttemptArtifact } from "./artifacts"

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
    await writer.complete(["resolved-identity.json"])
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
})
