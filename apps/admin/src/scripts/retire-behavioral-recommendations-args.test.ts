import { describe, expect, it } from "vitest"
import { parseRetirementArguments } from "./retire-behavioral-recommendations-args"

const invocation = [
  "--execute",
  `--operation-id=11111111-1111-4111-8111-111111111111`,
  `--release-a=${"a".repeat(40)}`,
  "--cutover-proof=/private/cutover-proof.json",
  `--proof-sha256=${"b".repeat(64)}`,
  "--batch-size=50",
  "--max-batches=1",
]

describe("behavioral retirement CLI admission", () => {
  it("accepts the exact acknowledged operator flag set, including the proof checksum", () => {
    expect(parseRetirementArguments(invocation)).toEqual({
      execute: "true",
      "operation-id": "11111111-1111-4111-8111-111111111111",
      "release-a": "a".repeat(40),
      "cutover-proof": "/private/cutover-proof.json",
      "proof-sha256": "b".repeat(64),
      "batch-size": "50",
      "max-batches": "1",
    })
  })

  it("refuses malformed, unknown, duplicate, and incomplete arguments", () => {
    for (const argv of [
      [...invocation, "--unknown=value"],
      [...invocation, invocation[4]],
      invocation.filter((arg) => !arg.startsWith("--proof-sha256=")),
      invocation.map((arg) =>
        arg.startsWith("--proof-sha256=") ? "--proof-sha256=" : arg,
      ),
      invocation.map((arg) => (arg === "--execute" ? "--execute=false" : arg)),
    ]) {
      expect(() => parseRetirementArguments(argv)).toThrow()
    }
  })
})
