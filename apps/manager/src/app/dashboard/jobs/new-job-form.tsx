"use client"

import React from "react"
import { useState } from "react"
import { Play, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

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
    <Card>
      <form onSubmit={onSubmit}>
        <CardHeader className="border-b border-border/70 pb-6">
          <div className="space-y-2">
            <h2 className="text-[1.75rem] font-semibold tracking-[-0.03em] text-foreground">
              Create enrichment job
            </h2>
            <p className="max-w-2xl text-[1rem] leading-7 text-muted-foreground">
              Kick off a one-off enrichment run for a Mux asset and the
              languages you want to process.
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-8 pt-8">
          <div className="grid gap-6 lg:grid-cols-2">
            <label className="space-y-3">
              <span className="text-[0.95rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Mux asset ID
              </span>
              <Input
                value={muxAssetId}
                onChange={(e) => setMuxAssetId(e.target.value)}
                required
              />
            </label>

            <label className="space-y-3">
              <span className="text-[0.95rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Languages
              </span>
              <Input
                value={languages}
                onChange={(e) => setLanguages(e.target.value)}
                placeholder="es,fr,de"
              />
            </label>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-[0.95rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Options
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                {
                  checked: generateVoiceover,
                  label: "Generate voiceover",
                  onChange: (checked: boolean) => setGenerateVoiceover(checked),
                },
                {
                  checked: uploadMux,
                  label: "Upload to Mux",
                  onChange: (checked: boolean) => setUploadMux(checked),
                },
                {
                  checked: notifyCms,
                  label: "Notify CMS (Strapi)",
                  onChange: (checked: boolean) => setNotifyCms(checked),
                },
              ].map((option) => (
                <label
                  key={option.label}
                  className="flex cursor-pointer items-start gap-3 rounded-[1.5rem] border border-border bg-card px-4 py-4 transition-colors hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={option.checked}
                    onChange={(event) => option.onChange(event.target.checked)}
                    className="mt-1 size-4 rounded border border-border accent-black"
                  />
                  <span className="text-[1rem] font-medium tracking-[-0.015em] text-foreground">
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={!canSubmit}
            >
              {isSubmitting ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              {isSubmitting ? "Creating..." : "Start job"}
            </Button>
          </div>

          {status.type !== "idle" ? (
            <p
              role="status"
              aria-live="polite"
              className={
                status.type === "error"
                  ? "rounded-[1.25rem] border border-[rgba(239,51,64,0.2)] bg-[rgba(239,51,64,0.08)] px-4 py-3 text-[15px] font-medium text-[color:var(--ds-brand-red)]"
                  : "rounded-[1.25rem] border border-[rgba(29,185,84,0.22)] bg-[rgba(29,185,84,0.10)] px-4 py-3 text-[15px] font-medium text-[#15803d]"
              }
            >
              {status.message}{" "}
              {status.type === "success" ? (
                <a
                  href={`/dashboard/jobs/${status.jobId}`}
                  className="underline underline-offset-4"
                >
                  Open job
                </a>
              ) : null}
            </p>
          ) : null}
        </CardContent>
      </form>
    </Card>
  )
}
