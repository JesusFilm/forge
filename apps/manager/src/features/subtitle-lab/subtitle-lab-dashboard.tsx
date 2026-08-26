"use client"

import {
  AlertTriangle,
  ArrowRight,
  Beaker,
  CheckCircle2,
  Database,
  FileCheck2,
  History,
  Languages,
  Play,
  ShieldCheck,
} from "lucide-react"
import { useMemo, useState, type FormEvent } from "react"

import { apiFetch } from "@/lib/api-fetch"

import { formatSubtitleLabDate } from "./subtitle-lab-operator-presenter"
import {
  SUBTITLE_EVAL_ALLOWED_MODELS,
  SUBTITLE_EVAL_ALLOWED_PROVIDER,
  SUBTITLE_EVAL_PROMPT_POLICY_ID,
  SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST,
} from "./subtitle-lab-policy"
import { SubtitleRunComparison } from "./subtitle-run-comparison"
import { useStableActionKey } from "./stable-action-key"
import type {
  SubtitleLabComparison,
  SubtitleLabCorpusVersion,
  SubtitleLabReferenceIssue,
  SubtitleLabRunSummary,
} from "./subtitle-lab-operator-types"

const PANEL =
  "rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-5 shadow-[0_8px_24px_rgba(17,17,17,0.04)]"
const INPUT =
  "min-h-11 w-full rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-panel)] px-3 py-2 text-sm text-[color:var(--ds-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ds-black)]"
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--ds-radius)] border border-[color:var(--ds-black)] bg-[color:var(--ds-black)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ds-black)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-panel)] px-4 py-2 text-sm font-semibold text-[color:var(--ds-ink)] hover:bg-[color:var(--ds-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ds-black)] disabled:cursor-not-allowed disabled:opacity-45"

const MODEL = SUBTITLE_EVAL_ALLOWED_MODELS[0]
const PROVIDER = SUBTITLE_EVAL_ALLOWED_PROVIDER
const PROMPT_POLICY = SUBTITLE_EVAL_PROMPT_POLICY_ID
const WORKFLOW_POLICY = SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST

type ActionState =
  | { type: "idle" }
  | { type: "busy"; message: string }
  | { type: "success"; message: string }
  | { type: "error"; message: string }

function actionMessage(state: ActionState) {
  if (state.type === "idle") return null
  return (
    <p
      className={`mt-3 text-sm ${state.type === "error" ? "text-[color:var(--ds-danger)]" : "text-[color:var(--ds-muted)]"}`}
      role={state.type === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  )
}

function shortDigest(value: string) {
  return `${value.slice(0, 12)}…${value.slice(-8)}`
}

function statusLabel(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase())
}

function CorpusEvidence({ corpus }: { corpus: SubtitleLabCorpusVersion }) {
  const [state, setState] = useState<ActionState>({ type: "idle" })

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setState({ type: "busy", message: "Recording corpus certification…" })
    const response = await apiFetch(
      `/api/subtitle-lab/corpus/${encodeURIComponent(corpus.id)}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: String(form.get("reason") ?? ""),
          certification: {
            schemaVersion: 1,
            authority: corpus.authority,
            sourceTracksVerified: corpus.cells.length,
            referenceTracksVerified: corpus.cells.length,
            humanAuthorshipConfirmed:
              form.get("humanAuthorshipConfirmed") === "on",
            languageIdentityConfirmed:
              form.get("languageIdentityConfirmed") === "on",
            certifiedAt: String(form.get("certifiedAt") ?? ""),
            notes: String(form.get("notes") ?? "") || null,
          },
        }),
      },
    ).catch(() => null)
    if (!response?.ok) {
      setState({
        type: "error",
        message:
          "Certification was not recorded. The evidence may be incomplete or the ledger unavailable.",
      })
      return
    }
    setState({
      type: "success",
      message: "Corpus certification appended. Reload to see ledger status.",
    })
  }

  return (
    <section className={PANEL} aria-labelledby="subtitle-corpus-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="studio-page-eyebrow">Frozen gold evidence</span>
          <h2 id="subtitle-corpus-title" className="mt-1 text-xl font-semibold">
            Corpus authority
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-[color:var(--ds-muted)]">
            Exact source and human-reference snapshots are content addressed.
            Approval certifies these bytes; it does not publish subtitles.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--ds-line-strong)] px-3 py-1 text-xs font-semibold">
          <Database aria-hidden="true" size={14} /> {corpus.status}
        </span>
      </div>

      <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ds-muted)]">
            Version
          </dt>
          <dd className="mt-1 break-all font-mono text-xs">{corpus.id}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ds-muted)]">
            Corpus identity
          </dt>
          <dd className="mt-1 font-mono text-xs" title={corpus.identityDigest}>
            {shortDigest(corpus.identityDigest)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ds-muted)]">
            Manifest SHA-256
          </dt>
          <dd className="mt-1 break-all font-mono text-xs">
            {corpus.manifestDigest}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ds-muted)]">
            Lock SHA-256
          </dt>
          <dd className="mt-1 break-all font-mono text-xs">
            {corpus.lockDigest}
          </dd>
        </div>
      </dl>

      <div className="mt-5 overflow-x-auto rounded-[var(--ds-radius)] border border-[color:var(--ds-line)]">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-[color:var(--ds-hover)] text-xs uppercase tracking-wide text-[color:var(--ds-muted)]">
            <tr>
              <th className="px-3 py-2">Case / collection</th>
              <th className="px-3 py-2">Exact target language</th>
              <th className="px-3 py-2">Source snapshot</th>
              <th className="px-3 py-2">Human reference snapshot</th>
            </tr>
          </thead>
          <tbody>
            {corpus.cells.map((cell) => (
              <tr
                key={cell.id}
                className="border-t border-[color:var(--ds-line)]"
              >
                <td className="px-3 py-3">
                  <strong>{cell.caseId}</strong>
                  <span className="block text-xs text-[color:var(--ds-muted)]">
                    {cell.collectionKey}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span dir="auto">{cell.targetLanguageSlug}</span>
                  <span className="block font-mono text-xs text-[color:var(--ds-muted)]">
                    {cell.targetLanguageId}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono text-xs">
                  {shortDigest(cell.sourceSnapshotDigest)}
                </td>
                <td className="px-3 py-3 font-mono text-xs">
                  {shortDigest(cell.referenceSnapshotDigest)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {corpus.status === "PROVISIONAL" ? (
        <form
          className="mt-5 border-t border-[color:var(--ds-line)] pt-5"
          onSubmit={approve}
        >
          <div className="flex items-center gap-2">
            <FileCheck2 aria-hidden="true" size={19} />
            <h3 className="font-semibold">Certify exact snapshots</h3>
          </div>
          <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
            A human curator must confirm authorship, exact edition/cut,
            synchronization, target-language identity, and benchmark reuse
            authority before this provisional corpus can launch a run.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="text-sm font-medium">
              Certification timestamp
              <input
                className={`${INPUT} mt-1`}
                name="certifiedAt"
                required
                type="datetime-local"
              />
            </label>
            <label className="text-sm font-medium">
              Approval reason
              <input
                className={`${INPUT} mt-1`}
                maxLength={4000}
                name="reason"
                required
              />
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium">
            Evidence notes
            <textarea
              className={`${INPUT} mt-1 min-h-24`}
              maxLength={4000}
              name="notes"
            />
          </label>
          <div className="mt-4 grid gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                className="mt-1"
                name="humanAuthorshipConfirmed"
                required
                type="checkbox"
              />
              Human authorship, exact edition/cut synchronization, and benchmark
              reuse authority are confirmed.
            </label>
            <label className="flex items-start gap-2">
              <input
                className="mt-1"
                name="languageIdentityConfirmed"
                required
                type="checkbox"
              />
              Every Admin Language.id and Language.slug pair matches the
              certified subtitle language.
            </label>
          </div>
          <button
            className={`${BUTTON} mt-4`}
            disabled={state.type === "busy"}
            type="submit"
          >
            <ShieldCheck aria-hidden="true" size={17} /> Record corpus
            certification
          </button>
          {actionMessage(state)}
        </form>
      ) : (
        <p className="mt-5 flex items-center gap-2 text-sm text-[color:var(--ds-muted)]">
          <CheckCircle2 aria-hidden="true" size={17} /> Approved by{" "}
          {corpus.approvedById ?? "an operator"} on{" "}
          {formatSubtitleLabDate(corpus.approvedAt)}.
        </p>
      )}
    </section>
  )
}

function ImportCorpus() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ActionState>({ type: "idle" })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setState({
      type: "busy",
      message: "Verifying and snapshotting corpus bytes…",
    })
    let languageIdentities: unknown
    try {
      languageIdentities = JSON.parse(
        String(data.get("languageIdentitiesJson")),
      )
    } catch {
      setState({ type: "error", message: "Language identity JSON is invalid." })
      return
    }
    const response = await apiFetch("/api/subtitle-lab/corpus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        manifestJson: String(data.get("manifestJson") ?? ""),
        lockJson: String(data.get("lockJson") ?? ""),
        languageIdentities,
        supersedesVersionId:
          String(data.get("supersedesVersionId") ?? "") || undefined,
      }),
    }).catch(() => null)
    if (!response?.ok) {
      setState({
        type: "error",
        message: "Corpus import was rejected before activation.",
      })
      return
    }
    const result = (await response.json()) as { id?: string }
    setState({
      type: "success",
      message: `Frozen corpus ${result.id ?? "version"} imported. Open it by ID to inspect proof.`,
    })
  }

  return (
    <section className={PANEL} aria-labelledby="subtitle-import-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="studio-page-eyebrow">Versioned seed</span>
          <h2 id="subtitle-import-title" className="mt-1 text-xl font-semibold">
            Import frozen corpus
          </h2>
        </div>
        <button
          className={SECONDARY_BUTTON}
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? "Close import" : "Open import"}
        </button>
      </div>
      <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
        Import verifies the packaged manifest/lock, downloads only allowlisted
        Core VTT URLs, and writes digest-keyed snapshots. It never approves the
        corpus automatically.
      </p>
      {open ? (
        <form className="mt-5 grid gap-4" onSubmit={submit}>
          <label className="text-sm font-medium">
            Manifest JSON
            <textarea
              className={`${INPUT} mt-1 min-h-32 font-mono text-xs`}
              maxLength={128000}
              name="manifestJson"
              required
            />
          </label>
          <label className="text-sm font-medium">
            Corpus lock JSON
            <textarea
              className={`${INPUT} mt-1 min-h-32 font-mono text-xs`}
              maxLength={256000}
              name="lockJson"
              required
            />
          </label>
          <label className="text-sm font-medium">
            Exact language identity JSON
            <textarea
              className={`${INPUT} mt-1 min-h-28 font-mono text-xs`}
              name="languageIdentitiesJson"
              required
              placeholder='[{"bcp47":"es","coreLanguageId":"...","languageId":"...","languageSlug":"spanish"}]'
            />
          </label>
          <label className="text-sm font-medium">
            Supersedes corpus version (only for accepted corrections)
            <input className={`${INPUT} mt-1`} name="supersedesVersionId" />
          </label>
          <button
            className={BUTTON}
            disabled={state.type === "busy"}
            type="submit"
          >
            <Database aria-hidden="true" size={17} /> Verify and import
            provisional corpus
          </button>
          {actionMessage(state)}
        </form>
      ) : null}
    </section>
  )
}

function LaunchRun({ corpus }: { corpus: SubtitleLabCorpusVersion | null }) {
  const [selected, setSelected] = useState<string[]>([])
  const [state, setState] = useState<ActionState>({ type: "idle" })
  const actionKey = useStableActionKey()
  const canLaunch = corpus?.status === "APPROVED" && selected.length > 0

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!corpus) return
    const data = new FormData(event.currentTarget)
    setState({
      type: "busy",
      message: "Creating the Admin run before dispatch…",
    })
    const response = await apiFetch("/api/subtitle-lab/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: actionKey.current(),
        corpusVersionId: corpus.id,
        corpusCellIds: selected,
        requestedProvider: PROVIDER,
        requestedModel: MODEL,
        promptPolicyId: PROMPT_POLICY,
        workflowPolicyDigest: WORKFLOW_POLICY,
        determinism: { temperature: 0, providerSeed: null },
        concurrency: Number(data.get("concurrency")),
        timeoutSeconds: Number(data.get("timeoutSeconds")),
        maxAttempts: Number(data.get("maxAttempts")),
      }),
    }).catch(() => null)
    if (!response?.ok) {
      setState({
        type: "error",
        message:
          "Run launch was rejected. No paid work was dispatched from this form.",
      })
      return
    }
    const result = (await response.json()) as {
      id?: string
      replayed?: boolean
    }
    actionKey.complete()
    setState({
      type: "success",
      message: `${result.replayed ? "Existing" : "New"} run ${result.id ?? "accepted"}.`,
    })
  }

  return (
    <section className={PANEL} aria-labelledby="subtitle-launch-title">
      <div className="flex items-center gap-2">
        <Play aria-hidden="true" size={19} />
        <h2 id="subtitle-launch-title" className="text-xl font-semibold">
          Launch bounded cloud run
        </h2>
      </div>
      <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
        At most 20 frozen cells, concurrency 1–3, 60–600 seconds, and two
        attempts. Admin applies stricter active-run and spend budgets before
        dispatch.
      </p>
      {!corpus ? (
        <p className="mt-4 text-sm">Open a corpus version to select cells.</p>
      ) : corpus.status !== "APPROVED" ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-[color:var(--ds-danger)]">
          <AlertTriangle aria-hidden="true" size={17} /> The corpus is
          provisional. Certification is required before launch.
        </p>
      ) : null}
      <form className="mt-5" onSubmit={submit}>
        {corpus ? (
          <fieldset>
            <legend className="text-sm font-semibold">
              Approved corpus cells ({selected.length}/20 selected)
            </legend>
            <div className="mt-2 grid max-h-72 gap-2 overflow-y-auto rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-3 lg:grid-cols-2">
              {corpus.cells.map((cell) => (
                <label
                  key={cell.id}
                  className="flex items-start gap-3 rounded-[var(--ds-radius)] p-2 hover:bg-[color:var(--ds-hover)]"
                >
                  <input
                    checked={selected.includes(cell.id)}
                    className="mt-1"
                    disabled={
                      corpus.status !== "APPROVED" ||
                      (!selected.includes(cell.id) && selected.length >= 20)
                    }
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, cell.id]
                          : current.filter((id) => id !== cell.id),
                      )
                    }
                    type="checkbox"
                  />
                  <span className="text-sm">
                    <strong>{cell.caseId}</strong>
                    <span className="block text-xs text-[color:var(--ds-muted)]">
                      {cell.collectionKey} ·{" "}
                      <span dir="auto">{cell.targetLanguageSlug}</span> ·{" "}
                      {cell.targetLanguageId}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm font-medium">
            Concurrency
            <input
              className={`${INPUT} mt-1`}
              defaultValue={1}
              max={3}
              min={1}
              name="concurrency"
              required
              type="number"
            />
          </label>
          <label className="text-sm font-medium">
            Timeout seconds
            <input
              className={`${INPUT} mt-1`}
              defaultValue={300}
              max={600}
              min={60}
              name="timeoutSeconds"
              required
              type="number"
            />
          </label>
          <label className="text-sm font-medium">
            Attempts
            <select
              className={`${INPUT} mt-1`}
              defaultValue="2"
              name="maxAttempts"
            >
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
        </div>
        {actionKey.peek() ? (
          <details className="mt-3 text-xs text-[color:var(--ds-muted)]">
            <summary>Advanced retry evidence</summary>
            <code className="mt-1 block break-all">{actionKey.peek()}</code>
          </details>
        ) : null}
        <dl className="mt-4 grid gap-2 rounded-[var(--ds-radius)] bg-[color:var(--ds-hover)] p-3 text-xs md:grid-cols-2">
          <div>
            <dt className="font-semibold">Provider/model</dt>
            <dd className="mt-1 break-all">
              {PROVIDER} · {MODEL}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Prompt/workflow policy</dt>
            <dd className="mt-1 break-all">
              {PROMPT_POLICY} · {shortDigest(WORKFLOW_POLICY)}
            </dd>
          </div>
        </dl>
        <button
          className={`${BUTTON} mt-4`}
          disabled={!canLaunch || state.type === "busy"}
          type="submit"
        >
          <Play aria-hidden="true" size={17} /> Create report-backed run
        </button>
        {actionMessage(state)}
      </form>
    </section>
  )
}

function RunHistory({ runs }: { runs: SubtitleLabRunSummary[] }) {
  return (
    <section className={PANEL} aria-labelledby="subtitle-runs-title">
      <div className="flex items-center gap-2">
        <History aria-hidden="true" size={19} />
        <h2 id="subtitle-runs-title" className="text-xl font-semibold">
          Active and recent runs
        </h2>
      </div>
      <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
        Terminal reports are immutable. Partial and failed runs remain
        first-class evidence.
      </p>
      <div className="mt-4 grid gap-2">
        {runs.length === 0 ? (
          <p className="rounded-[var(--ds-radius)] border border-dashed border-[color:var(--ds-line-strong)] p-6 text-center text-sm text-[color:var(--ds-muted)]">
            No retained subtitle evaluation runs.
          </p>
        ) : (
          runs.map((run) => (
            <a
              className="group flex items-center gap-3 rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-3 hover:bg-[color:var(--ds-hover)]"
              href={`/dashboard/subtitle-lab/runs/${encodeURIComponent(run.id)}`}
              key={run.id}
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <strong>{statusLabel(run.status)}</strong>
                  <span className="rounded-full border border-[color:var(--ds-line-strong)] px-2 py-0.5 text-xs">
                    {run.cellCount} cells
                  </span>
                </span>
                <span className="mt-1 block truncate font-mono text-xs text-[color:var(--ds-muted)]">
                  {run.id}
                </span>
                <span className="mt-1 block text-xs text-[color:var(--ds-muted)]">
                  {run.requestedModel} · {run.promptPolicyId} ·{" "}
                  {formatSubtitleLabDate(run.createdAt)}
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="shrink-0 transition-transform group-hover:translate-x-0.5"
                size={18}
              />
            </a>
          ))
        )}
      </div>
    </section>
  )
}

function ReferenceIssues({ issues }: { issues: SubtitleLabReferenceIssue[] }) {
  const [states, setStates] = useState<Record<string, ActionState>>({})
  async function disposition(
    event: FormEvent<HTMLFormElement>,
    issueId: string,
  ) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setStates((current) => ({
      ...current,
      [issueId]: { type: "busy", message: "Appending disposition…" },
    }))
    const response = await apiFetch(
      `/api/subtitle-lab/reference-issues/${encodeURIComponent(issueId)}/disposition`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          disposition: data.get("disposition"),
          reason: data.get("reason"),
          correctedCorpusVersionId:
            String(data.get("correctedCorpusVersionId") ?? "") || null,
        }),
      },
    ).catch(() => null)
    setStates((current) => ({
      ...current,
      [issueId]: response?.ok
        ? {
            type: "success",
            message: "Disposition appended. Original review remains unchanged.",
          }
        : { type: "error", message: "Disposition was rejected." },
    }))
  }
  return (
    <section className={PANEL} aria-labelledby="subtitle-issues-title">
      <div className="flex items-center gap-2">
        <AlertTriangle aria-hidden="true" size={19} />
        <h2 id="subtitle-issues-title" className="text-xl font-semibold">
          Open reference issues
        </h2>
      </div>
      <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
        An open reference question blocks approval for the affected corpus cell.
        Accepted corrections must point to a new frozen corpus version.
      </p>
      <div className="mt-4 grid gap-3">
        {issues.length === 0 ? (
          <p className="text-sm text-[color:var(--ds-muted)]">
            No open reference questions.
          </p>
        ) : (
          issues.map((issue) => (
            <article
              className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-4"
              key={issue.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <strong>{issue.caseId}</strong>
                  <p className="mt-1 text-xs text-[color:var(--ds-muted)]">
                    {issue.collectionKey} ·{" "}
                    <span dir="auto">{issue.targetLanguageSlug}</span> ·{" "}
                    {issue.targetLanguageId}
                  </p>
                </div>
                <span className="rounded-full border border-[color:var(--ds-line-strong)] px-2 py-0.5 text-xs font-semibold">
                  {issue.status}
                </span>
              </div>
              {issue.status === "OPEN" ? (
                <form
                  className="mt-4 grid gap-3 lg:grid-cols-[12rem_1fr_1fr_auto]"
                  onSubmit={(event) => disposition(event, issue.id)}
                >
                  <label className="text-xs font-semibold">
                    Disposition
                    <select className={`${INPUT} mt-1`} name="disposition">
                      <option value="REJECTED">Reference is valid</option>
                      <option value="ACCEPTED">Correction accepted</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold">
                    Reason
                    <input
                      className={`${INPUT} mt-1`}
                      maxLength={4000}
                      name="reason"
                      required
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    Corrected corpus version
                    <input
                      className={`${INPUT} mt-1`}
                      name="correctedCorpusVersionId"
                    />
                  </label>
                  <button
                    className={`${SECONDARY_BUTTON} self-end`}
                    disabled={states[issue.id]?.type === "busy"}
                    type="submit"
                  >
                    Append disposition
                  </button>
                </form>
              ) : null}
              {actionMessage(states[issue.id] ?? { type: "idle" })}
            </article>
          ))
        )}
      </div>
    </section>
  )
}

function ComparisonBuilder({ runs }: { runs: SubtitleLabRunSummary[] }) {
  const terminalRuns = useMemo(
    () => runs.filter((run) => run.terminalAt),
    [runs],
  )
  const [state, setState] = useState<ActionState>({ type: "idle" })
  const actionKey = useStableActionKey()
  const [comparison, setComparison] = useState<SubtitleLabComparison | null>(
    null,
  )
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const baselineRunId = String(data.get("baselineRunId"))
    const candidateRunId = String(data.get("candidateRunId"))
    setState({ type: "busy", message: "Resolving immutable terminal reports…" })
    const [baseline, candidate] = await Promise.all([
      apiFetch(`/api/subtitle-lab/runs/${encodeURIComponent(baselineRunId)}`, {
        cache: "no-store",
      }),
      apiFetch(`/api/subtitle-lab/runs/${encodeURIComponent(candidateRunId)}`, {
        cache: "no-store",
      }),
    ]).catch(() => [null, null] as const)
    if (!baseline?.ok || !candidate?.ok) {
      setState({
        type: "error",
        message: "Both terminal runs must be available.",
      })
      return
    }
    const baselineRun = (await baseline.json()) as {
      terminalReport?: { id?: string } | null
    }
    const candidateRun = (await candidate.json()) as {
      terminalReport?: { id?: string } | null
    }
    if (!baselineRun.terminalReport?.id || !candidateRun.terminalReport?.id) {
      setState({
        type: "error",
        message: "Both selected runs need immutable terminal reports.",
      })
      return
    }
    const response = await apiFetch("/api/subtitle-lab/comparisons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: actionKey.current(),
        baselineReportId: baselineRun.terminalReport.id,
        candidateReportId: candidateRun.terminalReport.id,
        changedAxis: String(data.get("changedAxis")),
      }),
    }).catch(() => null)
    if (!response?.ok) {
      setState({ type: "error", message: "Comparison was rejected." })
      return
    }
    const created = (await response.json()) as { id?: string }
    if (!created.id)
      return setState({
        type: "error",
        message: "Comparison identity was missing.",
      })
    actionKey.complete()
    const detail = await apiFetch(
      `/api/subtitle-lab/comparisons/${encodeURIComponent(created.id)}`,
      { cache: "no-store" },
    ).catch(() => null)
    if (!detail?.ok)
      return setState({
        type: "error",
        message:
          "Comparison was created but detail is temporarily unavailable.",
      })
    setComparison((await detail.json()) as SubtitleLabComparison)
    setState({ type: "success", message: "Matched-cell comparison created." })
  }
  return (
    <section className={PANEL} aria-labelledby="subtitle-compare-title">
      <div className="flex items-center gap-2">
        <Beaker aria-hidden="true" size={19} />
        <h2 id="subtitle-compare-title" className="text-xl font-semibold">
          Compare immutable reports
        </h2>
      </div>
      <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
        One declared changed axis. Every other identity difference remains
        visible; unmatched cells never enter aggregate deltas.
      </p>
      <form className="mt-4 grid gap-4 lg:grid-cols-3" onSubmit={submit}>
        <label className="text-sm font-medium">
          Baseline run
          <select className={`${INPUT} mt-1`} name="baselineRunId" required>
            <option value="">Select a terminal run</option>
            {terminalRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Candidate run
          <select className={`${INPUT} mt-1`} name="candidateRunId" required>
            <option value="">Select a terminal run</option>
            {terminalRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Declared changed axis
          <select className={`${INPUT} mt-1`} name="changedAxis">
            <option value="PROMPT_POLICY">Prompt policy</option>
            <option value="MODEL">Model</option>
            <option value="WORKFLOW_POLICY">Workflow policy</option>
            <option value="CODE_REVISION">Code revision</option>
            <option value="RUNTIME">Runtime</option>
          </select>
        </label>
        <button
          className={`${BUTTON} lg:col-span-3 lg:justify-self-start`}
          disabled={state.type === "busy"}
          type="submit"
        >
          <Beaker aria-hidden="true" size={17} /> Create descriptive comparison
        </button>
      </form>
      {actionKey.peek() ? (
        <details className="mt-3 text-xs text-[color:var(--ds-muted)]">
          <summary>Advanced retry evidence</summary>
          <code className="mt-1 block break-all">{actionKey.peek()}</code>
        </details>
      ) : null}
      {actionMessage(state)}
      {comparison ? (
        <div className="mt-5 grid gap-3">
          <a
            className={SECONDARY_BUTTON}
            href={`/dashboard/subtitle-lab/comparisons/${encodeURIComponent(comparison.id)}`}
          >
            Open persistent comparison report{" "}
            <ArrowRight aria-hidden="true" size={16} />
          </a>
          <SubtitleRunComparison comparison={comparison} />
        </div>
      ) : null}
    </section>
  )
}

export function SubtitleLabDashboard({
  initialCorpus,
  initialReferenceIssues,
  initialRuns,
}: {
  initialCorpus: SubtitleLabCorpusVersion | null
  initialReferenceIssues: SubtitleLabReferenceIssue[]
  initialRuns: SubtitleLabRunSummary[]
}) {
  return (
    <section
      className="mx-auto grid w-full max-w-[1600px] gap-5 px-4 py-6 md:px-6"
      aria-labelledby="subtitle-lab-title"
    >
      <header className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="studio-page-eyebrow">
              Human-reviewed experimentation
            </span>
            <h1
              className="mt-1 text-3xl font-semibold tracking-tight"
              id="subtitle-lab-title"
            >
              Subtitle Quality Lab
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--ds-muted)]">
              Run the same frozen human-reference corpus against Mastra, inspect
              machine evidence, and route irreducible language and theology
              decisions to qualified contributors.
            </p>
          </div>
          <div className="max-w-sm rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] p-3 text-sm">
            <strong className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" size={17} /> Development benchmark
            </strong>
            <p className="mt-1 text-xs text-[color:var(--ds-muted)]">
              Descriptive only. Machine metrics do not approve gold data,
              publish subtitles, activate prompts, deploy code, or establish
              causality.
            </p>
          </div>
        </div>
        <nav
          className="mt-5 flex flex-wrap gap-2 text-sm"
          aria-label="Subtitle Lab sections"
        >
          <a className={SECONDARY_BUTTON} href="#subtitle-corpus-title">
            Corpus
          </a>
          <a className={SECONDARY_BUTTON} href="#subtitle-launch-title">
            Launch
          </a>
          <a className={SECONDARY_BUTTON} href="#subtitle-runs-title">
            Reports
          </a>
          <a className={SECONDARY_BUTTON} href="#subtitle-compare-title">
            Compare
          </a>
          <a className={SECONDARY_BUTTON} href="#subtitle-issues-title">
            Reference issues
          </a>
        </nav>
      </header>
      {initialCorpus ? (
        <CorpusEvidence corpus={initialCorpus} />
      ) : (
        <section className={PANEL}>
          <div className="flex items-center gap-2">
            <Languages aria-hidden="true" size={19} />
            <h2 className="text-xl font-semibold">Open corpus evidence</h2>
          </div>
          <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
            Add <code>?corpusId=&lt;version&gt;</code> to inspect exact frozen
            bytes and launch eligible cells.
          </p>
        </section>
      )}
      <ImportCorpus />
      <LaunchRun corpus={initialCorpus} />
      <RunHistory runs={initialRuns} />
      <ComparisonBuilder runs={initialRuns} />
      <ReferenceIssues issues={initialReferenceIssues} />
      <p className="text-center text-xs text-[color:var(--ds-muted)]">
        Assign reviewers from run detail. Every contributor candidate is
        rechecked against exact Language.id + Language.slug grants.
      </p>
    </section>
  )
}
