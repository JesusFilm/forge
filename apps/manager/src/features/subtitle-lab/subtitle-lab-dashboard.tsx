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
  "min-w-0 rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-5 shadow-[0_8px_24px_rgba(17,17,17,0.04)]"
const INPUT =
  "min-h-11 w-full rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-panel)] px-3 py-2 text-sm text-[color:var(--ds-ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ds-black)]"
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--ds-radius)] border border-[color:var(--ds-black)] bg-[color:var(--ds-black)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ds-black)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
const QUIET_BUTTON =
  "inline-flex min-h-8 items-center rounded-full border border-[color:var(--ds-line-strong)] px-3 py-1 text-xs font-medium text-[color:var(--ds-ink)] hover:bg-[color:var(--ds-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ds-black)] disabled:cursor-not-allowed disabled:opacity-45"
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-panel)] px-4 py-2 text-sm font-semibold text-[color:var(--ds-ink)] hover:bg-[color:var(--ds-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ds-black)] disabled:cursor-not-allowed disabled:opacity-45"

const MODEL = SUBTITLE_EVAL_ALLOWED_MODELS[0]
const PROVIDER = SUBTITLE_EVAL_ALLOWED_PROVIDER
const PROMPT_POLICY = SUBTITLE_EVAL_PROMPT_POLICY_ID
const WORKFLOW_POLICY = SUBTITLE_EVAL_WORKFLOW_POLICY_DIGEST

/**
 * Run status colours are lifted from Manager's existing job badges
 * (`.jobs-summary-status-badge` in globals.css) so the Lab reads as the same
 * product rather than inventing a second status vocabulary.
 */
const RUN_STATUS_META: Record<
  string,
  { label: string; background: string; needsOperator: boolean }
> = {
  QUEUED: { label: "Queued", background: "#475569", needsOperator: false },
  RUNNING: { label: "Running", background: "#fe8549", needsOperator: false },
  COMPLETED: {
    label: "Completed",
    background: "#0f8a64",
    needsOperator: false,
  },
  PARTIAL: { label: "Partial", background: "#b45309", needsOperator: true },
  FAILED: { label: "Failed", background: "#b91c1c", needsOperator: true },
  CANCELLED: {
    label: "Cancelled",
    background: "#475569",
    needsOperator: false,
  },
}

function runStatusMeta(status: string) {
  return (
    RUN_STATUS_META[status] ?? {
      label: statusLabel(status),
      background: "#475569",
      needsOperator: false,
    }
  )
}

function RunStatusBadge({ status }: { status: string }) {
  const meta = runStatusMeta(status)
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold text-white"
      style={{ background: meta.background }}
    >
      {meta.label}
    </span>
  )
}

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
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="max-w-3xl text-sm text-[color:var(--ds-muted)]">
            Every source and reference subtitle is stored by a hash of its
            bytes, so a run can always be traced to the exact text it was scored
            against. Approving a corpus certifies that text. It does not publish
            anything.
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
    </div>
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
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
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
    </div>
  )
}

const MAX_RUN_CELLS = 20

function LaunchRun({ corpus }: { corpus: SubtitleLabCorpusVersion | null }) {
  const [selected, setSelected] = useState<string[]>([])
  const [state, setState] = useState<ActionState>({ type: "idle" })
  const actionKey = useStableActionKey()
  const canLaunch = corpus?.status === "APPROVED" && selected.length > 0
  const cells = corpus?.cells ?? []
  const selectable = corpus?.status === "APPROVED"

  // Selecting a whole corpus used to cost one click per cell. These act on the
  // cells the operator can actually run, capped at the same limit Admin
  // enforces, and stay deliberate: nothing is preselected, because starting a
  // run spends money.
  function selectAll() {
    setSelected(cells.slice(0, MAX_RUN_CELLS).map((cell) => cell.id))
  }

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
          Start a run
        </h2>
      </div>
      <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
        Each selected cell is one paid translation. Pick the cells, then start
        the run — spend limits are enforced before anything is dispatched, so a
        run that would exceed them is refused rather than trimmed.
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
              Cells to measure ({selected.length} of{" "}
              {Math.min(cells.length, MAX_RUN_CELLS)} selected)
            </legend>
            {selectable ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  className={QUIET_BUTTON}
                  onClick={selectAll}
                  type="button"
                >
                  Select all
                </button>
                <button
                  className={QUIET_BUTTON}
                  disabled={selected.length === 0}
                  onClick={() => setSelected([])}
                  type="button"
                >
                  Clear
                </button>
              </div>
            ) : null}
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
          <Play aria-hidden="true" size={17} /> Start run
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
          Runs
        </h2>
      </div>
      <div className="mt-4 grid gap-2">
        {runs.length === 0 ? (
          <p className="rounded-[var(--ds-radius)] border border-dashed border-[color:var(--ds-line-strong)] p-6 text-sm text-[color:var(--ds-muted)]">
            No runs yet. Pick the cells you want to measure and start one.
          </p>
        ) : (
          runs.map((run) => (
            <a
              className="group flex min-w-0 items-center gap-3 rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-3 hover:bg-[color:var(--ds-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ds-black)]"
              href={`/dashboard/subtitle-lab/runs/${encodeURIComponent(run.id)}`}
              key={run.id}
            >
              <RunStatusBadge status={run.status} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium text-[color:var(--ds-ink)]">
                  {run.cellCount} cells · {run.requestedModel}
                </span>
                <span className="mt-0.5 block text-xs text-[color:var(--ds-muted)]">
                  Started {formatSubtitleLabDate(run.createdAt)}
                  {run.terminalAt
                    ? ` · finished ${formatSubtitleLabDate(run.terminalAt)}`
                    : ""}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-[color:var(--ds-soft)]">
                  {run.id}
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="shrink-0 text-[color:var(--ds-muted)] transition-transform group-hover:translate-x-0.5"
                size={18}
              />
            </a>
          ))
        )}
      </div>
      <div className="mt-3 space-y-2 text-xs text-[color:var(--ds-muted)]">
        <p>
          Reports never change once a run finishes. A partial or failed run is
          still evidence — open it to see which cells succeeded, and to assign
          reviewers from run detail.
        </p>
        {/* The interpretation caveat lives here, next to the results it
            qualifies, rather than as a banner in the page header. */}
        <p className="flex items-start gap-2">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 shrink-0"
            size={14}
          />
          <span>
            <strong className="font-semibold">Development benchmark.</strong>{" "}
            Scores describe how close a translation is to the reference. They do
            not approve reference data, publish subtitles, activate a prompt or
            model, or show that a change caused the difference.
          </span>
        </p>
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
          Questions about the reference
        </h2>
      </div>
      <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
        A reviewer thinks the reference itself is wrong. While the question is
        open, that cell cannot be approved. Accepting a correction means
        creating a new corpus version — the existing one is never edited.
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
                    <select
                      className={`${INPUT} mt-1`}
                      defaultValue=""
                      name="disposition"
                      required
                    >
                      <option disabled value="">
                        Choose…
                      </option>
                      <option value="REJECTED">
                        Reference is right, keep it
                      </option>
                      <option value="ACCEPTED">
                        Reviewer is right, needs a correction
                      </option>
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
                    Record decision
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
          Compare two runs
        </h2>
      </div>
      <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
        Name the one thing you changed between the two runs. Everything else
        that differs is still reported, and cells that do not appear in both
        runs are left out of the totals.
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
          <Beaker aria-hidden="true" size={17} /> Compare runs
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

function StateStrip({
  runs,
  issueCount,
}: {
  runs: SubtitleLabRunSummary[]
  issueCount: number
}) {
  const active = runs.filter(
    (run) => run.status === "RUNNING" || run.status === "QUEUED",
  ).length
  const attention = runs.filter(
    (run) => runStatusMeta(run.status).needsOperator,
  ).length

  const items = [
    {
      label: active === 1 ? "run in progress" : "runs in progress",
      value: active,
    },
    {
      label: attention === 1 ? "run needs a look" : "runs need a look",
      value: attention,
    },
    {
      label:
        issueCount === 1
          ? "question on the reference"
          : "questions on the reference",
      value: issueCount,
    },
  ]

  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div
          className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] px-4 py-3"
          key={item.label}
        >
          <dd className="text-2xl font-semibold tabular-nums">{item.value}</dd>
          <dt className="mt-0.5 text-xs text-[color:var(--ds-muted)]">
            {item.label}
          </dt>
        </div>
      ))}
    </dl>
  )
}

function CollapsedPanel({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className={PANEL}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ds-black)]">
        <span className="text-xl font-semibold">{title}</span>
        <span className="text-xs text-[color:var(--ds-muted)]">{summary}</span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
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
  const corpusSummary = initialCorpus
    ? `${initialCorpus.id} · ${statusLabel(initialCorpus.status).toLowerCase()} · ${initialCorpus.cells.length} cells`
    : "No corpus open"

  return (
    <section
      className="mx-auto grid w-full max-w-[1600px] gap-5 px-4 py-6 md:px-6"
      aria-labelledby="subtitle-lab-title"
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-semibold tracking-tight"
            id="subtitle-lab-title"
          >
            Subtitle Quality Lab
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[color:var(--ds-muted)]">
            Measure subtitle translations against a fixed set of human
            references, and send the calls only a person can make to a reviewer
            who speaks the language.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--ds-line-strong)] px-3 py-1.5 font-mono text-xs">
          <Database aria-hidden="true" size={14} />
          {corpusSummary}
        </span>
      </header>

      <StateStrip
        runs={initialRuns}
        issueCount={initialReferenceIssues.length}
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <RunHistory runs={initialRuns} />
        <LaunchRun corpus={initialCorpus} />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ReferenceIssues issues={initialReferenceIssues} />
        <ComparisonBuilder runs={initialRuns} />
      </div>

      {initialCorpus ? (
        <CollapsedPanel
          summary={`${initialCorpus.cells.length} cells · ${statusLabel(initialCorpus.status).toLowerCase()}`}
          title="Reference corpus"
        >
          <CorpusEvidence corpus={initialCorpus} />
        </CollapsedPanel>
      ) : (
        <section className={PANEL}>
          <div className="flex items-center gap-2">
            <Languages aria-hidden="true" size={19} />
            <h2 className="text-xl font-semibold">No corpus open</h2>
          </div>
          <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
            Open a corpus version by its id to see its cells and start a run.
            Import one below if there is none yet.
          </p>
        </section>
      )}

      <CollapsedPanel
        summary="Once per corpus version"
        title="Import a corpus version"
      >
        <ImportCorpus />
      </CollapsedPanel>
    </section>
  )
}
