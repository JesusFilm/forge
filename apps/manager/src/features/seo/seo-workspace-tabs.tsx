"use client"

import {
  BarChart3,
  Beaker,
  BookOpenCheck,
  FileDiff,
  History,
  Link2,
  type LucideIcon,
} from "lucide-react"
import { useRef } from "react"
import { SEO_WORKSPACE_VIEWS, type SeoWorkspaceView } from "./seo-contract"

export const SEO_WORKSPACE_VIEW_META: Record<
  SeoWorkspaceView,
  { label: string; icon: LucideIcon; description: string }
> = {
  overview: {
    label: "Overview",
    icon: BarChart3,
    description: "Action queue and run health",
  },
  proposals: {
    label: "Proposals",
    icon: FileDiff,
    description: "Exact editorial and engineering actions",
  },
  experiments: {
    label: "Experiments",
    icon: Beaker,
    description: "Activation and measurement",
  },
  learnings: {
    label: "Learnings",
    icon: BookOpenCheck,
    description: "Reviewed reusable outcomes",
  },
  reconciliation: {
    label: "Reconciliation",
    icon: Link2,
    description: "Ambiguous ticket delivery",
  },
  runs: {
    label: "Runs",
    icon: History,
    description: "Every job and its decisions",
  },
}

export function SeoWorkspaceTabs({
  view,
  onSelect,
}: {
  view: SeoWorkspaceView
  onSelect?: (view: SeoWorkspaceView) => void
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function select(nextView: SeoWorkspaceView) {
    if (onSelect) {
      onSelect(nextView)
      return
    }
    window.location.assign(`/dashboard/seo?view=${nextView}`)
  }

  function onKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % SEO_WORKSPACE_VIEWS.length
    }
    if (event.key === "ArrowLeft") {
      nextIndex =
        (index - 1 + SEO_WORKSPACE_VIEWS.length) % SEO_WORKSPACE_VIEWS.length
    }
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = SEO_WORKSPACE_VIEWS.length - 1
    if (nextIndex == null) return
    event.preventDefault()
    select(SEO_WORKSPACE_VIEWS[nextIndex])
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <nav className="seo-view-tabs" aria-label="SEO workspace views">
      <div role="tablist" aria-orientation="horizontal">
        {SEO_WORKSPACE_VIEWS.map((candidate, index) => {
          const meta = SEO_WORKSPACE_VIEW_META[candidate]
          const Icon = meta.icon
          const selected = candidate === view
          return (
            <button
              type="button"
              key={candidate}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              role="tab"
              id={`seo-tab-${candidate}`}
              aria-selected={selected}
              aria-controls={`seo-panel-${candidate}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? "is-active" : undefined}
              onClick={() => select(candidate)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <Icon aria-hidden="true" size={18} />
              <span>
                <strong>{meta.label}</strong>
                <small>{meta.description}</small>
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
