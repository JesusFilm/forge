"use client"

import { useEffect, useMemo, useState } from "react"
import { ServerOff } from "lucide-react"

import {
  groupExperiencesByDay,
  type ClientExperience,
} from "./coverage-report-model"
import { apiFetch } from "@/lib/api-fetch"

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; experiences: ClientExperience[] }
  | { status: "error"; message: string }

type ExperiencesReportBodyProps = {
  languageIds: string[]
}

const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
})

function formatDay(day: string): string {
  if (day === "unknown") return "Unknown date"
  const parsed = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return day
  return DAY_FORMATTER.format(parsed)
}

export function ExperiencesReportBody({
  languageIds,
}: ExperiencesReportBodyProps) {
  const [state, setState] = useState<FetchState>({ status: "idle" })

  const languageQuery = useMemo(
    () =>
      Array.from(
        new Set(languageIds.map((id) => id.trim()).filter(Boolean)),
      ).sort(),
    [languageIds],
  )
  const languageQueryKey = languageQuery.join(",")

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading" })

    const params = new URLSearchParams()
    if (languageQueryKey.length > 0) {
      params.set("languageIds", languageQueryKey)
    }
    const qs = params.toString()

    void (async () => {
      try {
        const response = await apiFetch(
          `/api/experiences${qs ? `?${qs}` : ""}`,
          { cache: "no-store" },
        )
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`)
        }
        const payload = (await response.json()) as {
          experiences: ClientExperience[]
        }
        if (cancelled) return
        setState({ status: "ready", experiences: payload.experiences ?? [] })
      } catch (error) {
        if (cancelled) return
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to fetch experiences",
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [languageQueryKey])

  if (state.status === "error") {
    return (
      <div className="collections">
        <div className="collection-empty collection-empty--no-data">
          <ServerOff
            size={40}
            strokeWidth={1.25}
            aria-hidden="true"
            className="collection-empty-icon"
          />
          Experiences couldn&apos;t be loaded from the server. Check your
          connection and try refreshing.
        </div>
      </div>
    )
  }

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="collections">
        {Array.from({ length: 3 }).map((_, i) => (
          <section key={i} className="collection-card skeleton-card">
            <div className="collection-header">
              <div className="collection-title-row">
                <div className="collection-title-block">
                  <div className="collection-title-line">
                    <span className="skeleton skeleton--title" />
                    <span className="skeleton skeleton--label" />
                  </div>
                </div>
              </div>
            </div>
            <div className="collection-tiles">
              {Array.from({ length: 20 }).map((_, j) => (
                <span key={j} className="tile skeleton skeleton--tile" />
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  const groups = groupExperiencesByDay(state.experiences)

  if (groups.length === 0) {
    return (
      <div className="collections">
        <div className="collection-empty collection-empty--no-data">
          No experiences match the selected language filter.
        </div>
      </div>
    )
  }

  return (
    <div className="collections">
      {groups.map((group) => (
        <section key={group.day} className="collection-card">
          <div className="collection-header">
            <div className="collection-title-row">
              <div className="collection-title-block">
                <div className="collection-title-line">
                  <span className="collection-title">
                    {formatDay(group.day)}
                  </span>
                  <span className="collection-label">
                    {group.experiences.length} experience
                    {group.experiences.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="collection-tiles">
            {group.experiences.map((experience) => {
              const tileTitle = [
                experience.title ?? experience.slug ?? experience.documentId,
                experience.locale,
                experience.slug,
              ]
                .filter((value): value is string => !!value)
                .join(" · ")
              return (
                <span
                  key={`${experience.documentId}:${experience.locale ?? ""}`}
                  className={`tile tile--experience${
                    experience.isHomepage ? " tile--experience-homepage" : ""
                  }${experience.isTemplate ? " tile--experience-template" : ""}`}
                  title={tileTitle}
                  aria-label={tileTitle}
                />
              )
            })}
          </div>
        </section>
      ))}
      <div className="collection-load-meta">
        {state.experiences.length} experience
        {state.experiences.length === 1 ? "" : "s"}
      </div>
    </div>
  )
}
