"use client"

import React, { useState } from "react"

type RequestStatus =
  | { type: "idle" }
  | { type: "success"; message: string; jobId: string }
  | { type: "error"; message: string }

export function NewJobForm() {
  const [inputUrl, setInputUrl] = useState("")
  const [language, setLanguage] = useState("en")
  const [translateTo, setTranslateTo] = useState("es,fr")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<RequestStatus>({ type: "idle" })

  const canSubmit = inputUrl.trim().length > 0 && !isSubmitting

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!inputUrl.trim()) {
      setStatus({ type: "error", message: "Input URL is required." })
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
          inputUrl: inputUrl.trim(),
          language: language.trim(),
          translateTo: translateTo
            .split(",")
            .map((lang) => lang.trim())
            .filter(Boolean),
        }),
      })

      const json = (await response.json()) as {
        job?: { id: string }
        jobId?: string
        error?: string
        details?: string
        code?: string
      }

      const jobId = json.job?.id ?? json.jobId

      if (!response.ok || !jobId) {
        const message = [json.error, json.details, json.code]
          .filter((value): value is string => Boolean(value && value.trim()))
          .join(" | ")
        throw new Error(message || "Failed to create job.")
      }

      setStatus({
        type: "success",
        jobId,
        message: `Job ${jobId} created. Refresh to see updates.`,
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
          <div className="small jobs-field-label">Input URL</div>
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            required
            className="jobs-input"
            placeholder="https://example.com/video.mp4"
          />
        </label>
        <label className="jobs-field">
          <div className="small jobs-field-label">Source Language</div>
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="jobs-input"
            placeholder="en"
          />
        </label>
      </div>

      <div
        className="grid cols-1 jobs-form-grid"
        style={{ marginTop: "0.75rem" }}
      >
        <label className="jobs-field">
          <div className="small jobs-field-label">
            Translate To (comma-separated)
          </div>
          <input
            value={translateTo}
            onChange={(e) => setTranslateTo(e.target.value)}
            className="jobs-input"
            placeholder="es,fr,de"
          />
        </label>
      </div>

      <div className="jobs-actions">
        <button
          type="submit"
          disabled={!canSubmit}
          className="jobs-primary-button"
        >
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
