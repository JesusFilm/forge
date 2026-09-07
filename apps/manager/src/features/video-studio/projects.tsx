"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import type { Route } from "next"
import { Plus, Film, ArrowLeft } from "lucide-react"
import type {
  StudioCommandResult,
  StudioDocument,
} from "@forge/studio-contracts"
import { studioCall } from "./client"
import "./studio.css"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"

type Summary = {
  projectId: string
  revision: number
  lifecycle: string
  title: string
  width: number
  height: number
  durationInFrames: number
  fps: number
}
export const newDocument = (
  title = "Untitled project",
  language = "english",
  width = 1920,
  height = 1080,
): StudioDocument => ({
  version: 1,
  title,
  language,
  runtimeVersion: STUDIO_RUNTIME_VERSION,
  width,
  height,
  fps: 30,
  durationInFrames: 900,
  tracks: [
    { id: "visual-1", kind: "visual" },
    { id: "visual-2", kind: "visual" },
    { id: "audio-1", kind: "audio" },
  ],
  items: [],
  components: [],
  packRevisionIds: [],
})
export function StudioProjects() {
  const [rows, setRows] = useState<Summary[] | null>(null),
    [error, setError] = useState("")
  useEffect(() => {
    let active = true
    studioCall<Summary[]>("list", { limit: 100 })
      .then((v) => {
        if (active) setRows(v)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [])
  return (
    <section className="nle-projects">
      <header>
        <div>
          <p className="nle-eyebrow">VIDEO STUDIO</p>
          <h1>Your projects</h1>
          <p>Build a story with footage, sound and your own composition.</p>
        </div>
        <Link href="/dashboard/shorts/new" className="nle-primary">
          <Plus size={16} />
          New project
        </Link>
      </header>
      {error ? (
        <p role="alert">{error}</p>
      ) : rows === null ? (
        <p>Loading projects…</p>
      ) : rows.length === 0 ? (
        <div className="nle-empty">
          <Film size={36} />
          <h2>A blank canvas for your next story</h2>
          <p>Create a standalone project. Arrange it your way.</p>
          <Link href="/dashboard/shorts/new">Create your first project</Link>
        </div>
      ) : (
        <div className="nle-project-grid">
          {rows.map((p) => (
            <Link
              key={p.projectId}
              href={`/dashboard/shorts/${p.projectId}` as Route}
              className="nle-project-card"
            >
              <div className="nle-project-poster">
                <Film size={36} />
                <span>
                  {p.width} × {p.height}
                </span>
              </div>
              <h2>{p.title}</h2>
              <p>
                {Math.round(p.durationInFrames / p.fps)} sec · Revision{" "}
                {p.revision} · {p.lifecycle.toLowerCase()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
export function StudioCreate() {
  const [title, setTitle] = useState("Untitled project"),
    [language, setLanguage] = useState("english"),
    [width, setWidth] = useState(1920),
    [height, setHeight] = useState(1080),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      const projectId = crypto.randomUUID()
      await studioCall<StudioCommandResult>("create", {
        projectId,
        expectedRevision: 0,
        idempotencyKey: crypto.randomUUID(),
        document: newDocument(title.trim(), language, width, height),
      })
      window.location.assign(`/dashboard/shorts/${projectId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project")
      setBusy(false)
    }
  }
  return (
    <section className="nle-create">
      <Link href="/dashboard/shorts">
        <ArrowLeft size={14} />
        Projects
      </Link>
      <p className="nle-eyebrow">VIDEO STUDIO</p>
      <h1>Start a new project</h1>
      <p>A standalone composition, ready for your ideas.</p>
      <form onSubmit={create}>
        <label>
          Project title
          <input
            autoFocus
            value={title}
            maxLength={300}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Source language
          <input
            value={language}
            required
            pattern="[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}"
            onChange={(e) => setLanguage(e.target.value)}
          />
          <small>Exact Forge language slug, for example english.</small>
        </label>
        <div className="nle-row">
          <label>
            Width
            <input
              type="number"
              min={16}
              max={7680}
              value={width}
              onChange={(e) => setWidth(+e.target.value)}
            />
          </label>
          <label>
            Height
            <input
              type="number"
              min={16}
              max={7680}
              value={height}
              onChange={(e) => setHeight(+e.target.value)}
            />
          </label>
        </div>
        <div className="nle-row">
          {[
            [1920, 1080, "Landscape"],
            [1080, 1920, "Portrait"],
            [1080, 1080, "Square"],
          ].map(([w, h, name]) => (
            <button
              type="button"
              key={name}
              onClick={() => {
                setWidth(Number(w))
                setHeight(Number(h))
              }}
            >
              {name}
            </button>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        <button className="nle-primary" disabled={busy || !title.trim()}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </form>
    </section>
  )
}
