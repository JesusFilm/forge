"use client"
import { useState } from "react"

export function CompositionControls(props: {
  protocolId?: string
  configDigest?: string
  evidenceDigest?: string
  canCalibrate?: boolean
}) {
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [rationale, setRationale] = useState("")
  async function submit(body: unknown) {
    setPending(true)
    setMessage("Submitting…")
    try {
      const response = await fetch("/api/recommendations/composition", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forge-csrf": "recommendation-composition-v1",
        },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) {
        if (response.status >= 500) setUnknown(true)
        setMessage(
          response.status >= 500
            ? "Acknowledgement unknown. Inspect this protocol before another transition."
            : `Rejected: ${result.error}`,
        )
      } else {
        setMessage("Recorded. Refresh the protocol to review its exact state.")
        setUnknown(true)
      }
    } catch {
      setUnknown(true)
      setMessage(
        "Acknowledgement unknown. Inspect this protocol before another transition.",
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="text-lg font-semibold">Operator actions</h2>
      <p>
        Recent authentication is required. Structural calibration qualifies the
        exact policy for a controlled study; weights remain an unproven
        usefulness hypothesis.
      </p>
      {props.protocolId ? (
        <>
          <button
            disabled={pending || unknown}
            className="rounded border p-2 disabled:opacity-50"
            onClick={() =>
              submit({ action: "decide", protocolId: props.protocolId })
            }
          >
            Record terminal decision
          </button>
          {props.canCalibrate && (
            <>
              <label className="block">
                Calibration rationale
                <textarea
                  className="mt-1 block w-full rounded border p-2"
                  minLength={20}
                  maxLength={512}
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                  placeholder="Explain the observed input availability, fallback and latency results supporting this controlled study."
                />
              </label>
              <button
                disabled={pending || unknown || rationale.trim().length < 20}
                className="rounded border p-2 disabled:opacity-50"
                onClick={() =>
                  submit({
                    action: "calibrate",
                    protocolId: props.protocolId,
                    configDigest: props.configDigest,
                    evidenceDigest: props.evidenceDigest,
                    rationale,
                  })
                }
              >
                Record review of exact evidence
              </button>
            </>
          )}
        </>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            submit({
              action: "prepare",
              protocolId: data.get("protocolId"),
              shadowEvaluationId: data.get("shadowEvaluationId"),
              sourceManifestId: data.get("sourceManifestId"),
              generatorVersion: data.get("generatorVersion"),
              challengerManifestId: data.get("challengerManifestId"),
              thresholds: Object.fromEntries(
                [
                  "minimumRuns",
                  "maxFallbackRate",
                  "maxMissingInputRate",
                  "maxLatencyMs",
                  "minimumFillRate",
                ].map((key) => [key, Number(data.get(key))]),
              ),
            })
          }}
        >
          {[
            "protocolId",
            "shadowEvaluationId",
            "sourceManifestId",
            "generatorVersion",
            "challengerManifestId",
          ].map((name) => (
            <label key={name} className="block">
              {name.replaceAll(/([A-Z])/g, " $1")}
              <input
                name={name}
                required
                className="mt-1 block w-full rounded border p-2"
              />
            </label>
          ))}
          <p>
            Prespecify operational thresholds. No default thresholds are
            supplied.
          </p>
          {[
            { name: "minimumRuns", min: 1, max: 500, step: 1 },
            { name: "maxFallbackRate", min: 0, max: 1, step: 0.001 },
            { name: "maxMissingInputRate", min: 0, max: 1, step: 0.001 },
            { name: "maxLatencyMs", min: 0.001, max: 200, step: 0.001 },
            { name: "minimumFillRate", min: 0, max: 1, step: 0.001 },
          ].map((field) => (
            <label key={field.name} className="block">
              {field.name.replaceAll(/([A-Z])/g, " $1")}
              <input
                {...field}
                type="number"
                required
                className="ml-3 rounded border p-2"
              />
            </label>
          ))}
          <button
            disabled={pending || unknown}
            className="rounded border p-2 disabled:opacity-50"
          >
            Freeze protocol before execution
          </button>
        </form>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
