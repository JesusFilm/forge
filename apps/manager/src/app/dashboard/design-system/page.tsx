import type { Metadata } from "next"
import Image from "next/image"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import {
  BarChart2,
  Bot,
  Captions,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileAudio2,
  FileJson2,
  Languages,
  LayoutGrid,
  LayoutTemplate,
  List,
  ListChecks,
  Mic2,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Upload,
  Wand2,
  X,
} from "lucide-react"

export const metadata: Metadata = {
  title: "Design System -- Studio",
}

const sourceComponents = [
  {
    name: "Dashboard navigation",
    role: "Authenticated dashboard tabs, queue count, user menu.",
    path: "apps/manager/src/features/nav/dashboard-nav.tsx",
  },
  {
    name: "Coverage report",
    role: "Report header controls, language selector, collection cards, coverage bars, selection bar.",
    path: "apps/manager/src/features/coverage/coverage-report-client.tsx",
  },
  {
    name: "Language selector",
    role: "Searchable geo/language panel, selected language pills, confirmation states.",
    path: "apps/manager/src/features/coverage/LanguageGeoSelector.tsx",
  },
  {
    name: "Coverage empty state",
    role: "Language-required and no-data states for report pages.",
    path: "apps/manager/src/features/coverage/coverage-empty-state.tsx",
  },
  {
    name: "Enrich action controls",
    role: "Selection feedback, enrich submission states, and Jobs handoff.",
    path: "apps/manager/src/features/coverage/enrich-action-controls.tsx",
  },
  {
    name: "Jobs table",
    role: "Grouped live job list with polling, status dots, language badges, and row navigation.",
    path: "apps/manager/src/features/jobs/live-jobs-table.tsx",
  },
  {
    name: "Job detail header",
    role: "Status summary, language badges, Mux links, copy action, and environment indicator.",
    path: "apps/manager/src/features/jobs/live-job-detail-header.tsx",
  },
  {
    name: "Job step table",
    role: "Live workflow step status, artifacts, retries, sync details, and rerun controls.",
    path: "apps/manager/src/features/jobs/live-job-steps-table.tsx",
  },
  {
    name: "Collapsible step row",
    role: "Reusable expandable table row for workflow step diagnostics.",
    path: "apps/manager/src/features/jobs/collapsible-step-row.tsx",
  },
  {
    name: "Review player",
    role: "Before/after generated-output review, metadata panels, chapters, and compare status.",
    path: "apps/manager/src/features/jobs/review-player/review-player-card.tsx",
  },
  {
    name: "Embedding sync card",
    role: "CMS transcript embedding sync status and manual override controls.",
    path: "apps/manager/src/features/jobs/embedding-sync-card.tsx",
  },
  {
    name: "Scene embedding sync card",
    role: "Scene embedding diagnostics attached to the embeddings workflow step.",
    path: "apps/manager/src/features/jobs/scene-embedding-sync-card.tsx",
  },
  {
    name: "Job error log",
    role: "Persistent job-level error review.",
    path: "apps/manager/src/features/jobs/job-error-log-section.tsx",
  },
  {
    name: "New job form",
    role: "Mux asset job creation with language input and workflow options.",
    path: "apps/manager/src/app/dashboard/jobs/new-job-form.tsx",
  },
  {
    name: "Agents page",
    role: "Automation dashboard, create modal, active and paused lists.",
    path: "apps/manager/src/features/agents/agents-page.tsx",
  },
  {
    name: "Automation form",
    role: "Template, schedule, refresh mode, cap, and target-language inputs.",
    path: "apps/manager/src/features/agents/automation-form.tsx",
  },
  {
    name: "Automation list",
    role: "Automation rows, detail grid, run history, pause and resume actions.",
    path: "apps/manager/src/features/agents/automation-list.tsx",
  },
  {
    name: "Automation run history",
    role: "Recent automation run rows and empty state.",
    path: "apps/manager/src/features/agents/automation-run-history.tsx",
  },
]

const componentGroups = [
  "Screens",
  "Foundations",
  "Navigation",
  "Buttons",
  "Forms",
  "Badges",
  "Cards",
  "Tables",
  "Coverage",
  "Jobs",
  "Review",
  "Agents",
  "Feedback",
]

const productTiles = [
  {
    title: "Report",
    meta: "Coverage and subtitle health",
    icon: BarChart2,
    image: "/World_map_with_points.svg",
  },
  {
    title: "Jobs",
    meta: "Live enrichment workflows",
    icon: ListChecks,
    image: "/jesusfilm-sign.svg",
  },
  {
    title: "Review",
    meta: "Generated metadata QA",
    icon: Captions,
    image: "/favicon.svg",
  },
  {
    title: "Agents",
    meta: "Recurring automation runs",
    icon: Bot,
  },
]

const statusBadges = [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "active",
  "paused",
]

function SourceTable() {
  return (
    <div className="design-system-source-frame">
      <table className="design-system-source-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Use</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {sourceComponents.map((component) => (
            <tr key={component.path}>
              <td data-label="Component">
                <strong>{component.name}</strong>
              </td>
              <td data-label="Use">{component.role}</td>
              <td data-label="Source">
                <code>{component.path}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SectionHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children: ReactNode
}) {
  return (
    <header className="design-system-section-header">
      <span className="design-system-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </header>
  )
}

function DemoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="design-system-demo-card">
      <h3>{title}</h3>
      {children}
    </article>
  )
}

function StepGlyph({
  status,
}: {
  status: "completed" | "running" | "failed" | "skipped" | "pending"
}) {
  return (
    <span className={`design-system-step-icon is-${status}`}>
      {status === "completed" ? <Check size={18} /> : null}
      {status === "running" ? <RefreshCw size={18} /> : null}
      {status === "failed" ? <ExternalLink size={18} /> : null}
      {status === "skipped" ? <ChevronDown size={18} /> : null}
      {status === "pending" ? <FileJson2 size={18} /> : null}
    </span>
  )
}

function ScreenShell({
  className,
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
}: {
  className?: string
  icon: LucideIcon
  title: string
  subtitle: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <article
      className={`design-system-screen-shell${className ? ` ${className}` : ""}`}
    >
      <header className="design-system-screen-shell-header">
        <div className="design-system-screen-shell-title">
          <span className="design-system-screen-shell-icon">
            <Icon size={18} aria-hidden="true" />
          </span>
          <div className="design-system-screen-shell-copy">
            <strong>{title}</strong>
            <p>{subtitle}</p>
          </div>
        </div>
        {actions ? (
          <div className="design-system-screen-shell-actions">{actions}</div>
        ) : null}
      </header>
      <div className="design-system-screen-shell-body">{children}</div>
    </article>
  )
}

export default function DesignSystemPage() {
  return (
    <div className="design-system-page">
      <section className="design-system-section design-system-section--hero">
        <div className="design-system-hero-copy">
          <span className="design-system-eyebrow">Studio UI</span>
          <h1 id="system-title">Design system components</h1>
          <p>
            A kitchen sink for the Studio surfaces: coverage reporting, job
            execution, enrichment review, and agent automations.
          </p>
        </div>
        <div
          className="design-system-component-pills"
          aria-label="Component groups"
        >
          {componentGroups.map((group) => (
            <span key={group}>{group}</span>
          ))}
        </div>
        <div className="design-system-product-grid">
          {productTiles.map((tile) => {
            const Icon = tile.icon

            return (
              <article className="design-system-product-tile" key={tile.title}>
                <div className="design-system-product-visual">
                  {tile.image ? (
                    <Image
                      alt=""
                      aria-hidden="true"
                      height={72}
                      src={tile.image}
                      width={140}
                    />
                  ) : (
                    <Icon size={42} aria-hidden="true" />
                  )}
                  <span className="design-system-product-glyph">
                    <Icon size={17} aria-hidden="true" />
                  </span>
                </div>
                <h2>{tile.title}</h2>
                <p>{tile.meta}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="design-system-section">
        <SectionHeader eyebrow="01" title="Current screens">
          Empty shells for the current manager surfaces, restyled with the new
          Studio system so layout and hierarchy can be reviewed without app
          logic.
        </SectionHeader>
        <div className="design-system-screen-stack">
          <ScreenShell
            className="is-report-shell"
            icon={BarChart2}
            title="Reports"
            subtitle="Coverage dashboard shell"
            actions={
              <>
                <button className="design-system-button" type="button">
                  <RefreshCw size={16} aria-hidden="true" />
                  Refresh
                </button>
                <button className="design-system-button" type="button">
                  <SlidersHorizontal size={16} aria-hidden="true" />
                  Filters
                </button>
                <button
                  className="design-system-button is-primary"
                  type="button"
                >
                  <Plus size={16} aria-hidden="true" />
                  Enrich selected
                </button>
              </>
            }
          >
            <div className="design-system-screen-grid is-report">
              <section className="design-system-screen-panel is-report-content">
                <div className="design-system-screen-toolbar">
                  <label className="design-system-screen-search">
                    <Search size={18} aria-hidden="true" />
                    <input
                      defaultValue=""
                      placeholder="Search collections..."
                    />
                  </label>
                  <div className="design-system-mini-pills">
                    <span>Spanish</span>
                    <span>Missing subtitles</span>
                    <span>Series</span>
                  </div>
                </div>
                <div className="design-system-screen-stat-grid">
                  <article className="design-system-screen-stat">
                    <span>Collections</span>
                    <strong>128</strong>
                  </article>
                  <article className="design-system-screen-stat">
                    <span>Eligible videos</span>
                    <strong>2,904</strong>
                  </article>
                  <article className="design-system-screen-stat">
                    <span>Selected</span>
                    <strong>74</strong>
                  </article>
                </div>
                <div className="design-system-screen-list">
                  <article className="design-system-screen-list-row">
                    <span className="design-system-screen-thumb" />
                    <div className="design-system-screen-list-copy">
                      <strong>Jesus Film</strong>
                      <span>74 videos ready for subtitle review</span>
                    </div>
                    <span className="design-system-badge is-active">46%</span>
                  </article>
                  <article className="design-system-screen-list-row">
                    <span className="design-system-screen-thumb" />
                    <div className="design-system-screen-list-copy">
                      <strong>Stories of Hope</strong>
                      <span>32 videos missing AI subtitles</span>
                    </div>
                    <span className="design-system-badge is-pending">28%</span>
                  </article>
                  <article className="design-system-screen-list-row is-selected">
                    <span className="design-system-screen-thumb" />
                    <div className="design-system-screen-list-copy">
                      <strong>Walking with Jesus</strong>
                      <span>18 videos with partial language coverage</span>
                    </div>
                    <span className="design-system-badge is-running">63%</span>
                  </article>
                </div>
              </section>

              <aside className="design-system-screen-panel is-inspector">
                <div className="design-system-screen-panel-heading">
                  <strong>Selected collection</strong>
                  <span>Walking with Jesus</span>
                </div>
                <div className="design-system-coverage-bar">
                  <div aria-label="Coverage demo">
                    <span style={{ width: "63%" }} />
                    <span style={{ width: "21%" }} />
                    <span style={{ width: "16%" }} />
                  </div>
                  <dl>
                    <div>
                      <dt>Verified</dt>
                      <dd>63%</dd>
                    </div>
                    <div>
                      <dt>AI</dt>
                      <dd>21%</dd>
                    </div>
                    <div>
                      <dt>None</dt>
                      <dd>16%</dd>
                    </div>
                  </dl>
                </div>
                <div className="design-system-screen-placeholder is-tall" />
                <div className="design-system-mini-pills">
                  <span>Subtitle health</span>
                  <span>Language reach</span>
                  <span>Collection notes</span>
                </div>
              </aside>
            </div>
          </ScreenShell>

          <ScreenShell
            icon={ListChecks}
            title="Jobs"
            subtitle="Execution queue and detail shell"
            actions={
              <>
                <button className="design-system-button" type="button">
                  <RefreshCw size={16} aria-hidden="true" />
                  Poll
                </button>
                <button
                  className="design-system-button is-primary"
                  type="button"
                >
                  <Plus size={16} aria-hidden="true" />
                  New job
                </button>
              </>
            }
          >
            <div className="design-system-screen-grid is-jobs">
              <section className="design-system-screen-panel">
                <div className="design-system-screen-stat-grid">
                  <article className="design-system-screen-stat">
                    <span>Queued</span>
                    <strong>12</strong>
                  </article>
                  <article className="design-system-screen-stat">
                    <span>Running</span>
                    <strong>4</strong>
                  </article>
                  <article className="design-system-screen-stat">
                    <span>Failed</span>
                    <strong>1</strong>
                  </article>
                </div>
                <div className="design-system-screen-table">
                  <div className="design-system-screen-table-row is-head">
                    <span>Job</span>
                    <span>Languages</span>
                    <span>Status</span>
                    <span>Updated</span>
                  </div>
                  <div className="design-system-screen-table-row">
                    <strong>job_7yD2Q9pL</strong>
                    <span>Spanish, French</span>
                    <span className="design-system-badge is-running">
                      Running
                    </span>
                    <span>2m ago</span>
                  </div>
                  <div className="design-system-screen-table-row is-selected">
                    <strong>job_7yD2QXb4</strong>
                    <span>Arabic</span>
                    <span className="design-system-badge is-pending">
                      Queued
                    </span>
                    <span>6m ago</span>
                  </div>
                  <div className="design-system-screen-table-row">
                    <strong>job_7yD2Qfa1</strong>
                    <span>German, Hindi</span>
                    <span className="design-system-badge is-completed">
                      Completed
                    </span>
                    <span>19m ago</span>
                  </div>
                </div>
              </section>

              <aside className="design-system-screen-panel">
                <div className="design-system-screen-panel-heading">
                  <strong>Selected job</strong>
                  <span>job_7yD2QXb4</span>
                </div>
                <div className="design-system-screen-step-list">
                  <article className="design-system-screen-step-row">
                    <div>
                      <strong>Ingest and validate</strong>
                      <span>Mux asset ready</span>
                    </div>
                    <StepGlyph status="completed" />
                  </article>
                  <article className="design-system-screen-step-row">
                    <div>
                      <strong>Generate subtitles</strong>
                      <span>Waiting for worker slot</span>
                    </div>
                    <StepGlyph status="pending" />
                  </article>
                  <article className="design-system-screen-step-row">
                    <div>
                      <strong>Create metadata</strong>
                      <span>Dependent on subtitles</span>
                    </div>
                    <StepGlyph status="skipped" />
                  </article>
                </div>
                <div className="design-system-screen-placeholder" />
              </aside>
            </div>
          </ScreenShell>

          <ScreenShell
            icon={Captions}
            title="Review"
            subtitle="Artifact QA and compare shell"
            actions={
              <>
                <button className="design-system-button" type="button">
                  <ExternalLink size={16} aria-hidden="true" />
                  Open artifact
                </button>
                <button
                  className="design-system-button is-primary"
                  type="button"
                >
                  Approve
                </button>
              </>
            }
          >
            <div className="design-system-screen-grid is-review">
              <section className="design-system-screen-stage">
                <div className="design-system-screen-video" />
                <div className="design-system-player-bar">
                  <button type="button" aria-label="Play">
                    <Plus size={18} aria-hidden="true" />
                  </button>
                  <span>1:38</span>
                  <div>
                    <span style={{ width: "41%" }} />
                  </div>
                  <span>6:00</span>
                </div>
                <div className="design-system-screen-chapter-strip">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </section>

              <aside className="design-system-screen-panel">
                <div className="design-system-screen-card">
                  <strong>Metadata</strong>
                  <p>Title, summary, tags, themes, and safety notes.</p>
                  <div className="design-system-mini-pills">
                    <span>Hope</span>
                    <span>Discipleship</span>
                    <span>Family</span>
                  </div>
                </div>
                <div className="design-system-screen-card">
                  <strong>Compare panels</strong>
                  <p>Mux subtitles, generated tracks, and CMS sync state.</p>
                  <div className="design-system-screen-split">
                    <div className="design-system-screen-placeholder" />
                    <div className="design-system-screen-placeholder" />
                  </div>
                </div>
                <div className="design-system-screen-card">
                  <strong>QA checklist</strong>
                  <div className="design-system-screen-checklist">
                    <span>Subtitle timing</span>
                    <span>Speaker names</span>
                    <span>Publishing notes</span>
                  </div>
                </div>
              </aside>
            </div>
          </ScreenShell>

          <ScreenShell
            icon={Bot}
            title="Agents"
            subtitle="Automation manager shell"
            actions={
              <>
                <button className="design-system-button" type="button">
                  <Clock3 size={16} aria-hidden="true" />
                  Run now
                </button>
                <button
                  className="design-system-button is-primary"
                  type="button"
                >
                  <Plus size={16} aria-hidden="true" />
                  New automation
                </button>
              </>
            }
          >
            <div className="design-system-screen-grid is-agents">
              <section className="design-system-screen-panel">
                <div className="design-system-screen-tabs" role="tablist">
                  <button className="is-active" type="button">
                    Active
                  </button>
                  <button type="button">Paused</button>
                  <button type="button">Templates</button>
                </div>
                <div className="design-system-screen-list">
                  <article className="design-system-screen-list-row">
                    <span className="design-system-screen-thumb" />
                    <div className="design-system-screen-list-copy">
                      <strong>Missing subtitles</strong>
                      <span>Every day at 9:00 AM · cap 12</span>
                    </div>
                    <span className="design-system-badge is-active">
                      Active
                    </span>
                  </article>
                  <article className="design-system-screen-list-row">
                    <span className="design-system-screen-thumb" />
                    <div className="design-system-screen-list-copy">
                      <strong>Metadata refresh</strong>
                      <span>Weekdays · English and Spanish</span>
                    </div>
                    <span className="design-system-badge is-active">
                      Active
                    </span>
                  </article>
                  <article className="design-system-screen-list-row">
                    <span className="design-system-screen-thumb" />
                    <div className="design-system-screen-list-copy">
                      <strong>Scene sync audit</strong>
                      <span>Paused after last failed run</span>
                    </div>
                    <span className="design-system-badge is-paused">
                      Paused
                    </span>
                  </article>
                </div>
              </section>

              <aside className="design-system-screen-panel">
                <div className="design-system-screen-card">
                  <strong>Automation detail</strong>
                  <p>Schedule, refresh rules, target languages, and run cap.</p>
                  <div className="design-system-screen-form-grid">
                    <div className="design-system-screen-placeholder" />
                    <div className="design-system-screen-placeholder" />
                    <div className="design-system-screen-placeholder" />
                    <div className="design-system-screen-placeholder" />
                  </div>
                </div>
                <div className="design-system-screen-card">
                  <strong>Recent runs</strong>
                  <div className="design-system-screen-checklist">
                    <span>Success · 14m ago</span>
                    <span>Success · Yesterday</span>
                    <span>Failed · 2 days ago</span>
                  </div>
                </div>
              </aside>
            </div>
          </ScreenShell>
        </div>
      </section>

      <section className="design-system-section">
        <SectionHeader eyebrow="02" title="Foundations">
          Core type, surface, status, and spacing decisions for the
          authenticated Studio dashboard.
        </SectionHeader>
        <div className="design-system-grid is-three">
          <DemoCard title="Type scale">
            <div className="design-system-type-stack">
              <div>
                <span>Page title</span>
                <strong>Jobs</strong>
              </div>
              <div>
                <span>Section title</span>
                <b>Step execution</b>
              </div>
              <div>
                <span>Body copy</span>
                <p>
                  Inspect generated enrichment outputs against the current live
                  state.
                </p>
              </div>
              <code>job_7yD2Q9pL</code>
            </div>
          </DemoCard>
          <DemoCard title="Status badges">
            <div className="design-system-swatch-row">
              {statusBadges.map((status) => (
                <span
                  key={status}
                  className={`design-system-badge is-${status}`}
                >
                  {status}
                </span>
              ))}
            </div>
          </DemoCard>
          <DemoCard title="Surface rhythm">
            <div className="design-system-surface-stack">
              <div className="design-system-surface-row">Primary panel</div>
              <div className="design-system-surface-row is-muted">
                Muted row state
              </div>
              <div className="design-system-surface-row is-selected">
                Selected state
              </div>
            </div>
          </DemoCard>
        </div>
      </section>

      <section className="design-system-section">
        <SectionHeader eyebrow="03" title="Navigation and actions">
          Header tabs, pills, primary actions, refresh affordances, icon-only
          actions, and segmented controls.
        </SectionHeader>
        <div className="design-system-grid">
          <DemoCard title="Tabs">
            <div className="design-system-tabs" role="tablist">
              <button className="is-active" type="button">
                <BarChart2 size={17} aria-hidden="true" />
                Report
              </button>
              <button type="button">
                <ListChecks size={17} aria-hidden="true" />
                Jobs
                <span>12</span>
              </button>
              <button type="button">
                <Bot size={17} aria-hidden="true" />
                Agents
              </button>
              <button type="button">
                <LayoutTemplate size={17} aria-hidden="true" />
                System
              </button>
            </div>
          </DemoCard>
          <DemoCard title="Buttons">
            <div className="design-system-action-row">
              <button className="design-system-button is-primary" type="button">
                <Plus size={18} aria-hidden="true" />
                Start job
              </button>
              <button className="design-system-button is-active" type="button">
                Selected
              </button>
              <button className="design-system-button" type="button">
                Pause
              </button>
              <button className="design-system-button" type="button" disabled>
                Disabled
              </button>
              <button className="design-system-button" type="button">
                <RefreshCw size={16} aria-hidden="true" />
                Refresh
              </button>
              <button
                className="design-system-icon-button"
                type="button"
                aria-label="Open external link"
              >
                <ExternalLink size={17} aria-hidden="true" />
              </button>
            </div>
          </DemoCard>
          <DemoCard title="Segmented controls">
            <div className="design-system-control-stack">
              <div className="design-system-segmented">
                <button type="button" className="is-active">
                  <LayoutGrid size={16} aria-hidden="true" />
                  Grid
                </button>
                <button type="button">
                  <List size={16} aria-hidden="true" />
                  List
                </button>
              </div>
              <div className="design-system-segmented is-loose">
                <button type="button" className="is-active">
                  After
                </button>
                <button type="button">Before</button>
              </div>
            </div>
          </DemoCard>
          <DemoCard title="Prompt bar">
            <div className="design-system-prompt-bar">
              <div className="design-system-prompt-tags">
                <span>
                  <SlidersHorizontal size={15} aria-hidden="true" />
                  Missing subtitles
                </span>
                <span>
                  <Languages size={15} aria-hidden="true" />
                  Spanish
                </span>
                <span>
                  <Clock3 size={15} aria-hidden="true" />
                  Daily
                </span>
              </div>
              <p>Create a recurring enrichment job for eligible videos.</p>
              <button type="button" aria-label="Submit prompt">
                <Plus size={20} aria-hidden="true" />
              </button>
            </div>
          </DemoCard>
        </div>
      </section>

      <section className="design-system-section">
        <SectionHeader eyebrow="04" title="Forms and filters">
          Inputs, selects, checkboxes, fieldsets, search shells, and selected
          language chips.
        </SectionHeader>
        <div className="design-system-search-row">
          <label>
            <Search size={24} aria-hidden="true" />
            <span className="sr-only">Search components</span>
            <input defaultValue="" placeholder="Search components..." />
          </label>
          <button type="button" aria-label="Grid view">
            <LayoutGrid size={22} aria-hidden="true" />
          </button>
          <button type="button" aria-label="List view">
            <List size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="design-system-filter-row">
          <button type="button">
            <Plus size={16} aria-hidden="true" />
            Created by
          </button>
          <button type="button" className="is-active">
            <Plus size={16} aria-hidden="true" />
            Language
          </button>
          <button type="button" disabled>
            <Plus size={16} aria-hidden="true" />
            Workflow state
          </button>
          <button type="button" className="is-muted">
            <Settings2 size={16} aria-hidden="true" />
            Automations have a new home
          </button>
        </div>
        <div className="design-system-grid">
          <DemoCard title="Job form">
            <form className="design-system-form" action="#">
              <label>
                <span>Mux asset ID</span>
                <input defaultValue="mux_asset_123" />
              </label>
              <label>
                <span>Languages</span>
                <input defaultValue="es, fr, de" />
              </label>
              <div className="design-system-checks">
                <label>
                  <input type="checkbox" defaultChecked /> Generate voiceover
                </label>
                <label>
                  <input type="checkbox" /> Upload to Mux
                </label>
                <label>
                  <input type="checkbox" /> Notify CMS
                </label>
              </div>
            </form>
          </DemoCard>
          <DemoCard title="Language selector">
            <div className="design-system-selector-panel">
              <label>
                <Search size={18} aria-hidden="true" />
                <input defaultValue="Spanish" aria-label="Search languages" />
              </label>
              <div>
                <button type="button">
                  Spanish <X size={14} aria-hidden="true" />
                </button>
                <button type="button">
                  French <X size={14} aria-hidden="true" />
                </button>
              </div>
              <button className="design-system-button is-primary" type="button">
                Apply languages
              </button>
            </div>
          </DemoCard>
        </div>
      </section>

      <section className="design-system-section">
        <SectionHeader eyebrow="05" title="Coverage patterns">
          The report surface uses compact indicators so operators can scan many
          collections quickly.
        </SectionHeader>
        <div className="design-system-grid is-three">
          <DemoCard title="Coverage bar">
            <div className="design-system-coverage-bar">
              <div aria-label="Coverage demo">
                <span style={{ width: "46%" }} />
                <span style={{ width: "28%" }} />
                <span style={{ width: "26%" }} />
              </div>
              <dl>
                <div>
                  <dt>Verified</dt>
                  <dd>46%</dd>
                </div>
                <div>
                  <dt>AI</dt>
                  <dd>28%</dd>
                </div>
                <div>
                  <dt>None</dt>
                  <dd>26%</dd>
                </div>
              </dl>
            </div>
          </DemoCard>
          <DemoCard title="Tiles">
            <div className="design-system-tile-strip">
              <span className="is-human" />
              <span className="is-ai" />
              <span className="is-none" />
              <span className="is-partial" />
              <span className="is-selected">
                <Check size={16} aria-hidden="true" />
              </span>
            </div>
          </DemoCard>
          <DemoCard title="Collection row">
            <article className="design-system-list-row">
              <Image
                alt=""
                aria-hidden="true"
                height={36}
                src="/jesusfilm-sign.svg"
                width={49}
              />
              <div>
                <strong>Jesus Film</strong>
                <span>74 videos - Spanish report</span>
              </div>
              <span className="design-system-badge is-active">series</span>
            </article>
          </DemoCard>
        </div>
      </section>

      <section className="design-system-section">
        <SectionHeader eyebrow="06" title="Jobs and review">
          Job list rows, workflow step diagnostics, artifact links, review
          panels, and compare states.
        </SectionHeader>
        <div className="design-system-grid">
          <DemoCard title="Jobs table">
            <div className="design-system-table-frame">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Source</th>
                    <th>Languages</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>9:42 AM</td>
                    <td>Life of Jesus</td>
                    <td>
                      <div className="design-system-mini-pills">
                        <span>Spanish</span>
                        <span>French</span>
                      </div>
                    </td>
                    <td>
                      <div className="design-system-progress-dots">
                        <span className="is-done" />
                        <span className="is-done" />
                        <span className="is-live" />
                        <span />
                      </div>
                    </td>
                  </tr>
                  <tr className="is-selected">
                    <td>9:47 AM</td>
                    <td>Stories of Hope</td>
                    <td>
                      <div className="design-system-mini-pills">
                        <span>Arabic</span>
                      </div>
                    </td>
                    <td>
                      <div className="design-system-progress-dots">
                        <span className="is-done" />
                        <span className="is-live" />
                        <span />
                        <span />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </DemoCard>
          <DemoCard title="Step row">
            <article className="design-system-step-row">
              <FileAudio2 size={24} aria-hidden="true" />
              <div>
                <strong>Transcription</strong>
                <span>Final provider: ElevenLabs. 2 attempts.</span>
              </div>
              <a href="#artifact">
                <ExternalLink size={14} aria-hidden="true" />
                transcript.json
              </a>
              <StepGlyph status="running" />
            </article>
          </DemoCard>
          <DemoCard title="Review panels">
            <div className="design-system-review-grid">
              <section>
                <header>
                  <FileJson2 size={16} aria-hidden="true" />
                  <h4>Metadata</h4>
                </header>
                <p>Jesus meets a crowd in their own language.</p>
                <div className="design-system-mini-pills">
                  <span>hope</span>
                  <span>discipleship</span>
                </div>
              </section>
              <section>
                <header>
                  <Network size={16} aria-hidden="true" />
                  <h4>Compare status</h4>
                </header>
                <dl>
                  <div>
                    <dt>Mux subtitles</dt>
                    <dd>override pending</dd>
                  </div>
                  <div>
                    <dt>Scene embeddings</dt>
                    <dd>not reported</dd>
                  </div>
                </dl>
              </section>
            </div>
          </DemoCard>
          <DemoCard title="Player bar">
            <div className="design-system-player-bar">
              <Image
                alt=""
                aria-hidden="true"
                height={44}
                src="/World_map_with_points.svg"
                width={64}
              />
              <button type="button" aria-label="Play">
                <Plus size={20} aria-hidden="true" />
              </button>
              <span>1:38</span>
              <div>
                <span style={{ width: "26%" }} />
              </div>
              <span>6:00</span>
            </div>
          </DemoCard>
        </div>
      </section>

      <section className="design-system-section">
        <SectionHeader eyebrow="07" title="Agents and feedback">
          Automation rows, run history, modal chrome, success messages, warning
          pills, and empty states.
        </SectionHeader>
        <div className="design-system-grid">
          <DemoCard title="Automation row">
            <article className="design-system-automation-row">
              <div>
                <strong>Missing metadata</strong>
                <span>Missing metadata - Every minute - cap 1</span>
              </div>
              <span className="design-system-badge is-active">Active</span>
              <dl>
                <div>
                  <dt>Refresh</dt>
                  <dd>Missing only</dd>
                </div>
                <div>
                  <dt>Next run</dt>
                  <dd>Apr 14, 9:00 AM</dd>
                </div>
                <div>
                  <dt>Last result</dt>
                  <dd>success</dd>
                </div>
              </dl>
            </article>
          </DemoCard>
          <DemoCard title="Modal">
            <section className="design-system-modal-demo">
              <header>
                <div>
                  <h3>New automation</h3>
                  <p>Create recurring enrichment work for eligible videos.</p>
                </div>
                <button type="button">
                  <X size={18} aria-hidden="true" />
                </button>
              </header>
              <div>
                <label>
                  <span>Name</span>
                  <input defaultValue="Missing subtitles" />
                </label>
                <label>
                  <span>Schedule</span>
                  <select defaultValue="daily">
                    <option value="daily">Daily at 9:00 AM</option>
                  </select>
                </label>
              </div>
            </section>
          </DemoCard>
          <DemoCard title="Feedback">
            <div className="design-system-feedback-stack">
              <p className="is-success">Automation created.</p>
              <p className="is-error">Subtitle sync override failed.</p>
              <span>
                Spanish selected
                <button type="button">Clear</button>
              </span>
              <div>
                <Wand2 size={22} aria-hidden="true" />
                <strong>Review context unavailable</strong>
                <p>This job does not have generated artifacts yet.</p>
              </div>
            </div>
          </DemoCard>
          <DemoCard title="Upload empty state">
            <div className="design-system-upload-state">
              <Upload size={26} aria-hidden="true" />
              <strong>Click to upload, or drag and drop</strong>
              <p>Audio or video files up to 50MB each</p>
              <button type="button">
                <Mic2 size={17} aria-hidden="true" />
                Record audio
              </button>
            </div>
          </DemoCard>
        </div>
      </section>

      <section className="design-system-section" id="components">
        <SectionHeader eyebrow="08" title="Component inventory">
          Current UI components and the files that own behavior.
        </SectionHeader>
        <SourceTable />
      </section>

      <section className="design-system-usage-note">
        <Captions size={18} aria-hidden="true" />
        <div>
          <h2>Usage notes</h2>
          <p>
            Prefer these existing components and behavior owners before adding
            new primitives. Keep new Studio UI close to this monochrome
            workspace language.
          </p>
        </div>
      </section>
    </div>
  )
}
