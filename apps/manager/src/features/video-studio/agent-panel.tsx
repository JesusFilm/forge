"use client"
import { useEffect, useRef, useState } from "react"
import { z } from "zod"
import {
  studioAgentEventSchema,
  studioProposalSchema,
} from "@forge/studio-contracts/agent"
import type {
  StudioDocument,
  StudioCommandResult,
} from "@forge/studio-contracts"
import type { EditorSession } from "./editor-session"
import { studioCall } from "./client"
const versionSchema = z.object({
  id: z.string(),
  versionNumber: z.number(),
  content: z.string(),
  changeMessage: z.string().optional(),
})
const viewSchema = z.object({
  suggestedDefaults: z.string().optional(),
  activeVersionId: z.string().nullable(),
  latest: versionSchema,
  versions: z.array(versionSchema),
  block: z.object({ resolvedVersionId: z.string(), content: z.string() }),
})
type View = z.infer<typeof viewSchema>
type Proposal = z.infer<typeof studioProposalSchema>
async function agentRequest(body: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/studio/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error ?? "Studio request failed")
  }
  return response
}
export default function AgentPanel({
  session,
  projectId,
  onClose,
}: {
  session: EditorSession
  projectId: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<"chat" | "instructions">("chat"),
    [message, setMessage] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [proposals, setProposals] = useState<Proposal[]>([]),
    [diagnostics, setDiagnostics] = useState<string[]>([]),
    [view, setView] = useState<View | null>(null),
    [draft, setDraft] = useState(""),
    [selected, setSelected] = useState(""),
    [comparison, setComparison] = useState<{
      from: { content: string }
      to: { content: string }
    } | null>(null),
    [undo, setUndo] = useState<{
      document: StudioDocument
      revision: number
    } | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function action(work: () => Promise<void>) {
    setBusy(true)
    setError("")
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Studio failed")
    } finally {
      setBusy(false)
    }
  }
  async function instruction(command: unknown) {
    const response = await agentRequest({
      kind: "instructions",
      input: { action: "instructions", command },
    })
    return (await response.json()).result
  }
  function load(raw: unknown) {
    const next = viewSchema.parse(raw)
    setComparison(null)
    setView(next)
    setDraft(next.latest.content)
    setSelected(next.latest.id)
  }
  async function stream(body: unknown) {
    controller.current = new AbortController()
    setText("")
    setProposals([])
    setDiagnostics([])
    const response = await agentRequest(body, controller.current.signal),
      reader = response.body!.getReader(),
      decoder = new TextDecoder()
    let buffer = "",
      size = 0,
      completed = false
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        if (size > 262144) throw new Error("Studio response too large")
        buffer += decoder.decode(value, { stream: true })
        let index: number
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          const event = studioAgentEventSchema.parse(JSON.parse(line))
          if (event.type === "text") setText((t) => t + event.text)
          if (event.type === "proposal")
            setProposals((p) => [...p, event.proposal])
          if (event.type === "diagnostic")
            setDiagnostics((d) => [...d, event.message])
          if (event.type === "admitted")
            setDiagnostics((d) => [
              ...d,
              `Attempt ${event.attemptId} · ${JSON.stringify(event.instructions)}`,
            ])
          if (event.type === "error") throw new Error(event.message)
          if (event.type === "done") completed = true
        }
      }
      if (!completed || buffer.trim())
        throw new Error("Studio stream ended before completion")
    } catch (e) {
      setProposals([])
      throw e
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  return (
    <div className="nle-dialog-backdrop">
      <section
        className="nle-dialog nle-agent"
        role="dialog"
        aria-modal="true"
        aria-label="Studio assistant"
      >
        <header>
          <h2>Studio assistant</h2>
          <button onClick={onClose}>Close</button>
        </header>
        <nav>
          <button disabled={busy} onClick={() => setTab("chat")}>
            Chat
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setTab("instructions")
              void action(async () =>
                load(await instruction({ action: "inspect" })),
              )
            }}
          >
            Instructions
          </button>
        </nav>
        {error && <p role="alert">{error}</p>}
        {tab === "chat" ? (
          <>
            <p>
              Save your project before asking for edits. Review proposals before
              applying them. Narration and publication are not available here.
            </p>
            <label>
              Message
              <textarea
                value={message}
                maxLength={8000}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <button
              disabled={
                busy ||
                !message.trim() ||
                session.getSnapshot().status !== "saved"
              }
              onClick={() =>
                void action(() =>
                  stream({
                    kind: "chat",
                    input: {
                      projectId,
                      expectedRevision: session.getSnapshot().revision,
                      idempotencyKey: crypto.randomUUID(),
                      message,
                    },
                  }),
                )
              }
            >
              Send
            </button>
            {busy && (
              <button onClick={() => controller.current?.abort()}>Stop</button>
            )}
            <div aria-live="polite" className="nle-agent-output">
              {text}
            </div>
            {diagnostics.map((d, i) => (
              <details key={i}>
                <summary>Run details</summary>
                <pre>{d}</pre>
              </details>
            ))}
            {proposals.map((p, i) => (
              <article key={p.command.idempotencyKey}>
                <h3>{p.summary}</h3>
                <p>Based on revision {p.command.expectedRevision}</p>
                {p.quality && (
                  <details>
                    <summary>Quality findings and spoken role coverage</summary>
                    <pre>{JSON.stringify(p.quality, null, 2)}</pre>
                  </details>
                )}
                <details>
                  <summary>Proposed changes</summary>
                  <pre>{JSON.stringify(p.command.operations, null, 2)}</pre>
                </details>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const state = session.getSnapshot()
                      if (
                        state.status !== "saved" ||
                        state.revision !== p.command.expectedRevision
                      )
                        throw new Error(
                          "Project changed. Save and request a new proposal.",
                        )
                      const previous = structuredClone(state.document),
                        response = await agentRequest({
                          kind: "apply",
                          input: p.command,
                        }),
                        result = (await response.json())
                          .result as StudioCommandResult
                      await session.reload()
                      setUndo({ document: previous, revision: result.revision })
                      setProposals((ps) => ps.filter((_, n) => n !== i))
                      setDiagnostics((d) => [
                        ...d,
                        `Applied as delegated hosted edit at revision ${result.revision}`,
                      ])
                    })
                  }
                >
                  Apply proposal
                </button>
              </article>
            ))}
            {undo && (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    if (session.getSnapshot().status !== "saved")
                      throw new Error("Save local changes first")
                    await studioCall("apply", {
                      projectId,
                      expectedRevision: undo.revision,
                      idempotencyKey: crypto.randomUUID(),
                      operations: [
                        { kind: "restore-document", document: undo.document },
                      ],
                    })
                    await session.reload()
                    setUndo(null)
                    setDiagnostics((d) => [
                      ...d,
                      "Undo saved as a new revision",
                    ])
                  })
                }
              >
                Undo applied proposal
              </button>
            )}
          </>
        ) : (
          view && (
            <>
              <p>
                Active:{" "}
                {view.activeVersionId ??
                  "None — activate a version before chatting"}
                . Saving and testing do not activate instructions.
              </p>
              <label>
                Draft instructions
                <textarea
                  rows={10}
                  value={draft}
                  maxLength={16000}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>
              {view.suggestedDefaults && (
                <button
                  disabled={busy}
                  onClick={() => setDraft(view.suggestedDefaults!)}
                >
                  Load creative defaults into draft
                </button>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    load(
                      await instruction({
                        action: "save",
                        expectedVersionId: view.latest.id,
                        content: draft,
                      }),
                    ),
                  )
                }
              >
                Save draft
              </button>
              <label>
                Version
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value)
                    setComparison(null)
                  }}
                >
                  {view.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      Version {v.versionNumber}
                      {v.id === view.activeVersionId ? " · active" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setComparison(
                      await instruction({
                        action: "compare",
                        from: view.activeVersionId ?? view.latest.id,
                        to: selected,
                      }),
                    ),
                  )
                }
              >
                Compare with active
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    load(
                      await instruction({
                        action: "restore",
                        versionId: selected,
                        expectedVersionId: view.latest.id,
                      }),
                    ),
                  )
                }
              >
                Restore as new draft
              </button>
              <button
                disabled={busy || selected === view.activeVersionId}
                onClick={() =>
                  void action(async () =>
                    load(
                      await instruction({
                        action: "activate",
                        versionId: selected,
                        expectedActiveVersionId: view.activeVersionId,
                      }),
                    ),
                  )
                }
              >
                Activate selected version
              </button>
              {comparison && (
                <div className="nle-agent-compare">
                  <pre>{comparison.from.content}</pre>
                  <pre>{comparison.to.content}</pre>
                </div>
              )}
              <details>
                <summary>Native source guidance block</summary>
                <pre>{view.block.content}</pre>
                <p>{view.block.resolvedVersionId}</p>
              </details>
              <label>
                Test message
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={8000}
                />
              </label>
              <button
                disabled={busy || !message.trim()}
                onClick={() =>
                  void action(() =>
                    stream({
                      kind: "instructions",
                      input: {
                        action: "test",
                        language: session.getSnapshot().document.language,
                        selection: {
                          mode: "version",
                          versionId: selected,
                          blockVersionId: view.block.resolvedVersionId,
                        },
                        message,
                      },
                    }),
                  )
                }
              >
                Test selected version
              </button>
              <div className="nle-agent-output" aria-live="polite">
                {text}
              </div>
            </>
          )
        )}
      </section>
    </div>
  )
}
