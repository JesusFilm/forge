"use client"
import { StudioProductionClientError } from "./production-client"
import { useEffect, useState } from "react"
import { z } from "zod"
import { studioAssetReferenceSchema } from "@forge/studio-contracts"
import {
  studioExperimentRequestSchema,
  studioExperimentOutcomeSchema,
} from "@forge/studio-contracts/experiments"
import { studioCall } from "./client"
import {
  production,
  readProductionRuns,
  mergeProductionRuns,
  type ProductionRun,
} from "./production-client"
const estimateSchema = studioExperimentRequestSchema.shape.estimate
const experimentSchema = z.object({
  id: z.string(),
  request: studioExperimentRequestSchema,
  outcome: studioExperimentOutcomeSchema,
  selection: z
    .object({ candidateKey: z.string(), asset: studioAssetReferenceSchema })
    .nullable(),
  candidates: z.array(
    z.object({
      candidateKey: z.string(),
      asset: studioAssetReferenceSchema,
      providerRequestId: z.string().nullable(),
      actualCostMicros: z.number().nullable(),
    }),
  ),
})
type Candidate = z.infer<typeof experimentSchema>["candidates"][number]
function Audition({
  candidate,
  name,
  onError,
}: {
  candidate: Candidate
  name: string
  onError: (message: string) => void
}) {
  const [url, setUrl] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [provenance, setProvenance] = useState<unknown>(null)
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )
  return (
    <div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const response = await fetch("/api/shorts/audition", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(candidate.asset),
            })
            if (!response.ok)
              throw new StudioProductionClientError(
                (await response.json()).error ?? "Audition unavailable",
              )
            setUrl(URL.createObjectURL(await response.blob()))
          } catch (error) {
            onError(
              error instanceof Error ? error.message : "Audition unavailable",
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        Load retained audition
      </button>
      {url && (
        <audio
          aria-label={`Audition ${name}`}
          controls
          src={url}
          preload="metadata"
        />
      )}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            setProvenance(await studioCall("asset", candidate.asset))
          } catch (error) {
            onError(
              error instanceof Error ? error.message : "Provenance unavailable",
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        Inspect retained provider provenance
      </button>
      {provenance !== null && <pre>{JSON.stringify(provenance, null, 2)}</pre>}
    </div>
  )
}
export default function ExperimentPanel({
  language,
  onClose,
}: {
  language: string
  onClose: () => void
}) {
  const [kind, setKind] = useState<"music" | "voice">("music"),
    [model, setModel] = useState("music_v1"),
    [prompt, setPrompt] = useState(""),
    [text, setText] = useState(""),
    [languageCode, setLanguageCode] = useState(""),
    [duration, setDuration] = useState("10"),
    [count, setCount] = useState("2"),
    [instrumental, setInstrumental] = useState(true),
    [loudness, setLoudness] = useState("0.5"),
    [guidance, setGuidance] = useState("5"),
    [quote, setQuote] = useState<z.infer<typeof estimateSchema> | null>(null),
    [budget, setBudget] = useState("0"),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [runId, setRunId] = useState(""),
    [runs, setRuns] = useState<ProductionRun[]>([]),
    [moreRuns, setMoreRuns] = useState(true),
    [experiment, setExperiment] = useState<z.infer<
      typeof experimentSchema
    > | null>(null),
    [status, setStatus] = useState<unknown>(null),
    [name, setName] = useState(""),
    [registerConfirmed, setRegisterConfirmed] = useState(false)
  useEffect(() => {
    setQuote(null)
    setConfirmed(false)
  }, [
    kind,
    model,
    prompt,
    text,
    languageCode,
    duration,
    count,
    instrumental,
    loudness,
    guidance,
    language,
  ])
  useEffect(() => {
    let active = true
    readProductionRuns({ kind: "experiment" })
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
  }, [runId])
  async function action(task: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Experiment request failed")
    } finally {
      setBusy(false)
    }
  }
  function draft() {
    return {
      kind,
      provider: "elevenlabs",
      model,
      language,
      prompt,
      candidateCount: kind === "voice" ? 3 : Number(count),
      settings:
        kind === "music"
          ? { lengthMs: Math.round(Number(duration) * 1000), instrumental }
          : {
              text,
              loudness: Number(loudness),
              guidanceScale: Number(guidance),
              languageCode,
              narrationModel: "eleven_multilingual_v2",
            },
    }
  }
  async function refresh(after?: string) {
    const value = await production({ kind: "status", runId, after })
    setStatus(value)
    const id = z.object({ experimentId: z.string() }).parse(value).experimentId
    setExperiment(
      experimentSchema.parse(await studioCall("experiment-read", id)),
    )
  }
  return (
    <div className="nle-dialog-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Music and voice experiments"
        className="nle-dialog nle-production"
      >
        <header>
          <h2>Music and voice experiments</h2>
          <button onClick={onClose}>Close experiments</button>
        </header>
        <p>
          Explicit creative experiments for language {language}. All candidates
          remain available. Voice previews need separate registration before
          narration use.
        </p>
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={busy}>
          <legend>Fixed experiment request</legend>
          <label>
            Kind{" "}
            <select
              value={kind}
              onChange={(e) => {
                const next = e.target.value === "voice" ? "voice" : "music"
                setKind(next)
                setModel(
                  next === "voice" ? "eleven_multilingual_ttv_v2" : "music_v1",
                )
              }}
            >
              <option value="music">Music</option>
              <option value="voice">Voice design</option>
            </select>
          </label>
          <label>
            Model{" "}
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {(kind === "music"
                ? ["music_v1", "music_v2"]
                : ["eleven_multilingual_ttv_v2", "eleven_ttv_v3"]
              ).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            Creative direction{" "}
            <textarea
              value={prompt}
              maxLength={kind === "music" ? 4100 : 1000}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          {kind === "music" ? (
            <>
              <label>
                Duration in seconds{" "}
                <input
                  type="number"
                  min="3"
                  max="600"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
              <label>
                Candidates{" "}
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={instrumental}
                  onChange={(e) => setInstrumental(e.target.checked)}
                />
                Instrumental
              </label>
            </>
          ) : (
            <>
              <label>
                Exact preview text (100–1,000 characters){" "}
                <textarea
                  value={text}
                  maxLength={1000}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <label>
                Provider language code for {language}{" "}
                <input
                  value={languageCode}
                  onChange={(e) => setLanguageCode(e.target.value)}
                  placeholder="BCP 47 code"
                />
              </label>
              <label>
                Loudness{" "}
                <input
                  type="number"
                  min="-1"
                  max="1"
                  step="0.1"
                  value={loudness}
                  onChange={(e) => setLoudness(e.target.value)}
                />
              </label>
              <label>
                Guidance scale{" "}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={guidance}
                  onChange={(e) => setGuidance(e.target.value)}
                />
              </label>
              <p>
                One design request returns three previews. Preview text is
                supplied exactly; automatic text generation and prompt
                enhancement are disabled.
              </p>
            </>
          )}
          <button
            onClick={() =>
              void action(async () => {
                const result = await production({
                  kind: "experiment-estimate",
                  input: draft(),
                })
                const estimate = estimateSchema.parse(result.estimate)
                setQuote(estimate)
                setBudget(String((estimate.amountMicros ?? 0) / 1000000))
              })
            }
          >
            Estimate experiment
          </button>
        </fieldset>
        {quote && (
          <fieldset disabled={busy}>
            <legend>Review and confirm</legend>
            <pre>{JSON.stringify(draft(), null, 2)}</pre>
            <p>
              Estimate:{" "}
              {quote.amountMicros === null
                ? "Unavailable"
                : `$${(quote.amountMicros / 1000000).toFixed(6)} USD`}
              . {quote.basis} Valid until {quote.expiresAt}. Actual charges
              remain unknown unless the provider reports them.
            </p>
            {quote.amountMicros !== null && (
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
              I request these previews and accept provider charges, including
              when the exact price is unavailable.
            </label>
            <button
              disabled={!confirmed}
              onClick={() =>
                void action(async () => {
                  const value = await production({
                    kind: "experiment-run",
                    input: {
                      ...draft(),
                      estimate: quote,
                      maxCostMicros: Math.round(Number(budget) * 1000000),
                      confirmed: true,
                      idempotencyKey: crypto.randomUUID(),
                    },
                  })
                  setRunId(value.runId)
                  setStatus(value)
                  setExperiment(null)
                  setConfirmed(false)
                })
              }
            >
              Generate experiment candidates
            </button>
          </fieldset>
        )}
        <label>
          Retained experiment runs{" "}
          <select
            value={runId}
            onChange={(e) => {
              setRunId(e.target.value)
              setExperiment(null)
              setStatus(null)
              setRegisterConfirmed(false)
            }}
          >
            <option value="">Select a run</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} · {new Date(r.createdAt).toLocaleString()}
                {r.state === "CANCELLED" ? " · Stopped" : ""}
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
                  kind: "experiment",
                  before: { createdAt: last.createdAt, id: last.id },
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
            <button
              disabled={busy}
              onClick={() => void action(() => refresh())}
            >
              Refresh experiment
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  setStatus(await production({ kind: "resume", runId }))
                })
              }
            >
              Generate remaining candidates
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
            <p>
              Only candidates that have not started can be generated here.
              Failed or uncertain requests are kept for inspection and are never
              repeated automatically.
            </p>
            <details>
              <summary>Execution records</summary>
              <pre>{JSON.stringify(status, null, 2)}</pre>
            </details>
          </>
        )}
        {experiment && (
          <>
            <p>
              {experiment.outcome.status === "OVERRUN"
                ? "Reported costs exceed the approved budget. "
                : ""}
              Actual candidate cost:{" "}
              {experiment.outcome.actualCostMicros === null
                ? "Not reported by the provider"
                : `$${Number(experiment.outcome.actualCostMicros) / 1000000} USD`}
              . Unused candidates are retained.
            </p>
            {experiment.candidates.map((candidate, index) => (
              <fieldset key={candidate.candidateKey}>
                <legend>
                  {experiment.request.kind === "music" ? "Music" : "Voice"}{" "}
                  candidate {index + 1}
                </legend>
                <Audition
                  candidate={candidate}
                  name={`candidate ${index + 1}`}
                  onError={setError}
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await studioCall("experiment-select", {
                        experimentId: experiment.id,
                        candidateKey: candidate.candidateKey,
                        idempotencyKey: crypto.randomUUID(),
                      })
                      setRegisterConfirmed(false)
                      await refresh()
                    })
                  }
                >
                  {experiment.selection?.candidateKey === candidate.candidateKey
                    ? "Selected"
                    : "Select candidate"}
                </button>
                <details>
                  <summary>Candidate provenance</summary>
                  <pre>{JSON.stringify(candidate, null, 2)}</pre>
                </details>
              </fieldset>
            ))}
            {experiment.request.kind === "voice" && experiment.selection && (
              <fieldset disabled={busy}>
                <legend>Register selected voice</legend>
                <label>
                  Library name{" "}
                  <input
                    value={name}
                    maxLength={100}
                    onChange={(e) => {
                      setName(e.target.value)
                      setRegisterConfirmed(false)
                    }}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={registerConfirmed}
                    onChange={(e) => setRegisterConfirmed(e.target.checked)}
                  />
                  Register this selected voice and accept provider charges using
                  an available voice slot.
                </label>
                <button
                  disabled={!registerConfirmed || !name.trim()}
                  onClick={() =>
                    void action(async () => {
                      setStatus(
                        await production({
                          kind: "experiment-register",
                          runId,
                          candidateKey: experiment.selection!.candidateKey,
                          name,
                          confirmed: true,
                        }),
                      )
                      setRegisterConfirmed(false)
                      await refresh()
                    })
                  }
                >
                  Register voice preset
                </button>
              </fieldset>
            )}
          </>
        )}
      </section>
    </div>
  )
}
