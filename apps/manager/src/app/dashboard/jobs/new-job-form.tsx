"use client"

import React from "react"
import { useState } from "react"
import { Play, RefreshCw } from "lucide-react"

type RequestStatus =
  | { type: "idle" }
  | { type: "success"; message: string; jobId: string }
  | { type: "error"; message: string }

export function parseLanguageInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((lang) => lang.trim())
        .filter(Boolean),
    ),
  ]
}

export function NewJobForm() {
  const [muxAssetId, setMuxAssetId] = useState("sample-mux-asset")
  const [languages, setLanguages] = useState("es,fr")
  const [generateVoiceover, setGenerateVoiceover] = useState(false)
  const [uploadMux, setUploadMux] = useState(false)
  const [notifyCms, setNotifyCms] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<RequestStatus>({ type: "idle" })

  const canSubmit = muxAssetId.trim().length > 0 && !isSubmitting

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!muxAssetId.trim()) {
      setStatus({ type: "error", message: "Mux Asset ID is required." })
      return
    }

    setIsSubmitting(true)
    setStatus({ type: "idle" })

    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          muxAssetId: muxAssetId.trim(),
          languages: parseLanguageInput(languages),
          options: {
            generateVoiceover,
            uploadMux,
            notifyCms,
          },
        }),
      })

      const json = (await response.json()) as {
        jobId?: string
        error?: string
        details?: string
        code?: string
      }

      if (!response.ok || !json.jobId) {
        const message = [json.error, json.details, json.code]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join(" | ")
        throw new Error(message || "Failed to create job.")
      }

      setStatus({
        type: "success",
        jobId: json.jobId,
        message: `Job ${json.jobId} created. Refresh to see updates.`,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create job."
      setStatus({ type: "error", message })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="collection-card jobs-card jobs-form">
      <div className="jobs-card-header">
        <h2 className="jobs-card-title">Create Enrichment Job</h2>
      </div>

      <div className="grid cols-2 jobs-form-grid">
        <label className="jobs-field">
          <div className="small jobs-field-label">Mux Asset ID</div>
          <input
            value={muxAssetId}
            onChange={(e) => setMuxAssetId(e.target.value)}
            required
            className="jobs-input"
          />
        </label>
        <label className="jobs-field">
          <div className="small jobs-field-label">
            Languages (comma-separated)
          </div>
          <input
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
            className="jobs-input"
            placeholder="es,fr,de"
          />
        </label>
      </div>

      <div className="jobs-options">
        <label className="jobs-option">
          <input
            type="checkbox"
            checked={generateVoiceover}
            onChange={(e) => setGenerateVoiceover(e.target.checked)}
          />{" "}
          Generate voiceover
        </label>
        <label className="jobs-option">
          <input
            type="checkbox"
            checked={uploadMux}
            onChange={(e) => setUploadMux(e.target.checked)}
          />{" "}
          Upload to Mux
        </label>
        <label className="jobs-option">
          <input
            type="checkbox"
            checked={notifyCms}
            onChange={(e) => setNotifyCms(e.target.checked)}
          />{" "}
          Notify CMS (Strapi)
        </label>
      </div>

      <div className="jobs-actions">
        <button
          type="submit"
          disabled={!canSubmit}
          className="jobs-primary-button"
        >
          {isSubmitting ? (
            <RefreshCw className="icon is-spinning" aria-hidden="true" />
          ) : (
            <Play className="icon" aria-hidden="true" />
          )}
          {isSubmitting ? "Creating..." : "Start Job"}
        </button>
      </div>

      {status.type !== "idle" && (
        <p
          role="status"
          aria-live="polite"
          className={`small jobs-status ${status.type === "error" ? "jobs-status-error" : "jobs-status-success"}`}
        >
          {status.message}{" "}
          {status.type === "success" ? (
            <a href={`/dashboard/jobs/${status.jobId}`}>Open job</a>
          ) : null}
        </p>
      )}
    </form>
  )
}
