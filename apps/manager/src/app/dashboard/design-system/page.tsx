import type { Metadata } from "next"
import Image from "next/image"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import {
  BarChart2,
  Bot,
  Captions,
  Check,
  Clock3,
  Languages,
  ListChecks,
  Mic2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Upload,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  PageDescription,
  PageEyebrow,
  PageIntro,
  PageTitle,
} from "@/components/ui/page-intro"
import {
  SegmentedControl,
  SegmentedControlButton,
} from "@/components/ui/segmented-control"
import { StepperDemo } from "./stepper-demo"
import { DesignSystemReportSwitcher } from "./report-switcher"

export const metadata: Metadata = {
  title: "Design System -- Studio",
}

const sourceComponents = [
  {
    name: "Manager shell",
    role: "Shared Studio shell, navigation, breadcrumbs, mode switch, and profile menu.",
    path: "apps/manager/src/features/shell/manager-shell.tsx",
  },
  {
    name: "Coverage report",
    role: "Coverage intro, diagram, language selector, collection browser, and preview panel.",
    path: "apps/manager/src/features/coverage/coverage-report-client.tsx",
  },
  {
    name: "Language selector",
    role: "Geo-aware search, selected-language pills, and confirmation actions.",
    path: "apps/manager/src/features/coverage/LanguageGeoSelector.tsx",
  },
  {
    name: "Jobs UI",
    role: "Live jobs list, detail summary, workflow steps, and review surfaces.",
    path: "apps/manager/src/features/jobs",
  },
  {
    name: "Agents UI",
    role: "Automation list, create wizard, cadence controls, and run history.",
    path: "apps/manager/src/features/agents",
  },
  {
    name: "Shared UI primitives",
    role: "Buttons, badges, cards, inputs, segmented controls, modal shell, and stepper.",
    path: "apps/manager/src/components/ui",
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

const productTiles: Array<{
  title: string
  meta: string
  icon: LucideIcon
  image?: string
}> = [
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
    <header className="max-w-3xl space-y-2">
      <span className="block text-[0.82rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {eyebrow}
      </span>
      <h2 className="text-[clamp(1.7rem,4.2vw,2.6rem)] font-semibold leading-[0.98] tracking-[-0.04em] text-foreground">
        {title}
      </h2>
      <p className="text-[0.95rem] leading-6 text-muted-foreground sm:text-[1rem]">
        {children}
      </p>
    </header>
  )
}

function DemoCard({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="border-b border-border/70 pb-4">
        <h3 className="text-[1.05rem] font-semibold tracking-[-0.025em] text-foreground">
          {title}
        </h3>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  )
}

function ScreenFrame({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/70 pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="inline-flex size-12 items-center justify-center rounded-[1.25rem] border border-border bg-secondary/35">
              <Icon className="size-5 text-foreground" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground">
                {title}
              </h3>
              <p className="text-[0.95rem] leading-6 text-muted-foreground">
                {subtitle}
              </p>
            </div>
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-3">{actions}</div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  )
}

function SourceTable() {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-[0_10px_24px_rgba(8,8,8,0.05)]">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-left">
          <thead className="bg-secondary/35">
            <tr className="text-[0.78rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <th className="px-5 py-3">Component</th>
              <th className="px-5 py-3">Use</th>
              <th className="px-5 py-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sourceComponents.map((component) => (
              <tr key={component.path} className="align-top">
                <td className="px-5 py-4 text-[0.95rem] font-semibold tracking-[-0.015em] text-foreground">
                  {component.name}
                </td>
                <td className="px-5 py-4 text-[0.9rem] leading-6 text-muted-foreground">
                  {component.role}
                </td>
                <td className="px-5 py-4">
                  <code className="rounded-xl bg-secondary px-3 py-2 text-[0.82rem] text-foreground">
                    {component.path}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CoverageBarDemo() {
  return (
    <div className="space-y-4">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-secondary">
        <span className="w-[63%] bg-foreground" />
        <span className="w-[21%] bg-muted-foreground" />
        <span className="w-[16%] bg-[color:var(--ds-line)]" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <span className="text-[0.82rem] text-muted-foreground">Verified</span>
          <strong className="text-[1.5rem] font-semibold tracking-[-0.03em] text-foreground">
            63%
          </strong>
        </div>
        <div className="space-y-1">
          <span className="text-[0.82rem] text-muted-foreground">AI</span>
          <strong className="text-[1.5rem] font-semibold tracking-[-0.03em] text-foreground">
            21%
          </strong>
        </div>
        <div className="space-y-1">
          <span className="text-[0.82rem] text-muted-foreground">None</span>
          <strong className="text-[1.5rem] font-semibold tracking-[-0.03em] text-foreground">
            16%
          </strong>
        </div>
      </div>
    </div>
  )
}

export default function DesignSystemPage() {
  return (
    <div className="space-y-12">
      <section className="space-y-8">
        <PageIntro className="border-b-0 pb-0">
          <PageEyebrow>Studio UI</PageEyebrow>
          <PageTitle className="text-[clamp(2.75rem,6vw,4.75rem)]">
            Design system components
          </PageTitle>
          <PageDescription className="max-w-5xl">
            A kitchen sink for the Studio surfaces: coverage reporting, job
            execution, enrichment review, and agent automations.
          </PageDescription>
        </PageIntro>

        <div className="flex flex-wrap gap-2.5">
          {componentGroups.map((group) => (
            <Badge
              key={group}
              variant="outline"
              className="px-3 py-1.5 text-[12px]"
            >
              {group}
            </Badge>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-4">
          {productTiles.map((tile) => {
            const Icon = tile.icon
            return (
              <Card key={tile.title} className="overflow-hidden">
                <CardContent className="space-y-4 pt-6">
                  <div className="relative flex aspect-[1.15/0.78] items-center justify-center overflow-hidden rounded-[1.25rem] border border-border bg-secondary/40">
                    {tile.image ? (
                      <Image
                        alt=""
                        aria-hidden="true"
                        className="object-contain p-6"
                        fill
                        src={tile.image}
                      />
                    ) : (
                      <Icon
                        className="size-10 text-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <span className="absolute right-4 bottom-4 inline-flex size-10 items-center justify-center rounded-full bg-black text-white shadow-[0_10px_24px_rgba(8,8,8,0.2)]">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-[1.45rem] font-semibold tracking-[-0.03em] text-foreground">
                      {tile.title}
                    </h3>
                    <p className="text-[0.95rem] leading-6 text-muted-foreground">
                      {tile.meta}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="space-y-8">
        <SectionHeader eyebrow="Screens" title="Production shells">
          The kitchen sink now points at the same primitive layer used by the
          authenticated shell and the login experience.
        </SectionHeader>

        <div className="grid gap-8">
          <ScreenFrame
            icon={BarChart2}
            title="Report"
            subtitle="Coverage and subtitle health"
            actions={
              <>
                <Button variant="outline">
                  <Search className="size-4" aria-hidden="true" />
                  Search
                </Button>
                <Button variant="primary">
                  <Languages className="size-4" aria-hidden="true" />
                  Select languages
                </Button>
              </>
            }
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div className="space-y-6">
                <div className="rounded-[1.5rem] border border-border bg-secondary/18 p-4">
                  <CoverageBarDemo />
                </div>
                <div className="space-y-4">
                  {[
                    [
                      "Jesus Film",
                      "74 videos ready for subtitle review",
                      "46%",
                    ],
                    [
                      "Stories of Hope",
                      "32 videos missing AI subtitles",
                      "28%",
                    ],
                    [
                      "Walking with Jesus",
                      "18 videos with partial coverage",
                      "63%",
                    ],
                  ].map(([title, meta, percent], index) => (
                    <div
                      key={title}
                      className={`flex items-center gap-4 rounded-[1.25rem] border border-border px-4 py-4 ${index === 2 ? "bg-secondary/28" : "bg-card"}`}
                    >
                      <span className="inline-flex size-14 rounded-[1rem] border border-border bg-secondary/35" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[1.15rem] font-semibold tracking-[-0.03em] text-foreground">
                          {title}
                        </p>
                        <p className="text-[0.95rem] leading-6 text-muted-foreground">
                          {meta}
                        </p>
                      </div>
                      <Badge
                        variant={
                          index === 0
                            ? "success"
                            : index === 1
                              ? "pending"
                              : "outline"
                        }
                        className="px-3 py-1.5 text-[0.9rem]"
                      >
                        {percent}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-l border-border/70 pl-0 xl:pl-8">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-[1.4rem] font-semibold tracking-[-0.03em] text-foreground">
                      Selected collection
                    </p>
                    <p className="text-[1rem] leading-6 text-muted-foreground">
                      Walking with Jesus
                    </p>
                  </div>
                  <CoverageBarDemo />
                  <div className="min-h-[21rem] rounded-[1.5rem] border border-border bg-secondary/25" />
                  <div className="flex flex-wrap gap-2.5">
                    <Badge
                      variant="outline"
                      className="px-3 py-1.5 text-[12px]"
                    >
                      Subtitle health
                    </Badge>
                    <Badge
                      variant="outline"
                      className="px-3 py-1.5 text-[12px]"
                    >
                      Language reach
                    </Badge>
                    <Badge
                      variant="outline"
                      className="px-3 py-1.5 text-[12px]"
                    >
                      Collection notes
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </ScreenFrame>

          <ScreenFrame
            icon={ListChecks}
            title="Jobs"
            subtitle="Live enrichment workflows"
            actions={
              <>
                <Button variant="outline">
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Refresh
                </Button>
                <Button variant="primary">
                  <Plus className="size-4" aria-hidden="true" />
                  New job
                </Button>
              </>
            }
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    ["Queued", "12"],
                    ["Running", "4"],
                    ["Completed", "189"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-[1.25rem] border border-border bg-secondary/18 px-4 py-4"
                    >
                      <p className="text-[0.82rem] uppercase tracking-[0.16em] text-muted-foreground">
                        {label}
                      </p>
                      <p className="mt-2.5 text-[1.6rem] font-semibold tracking-[-0.03em] text-foreground">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="overflow-hidden rounded-[1.5rem] border border-border">
                  <div className="grid grid-cols-[1.6fr_1fr_1fr_0.8fr] gap-4 border-b border-border bg-secondary/30 px-4 py-3 text-[0.78rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    <span>Job</span>
                    <span>Status</span>
                    <span>Languages</span>
                    <span>Retries</span>
                  </div>
                  {[
                    ["Generate subtitles", "running", "es, fr", "1"],
                    ["Sync chapters", "pending", "en", "0"],
                    ["Backfill metadata", "completed", "es", "0"],
                  ].map(([job, status, languages, retries], index) => (
                    <div
                      key={job}
                      className={`grid grid-cols-[1.6fr_1fr_1fr_0.8fr] gap-4 px-4 py-3.5 ${index === 1 ? "bg-secondary/18" : "bg-card"} border-b border-border last:border-b-0`}
                    >
                      <span className="font-medium tracking-[-0.015em] text-foreground">
                        {job}
                      </span>
                      <Badge
                        variant={
                          status === "completed"
                            ? "success"
                            : status === "running"
                              ? "pending"
                              : "outline"
                        }
                        className="w-fit"
                      >
                        {status}
                      </Badge>
                      <span className="text-muted-foreground">{languages}</span>
                      <span className="text-muted-foreground">{retries}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-border bg-card p-5">
                  <p className="text-[1.15rem] font-semibold tracking-[-0.03em] text-foreground">
                    Step diagnostics
                  </p>
                  <div className="mt-4 space-y-3">
                    {[
                      ["Fetch video data", "completed", "Source asset loaded"],
                      [
                        "Run subtitle coverage",
                        "running",
                        "Waiting on providers",
                      ],
                      ["Publish to CMS", "pending", "Queued after enrichment"],
                    ].map(([title, status, detail]) => (
                      <div
                        key={title}
                        className="flex items-start gap-3 rounded-[1rem] border border-border bg-secondary/18 px-3.5 py-3.5"
                      >
                        <Badge
                          variant={
                            status === "completed"
                              ? "success"
                              : status === "running"
                                ? "pending"
                                : "outline"
                          }
                        >
                          {status}
                        </Badge>
                        <div className="space-y-1">
                          <p className="text-[0.95rem] font-medium tracking-[-0.015em] text-foreground">
                            {title}
                          </p>
                          <p className="text-[0.88rem] leading-6 text-muted-foreground">
                            {detail}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="min-h-[9rem] rounded-[1.5rem] border border-border bg-secondary/25" />
              </div>
            </div>
          </ScreenFrame>

          <ScreenFrame
            icon={Captions}
            title="Review"
            subtitle="Generated metadata QA"
            actions={
              <>
                <Button variant="outline">
                  <Clock3 className="size-4" aria-hidden="true" />
                  History
                </Button>
                <Button variant="primary">
                  <Check className="size-4" aria-hidden="true" />
                  Approve changes
                </Button>
              </>
            }
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="space-y-4">
                <div className="aspect-video rounded-[1.5rem] border border-border bg-secondary/28" />
                <div className="rounded-[1.5rem] border border-border bg-card px-4 py-3.5 shadow-[0_10px_24px_rgba(8,8,8,0.05)]">
                  <div className="flex items-center gap-4">
                    <Button
                      variant="primary"
                      size="icon"
                      className="rounded-full"
                    >
                      <Captions className="size-4" aria-hidden="true" />
                    </Button>
                    <div className="h-2 flex-1 rounded-full bg-secondary">
                      <div className="h-full w-[58%] rounded-full bg-foreground" />
                    </div>
                    <span className="text-[0.88rem] font-medium text-muted-foreground">
                      1:38 / 6:00
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-border bg-card p-5">
                  <p className="text-[1.05rem] font-semibold tracking-[-0.03em] text-foreground">
                    Review summary
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="success">ready</Badge>
                    <Badge variant="outline">chapters</Badge>
                    <Badge variant="outline">titles</Badge>
                  </div>
                </div>
                <div className="rounded-[1.5rem] border border-border bg-card p-5">
                  <p className="text-[1.05rem] font-semibold tracking-[-0.03em] text-foreground">
                    Compare panels
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="min-h-[8rem] rounded-[1rem] border border-border bg-secondary/20" />
                    <div className="min-h-[8rem] rounded-[1rem] border border-border bg-secondary/20" />
                  </div>
                </div>
              </div>
            </div>
          </ScreenFrame>

          <ScreenFrame
            icon={Bot}
            title="Agents"
            subtitle="Recurring automation runs"
            actions={
              <>
                <Button variant="outline">
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Refresh
                </Button>
                <Button variant="primary">
                  <Bot className="size-4" aria-hidden="true" />
                  New automation
                </Button>
              </>
            }
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-4">
                <SegmentedControl>
                  <SegmentedControlButton active>Active</SegmentedControlButton>
                  <SegmentedControlButton>Paused</SegmentedControlButton>
                  <SegmentedControlButton>Templates</SegmentedControlButton>
                </SegmentedControl>

                {[
                  ["Translate missing subtitles", "Hourly", "active"],
                  ["Generate missing metadata", "Daily", "active"],
                  ["Voice-over dubbing", "Weekly", "paused"],
                ].map(([title, cadence, status]) => (
                  <div
                    key={title}
                    className="flex items-start gap-4 rounded-[1.25rem] border border-border px-4 py-4"
                  >
                    <span className="inline-flex size-10 items-center justify-center rounded-[0.95rem] border border-border bg-secondary/30">
                      <Bot
                        className="size-4 text-foreground"
                        aria-hidden="true"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[1rem] font-semibold tracking-[-0.02em] text-foreground">
                        {title}
                      </p>
                      <p className="text-[0.88rem] leading-6 text-muted-foreground">
                        {cadence}
                      </p>
                    </div>
                    <Badge
                      variant={status === "active" ? "success" : "pending"}
                    >
                      {status}
                    </Badge>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-[0_16px_36px_rgba(8,8,8,0.08)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[1.45rem] font-semibold tracking-[-0.03em] text-foreground">
                        New automation
                      </p>
                      <p className="mt-2 text-[0.95rem] leading-6 text-muted-foreground">
                        Turn repeatable enrichment work into a durable agent.
                      </p>
                    </div>
                    <Button variant="ghost" size="icon">
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="mt-8">
                    <StepperDemo />
                  </div>
                </div>
              </div>
            </div>
          </ScreenFrame>
        </div>
      </section>

      <section className="space-y-8">
        <SectionHeader eyebrow="Foundations" title="Tokens and primitives">
          Typography, warm neutrals, and clear states stay centralized so the
          production surfaces and the kitchen sink share the same language.
        </SectionHeader>

        <div className="grid gap-6 xl:grid-cols-3">
          <DemoCard title="Typography">
            <div className="space-y-4">
              <div>
                <p className="text-[0.82rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Eyebrow
                </p>
                <p className="mt-2 text-[1.05rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Studio UI
                </p>
              </div>
              <div>
                <p className="text-[0.82rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Title
                </p>
                <p className="mt-2 text-[2.25rem] font-semibold leading-[0.96] tracking-[-0.04em] text-foreground">
                  Design system
                </p>
              </div>
              <div>
                <p className="text-[0.82rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Body
                </p>
                <p className="mt-2 text-[0.95rem] leading-6 text-muted-foreground">
                  Keep layout calm, reduce visual noise, and let actions feel
                  tactile without making the screen busy.
                </p>
              </div>
            </div>
          </DemoCard>

          <DemoCard title="Badges">
            <div className="flex flex-wrap gap-3">
              <Badge variant="outline">outline</Badge>
              <Badge variant="neutral">neutral</Badge>
              <Badge variant="pending">running</Badge>
              <Badge variant="success">completed</Badge>
              <Badge variant="danger">failed</Badge>
            </div>
          </DemoCard>

          <DemoCard title="Surfaces">
            <div className="space-y-3">
              <div className="rounded-[1.25rem] border border-border bg-card px-4 py-4">
                Primary panel
              </div>
              <div className="rounded-[1.25rem] border border-border bg-secondary/30 px-4 py-4">
                Muted panel
              </div>
              <div className="rounded-[1.25rem] border border-black bg-secondary px-4 py-4">
                Selected surface
              </div>
            </div>
          </DemoCard>
        </div>
      </section>

      <section className="space-y-8">
        <SectionHeader
          eyebrow="Controls"
          title="Navigation, buttons, and selectors"
        >
          Shared controls should stay compact, tactile, and easy to scan on both
          mobile and desktop layouts.
        </SectionHeader>

        <div className="grid gap-6 xl:grid-cols-3">
          <DemoCard title="Tabs and segmented controls">
            <div className="space-y-5">
              <SegmentedControl>
                <SegmentedControlButton active>Explore</SegmentedControlButton>
                <SegmentedControlButton>Select</SegmentedControlButton>
              </SegmentedControl>
              <SegmentedControl>
                <SegmentedControlButton active>Active</SegmentedControlButton>
                <SegmentedControlButton>Paused</SegmentedControlButton>
                <SegmentedControlButton>Templates</SegmentedControlButton>
              </SegmentedControl>
            </div>
          </DemoCard>

          <DemoCard title="Buttons">
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">
                <Plus className="size-4" aria-hidden="true" />
                Primary
              </Button>
              <Button variant="outline">Outline</Button>
              <Button variant="soft">Soft</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="outline" size="icon">
                <Settings2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </DemoCard>

          <DemoCard title="Report selector">
            <DesignSystemReportSwitcher />
          </DemoCard>
        </div>
      </section>

      <section className="space-y-8">
        <SectionHeader eyebrow="Forms" title="Inputs, search, and feedback">
          Inputs and prompt bars keep the same shape language as the shell so
          transitions between pages feel continuous.
        </SectionHeader>

        <div className="grid gap-6 xl:grid-cols-3">
          <DemoCard title="Search and filters">
            <div className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-11" placeholder="Search projects..." />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="px-3 py-1.5 text-[12px]">
                  Created by
                </Badge>
                <Badge variant="outline" className="px-3 py-1.5 text-[12px]">
                  Video only
                </Badge>
                <Badge variant="pending" className="px-3 py-1.5 text-[12px]">
                  Audiobooks have a new home
                </Badge>
              </div>
            </div>
          </DemoCard>

          <DemoCard title="Form stack">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[0.88rem] font-medium text-foreground">
                  Email
                </label>
                <Input placeholder="manager@forge.test" />
              </div>
              <div className="space-y-2">
                <label className="text-[0.88rem] font-medium text-foreground">
                  Password
                </label>
                <Input type="password" value="ManagerPass23456A" readOnly />
              </div>
              <Button variant="primary" size="lg" className="w-full">
                Sign in
              </Button>
            </div>
          </DemoCard>

          <DemoCard title="Prompt composer">
            <div className="space-y-4 rounded-[1.5rem] border border-border bg-card p-4 shadow-[0_10px_24px_rgba(8,8,8,0.05)]">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="px-3 py-1.5 text-[12px]">
                  Futuristic cityscape
                </Badge>
                <Badge variant="outline" className="px-3 py-1.5 text-[12px]">
                  Enchanted forest
                </Badge>
                <Badge variant="outline" className="px-3 py-1.5 text-[12px]">
                  Cyberpunk alley
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["Start frame", "End frame", "Image refs"].map((label) => (
                  <div
                    key={label}
                    className="flex min-h-[6rem] items-center justify-center rounded-[1rem] border border-border bg-secondary/30 px-3 text-center text-[0.9rem] text-muted-foreground"
                  >
                    {label}
                  </div>
                ))}
              </div>
              <Input placeholder="Describe your video or reference by using @..." />
              <div className="flex flex-wrap items-center gap-3 text-[0.88rem] text-muted-foreground">
                <span>Veo 3.1 Fast</span>
                <span>16:9</span>
                <span>720p</span>
                <span>4s</span>
                <span>110 left</span>
              </div>
            </div>
          </DemoCard>
        </div>
      </section>

      <section className="space-y-8">
        <SectionHeader
          eyebrow="Data display"
          title="Tables, review, and automation surfaces"
        >
          Production tables and review layouts use the same cards, badges, and
          spacing rules so the system holds together even in denser workflows.
        </SectionHeader>

        <div className="grid gap-6 xl:grid-cols-3">
          <DemoCard title="Jobs table">
            <div className="overflow-hidden rounded-[1.25rem] border border-border">
              <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3 border-b border-border bg-secondary/35 px-4 py-3 text-[0.76rem] uppercase tracking-[0.14em] text-muted-foreground">
                <span>Step</span>
                <span>Status</span>
                <span>Owner</span>
              </div>
              {[
                ["Mux ingest", "running", "Manager"],
                ["Subtitle coverage", "completed", "Coverage"],
                ["CMS sync", "pending", "Automation"],
              ].map(([step, status, owner]) => (
                <div
                  key={step}
                  className="grid grid-cols-[1.4fr_1fr_1fr] gap-3 border-b border-border px-4 py-3.5 last:border-b-0"
                >
                  <span className="font-medium tracking-[-0.015em] text-foreground">
                    {step}
                  </span>
                  <Badge
                    variant={
                      status === "completed"
                        ? "success"
                        : status === "running"
                          ? "pending"
                          : "outline"
                    }
                    className="w-fit"
                  >
                    {status}
                  </Badge>
                  <span className="text-muted-foreground">{owner}</span>
                </div>
              ))}
            </div>
          </DemoCard>

          <DemoCard title="Review player">
            <div className="space-y-4">
              <div className="aspect-[1.25] rounded-[1.25rem] border border-border bg-secondary/30" />
              <div className="rounded-[1.25rem] border border-border bg-card px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <Button
                    variant="primary"
                    size="icon"
                    className="rounded-full"
                  >
                    <Mic2 className="size-4" aria-hidden="true" />
                  </Button>
                  <div className="h-2 flex-1 rounded-full bg-secondary">
                    <div className="h-full w-[40%] rounded-full bg-foreground" />
                  </div>
                  <span className="text-[0.82rem] text-muted-foreground">
                    0:19
                  </span>
                </div>
              </div>
            </div>
          </DemoCard>

          <DemoCard title="Automation feedback">
            <div className="space-y-4">
              <div className="rounded-[1.25rem] border border-border bg-secondary/25 p-4">
                <p className="text-[1rem] font-semibold tracking-[-0.02em] text-foreground">
                  Enrichment queued
                </p>
                <p className="mt-2 text-[0.9rem] leading-6 text-muted-foreground">
                  12 videos were handed off to jobs for subtitle generation and
                  language fill.
                </p>
              </div>
              <div className="rounded-[1.25rem] border border-dashed border-border bg-card px-4 py-6 text-center">
                <Upload
                  className="mx-auto size-7 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mt-3 text-[0.95rem] font-medium tracking-[-0.015em] text-foreground">
                  Drag files here
                </p>
                <p className="mt-2 text-[0.88rem] leading-6 text-muted-foreground">
                  Audio or video files up to 50MB each
                </p>
              </div>
            </div>
          </DemoCard>
        </div>
      </section>

      <section className="space-y-8">
        <SectionHeader eyebrow="Reference" title="Implementation map">
          The design system points back to the real manager sources so we can
          keep migrating by touching production components instead of
          duplicating them in demo-only styling.
        </SectionHeader>
        <SourceTable />
      </section>
    </div>
  )
}
