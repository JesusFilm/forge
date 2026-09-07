"use client"
import { StudioProductionClientError } from "./production-client"
import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { z } from "zod"
import { studioDocumentSchema } from "@forge/studio-contracts"
import { studioProposalSchema } from "@forge/studio-contracts/agent"
import type { EditorSession } from "./editor-session"
import { studioCall } from "./client"
const ProposalPreview = dynamic(() => import("./proposal-preview"), {
  ssr: false,
})
const AgentPanel = dynamic(() => import("./agent-panel"), { ssr: false })
const projectSchema = z.object({
  projectId: z.string(),
  revision: z.number(),
  title: z.string(),
  lifecycle: z.string(),
  firstPublishedAt: z.string().nullable().default(null),
})
const resultSchema = z.object({
  attemptId: z.string(),
  projectId: z.string(),
  revision: z.number(),
  status: z.string(),
  instructions: z.unknown(),
  text: z.string(),
  diagnostics: z.array(z.string()),
  proposalCount: z.number(),
  proposalIndex: z.number(),
  previews: z.array(
    z.object({
      proposal: studioProposalSchema,
      document: studioDocumentSchema,
      sources: z.array(z.unknown()),
    }),
  ),
})
export default function GenerationPanel({
  session,
  projectId,
  onClose,
}: {
  session: EditorSession
  projectId: string
  onClose: () => void
}) {
  const [projects, setProjects] = useState<z.infer<typeof projectSchema>[]>([]),
    [selected, setSelected] = useState([projectId]),
    [nextProjectCursor, setNextProjectCursor] = useState<string | null>(null),
    [message, setMessage] = useState(
      "Generate an editable script and composition from this project's selected sources and Content Packs. Propose canonical operations and inspectable source, coherence, depth, fidelity and voice findings. Preserve author language and manual timing. Do not narrate or publish.",
    ),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<string[]>([]),
    [attempts, setAttempts] = useState<
      Array<{ id: string; projectId: string; status: string }>
    >([]),
    [result, setResult] = useState<z.infer<typeof resultSchema> | null>(null),
    [preview, setPreview] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    let active = true
    studioCall("list", { limit: 100 })
      .then(async (raw) => {
        const rows = z.array(projectSchema).parse(raw)
        const current = rows.some((row) => row.projectId === projectId)
          ? null
          : await studioCall("read", projectId)
        const extra = current
          ? z
              .object({
                projectId: z.string(),
                revision: z.number(),
                lifecycle: z.string(),
                firstPublishedAt: z.string().nullable(),
                document: z.object({ title: z.string() }),
              })
              .parse(current)
          : null
        if (active) {
          setProjects(
            extra ? [...rows, { ...extra, title: extra.document.title }] : rows,
          )
          setNextProjectCursor(rows.length === 100 ? rows[99].projectId : null)
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
      controller.current?.abort()
    }
  }, [projectId])
  async function action(work: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed")
    } finally {
      setBusy(false)
    }
  }
  async function history() {
    const values = await Promise.all(
      selected.map(async (id) =>
        z
          .array(
            z.object({
              id: z.string(),
              projectId: z.string(),
              status: z.string(),
              kind: z.string(),
            }),
          )
          .parse(await studioCall("attempts", id)),
      ),
    )
    setAttempts(values.flat().filter((a) => a.kind === "GENERATION"))
  }
  async function load(attemptId: string, proposalIndex = 0) {
    setResult(
      resultSchema.parse(
        await studioCall("generation-read", { attemptId, proposalIndex }),
      ),
    )
    setPreview(false)
  }
  async function generate() {
    if (
      session.getSnapshot().status !== "saved" &&
      selected.includes(projectId)
    )
      throw new StudioProductionClientError(
        "Save this project before generation",
      )
    const requests = selected.map((id) => {
      const project = projects.find((p) => p.projectId === id)
      if (!project)
        throw new StudioProductionClientError("Reload project selection")
      return {
        projectId: id,
        expectedRevision:
          id === projectId ? session.getSnapshot().revision : project.revision,
        idempotencyKey: crypto.randomUUID(),
        message,
      }
    })
    controller.current = new AbortController()
    setProgress([])
    setConfirmed(false)
    const response = await fetch("/api/studio/generation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests, confirmed: true }),
      signal: controller.current.signal,
    })
    if (!response.ok)
      throw new StudioProductionClientError(
        (await response.json()).error ?? "Generation rejected",
      )
    const reader = response.body!.getReader(),
      decoder = new TextDecoder()
    let pending = "",
      bytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.length
        if (bytes > 2300000)
          throw new StudioProductionClientError(
            "Batch stream exceeds its bounded size",
          )
        pending += decoder.decode(value, { stream: true })
        let newline: number
        while ((newline = pending.indexOf("\n")) >= 0) {
          const event = z
            .object({
              type: z.string(),
              projectId: z.string().optional(),
              message: z.string().optional(),
              event: z
                .object({
                  type: z.string(),
                  attemptId: z.string().optional(),
                  message: z.string().optional(),
                })
                .optional(),
            })
            .parse(JSON.parse(pending.slice(0, newline)))
          pending = pending.slice(newline + 1)
          if (event.type === "target-error" || event.event?.type === "error")
            setError(
              event.event?.message ??
                event.message ??
                "Generation interrupted; inspect the retained attempt",
            )
          if (
            event.type !== "target-event" ||
            event.event?.type === "admitted" ||
            event.event?.type === "done"
          )
            setProgress((previous) => [
              ...previous,
              `${event.projectId ?? "Batch"}: ${event.event?.type ?? event.type}${event.event?.attemptId ? ` ${event.event.attemptId}` : ""}${event.message ? ` · ${event.message}` : ""}`,
            ])
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
      await history()
    }
  }
  const proposed = result?.previews[0]
  if (instructionsOpen)
    return (
      <AgentPanel
        session={session}
        projectId={projectId}
        onClose={() => setInstructionsOpen(false)}
      />
    )
  return (
    <div className="nle-dialog-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Generate scripts and compositions"
        className="nle-dialog nle-production"
      >
        <header>
          <h2>Generate scripts and compositions</h2>
          <button onClick={onClose}>Close generation</button>
        </header>
        <p>
          Select one project or an explicit batch of up to eight. Each freezes
          its own instruction versions and revision. Review and apply proposals
          before approving speech.
        </p>
        <fieldset disabled={busy} className="nle-production-targets">
          <legend>Production targets</legend>
          {projects.map((project) => (
            <label key={project.projectId}>
              <input
                type="checkbox"
                disabled={
                  project.lifecycle !== "DRAFT" ||
                  project.firstPublishedAt !== null ||
                  (!selected.includes(project.projectId) &&
                    selected.length >= 8)
                }
                checked={selected.includes(project.projectId)}
                onChange={(e) => {
                  setSelected((previous) =>
                    e.target.checked
                      ? [...previous, project.projectId]
                      : previous.filter((id) => id !== project.projectId),
                  )
                  setConfirmed(false)
                }}
              />
              {project.title} · revision {project.revision} ·{" "}
              {project.projectId}
            </label>
          ))}
        </fieldset>
        {nextProjectCursor && (
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const rows = z.array(projectSchema).parse(
                  await studioCall("list", {
                    limit: 100,
                    cursor: nextProjectCursor,
                  }),
                )
                setProjects((previous) => [
                  ...new Map(
                    [...previous, ...rows].map((row) => [row.projectId, row]),
                  ).values(),
                ])
                setNextProjectCursor(
                  rows.length === 100 ? rows[99].projectId : null,
                )
              })
            }
          >
            Load more projects
          </button>
        )}
        <label>
          Generation direction{" "}
          <textarea
            maxLength={8000}
            value={message}
            disabled={busy}
            onChange={(e) => {
              setMessage(e.target.value)
              setConfirmed(false)
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Explicitly generate these {selected.length} projects using the active
          native instructions.
        </label>
        <p aria-live="polite">
          Selected ({selected.length}/8):{" "}
          {selected
            .map((id) => projects.find((p) => p.projectId === id)?.title ?? id)
            .join("; ") || "Choose a project"}
        </p>
        <p>
          Generation requires an active native instruction version. Open the
          assistant’s Instructions tab to review and activate it.
        </p>
        <button disabled={busy} onClick={() => setInstructionsOpen(true)}>
          Review or activate instructions
        </button>
        {error && <p role="alert">{error}</p>}
        <button
          disabled={busy || !confirmed || !selected.length || !message.length}
          onClick={() => void action(generate)}
        >
          Generate script, composition and source preview
        </button>
        {busy && (
          <button onClick={() => controller.current?.abort()}>
            Cancel remaining generation
          </button>
        )}
        {progress.map((entry, index) => (
          <p key={index}>{entry}</p>
        ))}
        <button disabled={busy} onClick={() => void action(history)}>
          Load retained generation attempts
        </button>
        <label>
          Attempt{" "}
          <select
            value={result?.attemptId ?? ""}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) void action(() => load(e.target.value))
            }}
          >
            <option value="">Choose an attempt</option>
            {attempts.map((attempt) => (
              <option key={attempt.id} value={attempt.id}>
                {attempt.projectId} · {attempt.id} · {attempt.status}
              </option>
            ))}
          </select>
        </label>
        {result && (
          <>
            <p>
              Retained revision {result.revision} · {result.status}. Current
              edits are checked again when applying.
            </p>
            <details>
              <summary>Frozen instruction provenance</summary>
              <pre>{JSON.stringify(result.instructions, null, 2)}</pre>
            </details>
            <p>{result.text}</p>
            {result.diagnostics.map((d, i) => (
              <p key={i}>{d}</p>
            ))}
            {result.proposalCount > 1 && (
              <label>
                Proposal{" "}
                <select
                  value={result.proposalIndex}
                  onChange={(e) =>
                    void action(() =>
                      load(result.attemptId, Number(e.target.value)),
                    )
                  }
                >
                  {Array.from({ length: result.proposalCount }, (_, index) => (
                    <option key={index} value={index}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {proposed ? (
              <>
                <h3>{proposed.proposal.summary}</h3>
                <h4>Effective script</h4>
                {proposed.document.items
                  .filter((item) => item.speech && !item.speech.suppressed)
                  .map((item) => (
                    <article key={item.id}>
                      <strong>{item.speech!.role}</strong>
                      <p className="nle-spoken-bytes">{item.speech!.text}</p>
                      <details>
                        <summary>Voice and pronunciation settings</summary>
                        <pre>
                          {JSON.stringify(
                            { itemId: item.id, ...item.speech },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </article>
                  ))}
                <h4>Source and quality findings</h4>
                {proposed.proposal.quality?.findings.map((finding, index) => (
                  <p key={index}>
                    <strong>
                      {finding.criterion.replaceAll("-", " ")}:{" "}
                      {finding.status.replaceAll("_", " ")}
                    </strong>{" "}
                    — {finding.reason}
                  </p>
                )) ?? <p>Quality has not been checked.</p>}
                <details>
                  <summary>Source and quality findings</summary>
                  <pre>
                    {JSON.stringify(
                      {
                        sources: proposed.sources,
                        quality: proposed.proposal.quality ?? "Not checked",
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <button onClick={() => setPreview((value) => !value)}>
                  {preview
                    ? "Close proposal preview"
                    : "Preview proposed composition"}
                </button>
                {preview && (
                  <ProposalPreview
                    key={`${result.attemptId}:${result.proposalIndex}`}
                    projectId={result.projectId}
                    document={proposed.document}
                  />
                )}
                <details>
                  <summary>Exact proposed operations</summary>
                  <pre>
                    {JSON.stringify(proposed.proposal.command, null, 2)}
                  </pre>
                </details>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      if (
                        result.projectId === projectId &&
                        session.getSnapshot().status !== "saved"
                      )
                        throw new StudioProductionClientError(
                          "Save local changes before applying a proposal",
                        )
                      const response = await fetch("/api/studio/agent", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          kind: "apply",
                          input: proposed.proposal.command,
                        }),
                      })
                      if (!response.ok)
                        throw new StudioProductionClientError(
                          (await response.json()).error ?? "Proposal conflict",
                        )
                      if (result.projectId === projectId) await session.reload()
                      setProgress((previous) => [
                        ...previous,
                        "Proposal applied. Review the complete speech before narration.",
                      ])
                    })
                  }
                >
                  Apply reviewed proposal
                </button>
              </>
            ) : (
              <p>
                No structured composition was proposed. Retained text is
                available for inspection.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
