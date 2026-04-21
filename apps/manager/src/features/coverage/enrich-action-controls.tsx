"use client"

import Link from "next/link"
import React from "react"
import { ArrowRight, RefreshCw, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { EnrichFeedback } from "@/features/enrich-selection"

type EnrichActionControlsProps = {
  enrichActionReady: boolean
  enrichFeedback: EnrichFeedback | null
  isEnrichSubmitting: boolean
  languageSelectionRequired: boolean
  onCancel: () => void
  onEnrich: () => void | Promise<void>
}

export function EnrichActionControls({
  enrichActionReady,
  enrichFeedback,
  isEnrichSubmitting,
  languageSelectionRequired,
  onCancel,
  onEnrich,
}: EnrichActionControlsProps) {
  const actionDisabled = !enrichActionReady || isEnrichSubmitting

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="rounded-[20px] px-6"
          disabled={actionDisabled}
          aria-busy={isEnrichSubmitting}
          title={
            languageSelectionRequired
              ? "Select at least one language before enriching."
              : undefined
          }
          onClick={() => {
            void onEnrich()
          }}
        >
          {isEnrichSubmitting ? (
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Rocket className="size-4" aria-hidden="true" />
          )}
          {isEnrichSubmitting ? "Creating jobs..." : "Enrich Now"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onCancel}
          aria-label="Cancel and clear selection"
          title="Cancel and clear selection"
        >
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6M9 9l6 6" />
          </svg>
        </Button>
      </div>
      {isEnrichSubmitting ? (
        <div className="rounded-[18px] border border-border/70 bg-secondary/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
          Submitting enrichment request...
        </div>
      ) : enrichFeedback ? (
        <div
          className={cn(
            "rounded-[18px] border px-4 py-3 text-sm leading-6",
            enrichFeedback.tone === "success" &&
              "border-[color:rgba(29,185,84,0.28)] bg-[color:rgba(29,185,84,0.10)] text-[color:#15803d]",
            enrichFeedback.tone === "error" &&
              "border-[color:rgba(239,51,64,0.24)] bg-[color:rgba(239,51,64,0.08)] text-[color:var(--ds-brand-red)]",
            enrichFeedback.tone === "neutral" &&
              "border-border/70 bg-secondary/40 text-muted-foreground",
          )}
        >
          {enrichFeedback.message}
          {enrichFeedback.action ? (
            <>
              {" "}
              <Link
                className="inline-flex cursor-pointer items-center gap-1 font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground/80"
                href={enrichFeedback.action.href}
              >
                {enrichFeedback.action.label}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </>
          ) : null}
        </div>
      ) : languageSelectionRequired ? (
        <div className="rounded-[18px] border border-border/70 bg-secondary/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
          Select at least one language to enable enrichment.
        </div>
      ) : null}
    </div>
  )
}
