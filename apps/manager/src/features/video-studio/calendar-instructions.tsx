"use client"
import { useState } from "react"
import { z } from "zod"
import { studioInstructionCommandSchema } from "@forge/studio-contracts/agent"
const viewSchema = z.object({
  activeVersionId: z.string().nullable(),
  latest: z.object({
    id: z.string(),
    content: z.string(),
    versionNumber: z.number(),
  }),
  versions: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      versionNumber: z.number(),
    }),
  ),
})
export async function calendarPlanCall(payload: unknown) {
  const response = await fetch("/api/studio/calendar-plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.error ?? "Calendar planner unavailable")
  return data.result as unknown
}
export default function CalendarInstructions() {
  const [view, setView] = useState<z.infer<typeof viewSchema> | null>(null),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false)
  async function command(
    command: z.input<typeof studioInstructionCommandSchema>,
  ) {
    setBusy(true)
    setError("")
    try {
      const v = viewSchema.parse(
        await calendarPlanCall({ action: "instructions", command }),
      )
      setView(v)
      setText(v.latest.content)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Planner instructions unavailable",
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="calendar-settings">
      <h2>Planner instructions</h2>
      <p>
        These native instruction versions control title/theme suggestions only.
        Production uses its own review workflow.
      </p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => command({ action: "inspect" })}>
        Load planner instructions
      </button>
      {view && (
        <>
          <p>
            Latest draft: version {view.latest.versionNumber}.{" "}
            {view.activeVersionId
              ? "An active version is available."
              : "Activate a reviewed version before planning."}
          </p>
          <label>
            Draft instructions
            <textarea
              rows={10}
              value={text}
              maxLength={16000}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button
            disabled={busy || !text.trim()}
            onClick={() =>
              command({
                action: "save",
                expectedVersionId: view.latest.id,
                content: text,
              })
            }
          >
            Save instruction draft
          </button>
          <button
            disabled={busy || view.activeVersionId === view.latest.id}
            onClick={() =>
              command({
                action: "activate",
                versionId: view.latest.id,
                expectedActiveVersionId: view.activeVersionId,
              })
            }
          >
            Activate latest saved version
          </button>
          <label>
            Restore an earlier version as a draft
            <select
              value=""
              disabled={busy}
              onChange={(event) => {
                if (event.target.value)
                  void command({
                    action: "restore",
                    versionId: event.target.value,
                    expectedVersionId: view.latest.id,
                  })
              }}
            >
              <option value="">Choose version</option>
              {view.versions.map((version) => (
                <option value={version.id} key={version.id}>
                  Version {version.versionNumber}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </section>
  )
}
