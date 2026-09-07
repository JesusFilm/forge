"use client"
import { useEffect, useState } from "react"
import {
  Plus,
  Search,
  Type,
  Music,
  ImageIcon,
  Code,
  Film,
  Folder,
} from "lucide-react"
import type { StudioAssetVersion } from "@forge/studio-contracts/assets"
import {
  studioComponentSchema,
  type StudioTimelineItem,
} from "@forge/studio-contracts"
import type { StudioSourceSnapshot } from "@forge/studio-contracts/sources"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import type { ContentPackDocument } from "@forge/studio-contracts/content-packs"
import { studioCall } from "./client"
import type { EditorSession, EditorSnapshot } from "./editor-session"
type Candidate = {
  videoId: string
  dubId: string
  editionId: string
  language: string
  title: string
  durationMs: number
  tracks: { id: string; primary: boolean; aiGenerated: boolean }[]
  downloads: { id: string; height: number; quality: string }[]
}
type Pack = { id: string; document: ContentPackDocument }
const template = `import React from "react";\nimport {AbsoluteFill,useCurrentFrame} from "remotion";\nexport default function Card({title,color}) {\n  const frame = useCurrentFrame();\n  return <AbsoluteFill style={{alignItems:"center",justifyContent:"center",fontSize:80,color,opacity:Math.min(1,frame/15)}}>{title}</AbsoluteFill>;\n}`
class StudioLibraryError extends Error {}

export function Library({
  session,
  state,
  onError,
}: {
  session: EditorSession
  state: EditorSnapshot
  onError: (s: string) => void
}) {
  const [tab, setTab] = useState("footage"),
    [query, setQuery] = useState(""),
    [rows, setRows] = useState<Candidate[]>([]),
    [assets, setAssets] = useState<StudioAssetVersion[]>([]),
    [packs, setPacks] = useState<Pack[]>([]),
    [choice, setChoice] = useState<Candidate | null>(null),
    [track, setTrack] = useState(""),
    [download, setDownload] = useState(""),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(10),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState(template),
    [controls, setControls] = useState(
      '{"title":{"type":"text","maxLength":200},"color":{"type":"color"}}',
    )
  const doc = state.document
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      const input = query ? { search: query, limit: 30 } : { limit: 30 }
      const task =
        tab === "footage"
          ? studioCall<Candidate[]>("search", {
              search: query,
              language: doc.language,
            }).then((v) => {
              if (active) setRows(v)
            })
          : tab === "packs"
            ? studioCall<Pack[]>("packs", input).then((v) => {
                if (active) setPacks(v)
              })
            : tab === "assets"
              ? studioCall<StudioAssetVersion[]>("assets", input).then((v) => {
                  if (active) setAssets(v)
                })
              : Promise.resolve()
      task.catch((e) => {
        if (active) onError(e.message)
      })
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [tab, query, doc.language, onError])
  function insert(item: StudioTimelineItem) {
    session.edit((d) => ({
      ...d,
      durationInFrames: Math.max(
        d.durationInFrames,
        item.startFrame + item.durationInFrames,
      ),
      items: [...d.items, item],
    }))
    session.select(item.id)
  }
  const base = (kind: "visual" | "audio" = "visual") => ({
    id: crypto.randomUUID(),
    trackId: doc.tracks.find((t) => t.kind === kind)?.id ?? doc.tracks[0]!.id,
    startFrame: state.playhead,
    durationInFrames: 150,
  })
  async function capture() {
    if (!choice) return
    setBusy(true)
    try {
      const snapshot = await studioCall<StudioSourceSnapshot>("capture", {
        videoId: choice.videoId,
        dubId: choice.dubId,
        editionId: choice.editionId,
        language: choice.language,
        trackId: track,
        downloadId: download,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        idempotencyKey: crypto.randomUUID(),
      })
      insert({
        ...base(),
        kind: "video",
        durationInFrames: Math.round((end - start) * doc.fps),
        source: snapshot.source,
        volume: 1,
      })
      setChoice(null)
    } catch (e) {
      onError(e instanceof Error ? e.message : "Source is unavailable")
    } finally {
      setBusy(false)
    }
  }
  async function upload(file: File) {
    setBusy(true)
    try {
      const form = new FormData()
      form.set("file", file)
      form.set("role", file.type.startsWith("audio/") ? "music" : "background")
      const response = await fetch("/api/studio/upload", {
        method: "POST",
        body: form,
      })
      if (!response.ok) throw new StudioLibraryError("Asset upload failed")
      const asset: StudioAssetVersion = await response.json()
      setAssets((rows) => [asset, ...rows])
      insert(
        file.type.startsWith("audio/")
          ? {
              ...base("audio"),
              kind: "audio",
              asset: asset.reference,
              sourceStartMs: 0,
              volume: 1,
            }
          : { ...base(), kind: "image", asset: asset.reference },
      )
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setBusy(false)
    }
  }
  async function custom() {
    setBusy(true)
    try {
      const form = new FormData()
      form.set(
        "file",
        new File([source], "component.tsx", { type: "text/plain" }),
      )
      form.set("role", "component")
      const res = await fetch("/api/studio/upload", {
        method: "POST",
        body: form,
      })
      if (!res.ok) throw new StudioLibraryError("Component upload failed")
      const asset: StudioAssetVersion = await res.json()
      const component = studioComponentSchema.parse({
        versionId: crypto.randomUUID(),
        code: asset.reference,
        runtimeVersion: STUDIO_RUNTIME_VERSION,
        dependencies: [
          { name: "react", version: "19.2.4" },
          { name: "remotion", version: "4.0.475" },
        ],
        width: doc.width,
        height: doc.height,
        duration: { minFrames: 1, maxFrames: 2592000 },
        assets: [],
        controls: JSON.parse(controls),
      })
      const properties = Object.fromEntries(
        Object.entries(component.controls).map(([key, c]) => [
          key,
          c.type === "text"
            ? "Your title"
            : c.type === "color"
              ? "#ffffff"
              : c.type === "number"
                ? c.min
                : c.type === "boolean"
                  ? true
                  : c.values[0]!,
        ]),
      )
      const item: StudioTimelineItem = {
        ...base(),
        kind: "component",
        componentVersionId: component.versionId,
        properties,
      }
      session.edit((d) => ({
        ...d,
        components: [...d.components, component],
        items: [...d.items, item],
        durationInFrames: Math.max(
          d.durationInFrames,
          item.startFrame + item.durationInFrames,
        ),
      }))
      session.select(item.id)
    } catch (e) {
      onError(e instanceof Error ? e.message : "Invalid component")
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside className="nle-library">
      <div className="nle-library-tabs">
        {[
          ["footage", Film],
          ["assets", Music],
          ["packs", Folder],
          ["custom", Code],
        ].map(([id, Icon]) => {
          const I = Icon as typeof Film
          return (
            <button
              key={String(id)}
              title={String(id)}
              aria-pressed={tab === id}
              onClick={() => setTab(String(id))}
            >
              <I size={17} />
            </button>
          )
        })}
      </div>
      <div className="nle-library-content">
        <h2>
          {tab === "footage"
            ? "Source library"
            : tab === "assets"
              ? "Shared assets"
              : tab === "packs"
                ? "Content Packs"
                : "Custom component"}
        </h2>
        <button
          className="nle-wide"
          disabled={!state.editable}
          onClick={() =>
            insert({
              ...base(),
              kind: "text",
              text: "Your text",
              properties: { fontSize: 72, color: "#ffffff", align: "center" },
            })
          }
        >
          <Type size={15} />
          Add text card
        </button>
        {tab !== "custom" && (
          <label className="nle-search">
            <Search size={14} />
            <input
              aria-label="Search library"
              placeholder="Search library"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        {tab === "footage" && (
          <>
            {rows.map((row) => (
              <button
                key={row.dubId}
                className="nle-library-card"
                onClick={() => {
                  setChoice(row)
                  setTrack(row.tracks[0]!.id)
                  setDownload(row.downloads[0]!.id)
                  setStart(0)
                  setEnd(Math.min(10, row.durationMs / 1000))
                }}
              >
                <div className="nle-thumbnail">
                  <Film size={26} />
                </div>
                <strong>{row.title}</strong>
                <span>
                  {row.language} · {Math.round(row.durationMs / 1000)} sec
                </span>
              </button>
            ))}
            {!rows.length && (
              <p className="nle-muted">
                No matching footage with an exact dub and timed subtitle track.
              </p>
            )}
          </>
        )}
        {tab === "assets" && (
          <>
            <label>
              Upload image or audio
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/mp4,audio/ogg"
                disabled={busy || !state.editable}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void upload(file)
                  e.target.value = ""
                }}
              />
            </label>
            {assets
              .filter(
                (a) =>
                  a.mimeType.startsWith("image/") ||
                  a.mimeType.startsWith("audio/"),
              )
              .map((a) => (
                <button
                  key={a.reference.versionId}
                  className="nle-library-card"
                  onClick={() =>
                    insert(
                      a.mimeType.startsWith("audio/")
                        ? {
                            ...base("audio"),
                            kind: "audio",
                            asset: a.reference,
                            sourceStartMs: 0,
                            volume: 1,
                          }
                        : { ...base(), kind: "image", asset: a.reference },
                    )
                  }
                >
                  {a.mimeType.startsWith("audio/") ? (
                    <Music size={24} />
                  ) : (
                    <ImageIcon size={24} />
                  )}
                  <strong>{a.filename}</strong>
                  <span>{a.role}</span>
                </button>
              ))}
            {!assets.length && (
              <p className="nle-muted">No retained assets yet.</p>
            )}
          </>
        )}
        {tab === "packs" &&
          packs.map((pack) => (
            <div key={pack.id} className="nle-pack">
              <strong>{pack.document.title}</strong>
              <p>{pack.document.guidance}</p>
              <small>{pack.document.sources.length} sources</small>
              <button
                onClick={() =>
                  session.edit((d) => ({
                    ...d,
                    packRevisionIds: d.packRevisionIds.includes(pack.id)
                      ? d.packRevisionIds.filter((id) => id !== pack.id)
                      : [...d.packRevisionIds, pack.id],
                  }))
                }
              >
                {doc.packRevisionIds.includes(pack.id)
                  ? "Remove from project"
                  : "Use this pack"}
              </button>
              <details>
                <summary>Source passages</summary>
                {pack.document.sources.map((s, i) => (
                  <blockquote key={i}>
                    <strong>{s.label}</strong>
                    <p>{s.excerpt}</p>
                  </blockquote>
                ))}
              </details>
            </div>
          ))}
        {tab === "custom" && (
          <>
            <p className="nle-muted">
              Components expose only their declared controls. Code runs in the
              isolated preview.
            </p>
            <label>
              Component TSX
              <textarea
                className="nle-code"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                maxLength={32768}
              />
            </label>
            <label>
              Editable controls
              <textarea
                className="nle-code"
                value={controls}
                onChange={(e) => setControls(e.target.value)}
              />
            </label>
            <button disabled={busy || !state.editable} onClick={custom}>
              <Plus size={14} />
              Add component
            </button>
          </>
        )}
      </div>
      {choice && (
        <div className="nle-dialog-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Add source footage"
            className="nle-dialog"
          >
            <h2>{choice.title}</h2>
            <p>{choice.language} · Exact source selection</p>
            <label>
              Subtitle track
              <select value={track} onChange={(e) => setTrack(e.target.value)}>
                {choice.tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.primary ? "Primary" : "Alternate"} ·{" "}
                    {t.aiGenerated ? "AI" : "Catalog"} · {t.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Full-resolution source
              <select
                value={download}
                onChange={(e) => setDownload(e.target.value)}
              >
                {choice.downloads.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.height}p · {d.quality}
                  </option>
                ))}
              </select>
            </label>
            <div className="nle-row">
              <label>
                Source in (seconds)
                <input
                  type="number"
                  min={0}
                  max={choice.durationMs / 1000}
                  step={0.001}
                  value={start}
                  onChange={(e) => setStart(+e.target.value)}
                />
              </label>
              <label>
                Source out (seconds)
                <input
                  type="number"
                  min={start}
                  max={choice.durationMs / 1000}
                  step={0.001}
                  value={end}
                  onChange={(e) => setEnd(+e.target.value)}
                />
              </label>
            </div>
            <p className="nle-muted">
              Streaming preview prepares the selected range. No narration or
              movie render is requested.
            </p>
            <div className="nle-row">
              <button disabled={busy} onClick={() => setChoice(null)}>
                Cancel
              </button>
              <button
                className="nle-primary"
                disabled={busy || end <= start}
                onClick={capture}
              >
                {busy ? "Resolving source…" : "Add footage"}
              </button>
            </div>
          </section>
        </div>
      )}
    </aside>
  )
}
