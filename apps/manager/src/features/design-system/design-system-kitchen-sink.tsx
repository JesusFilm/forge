"use client"

import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Download,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
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
import {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper"

const swatches = [
  ["Background", "bg-background", "var(--ds-bg)"],
  ["Card", "bg-card", "var(--ds-panel)"],
  ["Secondary", "bg-secondary", "var(--ds-panel-muted)"],
  ["Accent", "bg-accent", "var(--ds-hover)"],
  ["Ink", "bg-foreground", "var(--ds-ink)"],
  ["Brand red", "bg-[color:var(--ds-brand-red)]", "var(--ds-brand-red)"],
  ["Success", "bg-[color:var(--ds-success)]", "var(--ds-success)"],
]

const utilityRows = [
  "flex items-center justify-between gap-3",
  "grid grid-cols-1 gap-3 md:grid-cols-3",
  "rounded-xl border border-border bg-card p-4",
  "shadow-[0_8px_22px_rgba(8,8,8,0.05)]",
  "text-muted-foreground hover:text-foreground",
  "focus-visible:ring-4 focus-visible:ring-black/10",
]

export function DesignSystemKitchenSink() {
  return (
    <div className="studio-page flex flex-col gap-6">
      <PageIntro
        actions={
          <>
            <Button variant="soft" size="md">
              <SlidersHorizontal aria-hidden="true" />
              Tokens
            </Button>
            <Button variant="primary" size="md">
              <Save aria-hidden="true" />
              Save
            </Button>
          </>
        }
      >
        <PageEyebrow>Hidden design system</PageEyebrow>
        <PageTitle>Kitchen Sink</PageTitle>
        <PageDescription>
          Manager Tailwind tokens, reusable UI primitives, form states, tables,
          feedback, layout utilities, and native elements on one protected page.
        </PageDescription>
      </PageIntro>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
                Typography
              </h2>
              <p className="text-sm text-muted-foreground">
                Scale, weight, color, link, inline code, and supporting copy.
              </p>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div>
              <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Eyebrow
              </p>
              <h1 className="mt-2 text-[42px] leading-none font-semibold tracking-[-0.03em] text-foreground">
                Studio operator surface
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-6 text-muted-foreground">
                The manager UI favors dense but calm operational layouts with
                clear scan paths, warm neutrals, compact controls, and explicit
                status language.
              </p>
            </div>

            <div className="grid gap-2 text-sm text-foreground sm:grid-cols-2">
              <p>
                Body text with an{" "}
                <a className="font-medium text-foreground underline" href="#">
                  inline link
                </a>{" "}
                and <code>inline-code</code>.
              </p>
              <p className="text-muted-foreground">
                Muted supporting text for descriptions, metadata, helper text,
                and secondary table values.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              Tokens
            </h2>
            <p className="text-sm text-muted-foreground">
              Tailwind theme entries mapped to Manager CSS variables.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {swatches.map(([label, className, token]) => (
              <div className="flex items-center gap-3" key={label}>
                <span
                  aria-hidden="true"
                  className={`size-10 rounded-xl border border-border ${className}`}
                />
                <span className="min-w-0">
                  <strong className="block text-sm text-foreground">
                    {label}
                  </strong>
                  <code className="block truncate text-xs text-muted-foreground">
                    {token}
                  </code>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              Buttons
            </h2>
            <p className="text-sm text-muted-foreground">
              Variants, icon buttons, disabled states, and action density.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="primary">
                <Plus aria-hidden="true" />
                Create job
              </Button>
              <Button variant="outline">
                <Upload aria-hidden="true" />
                Upload
              </Button>
              <Button variant="soft">
                <Play aria-hidden="true" />
                Run
              </Button>
              <Button variant="ghost">
                <Download aria-hidden="true" />
                Export
              </Button>
              <Button variant="danger">
                <Trash2 aria-hidden="true" />
                Delete
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button aria-label="Search" size="icon">
                <Search aria-hidden="true" />
              </Button>
              <Button aria-label="Loading" disabled size="icon">
                <LoaderCircle aria-hidden="true" />
              </Button>
              <Button disabled>Disabled</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              Badges
            </h2>
            <p className="text-sm text-muted-foreground">
              Status, tone, and compact metadata labels.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>Neutral</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="pending">Pending</Badge>
              <Badge variant="success">Complete</Badge>
              <Badge variant="danger">Needs review</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Queued", Clock3, "text-muted-foreground"],
                ["Healthy", Check, "text-[color:var(--ds-success)]"],
                ["Blocked", AlertCircle, "text-[color:var(--ds-brand-red)]"],
              ].map(([label, Icon, className]) => (
                <div
                  className="flex items-center gap-3 rounded-xl border border-border bg-secondary p-3"
                  key={label as string}
                >
                  <Icon
                    aria-hidden="true"
                    className={className as string}
                    size={18}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {label as string}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              Forms
            </h2>
            <p className="text-sm text-muted-foreground">
              Inputs, selects, textareas, checks, radios, toggles, and range.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Job name
              <Input defaultValue="Subtitle coverage sweep" />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-foreground">
                Language
                <select className="h-10 rounded-[16px] border border-border bg-card px-4 text-[13px] text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.04)] outline-none focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-black/12">
                  <option>English</option>
                  <option>Spanish</option>
                  <option>Arabic</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-foreground">
                Priority
                <Input defaultValue="P1" />
              </label>
            </div>

            <label className="grid gap-2 text-sm font-medium text-foreground">
              Notes
              <textarea
                className="min-h-24 rounded-[16px] border border-border bg-white px-4 py-3 text-[13px] text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.04)] outline-none placeholder:text-muted-foreground/70 focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-black/12"
                defaultValue="Inspect subtitles, metadata, and audio artifacts before approval."
              />
            </label>

            <div className="flex flex-wrap gap-4 text-sm text-foreground">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" defaultChecked />
                Auto-refresh
              </label>
              <label className="inline-flex items-center gap-2">
                <input name="mode" type="radio" defaultChecked />
                Live
              </label>
              <label className="inline-flex items-center gap-2">
                <input name="mode" type="radio" />
                Dry run
              </label>
            </div>

            <label className="grid gap-2 text-sm font-medium text-foreground">
              Confidence threshold
              <input defaultValue="65" max="100" min="0" type="range" />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              Controls
            </h2>
            <p className="text-sm text-muted-foreground">
              Segmented controls, menus, steppers, and focused affordances.
            </p>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SegmentedControl>
              <SegmentedControlButton active>Explore</SegmentedControlButton>
              <SegmentedControlButton>Select</SegmentedControlButton>
              <SegmentedControlButton disabled>Locked</SegmentedControlButton>
            </SegmentedControl>

            <button
              className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground shadow-[0_1px_2px_rgba(8,8,8,0.05)]"
              type="button"
            >
              Report selector
              <ChevronDown aria-hidden="true" size={16} />
            </button>

            <Stepper defaultValue={2}>
              <StepperNav>
                {[1, 2, 3].map((step) => (
                  <StepperItem completed={step === 1} key={step} step={step}>
                    <StepperTrigger>
                      <StepperIndicator>{step}</StepperIndicator>
                      <span>
                        <StepperTitle>
                          {step === 1
                            ? "Ingest"
                            : step === 2
                              ? "Review"
                              : "Publish"}
                        </StepperTitle>
                        <StepperDescription>
                          {step === 1
                            ? "Ready"
                            : step === 2
                              ? "Active"
                              : "Waiting"}
                        </StepperDescription>
                      </span>
                    </StepperTrigger>
                    {step < 3 ? <StepperSeparator /> : null}
                  </StepperItem>
                ))}
              </StepperNav>
              <StepperPanel>
                <StepperContent value={2}>
                  <div className="rounded-xl border border-border bg-secondary p-3 text-sm text-foreground">
                    Review panel content with active step state.
                  </div>
                </StepperContent>
              </StepperPanel>
            </Stepper>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              Tables
            </h2>
            <p className="text-sm text-muted-foreground">
              Dense row scanning, status badges, numeric columns, and actions.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-secondary text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Asset</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Language</th>
                    <th className="px-4 py-3 text-right font-medium">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {[
                    ["JESUS Film", "Complete", "English", "98%"],
                    ["Magdalena", "Pending", "Spanish", "71%"],
                    ["Short Film", "Needs review", "Arabic", "42%"],
                  ].map(([asset, status, language, score]) => (
                    <tr key={asset}>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {asset}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            status === "Complete"
                              ? "success"
                              : status === "Pending"
                                ? "pending"
                                : "danger"
                          }
                        >
                          {status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {language}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-foreground">
                        {score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              Feedback
            </h2>
            <p className="text-sm text-muted-foreground">
              Empty, loading, warning, and destructive confirmation states.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-2xl border border-border bg-secondary p-4">
              <p className="font-medium text-foreground">No jobs selected</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Select rows to enable enrichment actions.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin text-muted-foreground"
                size={18}
              />
              <span className="text-sm text-foreground">
                Loading coverage snapshot
              </span>
            </div>
            <div className="rounded-2xl border border-[color:rgba(239,51,64,0.24)] bg-[color:rgba(239,51,64,0.08)] p-4">
              <p className="font-medium text-[color:var(--ds-brand-red)]">
                Publish blocked
              </p>
              <p className="mt-1 text-sm text-foreground">
                Resolve required metadata before syncing to CMS.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              Layout Utilities
            </h2>
            <p className="text-sm text-muted-foreground">
              Common utility strings used by page and component composition.
            </p>
          </CardHeader>
          <CardContent className="grid gap-2">
            {utilityRows.map((utility) => (
              <code
                className="block rounded-xl border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground"
                key={utility}
              >
                {utility}
              </code>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">
              Native Elements
            </h2>
            <p className="text-sm text-muted-foreground">
              Unclassed elements reveal browser defaults and global reset
              behavior.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 rounded-2xl border border-dashed border-border bg-background p-4">
              <h1>Raw heading one</h1>
              <h2>Raw heading two</h2>
              <p>
                Raw paragraph with <strong>strong</strong>, <em>emphasis</em>,
                and <a href="#">anchor</a>.
              </p>
              <ul>
                <li>Raw unordered item</li>
                <li>Raw unordered item</li>
              </ul>
              <button type="button">Raw button</button>
              <input defaultValue="Raw input" />
              <select defaultValue="raw">
                <option value="raw">Raw select</option>
              </select>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="rounded-3xl border border-border bg-black p-5 text-white shadow-[0_18px_60px_rgba(8,8,8,0.16)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-white/60">Dark surface</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.02em]">
              High-contrast inspection
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline">
              <X aria-hidden="true" />
              Cancel
            </Button>
            <Button variant="primary">
              Continue
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
