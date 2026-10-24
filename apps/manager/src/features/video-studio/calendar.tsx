"use client"
import dynamic from "next/dynamic"
import { useEffect, useState, useRef } from "react"
import Link from "next/link"
import type { Route } from "next"
import { ZodError } from "zod"
import {
  calendarSettingsSchema,
  calendarViewSchema,
  type CalendarSettings,
  type CalendarView,
} from "@forge/studio-contracts/calendar"
import { studioCall, StudioClientError } from "./client"
import "./calendar.css"

const CalendarSchedule = dynamic(() => import("./calendar-schedule"))
const CalendarProduction = dynamic(() => import("./calendar-production"))
const CalendarInstructions = dynamic(() => import("./calendar-instructions"))
function weekStart(date: string) {
  const value = new Date(date + "T12:00:00Z")
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7))
  return value.toISOString().slice(0, 10)
}
const calendarId = "shorts-calendar"
type Pack = { id: string; document: { title: string } }
type Project = {
  projectId: string
  title: string
  revision: number
  lifecycle: string
}
type Slot = CalendarView["slots"][number]
const defaults: CalendarSettings = {
  timeZone: "",
  publishTime: "09:00",
  deliveryWindowMinutes: 60,
  plannerTimes: ["06:00"],
  automationEnabled: false,
  defaultPackRevisionIds: [],
  language: "english",
}
export function ShortCalendar() {
  const [view, setView] = useState<CalendarView | null>(null),
    [settings, setSettings] = useState(defaults),
    [packs, setPacks] = useState<Pack[]>([]),
    [projects, setProjects] = useState<Project[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [following, setFollowing] = useState(false),
    [scheduling, setScheduling] = useState<string | null>(null),
    [editing, setEditing] = useState<Slot | null>(null),
    [showSettings, setShowSettings] = useState(false),
    [showInstructions, setShowInstructions] = useState(false),
    [showProduction, setShowProduction] = useState(false)
  const dialog = useRef<HTMLDialogElement | null>(null)
  useEffect(() => {
    if (editing && !dialog.current?.open) dialog.current?.showModal()
  }, [editing])
  async function refresh() {
    const result = calendarViewSchema.parse(
      await studioCall("calendar-read", calendarId),
    )
    setView(result)
    setSettings(result.settings)
    return result
  }
  useEffect(() => {
    let active = true
    Promise.all([
      studioCall("calendar-read", calendarId)
        .then(calendarViewSchema.parse)
        .catch((error) => {
          if (error instanceof StudioClientError && error.status === 404)
            return null
          throw error
        }),
      studioCall<Pack[]>("packs", { limit: 100 }),
      studioCall<Project[]>("list", { limit: 100 }),
    ])
      .then(([v, p, j]) => {
        if (active) {
          setView(v)
          setSettings(v?.settings ?? defaults)
          setPacks(p)
          setProjects(j)
          setShowSettings(!v)
        }
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  async function action(work: () => Promise<void>) {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await work()
      await refresh()
    } catch (error) {
      setError(
        error instanceof ZodError
          ? error.issues.map((issue) => issue.message).join(". ")
          : error instanceof Error
            ? error.message
            : "Calendar action failed",
      )
    } finally {
      setBusy(false)
    }
  }
  async function saveSettings(event: React.FormEvent) {
    event.preventDefault()
    await action(async () => {
      await studioCall("calendar-configure", {
        calendarId,
        expectedVersion: view?.version ?? 0,
        idempotencyKey: crypto.randomUUID(),
        settings: calendarSettingsSchema.parse(settings),
      })
      setShowSettings(false)
      setNotice("Calendar settings saved.")
    })
  }
  async function saveSlot(event: React.FormEvent) {
    event.preventDefault()
    if (!editing) return
    await action(async () => {
      await studioCall("calendar-edit-slot", {
        calendarId,
        expectedVersion: editing.version,
        idempotencyKey: crypto.randomUUID(),
        date: editing.date,
        title: editing.title,
        theme: editing.theme,
        packRevisionId: editing.packRevisionId,
        projectId: editing.projectId,
      })
      setEditing(null)
      setNotice("Your slot changes were saved.")
    })
  }
  const days = view?.slots.slice(following ? 14 : 0, following ? 28 : 14) ?? []
  return (
    <section className="shorts-calendar">
      <header>
        <div>
          <Link href="/dashboard/shorts">← Projects</Link>
          <p>SHORTS</p>
          <h1>Planning calendar</h1>
          <p>
            Plan titles and themes, then choose which projects to produce and
            review.
          </p>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          disabled={busy || loading}
        >
          Calendar settings
        </button>
      </header>
      <div className="calendar-toolbar">
        <button
          disabled={busy || loading}
          onClick={() => void action(async () => {})}
        >
          Refresh calendar
        </button>
        <button
          disabled={busy}
          onClick={() => setShowInstructions(!showInstructions)}
        >
          Planner instructions
        </button>
        {view && (
          <button
            disabled={busy}
            onClick={() =>
              action(async () => {
                const { calendarPlanCall } =
                  await import("./calendar-instructions")
                await calendarPlanCall({
                  action: "plan",
                  calendarId,
                  idempotencyKey: crypto.randomUUID(),
                })
                setNotice(
                  "Planning finished. Review suggestions and missing-source states below.",
                )
              })
            }
          >
            Suggest missing titles/themes in both fortnights
          </button>
        )}
      </div>
      {showInstructions && <CalendarInstructions />}
      {view && (
        <button onClick={() => setShowProduction(!showProduction)}>
          Generate selected projects
        </button>
      )}
      {view && showProduction && (
        <CalendarProduction view={view} refresh={refresh} />
      )}
      {view?.planningRun && (
        <p role="status">
          Latest planning run: {view.planningRun.status.toLowerCase()}. Existing
          projects and overrides are preserved.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Loading calendar…</p>
      ) : (
        <>
          {showSettings && (
            <form onSubmit={saveSettings} className="calendar-settings">
              <h2>{view ? "Calendar settings" : "Set up your calendar"}</h2>
              <label>
                Timezone (IANA)
                <input
                  required
                  placeholder="Pacific/Auckland"
                  value={settings.timeZone}
                  onChange={(event) =>
                    setSettings({ ...settings, timeZone: event.target.value })
                  }
                />
              </label>
              <p>
                Choose a named timezone. A daylight-saving gap cannot be
                scheduled; a repeated time requires an explicit choice.
              </p>
              <label>
                Publication time
                <input
                  type="time"
                  required
                  value={settings.publishTime}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      publishTime: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Latest delivery, minutes after scheduled time
                <input
                  type="number"
                  min={1}
                  max={1440}
                  required
                  value={settings.deliveryWindowMinutes}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      deliveryWindowMinutes: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Language
                <input
                  required
                  value={settings.language}
                  onChange={(event) =>
                    setSettings({ ...settings, language: event.target.value })
                  }
                />
              </label>
              <label>
                Default Content Pack
                <select
                  value={settings.defaultPackRevisionIds[0] ?? ""}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      defaultPackRevisionIds: event.target.value
                        ? [event.target.value]
                        : [],
                    })
                  }
                >
                  <option value="">No default pack</option>
                  {packs.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.document.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.automationEnabled}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      automationEnabled: event.target.checked,
                    })
                  }
                />
                Automatically suggest titles/themes for the following fortnight
              </label>
              <label>
                Planning frequency
                <select
                  value={settings.plannerTimes.length}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      plannerTimes:
                        Number(event.target.value) === 2
                          ? [settings.plannerTimes[0], "18:00"]
                          : [settings.plannerTimes[0]],
                    })
                  }
                >
                  <option value={1}>Once daily</option>
                  <option value={2}>Twice daily</option>
                </select>
              </label>
              {settings.plannerTimes.map((time, index) => (
                <label key={index}>
                  Planning time {index + 1}
                  <input
                    type="time"
                    value={time}
                    required
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        plannerTimes: settings.plannerTimes.map((old, i) =>
                          i === index ? event.target.value : old,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <p>
                Automation only fills title/theme suggestions. Production and
                publication require separate explicit actions and review.
                Missing sources remain unready.
              </p>
              <button disabled={busy} type="submit">
                Save settings
              </button>
            </form>
          )}
          {view && (
            <>
              <div className="calendar-toolbar">
                <div role="group" aria-label="Calendar window">
                  <button
                    aria-pressed={!following}
                    onClick={() => setFollowing(false)}
                  >
                    Current 14 days
                  </button>
                  <button
                    aria-pressed={following}
                    onClick={() => setFollowing(true)}
                  >
                    Following 14 days
                  </button>
                </div>
                <p>
                  {view.settings.timeZone} · {view.settings.publishTime}{" "}
                  publication time
                </p>
              </div>
              <p>
                One slot per day. Projects can also remain standalone. A title
                suggestion does not mean its sources, production or publication
                are ready.
              </p>
              <details className="calendar-settings">
                <summary>Weekly themes and Content Packs</summary>
                {[...new Set(days.map((slot) => weekStart(slot.date)))].map(
                  (startDate) => {
                    const week = view.weeks.find(
                      (week) => week.startDate === startDate,
                    )
                    return (
                      <form
                        key={startDate + ":" + view.version}
                        onSubmit={(event) => {
                          event.preventDefault()
                          const fields = new FormData(event.currentTarget)
                          void action(async () => {
                            await studioCall("calendar-assign-week", {
                              calendarId,
                              expectedVersion: view.version,
                              idempotencyKey: crypto.randomUUID(),
                              startDate,
                              theme: String(fields.get("theme") ?? ""),
                              packRevisionId: fields.get("pack") || null,
                            })
                            setNotice(
                              "Weekly plan saved; existing titles and projects were preserved.",
                            )
                          })
                        }}
                      >
                        <h2>Week of {startDate}</h2>
                        {week?.provenance ? (
                          <p>
                            Planner suggestion from{" "}
                            {packs.find(
                              (pack) =>
                                pack.id === week.provenance?.packRevisionId,
                            )?.document.title ?? "the admitted Content Pack"}
                            . Verify sources before production. Your pack
                            assignments are unchanged.
                          </p>
                        ) : week ? (
                          <p>Your weekly settings</p>
                        ) : null}
                        <label>
                          Weekly theme
                          <input
                            name="theme"
                            maxLength={2000}
                            defaultValue={week?.theme ?? ""}
                          />
                        </label>
                        <label>
                          Week Content Pack
                          <select
                            name="pack"
                            defaultValue={week?.packRevisionId ?? ""}
                          >
                            <option value="">Use default pack</option>
                            {packs.map((pack) => (
                              <option key={pack.id} value={pack.id}>
                                {pack.document.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button disabled={busy}>Save week</button>
                      </form>
                    )
                  },
                )}
              </details>
              <div className="calendar-grid">
                {days.map((slot) => {
                  const authorization = slot.authorizations[0]
                  const production =
                    slot.project?.currentRevisionRecord.attempts[0]
                  const approval =
                    slot.project?.currentRevisionRecord.approvals[0]
                  const state =
                    slot.project?.lifecycle === "UNPUBLISHED"
                      ? "Unpublished — permanently locked"
                      : slot.project?.lifecycle === "PUBLISHED"
                        ? "Published — permanently locked"
                        : authorization?.consumedAt
                          ? "Published once"
                          : authorization?.revokedAt
                            ? "Schedule cancelled"
                            : authorization
                              ? "Scheduled; readiness rechecked when due"
                              : slot.projectId
                                ? "Draft linked — review required"
                                : slot.title
                                  ? "Title/theme suggestion — no production"
                                  : "Missing title/theme"
                  return (
                    <article key={slot.date} className="calendar-day">
                      <time dateTime={slot.date}>
                        {new Intl.DateTimeFormat("en", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          timeZone: "UTC",
                        }).format(new Date(`${slot.date}T12:00:00Z`))}
                      </time>
                      <h2>{slot.title || "Unplanned"}</h2>
                      <p>{slot.theme || "No theme selected"}</p>
                      <p>
                        {slot.manual
                          ? "Your override"
                          : "Planner may fill empty slots"}
                      </p>
                      <p className="calendar-state">{state}</p>
                      {slot.project && (
                        <p>
                          Production:{" "}
                          {production?.status.toLowerCase() ?? "not started"}.
                          Publication:{" "}
                          {slot.project.lifecycle !== "DRAFT"
                            ? `${slot.project.lifecycle.toLowerCase()}; permanently locked`
                            : approval
                              ? "approval recorded; fresh readiness required"
                              : "unapproved"}
                          .
                        </p>
                      )}
                      {authorization?.dispatch && (
                        <p>
                          Delivery: {authorization.dispatch.state.toLowerCase()}
                          {authorization.dispatch.lastError
                            ? ` — ${authorization.dispatch.lastError}`
                            : ""}
                        </p>
                      )}
                      {slot.projectId && (
                        <button onClick={() => setScheduling(slot.date)}>
                          Schedule publication
                        </button>
                      )}
                      <p>
                        {slot.projectSourcesSelected
                          ? "Project sources selected; eligibility still needs validation"
                          : slot.provenance?.sourceState === "SELECTED"
                            ? "Source selection suggested; eligibility still needs validation"
                            : "Source selection missing — unready"}
                      </p>
                      {slot.projectId && (
                        <Link
                          href={`/dashboard/shorts/${slot.projectId}` as Route}
                        >
                          Open project and review
                        </Link>
                      )}
                      <button disabled={busy} onClick={() => setEditing(slot)}>
                        Edit slot
                      </button>
                      {authorization &&
                        !authorization.consumedAt &&
                        !authorization.revokedAt && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              action(async () => {
                                await studioCall("calendar-cancel", {
                                  calendarId,
                                  expectedVersion: slot.version,
                                  idempotencyKey: crypto.randomUUID(),
                                  authorizationId: authorization.id,
                                })
                                setNotice("Scheduled publication cancelled.")
                              })
                            }
                          >
                            Cancel scheduled publication
                          </button>
                        )}
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
      {scheduling &&
        view &&
        view.slots.find((slot) => slot.date === scheduling) && (
          <CalendarSchedule
            key={scheduling}
            view={view}
            slot={view.slots.find((slot) => slot.date === scheduling)!}
            refresh={refresh}
            close={() => setScheduling(null)}
          />
        )}
      {editing && (
        <dialog
          ref={dialog}
          className="calendar-dialog"
          aria-labelledby="slot-heading"
          onCancel={(event) => {
            if (busy) event.preventDefault()
            else setEditing(null)
          }}
        >
          <form onSubmit={saveSlot}>
            <h2 id="slot-heading">Edit {editing.date}</h2>
            <label>
              Title
              <input
                maxLength={300}
                value={editing.title}
                onChange={(event) =>
                  setEditing({ ...editing, title: event.target.value })
                }
              />
            </label>
            <label>
              Theme
              <textarea
                maxLength={2000}
                value={editing.theme}
                onChange={(event) =>
                  setEditing({ ...editing, theme: event.target.value })
                }
              />
            </label>
            <label>
              Assigned Content Pack
              <select
                value={editing.packRevisionId ?? ""}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    packRevisionId: event.target.value || null,
                  })
                }
              >
                <option value="">Use week/default pack</option>
                {packs.map((pack) => (
                  <option value={pack.id} key={pack.id}>
                    {pack.document.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                value={editing.projectId ?? ""}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    projectId: event.target.value || null,
                  })
                }
              >
                <option value="">No linked project</option>
                {projects.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.title} · {project.lifecycle.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Saving a slot preserves project content and cancels any pending
              authorization for this slot. Linked drafts remain editable.
            </p>
            <button type="submit" disabled={busy}>
              Save slot
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Close
            </button>
          </form>
        </dialog>
      )}
    </section>
  )
}
