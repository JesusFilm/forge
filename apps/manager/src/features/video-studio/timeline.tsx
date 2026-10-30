"use client"
import { AudioClipControls } from "./audio-clip-controls"
import { useMediaDrag, MediaDropClip, type MediaDrag } from "./media-drag"
import { mediaDropLocation } from "./media-drop"
import type { MediaLocation } from "./library-insertion"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  Plus,
  Minus,
  Volume2,
  Layers,
  Link2,
  Scan,
  ZoomIn,
  SlidersHorizontal,
} from "lucide-react"
import type { StudioTimelineItem } from "@forge/studio-contracts"
import { EditorSession, type EditorSnapshot } from "./editor-session"
import {
  timelineRows,
  timelineGroups,
  itemGroup,
  groupTrackKind,
  type TimelineGroup,
  type TimelineRow,
} from "./timeline-layout"

import { timelineRowHeight, timelineTimecode } from "./timeline-presentation"
import { AudioWaveform } from "./audio-waveform"
import { footageFrames, footageKey } from "./footage-presentation"
import { useFootagePresentation } from "./use-footage-presentation"
import { itemLabel } from "./item-presentation"
import { timelineZoomPresets, type TimelineZoomMode } from "./timeline-zoom"
import { timelineScale } from "./timeline-scale"
import {
  bindTimelineWheelZoom,
  applyTimelineWheelZoom,
} from "./timeline-wheel-zoom"
export { itemLabel } from "./item-presentation"
export function Timeline({
  session,
  state,
  onError,
  onScrub,
  projectId,
}: {
  projectId?: string
  session: EditorSession
  state: EditorSnapshot
  onError: (message: string) => void
  onScrub?: () => void
}) {
  const [zoomMode, setZoomMode] = useState<TimelineZoomMode>("fit")
  const mediaDrag = useMediaDrag()
  const [target, setMediaTarget] = useState<{
    media: MediaDrag
    rowId: string
    location: MediaLocation
  } | null>(null)
  const pendingMedia = mediaDrag?.media
  const mediaTarget = target?.media === pendingMedia ? target : null
  const zoomAnchor = useRef<number | null>(null)
  const position = useRef(state.playhead)
  useEffect(() => {
    position.current = state.playhead
  }, [state.playhead])
  const [zoom, setZoom] = useState(1),
    [drag, setDrag] = useState<{
      id: string
      start: number
      duration: number
      track: string
    } | null>(null)
  const dragStart = useRef<{
    x: number
    start: number
    duration: number
    sourceStart: number
    rate: number
    mode: "move" | "left" | "right"
    track: string
    linkedSourceAudio: boolean
  } | null>(null)
  const timeline = useRef<HTMLElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  useLayoutEffect(() => {
    const element = viewport.current!
    const measure = () => {
      const labels =
        element.firstElementChild?.getBoundingClientRect().width ?? 0
      setViewportWidth(Math.max(0, element.clientWidth - labels))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const scrubbing = useRef<number | null>(null)
  const footage = useFootagePresentation(projectId, state.document)
  const doc = state.document
  const presets = timelineZoomPresets(
    doc.durationInFrames,
    doc.fps,
    viewportWidth || 700,
  )
  const effectiveZoom =
    zoomMode === "fit"
      ? presets.fit
      : zoomMode === "detail"
        ? presets.detail
        : Math.max(presets.min, Math.min(presets.max, zoom))
  const { width, px } = timelineScale(
    doc.durationInFrames,
    doc.fps,
    effectiveZoom,
    viewportWidth,
  )
  function customZoom(value: number) {
    zoomAnchor.current = position.current
    setZoom(Math.max(presets.min, Math.min(presets.max, value)))
    setZoomMode("custom")
  }
  function selectZoomMode(next: TimelineZoomMode) {
    zoomAnchor.current = position.current
    if (next === zoomMode) {
      viewport.current!.scrollLeft =
        next === "fit"
          ? 0
          : Math.max(0, position.current * px - viewportWidth / 2)
      zoomAnchor.current = null
    }
    setZoomMode(next)
  }
  useEffect(
    () =>
      bindTimelineWheelZoom(timeline.current!, (factor) => {
        zoomAnchor.current = position.current
        setZoom(
          applyTimelineWheelZoom(
            effectiveZoom,
            factor,
            presets.min,
            presets.max,
          ),
        )
        setZoomMode("custom")
      }),
    [effectiveZoom, presets.min, presets.max],
  )
  useLayoutEffect(() => {
    if (zoomMode === "fit") viewport.current!.scrollLeft = 0
    else if (zoomAnchor.current !== null)
      viewport.current!.scrollLeft = Math.max(
        0,
        zoomAnchor.current * px - viewportWidth / 2,
      )
    zoomAnchor.current = null
  }, [px, viewportWidth, zoomMode])
  const rows = useMemo(() => timelineRows(doc), [doc])
  function hoverMedia(
    event: React.DragEvent<HTMLDivElement>,
    row: TimelineRow,
  ) {
    if (!pendingMedia || !state.editable || !area.current) return
    const location = mediaDropLocation(
      doc,
      pendingMedia.kind,
      row.id,
      (event.clientX - area.current.getBoundingClientRect().left) / px,
    )
    if (!location) {
      setMediaTarget(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    onScrub?.()
    setMediaTarget({
      media: pendingMedia,
      rowId: row.linkedSourceAudio
        ? row.id.replace(/^source-audio:/, "")
        : row.id,
      location,
    })
  }
  function seekAt(x: number) {
    if (area.current)
      session.seek((x - area.current.getBoundingClientRect().left) / px)
  }
  function scrubStart(e: React.PointerEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    onScrub?.()
    scrubbing.current = e.pointerId
    e.currentTarget.setPointerCapture(e.pointerId)
    seekAt(e.clientX)
  }
  useEffect(() => {
    const seek = (event: PointerEvent) => {
      if (scrubbing.current !== event.pointerId || !area.current) return
      session.seek(
        (event.clientX - area.current.getBoundingClientRect().left) / px,
      )
    }
    const end = (event: PointerEvent) => {
      if (scrubbing.current !== event.pointerId) return
      if (event.type !== "pointercancel") seek(event)
      scrubbing.current = null
    }
    const cancel = () => {
      scrubbing.current = null
    }
    // The playhead itself moves under the pointer. Follow the gesture at the
    // window boundary too, including when the pointer leaves its narrow handle.
    window.addEventListener("pointermove", seek)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    window.addEventListener("blur", cancel)
    return () => {
      cancel()
      window.removeEventListener("pointermove", seek)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      window.removeEventListener("blur", cancel)
    }
  }, [session, px])
  function addTrack(group: TimelineGroup) {
    session.edit((d) => ({
      ...d,
      tracks: [
        ...d.tracks,
        {
          id: crypto.randomUUID(),
          kind: groupTrackKind[group],
        },
      ],
    }))
  }
  function start(
    e: React.PointerEvent,
    item: StudioTimelineItem,
    mode: "move" | "left" | "right",
    linkedSourceAudio = false,
  ) {
    if (!state.editable) return
    e.preventDefault()
    e.stopPropagation()
    session.select(item.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = {
      linkedSourceAudio,
      x: e.clientX,
      start: item.startFrame,
      duration: item.durationInFrames,
      sourceStart:
        item.kind === "video"
          ? item.source.startMs
          : item.kind === "audio"
            ? item.sourceStartMs
            : (item.startFrame * 1000) / doc.fps,
      rate: item.kind === "video" ? (item.playbackRate ?? 1) : 1,
      mode,
      track: item.trackId,
    }
    setDrag({
      id: item.id,
      start: item.startFrame,
      duration: item.durationInFrames,
      track: item.trackId,
    })
  }
  function move(e: React.PointerEvent) {
    const a = dragStart.current
    if (!a || !drag) return
    const delta = Math.round((e.clientX - a.x) / px)
    let start = a.start,
      duration = a.duration
    if (a.mode === "move")
      start = Math.max(
        0,
        Math.min(doc.durationInFrames - duration, a.start + delta),
      )
    if (a.mode === "left") {
      start = Math.max(
        0,
        a.start - Math.floor((a.sourceStart * doc.fps) / (1000 * a.rate)),
        Math.min(a.start + a.duration - 1, a.start + delta),
      )
      duration = a.duration - (start - a.start)
    }
    if (a.mode === "right")
      duration = Math.max(
        1,
        Math.min(doc.durationInFrames - start, a.duration + delta),
      )
    const targetRow = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-track]")
    const item = doc.items.find((i) => i.id === drag.id)
    const target =
      !a.linkedSourceAudio &&
      item &&
      targetRow?.dataset.group === itemGroup(item)
        ? targetRow.dataset.track
        : undefined
    setDrag({
      ...drag,
      start,
      duration,
      track: a.mode === "move" && target ? target : a.track,
    })
  }
  function end() {
    const a = dragStart.current
    if (!drag || !a) return
    const value = drag
    dragStart.current = null
    setDrag(null)
    try {
      session.edit((d) => ({
        ...d,
        items: d.items.map((i) => {
          if (i.id !== value.id) return i
          const result = {
            ...i,
            startFrame: value.start,
            durationInFrames: value.duration,
            trackId: value.track,
          }
          if (i.kind === "audio" && a.mode === "left")
            return {
              ...result,
              kind: "audio",
              asset: i.asset,
              volume: i.volume,
              sourceStartMs:
                i.sourceStartMs +
                Math.round(((value.start - a.start) * 1000) / d.fps),
            }
          if (i.kind === "video" && a.mode !== "move") {
            const startMs = Math.max(
              0,
              Math.round(
                i.source.startMs +
                  ((value.start - a.start) * 1000 * (i.playbackRate ?? 1)) /
                    d.fps,
              ),
            )
            return {
              ...result,
              kind: "video",
              source: {
                ...i.source,
                startMs,
                endMs:
                  startMs +
                  Math.round(
                    (value.duration * 1000 * (i.playbackRate ?? 1)) / d.fps,
                  ),
              },
              volume: i.volume,
            }
          }
          return result
        }),
      }))
    } catch (error) {
      onError(error instanceof Error ? error.message : "Invalid timeline edit")
    }
  }
  return (
    <section
      ref={timeline}
      className="nle-timeline"
      aria-label="Timeline"
      onDragLeave={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          setMediaTarget(null)
      }}
    >
      <div className="nle-timeline-toolbar">
        <strong>Timeline</strong>
        <div
          className="nle-zoom-controls"
          role="group"
          aria-label="Timeline zoom controls"
        >
          <button
            aria-label="Full extent zoom"
            title="Full extent: fit the entire edit"
            aria-pressed={zoomMode === "fit"}
            onClick={() => selectZoomMode("fit")}
          >
            <Scan size={16} />
          </button>
          <button
            aria-label="Detail zoom"
            title="Detail: ten seconds around the current position"
            aria-pressed={zoomMode === "detail"}
            onClick={() => selectZoomMode("detail")}
          >
            <ZoomIn size={16} />
          </button>
          <button
            aria-label="Custom zoom"
            title="Custom zoom"
            aria-pressed={zoomMode === "custom"}
            onClick={() => selectZoomMode("custom")}
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => customZoom(effectiveZoom / 1.25)}
          >
            <Minus size={12} />
          </button>
          <input
            aria-label="Timeline zoom"
            title="Custom zoom · Cmd/Ctrl + scroll to zoom"
            type="range"
            min={Math.log2(presets.min)}
            max={Math.log2(presets.max)}
            step="any"
            value={Math.log2(effectiveZoom)}
            aria-valuetext={`${Math.round((effectiveZoom / presets.fit) * 100)}% of full extent`}
            onInput={(event) =>
              customZoom(2 ** Number(event.currentTarget.value))
            }
          />
          <button
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => customZoom(effectiveZoom * 1.25)}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
      <div ref={viewport} className="nle-timeline-scroll">
        <div className="nle-track-labels">
          <div className="nle-timecode-corner">
            <div className="nle-timecode">
              <output aria-label="Playhead timecode" aria-live="off">
                {timelineTimecode(state.playhead, doc.fps)}
              </output>
            </div>
          </div>
          {timelineGroups.map((group) => (
            <div
              className="nle-group-label"
              key={group}
              style={{
                height: rows
                  .filter((r) => r.group === group)
                  .reduce((height, row) => height + timelineRowHeight(row), 0),
              }}
            >
              {group === "Audio" ? <Volume2 size={14} /> : <Layers size={14} />}
              <strong>{group}</strong>
              <button
                aria-label={`Add ${group.toLowerCase()} track`}
                disabled={!state.editable}
                onClick={() => addTrack(group)}
              >
                <Plus size={12} />
              </button>
            </div>
          ))}
        </div>
        <div
          ref={area}
          className="nle-track-area"
          data-media-px={px}
          style={{
            width:
              pendingMedia && mediaTarget
                ? Math.max(
                    width,
                    (mediaTarget.location.startFrame +
                      pendingMedia.durationInFrames) *
                      px,
                  )
                : width,
          }}
        >
          <div className="nle-ruler" onPointerDown={scrubStart}>
            {Array.from({ length: Math.ceil(width / 80) }, (_, i) => (
              <span key={i} style={{ left: i * 80 }}>
                {((i * 80) / px / doc.fps).toFixed(1)}s
              </span>
            ))}
          </div>
          {rows.map((row, index) => (
            <div
              key={row.id}
              data-track={row.trackId ?? undefined}
              data-group={row.group}
              data-linked-source-audio={row.linkedSourceAudio || undefined}
              className={`nle-track ${rows[index - 1]?.group !== row.group ? "nle-group-start" : ""}`}
              style={{
                height:
                  pendingMedia?.kind === "video" &&
                  mediaTarget?.rowId === row.id
                    ? Math.max(104, timelineRowHeight(row))
                    : timelineRowHeight(row),
              }}
              onDragEnter={(event) => hoverMedia(event, row)}
              onDragOver={(event) => hoverMedia(event, row)}
              onDrop={(event) => {
                if (!pendingMedia || !state.editable || !area.current) return
                const location = mediaDropLocation(
                  doc,
                  pendingMedia.kind,
                  row.id,
                  (event.clientX - area.current.getBoundingClientRect().left) /
                    px,
                )
                if (!location) return
                event.preventDefault()
                mediaDrag?.clear()
                setMediaTarget(null)
                Promise.resolve()
                  .then(() => pendingMedia.insert(location))
                  .catch((error: unknown) =>
                    onError(
                      error instanceof Error
                        ? error.message
                        : "Could not add media",
                    ),
                  )
              }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  session.select(null)
                  session.seek(
                    (e.clientX - e.currentTarget.getBoundingClientRect().left) /
                      px,
                  )
                }
              }}
            >
              {pendingMedia &&
                mediaTarget &&
                (mediaTarget.rowId === row.id ||
                  (pendingMedia.kind === "video" &&
                    row.group === "Audio" &&
                    row.id ===
                      (rows.find(
                        (r) => r.id === `source-audio:${mediaTarget.rowId}`,
                      )?.id ?? rows.find((r) => r.group === "Audio")?.id))) && (
                  <MediaDropClip
                    media={pendingMedia}
                    audio={row.group === "Audio"}
                    left={mediaTarget.location.startFrame * px}
                    width={Math.max(12, pendingMedia.durationInFrames * px)}
                  />
                )}
              {row.items.map((i) => {
                const linked = Boolean(row.linkedSourceAudio)
                const muted = i.kind === "video" && i.volume === 0
                const details =
                  i.kind === "video" ? footage[footageKey(i)] : undefined
                const name =
                  i.kind === "video"
                    ? details?.name || i.source.videoId
                    : (mediaDrag?.labels[i.id] ?? itemLabel(i, doc))
                const label = linked
                  ? `${name} source audio (${muted ? "muted, " : ""}linked to footage)`
                  : name
                const value =
                  drag?.id === i.id
                    ? drag
                    : { start: i.startFrame, duration: i.durationInFrames }
                return (
                  <div
                    key={i.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${label} timeline item`}
                    title={linked || i.kind === "audio" ? undefined : name}
                    aria-pressed={state.selection === i.id}
                    className={`nle-clip nle-clip-${linked ? "audio" : i.kind}${linked ? " nle-clip-linked" : ""}`}
                    style={{
                      left: value.start * px,
                      width: Math.max(12, value.duration * px),
                      height: timelineRowHeight(row) - 10,
                    }}
                    onClick={() => session.select(i.id)}
                    onDoubleClick={() => session.seek(i.startFrame)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") session.select(i.id)
                      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                        e.preventDefault()
                        session.edit((d) => ({
                          ...d,
                          items: d.items.map((x) =>
                            x.id === i.id
                              ? {
                                  ...x,
                                  startFrame: Math.max(
                                    0,
                                    Math.min(
                                      d.durationInFrames - x.durationInFrames,
                                      x.startFrame +
                                        (e.key === "ArrowRight" ? 1 : -1),
                                    ),
                                  ),
                                }
                              : x,
                          ),
                        }))
                      }
                    }}
                    onPointerDown={(e) => start(e, i, "move", linked)}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={() => {
                      dragStart.current = null
                      setDrag(null)
                    }}
                  >
                    {(linked && i.kind === "video") || i.kind === "audio" ? (
                      <AudioWaveform
                        item={i}
                        document={doc}
                        projectId={projectId}
                      />
                    ) : null}
                    {(linked && i.kind === "video") || i.kind === "audio" ? (
                      <AudioClipControls
                        item={i}
                        fps={doc.fps}
                        disabled={!state.editable}
                        onGestureStart={() => {
                          onScrub?.()
                          session.select(i.id)
                        }}
                        onChange={(audio) => {
                          try {
                            session.edit((document) => ({
                              ...document,
                              items: document.items.map((item) =>
                                item.id === i.id &&
                                (item.kind === "video" || item.kind === "audio")
                                  ? { ...item, ...audio }
                                  : item,
                              ),
                            }))
                          } catch (error) {
                            onError(
                              error instanceof Error
                                ? error.message
                                : "Could not update audio",
                            )
                          }
                        }}
                      />
                    ) : null}
                    {!linked && i.kind === "video" && details?.frames.length ? (
                      <div className="nle-filmstrip" aria-hidden="true">
                        {footageFrames(details.frames, value.duration * px).map(
                          (url, index) => (
                            // Mux already supplies appropriately sized images; Next optimization would proxy every sample.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={`${index}:${url}`}
                              src={url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                              onError={(event) => {
                                event.currentTarget.style.visibility = "hidden"
                              }}
                            />
                          ),
                        )}
                      </div>
                    ) : null}
                    <span
                      className="nle-trim left"
                      onPointerDown={(e) => start(e, i, "left", linked)}
                      aria-label="Trim start"
                    />
                    {linked && <Link2 size={12} aria-hidden="true" />}
                    <span className="nle-clip-label">
                      {linked
                        ? `${name} · ${muted ? "Muted · " : ""}Linked audio`
                        : name}
                    </span>
                    <span
                      className="nle-trim right"
                      onPointerDown={(e) => start(e, i, "right", linked)}
                      aria-label="Trim end"
                    />
                  </div>
                )
              })}
            </div>
          ))}
          <div
            className="nle-playhead"
            role="slider"
            tabIndex={0}
            aria-label="Timeline playhead"
            aria-valuemin={0}
            aria-valuemax={doc.durationInFrames - 1}
            aria-valuenow={state.playhead}
            aria-valuetext={`${(state.playhead / doc.fps).toFixed(2)} seconds, frame ${state.playhead}`}
            aria-orientation="horizontal"
            onPointerDown={scrubStart}
            onKeyDown={(e) => {
              const delta = e.shiftKey ? doc.fps : 1
              const next =
                e.key === "ArrowLeft"
                  ? state.playhead - delta
                  : e.key === "ArrowRight"
                    ? state.playhead + delta
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? doc.durationInFrames - 1
                        : null
              if (next !== null) {
                e.preventDefault()
                e.stopPropagation()
                onScrub?.()
                session.seek(next)
              }
            }}
            style={{ left: state.playhead * px }}
          >
            <span />
          </div>
        </div>
      </div>
    </section>
  )
}
