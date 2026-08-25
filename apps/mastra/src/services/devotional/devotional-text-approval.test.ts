import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  approvalMessage,
  approvalState,
  readApproval,
  textFingerprint,
  writeApproval,
} from "./devotional-text-approval"

const SPOKEN = [
  "Jesus came to Zacchaeus unasked. Let's slow down and give Scripture our attention.",
  "Here's where we're reading today. Luke 19:5.",
  "Reflect on this. He stopped under the tree.",
]

async function dir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "devo-approval-"))
}

describe("text approval gate", () => {
  it("starts unapproved — nothing may reach TTS by default", async () => {
    expect(await approvalState(await dir(), SPOKEN)).toBe("never-reviewed")
  })

  it("approves the exact wording that was read", async () => {
    const d = await dir()
    await writeApproval(d, textFingerprint(SPOKEN), "2026-08-17")
    expect(await approvalState(d, SPOKEN)).toBe("approved")
  })

  it("REVOKES itself when a single word changes", async () => {
    // The whole point: approving one wording must never license another. A
    // hand-edit to devo.json or a regeneration has to reopen the gate.
    const d = await dir()
    await writeApproval(d, textFingerprint(SPOKEN), "2026-08-17")
    const edited = [...SPOKEN]
    edited[2] = "Reflect on this. He stopped beneath the tree."
    expect(await approvalState(d, edited)).toBe("text-changed")
  })

  it("distinguishes never-read from changed-since-read, because the fix differs", async () => {
    expect(approvalMessage("never-reviewed")).toMatch(/not been read/i)
    expect(approvalMessage("text-changed")).toMatch(/CHANGED/)
    // Both must say plainly that no money was spent.
    expect(approvalMessage("never-reviewed")).toMatch(
      /nothing has been sent to TTS/i,
    )
    expect(approvalMessage("text-changed")).toMatch(
      /nothing has been sent to TTS/i,
    )
  })

  it("survives a corrupt or hand-mangled marker by closing the gate", async () => {
    // Fail CLOSED: an unreadable marker must not read as approval.
    const d = await dir()
    await writeFile(path.join(d, "text-approved.json"), "{not json", "utf8")
    expect(await readApproval(d)).toBeNull()
    expect(await approvalState(d, SPOKEN)).toBe("never-reviewed")
  })

  it("ignores a marker whose fingerprint field is the wrong type", async () => {
    const d = await dir()
    await writeFile(
      path.join(d, "text-approved.json"),
      JSON.stringify({ fingerprint: 42 }),
      "utf8",
    )
    expect(await approvalState(d, SPOKEN)).toBe("never-reviewed")
  })

  it("records when it was approved, for anyone auditing later", async () => {
    const d = await dir()
    await writeApproval(d, textFingerprint(SPOKEN), "2026-08-17")
    const raw = JSON.parse(
      await readFile(path.join(d, "text-approved.json"), "utf8"),
    )
    expect(raw.approvedAt).toBe("2026-08-17")
  })

  it("fingerprints the spoken text, so connector changes count too", async () => {
    // The connectors are part of what a viewer hears, so changing "Here's
    // today's scripture" to "Here's where we're reading today" is a real change
    // and must reopen the gate.
    const withOldConnector = [...SPOKEN]
    withOldConnector[1] = "Here's today's scripture. Luke 19:5."
    expect(textFingerprint(SPOKEN)).not.toBe(textFingerprint(withOldConnector))
  })
})
