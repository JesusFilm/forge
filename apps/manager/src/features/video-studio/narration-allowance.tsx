"use client"
import { useRef, useState } from "react"
import { z } from "zod"
import type { EditorSession } from "./editor-session"
import { studioCall, StudioClientError } from "./client"
import { studioProjectSchema } from "@forge/studio-contracts"
const allowanceSchema = z.object({
  used: z.number(),
  allowed: z.number(),
  remaining: z.number(),
})
type Authorization = {
  projectId: string
  expectedRevision: number
  idempotencyKey: string
  additionalPasses: number
  confirmed: true
}
/** Retain the exact authorized command across lost responses; never silently grant twice. */
export class NarrationAllowanceAuthorization {
  command: Authorization | null = null
  rejected = false
  discardRejected() {
    if (!this.rejected) return
    this.command = null
    this.rejected = false
  }
  prepare(
    projectId: string,
    expectedRevision: number,
    additionalPasses: number,
  ) {
    this.command ??= {
      projectId,
      expectedRevision,
      additionalPasses,
      idempotencyKey: crypto.randomUUID(),
      confirmed: true,
    }
    return this.command
  }
  async submit(call: (command: Authorization) => Promise<unknown>) {
    if (!this.command) return
    try {
      await call(this.command)
      this.command = null
      this.rejected = false
    } catch (error) {
      // Admin checks the actor-bound receipt before revision. A 409 is a
      // definitive rejection, while transport failures remain uncertain.
      if (error instanceof StudioClientError && error.status === 409)
        this.rejected = true
      throw error
    }
  }
}
export default function NarrationAllowance({
  session,
  projectId,
}: {
  session: EditorSession
  projectId: string
}) {
  const [allowance, setAllowance] = useState<z.infer<
    typeof allowanceSchema
  > | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [passes, setPasses] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const authorization = useRef(new NarrationAllowanceAuthorization()).current
  const load = async () =>
    setAllowance(
      allowanceSchema.parse(
        await studioCall("narration-status", { projectId }),
      ),
    )
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await work()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Allowance unavailable")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="External agent narration allowance">
      <h3>External agent narration allowance</h3>
      <p>
        One initial generation and one correction pass cover this project
        authoring cycle, across revisions, clients and conversations. Unchanged
        audio is reused. A pass can include several changed speech items.
      </p>
      <p>
        Actual pricing is unavailable here. ElevenLabs charges still apply; a
        pass allowance is not a dollar quote. New music, voice design and
        cloning require separate explicit authorization.
      </p>
      <button disabled={busy} onClick={() => void run(load)}>
        Check narration allowance
      </button>
      {allowance && (
        <p>
          {allowance.used} of {allowance.allowed} passes used;{" "}
          {allowance.remaining} remaining. A new conversation does not reset
          this allowance.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <label>
        Additional passes{" "}
        <input
          type="number"
          min={1}
          max={10}
          value={passes}
          disabled={busy || Boolean(authorization.command)}
          onChange={(event) => {
            setPasses(Number(event.target.value))
            setConfirmed(false)
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy || Boolean(authorization.command)}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I authorize these additional paid narration passes for this project
        using approved existing voices, including when the exact price is
        unknown.
      </label>
      <button
        disabled={
          busy ||
          authorization.rejected ||
          (!authorization.command &&
            (!confirmed ||
              !Number.isInteger(passes) ||
              passes < 1 ||
              passes > 10 ||
              session.getSnapshot().status !== "saved" ||
              !session.getSnapshot().editable))
        }
        onClick={() =>
          void run(async () => {
            if (!authorization.command) {
              const current = studioProjectSchema.parse(
                await studioCall("read", projectId),
              )
              authorization.prepare(projectId, current.revision, passes)
            }
            await authorization.submit((command) =>
              studioCall("narration-authorize", command),
            )
            setConfirmed(false)
            await load()
          })
        }
      >
        {authorization.command
          ? "Retry exact authorization"
          : "Authorize additional narration passes"}
      </button>
      {authorization.rejected && (
        <>
          <p>
            The project changed and this authorization was rejected. Discard
            this rejected request, review the pass count, and confirm again
            against current project state. Local edits are preserved.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              authorization.discardRejected()
              setConfirmed(false)
              setError("")
            }}
          >
            Discard rejected authorization
          </button>
        </>
      )}
      {authorization.command && !authorization.rejected && (
        <p>
          The authorization outcome is unconfirmed. Retry reuses the original
          request and cannot grant the same passes twice. It does not execute
          narration.
        </p>
      )}
    </section>
  )
}
