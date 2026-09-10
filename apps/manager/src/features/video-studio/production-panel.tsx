"use client"
import { useEffect, useState, useSyncExternalStore } from "react"
import { z } from "zod"
import { studioAssetVersionSchema } from "@forge/studio-contracts/assets"
import { studioNarrationPlanSchema } from "@forge/studio-contracts/production"
import type { EditorSession } from "./editor-session"
import { studioCall } from "./client"
const quoteSchema = z.object({
  plan: studioNarrationPlanSchema,
  estimateMicros: z.number().nullable(),
  reservationMicros: z.number(),
  basis: z.string(),
  unavailable: z.string().nullable(),
})
import {
  production,
  readProductionRuns,
  mergeProductionRuns,
  type ProductionRun,
} from "./production-client"
import dynamic from "next/dynamic"
const ExperimentPanel = dynamic(() => import("./experiment-panel"))
export default function ProductionPanel({
  session,
  projectId,
  onClose,
}: {
  session: EditorSession
  projectId: string
  onClose: () => void
}) {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
  const [experimentsOpen, setExperimentsOpen] = useState(false)
  const [voiceSearch, setVoiceSearch] = useState(""),
    [voiceQuery, setVoiceQuery] = useState("")
  const [runs, setRuns] = useState<ProductionRun[]>([]),
    [moreRuns, setMoreRuns] = useState(true),
    [voices, setVoices] = useState<z.infer<typeof studioAssetVersionSchema>[]>(
      [],
    ),
    [quote, setQuote] = useState<z.infer<typeof quoteSchema> | null>(null),
    [reviewed, setReviewed] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [approved, setApproved] = useState(false),
    [budget, setBudget] = useState("0"),
    [runId, setRunId] = useState<string | null>(null),
    [status, setStatus] = useState<unknown>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    studioCall("assets", {
      role: "voice",
      search: voiceQuery || undefined,
      limit: 100,
    })
      .then((raw) => {
        if (active)
          setVoices(
            z
              .array(studioAssetVersionSchema)
              .parse(raw)
              .filter(
                (v) =>
                  v.voice &&
                  v.provenance.recorded.registrationStatus !== "preview" &&
                  v.voice.language === state.document.language,
              ),
          )
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [state.document.language, experimentsOpen, voiceQuery])
  useEffect(() => {
    let active = true
    readProductionRuns({ projectId, kind: "narration" })
      .then((page) => {
        if (active) {
          setRuns((current) => mergeProductionRuns(current, page))
          if (page.length < 20) setMoreRuns(false)
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [projectId, runId])
  useEffect(() => {
    setQuote(null)
    setReviewed(false)
    setConfirmed(false)
    setApproved(false)
  }, [state.revision, state.document])
  async function action(task: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Production failed")
    } finally {
      setBusy(false)
    }
  }
  async function refresh(after?: string) {
    if (!runId) return
    const value = await production({ kind: "status", runId, after })
    setStatus(value)
    if (value.state !== "READY" && session.getSnapshot().status === "saved")
      await session.reload()
  }
  const retained = z
    .object({
      timingConflicts: z.array(z.string()).default([]),
      attempt: z
        .object({
          status: z.string(),
          result: z
            .object({ diagnostic: z.string().optional() })
            .passthrough()
            .nullable(),
        })
        .nullable()
        .optional(),
      calls: z.array(z.object({ state: z.string() })).default([]),
    })
    .safeParse(status)
  if (experimentsOpen)
    return (
      <ExperimentPanel
        language={state.document.language}
        onClose={() => setExperimentsOpen(false)}
      />
    )
  return (
    <div className="nle-dialog-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Speech review and production"
        className="nle-dialog nle-production"
      >
        <header>
          <h2>Speech review and production</h2>
          <button onClick={onClose}>Close</button>
        </header>
        <button onClick={() => setExperimentsOpen(true)}>
          Music and voice experiments
        </button>
        {error && <p role="alert">{error}</p>}
        <p>
          Review all effective spoken text, including any bridge and settle
          lines. Display text may differ. Voice and pronunciation changes
          require new approval.
        </p>
        <label>
          Find a recorded voice{" "}
          <input
            value={voiceSearch}
            onChange={(event) => setVoiceSearch(event.target.value)}
          />
        </label>
        <button onClick={() => setVoiceQuery(voiceSearch)}>
          Search voice library
        </button>
        {state.document.items
          .filter((i) => i.kind !== "audio")
          .map((item) => (
            <fieldset key={item.id} disabled={busy || !state.editable}>
              <legend>{item.id}</legend>
              {item.kind === "text" && <p>Display: {item.text}</p>}
              <label>
                Voice{" "}
                <select
                  value={item.speech?.voice.versionId ?? ""}
                  onChange={(e) =>
                    session.edit((doc) => {
                      const target = doc.items.find((i) => i.id === item.id)!,
                        voice = voices.find(
                          (v) => v.reference.versionId === e.target.value,
                        )
                      if (!voice?.voice) {
                        delete target.speech
                        return doc
                      }
                      target.speech = {
                        text:
                          target.speech?.text ??
                          (target.kind === "text" ? target.text : ""),
                        role: target.speech?.role ?? "narration",
                        suppressed: target.speech?.suppressed ?? false,
                        voice: voice.reference,
                        provider: voice.voice.provider,
                        model: voice.voice.model,
                        settings: voice.voice.settings,
                        pronunciation: voice.voice.pronunciation,
                      }
                      return doc
                    })
                  }
                >
                  <option value="">No generated speech</option>
                  {item.speech &&
                    !voices.some(
                      (voice) =>
                        voice.reference.versionId ===
                        item.speech!.voice.versionId,
                    ) && (
                      <option value={item.speech.voice.versionId}>
                        Current voice version {item.speech.voice.versionId}
                      </option>
                    )}
                  {voices.map((v) => (
                    <option
                      key={v.reference.versionId}
                      value={v.reference.versionId}
                    >
                      {v.filename}
                    </option>
                  ))}
                </select>
              </label>
              {item.speech && (
                <>
                  <label>
                    Spoken role{" "}
                    <input
                      value={item.speech.role}
                      onChange={(e) => {
                        const role = e.target.value
                        if (/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(role))
                          session.edit((doc) => {
                            doc.items.find(
                              (i) => i.id === item.id,
                            )!.speech!.role = role
                            return doc
                          })
                      }}
                    />
                  </label>
                  <label>
                    Effective spoken text{" "}
                    <textarea
                      value={item.speech.text}
                      maxLength={8000}
                      onChange={(e) =>
                        session.edit((doc) => {
                          doc.items.find(
                            (i) => i.id === item.id,
                          )!.speech!.text = e.target.value
                          return doc
                        })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.speech.suppressed}
                      onChange={(e) =>
                        session.edit((doc) => {
                          doc.items.find(
                            (i) => i.id === item.id,
                          )!.speech!.suppressed = e.target.checked
                          return doc
                        })
                      }
                    />
                    Suppress speech
                  </label>
                  <pre>
                    {JSON.stringify(
                      {
                        provider: item.speech.provider,
                        model: item.speech.model,
                        settings: item.speech.settings,
                        pronunciation: item.speech.pronunciation,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </>
              )}
            </fieldset>
          ))}
        {!voices.length && (
          <p>
            No matching recorded voice preset. Import a known preset or
            explicitly request a voice experiment; a library miss does not
            generate anything.
          </p>
        )}
        <button
          disabled={busy || !state.editable}
          onClick={() =>
            void action(async () => {
              await session.save()
            })
          }
        >
          Save speech edits
        </button>
        <button
          disabled={busy || state.status !== "saved" || !state.editable}
          onClick={() =>
            void action(async () => {
              const value = quoteSchema.parse(
                await production({
                  kind: "plan",
                  projectId,
                  expectedRevision: state.revision,
                }),
              )
              setQuote(value)
              setBudget(String(value.reservationMicros / 1000000))
              setReviewed(false)
              setApproved(false)
            })
          }
        >
          Review complete speech and estimate
        </button>
        {quote && (
          <>
            <h3>Complete effective script · revision {quote.plan.revision}</h3>
            <p>
              {quote.plan.segments.length} spoken items. Estimate:{" "}
              {quote.estimateMicros === null
                ? "Unavailable"
                : `$${(quote.estimateMicros / 1000000).toFixed(6)} USD`}
              . {quote.basis}
            </p>
            {quote.unavailable && <p>{quote.unavailable}</p>}
            {quote.plan.segments.map((segment) => (
              <fieldset key={segment.itemId}>
                <legend>
                  {segment.identity.role} · {segment.itemId}
                </legend>
                <p>
                  {(() => {
                    const item = state.document.items.find(
                      (item) => item.id === segment.itemId,
                    )
                    if (!item) return "Timing unavailable"
                    const overlaps = quote.plan.segments
                      .filter((other) => other.itemId !== item.id)
                      .some((other) => {
                        const next = state.document.items.find(
                          (candidate) => candidate.id === other.itemId,
                        )
                        return (
                          next &&
                          next.startFrame <
                            item.startFrame + item.durationInFrames &&
                          next.startFrame + next.durationInFrames >
                            item.startFrame
                        )
                      })
                    return `${(item.startFrame / state.document.fps).toFixed(2)}–${((item.startFrame + item.durationInFrames) / state.document.fps).toFixed(2)} seconds · track ${item.trackId}${overlaps ? " · overlaps other speech" : ""}`
                  })()}
                </p>
                <pre className="nle-spoken-bytes">{segment.identity.text}</pre>
                <p>
                  {segment.identity.language} · {segment.identity.provider} /{" "}
                  {segment.identity.model} · voice {segment.identity.voiceId}
                </p>
                <p>
                  {segment.matches.length
                    ? "Exact narration is available for reuse"
                    : "New narration required"}
                </p>
                <details>
                  <summary>
                    Exact identity, pronunciation and cache references
                  </summary>
                  <pre>{JSON.stringify(segment, null, 2)}</pre>
                </details>
              </fieldset>
            ))}
            <label>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed the complete effective speech and identity settings.
            </label>
            <button
              disabled={busy || !reviewed}
              onClick={() =>
                void action(async () => {
                  await studioCall("approve", {
                    projectId,
                    expectedRevision: quote.plan.revision,
                    idempotencyKey: crypto.randomUUID(),
                    kind: "SCRIPT",
                  })
                  setApproved(true)
                })
              }
            >
              Approve complete effective script
            </button>
            {quote.estimateMicros !== null && (
              <label>
                Estimated charge limit USD{" "}
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.001"
                  value={budget}
                  onChange={(e) => {
                    setBudget(e.target.value)
                    setConfirmed(false)
                  }}
                />
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Generate this narration. I accept ElevenLabs charges, including
              when the exact price is unavailable.
            </label>
            <button
              disabled={busy || !approved || !confirmed}
              onClick={() =>
                void action(async () => {
                  const result = await production({
                    kind: "narrate",
                    input: {
                      projectId,
                      expectedRevision: quote.plan.revision,
                      idempotencyKey: crypto.randomUUID(),
                    },
                    maxCostMicros:
                      quote.estimateMicros === null
                        ? quote.reservationMicros
                        : Math.round(Number(budget) * 1000000),
                    confirmed: true,
                  })
                  setRunId(result.runId)
                  setStatus(result)
                  setConfirmed(false)
                })
              }
            >
              Generate narration
            </button>
          </>
        )}
        <label>
          Retained runs{" "}
          <select
            value={runId ?? ""}
            onChange={(e) => {
              setRunId(e.target.value || null)
              setStatus(null)
            }}
          >
            <option value="">Select a run</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                Narration · {new Date(run.createdAt).toLocaleString()} ·{" "}
                {run.state === "COMPLETED"
                  ? "Finished"
                  : run.state === "CANCELLED"
                    ? "Stopped"
                    : "Available"}
              </option>
            ))}
          </select>
        </label>
        {moreRuns && runs.length > 0 && (
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const last = runs.at(-1)!
                const page = await readProductionRuns({
                  projectId,
                  kind: "narration",
                  before: { id: last.id, createdAt: last.createdAt },
                })
                setRuns((current) => mergeProductionRuns(current, page))
                setMoreRuns(page.length === 20)
              })
            }
          >
            Load older runs
          </button>
        )}
        {runId && (
          <>
            {retained.success && retained.data.timingConflicts.length > 0 && (
              <p role="alert">
                Narration was retained but could not be attached. Review timing
                for:{" "}
                {retained.data.timingConflicts
                  .map((id) => {
                    const item = state.document.items.find(
                      (item) => item.id === id,
                    )
                    return (
                      item?.speech?.role ??
                      (item?.kind === "text" ? item.text : id)
                    )
                  })
                  .join(", ")}
                . Locked or ambiguous timing was preserved.
              </p>
            )}
            {retained.success && retained.data.attempt?.status === "FAILED" && (
              <p role="alert">
                {retained.data.attempt.result?.diagnostic ??
                  "Narration stopped. Inspect the retained execution records before requesting more."}
              </p>
            )}
            {retained.success &&
              retained.data.calls.some(
                (call) => call.state === "AMBIGUOUS",
              ) && (
                <p role="alert">
                  A provider outcome is uncertain. Its request will not be
                  repeated automatically; inspect the retained execution
                  records.
                </p>
              )}
            <p>
              Refresh to inspect retained results. Continuing never repeats a
              request whose outcome is uncertain.
            </p>
            <button
              disabled={busy}
              onClick={() => void action(() => refresh())}
            >
              Refresh run
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setStatus(await production({ kind: "resume", runId }))
                })
              }
            >
              Generate remaining narration
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setStatus(await production({ kind: "cancel", runId }))
                })
              }
            >
              Stop generation
            </button>
            {z.object({ nextKey: z.string() }).safeParse(status).success && (
              <button
                disabled={busy}
                onClick={() =>
                  void action(() =>
                    refresh(
                      z.object({ nextKey: z.string() }).parse(status).nextKey,
                    ),
                  )
                }
              >
                Next execution records
              </button>
            )}
            <p>
              Run state:{" "}
              {z.object({ state: z.string() }).safeParse(status).success
                ? z.object({ state: z.string() }).parse(status).state
                : "Awaiting refresh"}
            </p>
            <details>
              <summary>
                Retained calls, costs, results and timing conflicts
              </summary>
              <pre>{JSON.stringify(status, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
    </div>
  )
}
