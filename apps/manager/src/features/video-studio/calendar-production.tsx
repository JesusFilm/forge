"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import type { Route } from "next"
import { z } from "zod"
import {
  calendarProductionSchema,
  type CalendarView,
} from "@forge/studio-contracts/calendar"
const eventSchema = z.object({
  type: z.string(),
  projectId: z.string().optional(),
  message: z.string().optional(),
  event: z
    .object({ type: z.string(), message: z.string().optional() })
    .optional(),
})
export default function CalendarProduction({
  view,
  refresh,
}: {
  view: CalendarView
  refresh: () => Promise<CalendarView>
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<string[]>([])
  const controller = useRef<AbortController | null>(null),
    pending = useRef<z.infer<typeof calendarProductionSchema> | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const slots = view.slots.filter(
    (slot) => slot.projectId && slot.project?.lifecycle === "DRAFT",
  )
  async function produce() {
    setBusy(true)
    setError("")
    setProgress([])
    setConfirmed(false)
    try {
      pending.current ??= calendarProductionSchema.parse({
        calendarId: view.calendarId,
        idempotencyKey: crypto.randomUUID(),
        confirmed: true,
        targets: slots
          .filter((slot) => selected.includes(slot.date))
          .map((slot) => ({
            date: slot.date,
            version: slot.version,
            projectId: slot.projectId,
            revision: slot.project!.currentRevision,
          })),
      })
      controller.current = new AbortController()
      const response = await fetch("/api/studio/calendar-production", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pending.current),
        signal: controller.current.signal,
      })
      if (!response.ok) {
        const failure = await response.json()
        if (failure.admission === "rejected") {
          pending.current = null
          const current = await refresh()
          setSelected((old) =>
            old.filter((date) =>
              current.slots.some(
                (slot) =>
                  slot.date === date && slot.project?.lifecycle === "DRAFT",
              ),
            ),
          )
        }
        throw new Error(failure.error ?? "Production admission failed")
      }
      if (!response.body) throw new Error("Production stream unavailable")
      const reader = response.body.getReader(),
        decoder = new TextDecoder()
      let buffer = "",
        bytes = 0,
        finished = false
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.length
          if (bytes > 2300000)
            throw new Error("Production response exceeded its limit")
          buffer += decoder.decode(chunk.value, { stream: true })
          let newline: number
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const event = eventSchema.parse(
              JSON.parse(buffer.slice(0, newline)),
            )
            buffer = buffer.slice(newline + 1)
            const title =
              slots.find((slot) => slot.projectId === event.projectId)?.title ||
              "Selected project"
            if (event.type === "target-error" || event.event?.type === "error")
              setError(
                event.message ??
                  event.event?.message ??
                  "Production failed. Review retained work.",
              )
            if (event.type === "target-start")
              setProgress((old) => [...old, `${title}: generation started`])
            if (event.event?.type === "done")
              setProgress((old) => [
                ...old,
                `${title}: generation ended; review retained proposals in the project`,
              ])
            if (event.type === "batch-finished") finished = true
          }
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      if (!finished || buffer.trim())
        throw new Error(
          "Production interrupted. Inspect retained attempts before retrying the same selection.",
        )
      pending.current = null
      try {
        await refresh()
      } catch {
        setError((current) =>
          [
            current,
            "Generation ended, but calendar status could not be refreshed. Reload the calendar to inspect retained results.",
          ]
            .filter(Boolean)
            .join(" "),
        )
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Production failed")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="calendar-settings">
      <h2>Produce selected projects</h2>
      <p>
        Choose one linked draft or a batch of up to eight. Generation returns
        proposals to the same project review workflow. Narration, rendering and
        publication remain separate reviewed actions. A missing source blocks
        admission.
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || pending.current !== null}>
        <legend>Linked draft projects</legend>
        {slots.length ? (
          slots.map((slot) => (
            <label key={slot.date}>
              <input
                type="checkbox"
                checked={selected.includes(slot.date)}
                disabled={!selected.includes(slot.date) && selected.length >= 8}
                onChange={(event) =>
                  setSelected((old) =>
                    event.target.checked
                      ? [...old, slot.date]
                      : old.filter((date) => date !== slot.date),
                  )
                }
              />
              {slot.date} · {slot.title || "Untitled slot"} ·{" "}
              <Link href={`/dashboard/shorts/${slot.projectId}` as Route}>
                Review project
              </Link>
            </label>
          ))
        ) : (
          <p>
            Link a standalone draft to a slot, or create a project and select
            its sources first.
          </p>
        )}
      </fieldset>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        I confirm generation for this explicit selection and will review its
        proposals.
      </label>
      <button
        disabled={busy || !confirmed || !selected.length}
        onClick={produce}
      >
        {pending.current
          ? "Retry the same production selection"
          : "Generate for selected projects"}
      </button>
      {busy && (
        <button onClick={() => controller.current?.abort()}>
          Stop generation
        </button>
      )}
      <ul aria-live="polite">
        {progress.map((message, index) => (
          <li key={index}>{message}</li>
        ))}
      </ul>
    </section>
  )
}
