"use client"
import { LibraryImage } from "./library-image"
import { tracksForGroup } from "./timeline-layout"
import { insertLibraryItem, type MediaLocation } from "./library-insertion"
import { useMediaDrag, type MediaDrag } from "./media-drag"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import {
  Upload,
  Plus,
  Search,
  Music,
  ImageIcon,
  Code,
  Film,
} from "lucide-react"
import type { ShortAssetVersion } from "@forge/studio-contracts/assets"
import {
  studioComponentSchema,
  type StudioTimelineItem,
} from "@forge/studio-contracts"
import type { ShortSourceSnapshot } from "@forge/studio-contracts/sources"
import { STUDIO_RUNTIME_VERSION } from "@forge/studio-contracts/preview"
import { studioCall } from "./client"
import type { EditorSession, EditorSnapshot } from "./editor-session"
type Candidate = {
  videoId: string
  dubId: string
  editionId: string
  language: string
  title: string
  durationMs: number
  thumbnailUrl?: string
  tracks: { id: string; primary: boolean; aiGenerated: boolean }[]
  downloads: { id: string; height: number; quality: string }[]
}
const template = `import React from "react";\nimport {AbsoluteFill,useCurrentFrame} from "remotion";\nexport default function Card({title,color}) {\n  const frame = useCurrentFrame();\n  return <AbsoluteFill style={{alignItems:"center",justifyContent:"center",fontSize:80,color,opacity:Math.min(1,frame/15)}}>{title}</AbsoluteFill>;\n}`
const assetCategories = [
  { id: "video", label: "Videos", Icon: Film },
  { id: "image", label: "Images", Icon: ImageIcon },
  { id: "audio", label: "Audio", Icon: Music },
] as const
const librarySections = [
  { id: "media", label: "Media", Icon: Film },
  { id: "custom", label: "Custom component", Icon: Code },
] as const
const uploadTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]
function formatLibraryDuration(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return "—"
  const seconds = Math.round(value / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return (
    [minutes ? `${minutes}m` : "", remainder ? `${remainder}s` : ""]
      .filter(Boolean)
      .join(" ") || "0s"
  )
}
class StudioLibraryError extends Error {}

export function Library({
  session,
  state,
  active,
  incomingFiles,
  onIncomingFilesHandled,
}: {
  session: EditorSession
  state: EditorSnapshot
  active: boolean
  incomingFiles?: File[]
  onIncomingFilesHandled?: (count: number) => void
}) {
  const [tab, setTab] = useState("footage"),
    [query, setQuery] = useState(""),
    [rows, setRows] = useState<Candidate[]>([]),
    [assets, setAssets] = useState<ShortAssetVersion[]>([]),
    [choice, setChoice] = useState<Candidate | null>(null),
    [track, setTrack] = useState(""),
    [download, setDownload] = useState(""),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(10),
    [busy, setBusy] = useState(false),
    [componentName, setComponentName] = useState("Title card"),
    [componentCategory, setComponentCategory] = useState<"text" | "video">(
      "text",
    ),
    [source, setSource] = useState(template),
    [controls, setControls] = useState(
      '{"title":{"type":"text","maxLength":200},"color":{"type":"color"}}',
    )
  const [assetCategory, setAssetCategory] =
    useState<(typeof assetCategories)[number]["id"]>("image")
  const category = assetCategories.find((entry) => entry.id === assetCategory)!
  const fileInput = useRef<HTMLInputElement>(null)
  const uploading = useRef(false)
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>(
    {},
  )
  const [uploadedAssets, setUploadedAssets] = useState<ShortAssetVersion[]>([])
  const browser = useRef<HTMLElement>(null)
  const mounted = useRef(false)
  const inserting = useRef(false)
  const drag = useMediaDrag()
  const [selectedAsset, setSelectedAsset] = useState<ShortAssetVersion | null>(
    null,
  )
  const [error, onError] = useState("")
  const [loading, setLoading] = useState(true)
  const visibleAssets = [...uploadedAssets, ...assets].filter(
    (asset, index, all) =>
      asset.mimeType.startsWith(`${assetCategory}/`) &&
      asset.filename.toLowerCase().includes(query.trim().toLowerCase()) &&
      all.findIndex(
        (entry) => entry.reference.versionId === asset.reference.versionId,
      ) === index,
  )
  const empty =
    !loading &&
    !error &&
    (tab === "footage"
      ? rows.length === 0
      : tab === "assets"
        ? visibleAssets.length === 0
        : false)
  const mediaTab = tab === "footage" || tab === "assets"
  const emptyDropZone = mediaTab && state.editable
  function changeSection(next: string) {
    if (tab === next) return
    setTab(next)
    setQuery("")
    setRows([])
    setAssets([])
    setSelectedAsset(null)
    setLoading(next !== "custom")
    onError("")
  }
  function clearSearch() {
    setQuery("")
    setLoading(true)
    setRows([])
    setAssets([])
    setSelectedAsset(null)
    browser.current
      ?.querySelector<HTMLInputElement>('[aria-label="Search library"]')
      ?.focus()
  }
  const doc = state.document
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!active) return
    if (choice)
      browser.current
        ?.querySelector<HTMLButtonElement>(".nle-source-selection button")
        ?.focus()
    else browser.current?.querySelector<HTMLInputElement>("input")?.focus()
  }, [choice, active])
  useEffect(() => {
    if (!active) return
    let current = true
    const timer = setTimeout(() => {
      const input = query ? { search: query, limit: 30 } : { limit: 30 }
      const task =
        tab === "footage"
          ? studioCall<Candidate[]>("search", {
              search: query,
              language: doc.language,
            }).then((v) => {
              if (current) setRows(v)
            })
          : tab === "assets"
            ? studioCall<ShortAssetVersion[]>("assets", input).then((v) => {
                if (current) setAssets(v)
              })
            : Promise.resolve()
      task
        .catch((e) => {
          if (current)
            onError(e instanceof Error ? e.message : "Library unavailable")
        })
        .finally(() => {
          if (current) setLoading(false)
        })
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [tab, query, doc.language, onError, active])
  function insert(
    item: StudioTimelineItem,
    location?: MediaLocation,
    name?: string,
  ) {
    if (!mounted.current) return
    insertLibraryItem(
      session,
      item,
      location ?? { startFrame: session.getSnapshot().playhead },
    )
    if (
      name &&
      session.getSnapshot().document.items.some((entry) => entry.id === item.id)
    )
      drag?.remember(item.id, name)
  }
  const base = (kind: "visual" | "audio" = "visual") => ({
    id: crypto.randomUUID(),
    trackId:
      tracksForGroup(doc, kind === "audio" ? "Audio" : "Visual")[0]?.id ??
      crypto.randomUUID(),
    startFrame: state.playhead,
    durationInFrames: 150,
  })
  async function captureSource(
    row: Candidate,
    selection: { track: string; download: string; start: number; end: number },
    location?: MediaLocation,
  ) {
    if (inserting.current || !session.getSnapshot().editable) return
    const { track, download, start, end } = selection
    if (end <= start || start < 0 || end > row.durationMs / 1000 || !download)
      return
    inserting.current = true
    setBusy(true)
    onError("")
    const language = session.getSnapshot().document.language
    if (row.language !== language) {
      inserting.current = false
      setBusy(false)
      onError("Project language changed. Search the library again.")
      return
    }
    try {
      const snapshot = await studioCall<ShortSourceSnapshot>("capture", {
        videoId: row.videoId,
        dubId: row.dubId,
        editionId: row.editionId,
        language: row.language,
        trackId: track || null,
        downloadId: download,
        startMs: Math.round(start * 1000),
        endMs: Math.round(end * 1000),
        idempotencyKey: crypto.randomUUID(),
      })
      if (
        !mounted.current ||
        session.getSnapshot().document.language !== language
      )
        return
      insert(
        {
          ...base(),
          kind: "video",
          durationInFrames: Math.max(
            1,
            Math.round((end - start) * session.getSnapshot().document.fps),
          ),
          source: snapshot.source,
          volume: 1,
        },
        location,
        row.title,
      )
    } catch (e) {
      onError(e instanceof Error ? e.message : "Source is unavailable")
    } finally {
      inserting.current = false
      setBusy(false)
    }
  }
  function footageDrag(row: Candidate, selected = false): MediaDrag {
    const selection = selected
      ? { track, download, start, end }
      : {
          track: row.tracks[0]?.id ?? "",
          download: row.downloads[0]?.id ?? "",
          start: 0,
          end: Math.min(10, row.durationMs / 1000),
        }
    return {
      kind: "video",
      name: row.title,
      durationInFrames: Math.max(
        1,
        Math.round((selection.end - selection.start) * doc.fps),
      ),
      thumbnail: row.thumbnailUrl,
      insert: (location) => captureSource(row, selection, location),
    }
  }
  const assetItem = (a: ShortAssetVersion): StudioTimelineItem =>
    a.mimeType.startsWith("audio/")
      ? {
          ...base("audio"),
          durationInFrames: assetDuration(a),
          kind: "audio",
          asset: a.reference,
          sourceStartMs: 0,
          volume: 1,
        }
      : {
          ...base(),
          durationInFrames: assetDuration(a),
          kind: "image",
          asset: a.reference,
        }
  function assetName(asset: ShortAssetVersion) {
    const title = asset.provenance?.recorded?.title
    return (
      (typeof title === "string" && title.trim()) ||
      asset.filename?.trim() ||
      "Untitled media"
    )
  }
  function assetDuration(asset: ShortAssetVersion) {
    const duration = asset.provenance.recorded.durationMs
    return asset.mimeType.startsWith("audio/") &&
      typeof duration === "number" &&
      Number.isFinite(duration) &&
      duration > 0
      ? Math.max(1, Math.min(2592000, Math.round((duration * doc.fps) / 1000)))
      : doc.fps * 5
  }
  function startDrag(event: React.DragEvent<HTMLElement>, media: MediaDrag) {
    if (busy || !state.editable || !drag) {
      event.preventDefault()
      return
    }
    drag.begin(event, media)
  }
  async function uploadFiles(files: File[]) {
    if (
      !files.length ||
      busy ||
      uploading.current ||
      !state.editable ||
      !active
    )
      return
    const invalid = files.find(
      (file) =>
        !uploadTypes.includes(file.type) ||
        !file.size ||
        file.size > 16 * 1024 * 1024,
    )
    if (invalid) {
      onError(
        `“${invalid.name}”: choose a supported image, video or audio file up to 16 MiB.`,
      )
      return
    }
    uploading.current = true
    setBusy(true)
    onError("")
    const uploaded: ShortAssetVersion[] = []
    const failed: string[] = []
    try {
      for (const file of files) {
        try {
          const form = new FormData()
          form.set("file", file)
          form.set(
            "role",
            file.type.startsWith("audio/") ? "music" : "background",
          )
          const response = await fetch("/api/shorts/upload", {
            method: "POST",
            body: form,
          })
          if (!response.ok) throw new StudioLibraryError("Asset upload failed")
          uploaded.push(await response.json())
        } catch {
          failed.push(file.name)
        }
        if (!mounted.current) return
      }
      if (uploaded.length) {
        setUploadedAssets((rows) => [...uploaded, ...rows])
        setSelectedAsset(null)
        setQuery("")
        setTab("assets")
        const first = uploaded[0]!
        setAssetCategory(
          first.mimeType.startsWith("video/")
            ? "video"
            : first.mimeType.startsWith("audio/")
              ? "audio"
              : "image",
        )
      }
      if (failed.length)
        onError(`Could not upload: ${failed.join(", ")}. Try again.`)
    } finally {
      uploading.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const uploadIncomingFiles = useEffectEvent((files: File[]) => {
    void uploadFiles(files)
    onIncomingFilesHandled?.(files.length)
  })
  useEffect(() => {
    if (!incomingFiles?.length || !active || busy || !state.editable) return
    uploadIncomingFiles(incomingFiles)
  }, [incomingFiles, active, busy, state.editable])
  async function custom() {
    setBusy(true)
    try {
      const form = new FormData()
      form.set(
        "file",
        new File([source], "component.tsx", { type: "text/plain" }),
      )
      form.set("role", "component")
      const res = await fetch("/api/shorts/upload", {
        method: "POST",
        body: form,
      })
      if (!res.ok) throw new StudioLibraryError("Component upload failed")
      const asset: ShortAssetVersion = await res.json()
      const component = studioComponentSchema.parse({
        versionId: crypto.randomUUID(),
        name: componentName.trim(),
        category: componentCategory,
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
        tracks: d.tracks.some((track) => track.id === item.trackId)
          ? d.tracks
          : [
              ...d.tracks,
              {
                id: item.trackId,
                kind: "visual",
              },
            ],
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
    <section
      ref={browser}
      className="nle-media-browser"
      aria-label="Media browser"
      onDragEnd={() => drag?.clear()}
    >
      {error && (
        <p className="nle-error" role="alert">
          {error}
        </p>
      )}
      {!choice && (
        <>
          <nav className="nle-library-tabs" aria-label="Content categories">
            {librarySections.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={
                  (id === "media" ? mediaTab : tab === id) ? "true" : undefined
                }
                aria-controls="nle-library-content"
                disabled={busy}
                onClick={() => {
                  if (id === "media" && mediaTab) return
                  changeSection(id === "media" ? "footage" : id)
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          <div className="nle-library-content" id="nle-library-content">
            {!mediaTab && (
              <h2>
                {librarySections.find((section) => section.id === tab)?.label}
              </h2>
            )}
            {mediaTab && (
              <nav className="nle-asset-categories" aria-label="Media types">
                <button
                  type="button"
                  aria-pressed={tab === "footage"}
                  disabled={busy}
                  onClick={() => changeSection("footage")}
                >
                  <Film size={15} />
                  JFP
                </button>
                {assetCategories.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={tab === "assets" && assetCategory === id}
                    disabled={busy}
                    onClick={() => {
                      setAssetCategory(id)
                      setSelectedAsset(null)
                      changeSection("assets")
                    }}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </nav>
            )}
            {tab !== "custom" && (
              <div className="nle-library-toolbar">
                <label className="nle-search">
                  <Search size={14} />
                  <input
                    aria-label="Search library"
                    disabled={busy}
                    placeholder={
                      tab === "footage"
                        ? "Search footage in this project’s language…"
                        : `Search ${category.label.toLowerCase()}…`
                    }
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      setLoading(true)
                      setRows([])
                      setAssets([])
                      onError("")
                    }}
                  />
                </label>
                {mediaTab && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      aria-label="Upload media files"
                      hidden
                      multiple
                      accept={uploadTypes.join(",")}
                      disabled={busy || !state.editable}
                      onChange={(event) => {
                        void uploadFiles(Array.from(event.target.files ?? []))
                        event.target.value = ""
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy || !state.editable}
                      onClick={() => fileInput.current?.click()}
                    >
                      <Upload size={15} />
                      {uploading.current ? "Uploading…" : "Upload"}
                    </button>
                  </>
                )}
              </div>
            )}
            {uploading.current && (
              <p role="status" className="nle-muted">
                Uploading media…
              </p>
            )}
            {loading && tab !== "custom" && (
              <div
                role="status"
                aria-label="Searching library"
                aria-busy="true"
              >
                <div
                  className="nle-media-grid nle-library-skeletons"
                  aria-hidden="true"
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <div className="nle-library-skeleton" key={index}>
                      <div className="nle-library-skeleton-image" />
                      <div className="nle-library-skeleton-title" />
                      <div className="nle-library-skeleton-caption" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tab === "footage" && !loading && (
              <div className="nle-media-grid">
                {rows.map((row) => (
                  <button
                    key={row.dubId}
                    className="nle-library-card"
                    disabled={busy || !state.editable || !row.downloads.length}
                    draggable={
                      !busy && state.editable && Boolean(row.downloads.length)
                    }
                    onDragStart={(event) => startDrag(event, footageDrag(row))}
                    onClick={() => {
                      onError("")
                      setChoice(row)
                      setTrack(row.tracks[0]?.id ?? "")
                      setDownload(row.downloads[0]!.id)
                      setStart(0)
                      setEnd(Math.min(10, row.durationMs / 1000))
                    }}
                  >
                    <div className="nle-thumbnail">
                      <Film size={26} />
                      {row.thumbnailUrl && (
                        // Prefer supplied catalog artwork; no image optimization proxy.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          draggable={false}
                          onError={(e) => {
                            e.currentTarget.hidden = true
                          }}
                        />
                      )}
                    </div>
                    <strong title={row.title}>{row.title}</strong>
                    <span>
                      {row.language} · {formatLibraryDuration(row.durationMs)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {tab === "assets" && !loading && (
              <>
                <div className="nle-media-grid">
                  {visibleAssets.map((a) => (
                    <button
                      key={a.reference.versionId}
                      className="nle-library-card"
                      disabled={busy || !state.editable}
                      aria-pressed={
                        selectedAsset?.reference.versionId ===
                        a.reference.versionId
                      }
                      draggable={
                        !busy && state.editable && assetCategory !== "video"
                      }
                      onDragStart={(event) => {
                        if (assetCategory === "video") {
                          event.preventDefault()
                          return
                        }
                        startDrag(event, {
                          kind: a.mimeType.startsWith("audio/")
                            ? "audio"
                            : "image",
                          name: assetName(a),
                          durationInFrames: assetDuration(a),
                          insert: (location) =>
                            insert(assetItem(a), location, assetName(a)),
                        })
                      }}
                      onClick={() => setSelectedAsset(a)}
                    >
                      <div className="nle-thumbnail">
                        {assetCategory === "video" ? (
                          <>
                            <Film size={24} />
                            <LibraryImage
                              reference={a.reference}
                              active={active}
                              onDuration={(durationMs) =>
                                setVideoDurations((values) =>
                                  values[a.reference.versionId] === durationMs
                                    ? values
                                    : {
                                        ...values,
                                        [a.reference.versionId]: durationMs,
                                      },
                                )
                              }
                            />
                          </>
                        ) : a.mimeType.startsWith("audio/") ? (
                          <Music size={24} />
                        ) : (
                          <>
                            <ImageIcon size={24} />
                            <LibraryImage
                              reference={a.reference}
                              active={active}
                            />
                          </>
                        )}
                      </div>
                      <strong title={assetName(a)}>{assetName(a)}</strong>
                      <span>
                        {assetCategory === "video"
                          ? formatLibraryDuration(
                              videoDurations[a.reference.versionId] ??
                                a.provenance?.recorded?.durationMs,
                            )
                          : a.role}
                      </span>
                    </button>
                  ))}
                </div>
                {selectedAsset && assetCategory !== "video" && (
                  <div className="nle-media-selection">
                    <strong>{assetName(selectedAsset)}</strong>
                    <button
                      disabled={busy || !state.editable}
                      onClick={() =>
                        insert(
                          assetItem(selectedAsset),
                          undefined,
                          assetName(selectedAsset),
                        )
                      }
                    >
                      <Plus size={15} />
                      Add to timeline
                    </button>
                  </div>
                )}
              </>
            )}
            {empty && (
              <div
                className={`nle-library-empty${emptyDropZone ? " nle-empty-drop-zone" : ""}`}
                role="status"
              >
                <div className="nle-library-empty-icon" aria-hidden="true">
                  {emptyDropZone ? (
                    tab === "footage" ? (
                      <Film size={28} />
                    ) : (
                      <category.Icon size={28} />
                    )
                  ) : query.trim() ? (
                    <Search size={24} />
                  ) : tab === "assets" ? (
                    <category.Icon size={24} />
                  ) : (
                    <Film size={24} />
                  )}
                </div>
                <h3>
                  {query.trim()
                    ? `No results for “${query.trim()}”`
                    : emptyDropZone
                      ? tab === "footage"
                        ? "No JFP footage available"
                        : `Drop ${category.label.toLowerCase()} here`
                      : tab === "assets"
                        ? `No shared ${category.label.toLowerCase()} yet`
                        : "No footage available"}
                </h3>
                {(!emptyDropZone || query.trim()) && (
                  <p>
                    {query.trim()
                      ? "Try a different search or clear it to browse the library."
                      : tab === "assets"
                        ? assetCategory === "video"
                          ? "Shared video files will appear here when they’re available."
                          : `Upload ${assetCategory === "image" ? "an image" : "an audio file"} to start building your edit.`
                        : "Playable footage in this project’s language will appear here."}
                  </p>
                )}
                {emptyDropZone && (
                  <p>
                    {tab === "footage"
                      ? "Upload your own media to get started."
                      : assetCategory === "video"
                        ? "Drop video clips or choose Upload."
                        : assetCategory === "image"
                          ? "Drop photos or graphics, or choose Upload."
                          : "Drop music or voiceovers, or choose Upload."}
                  </p>
                )}
                {emptyDropZone && (
                  <button
                    type="button"
                    className="nle-primary"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload size={15} />
                    {uploading.current ? "Uploading…" : "Upload"}
                  </button>
                )}
                {query.trim() && (
                  <button type="button" onClick={clearSearch}>
                    Clear search
                  </button>
                )}
              </div>
            )}
            {tab === "custom" && (
              <>
                <p className="nle-muted">
                  Add a component with its own editable controls.
                </p>
                <label>
                  Component name
                  <input
                    value={componentName}
                    maxLength={200}
                    onChange={(e) => setComponentName(e.target.value)}
                  />
                </label>
                <label>
                  Component type
                  <select
                    value={componentCategory}
                    onChange={(e) =>
                      setComponentCategory(e.target.value as "text" | "video")
                    }
                  >
                    <option value="text">Text</option>
                    <option value="video">Video</option>
                  </select>
                </label>
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
                <button
                  disabled={busy || !state.editable || !componentName.trim()}
                  onClick={custom}
                >
                  <Plus size={14} />
                  Add component
                </button>
              </>
            )}
          </div>
        </>
      )}
      {choice && (
        <section
          className="nle-source-selection"
          aria-label="Add source footage"
        >
          <button
            disabled={busy}
            onClick={() => {
              setChoice(null)
              onError("")
            }}
          >
            Back to results
          </button>
          <h2>{choice.title}</h2>
          <p>{choice.language} · Exact source selection</p>
          <label>
            Subtitle track
            <select value={track} onChange={(e) => setTrack(e.target.value)}>
              <option value="">No subtitles</option>
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
            Choose the source range to add to your timeline.
          </p>
          <div className="nle-row">
            <button disabled={busy} onClick={() => setChoice(null)}>
              Cancel
            </button>
            <button
              className="nle-primary"
              disabled={
                busy ||
                !state.editable ||
                !download ||
                start < 0 ||
                end <= start ||
                end > choice.durationMs / 1000
              }
              draggable={
                !busy &&
                state.editable &&
                Boolean(download) &&
                start >= 0 &&
                end > start &&
                end <= choice.durationMs / 1000
              }
              onDragStart={(event) =>
                startDrag(event, footageDrag(choice, true))
              }
              onClick={() =>
                void captureSource(choice, { track, download, start, end })
              }
            >
              {busy ? "Resolving source…" : "Add footage"}
            </button>
          </div>
        </section>
      )}
    </section>
  )
}
