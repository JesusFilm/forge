"use client"
import { useRef, useState } from "react"
import { Plus, Volume2, Type, Film } from "lucide-react"
import type { StudioTimelineItem } from "@forge/studio-contracts"
import { EditorSession, type EditorSnapshot } from "./editor-session"

export const itemLabel = (item: StudioTimelineItem) =>
  item.kind === "text"
    ? item.text || "Text"
    : item.kind === "video"
      ? "Source footage"
      : item.kind === "component"
        ? "Custom component"
        : item.kind === "audio"
          ? "Audio"
          : "Image"
export function Timeline({
  session,
  state,
  onError,
}: {
  session: EditorSession
  state: EditorSnapshot
  onError: (message: string) => void
}) {
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
    mode: "move" | "left" | "right"
    track: string
  } | null>(null)
  const doc = state.document,
    width = Math.max(
      700,
      Math.min(20000, (doc.durationInFrames / doc.fps) * 24 * zoom),
    ),
    px = width / doc.durationInFrames
  function start(
    e: React.PointerEvent,
    item: StudioTimelineItem,
    mode: "move" | "left" | "right",
  ) {
    if (!state.editable) return
    e.preventDefault()
    e.stopPropagation()
    session.select(item.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = {
      x: e.clientX,
      start: item.startFrame,
      duration: item.durationInFrames,
      sourceStart:
        item.kind === "video"
          ? item.source.startMs
          : item.kind === "audio"
            ? item.sourceStartMs
            : (item.startFrame * 1000) / doc.fps,
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
        a.start - Math.floor((a.sourceStart * doc.fps) / 1000),
        Math.min(a.start + a.duration - 1, a.start + delta),
      )
      duration = a.duration - (start - a.start)
    }
    if (a.mode === "right")
      duration = Math.max(
        1,
        Math.min(doc.durationInFrames - start, a.duration + delta),
      )
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-track]")?.dataset.track
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
                i.source.startMs + ((value.start - a.start) * 1000) / d.fps,
              ),
            )
            return {
              ...result,
              kind: "video",
              source: {
                ...i.source,
                startMs,
                endMs: startMs + Math.round((value.duration * 1000) / d.fps),
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
    <section className="nle-timeline" aria-label="Timeline">
      <div className="nle-timeline-toolbar">
        <strong>Timeline</strong>
        <span>
          {doc.items.length} items · {doc.fps} fps
        </span>
        <button
          onClick={() =>
            session.edit((d) => ({
              ...d,
              tracks: [
                ...d.tracks,
                { id: crypto.randomUUID(), kind: "visual" },
              ],
            }))
          }
          disabled={!state.editable}
        >
          <Plus size={14} />
          Track
        </button>
        <label>
          Zoom
          <input
            aria-label="Timeline zoom"
            type="range"
            min={0.3}
            max={4}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
      </div>
      <div className="nle-timeline-scroll">
        <div className="nle-track-labels">
          <div>Tracks</div>
          {doc.tracks.map((t, i) => (
            <div key={t.id}>
              {t.kind === "audio" ? (
                <Volume2 size={14} />
              ) : t.kind === "caption" ? (
                <Type size={14} />
              ) : (
                <Film size={14} />
              )}
              <span>
                {t.kind} {i + 1}
              </span>
            </div>
          ))}
        </div>
        <div className="nle-track-area" style={{ width }}>
          <div
            className="nle-ruler"
            onPointerDown={(e) =>
              session.seek(
                (e.clientX - e.currentTarget.getBoundingClientRect().left) / px,
              )
            }
          >
            {Array.from(
              { length: Math.min(100, Math.ceil(width / 80)) },
              (_, i) => (
                <span key={i} style={{ left: i * 80 }}>
                  {((i * 80) / px / doc.fps).toFixed(1)}s
                </span>
              ),
            )}
          </div>
          {doc.tracks.map((t) => (
            <div
              key={t.id}
              data-track={t.id}
              className="nle-track"
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
              {doc.items
                .filter(
                  (i) => (drag?.id === i.id ? drag.track : i.trackId) === t.id,
                )
                .map((i) => {
                  const value =
                    drag?.id === i.id
                      ? drag
                      : { start: i.startFrame, duration: i.durationInFrames }
                  return (
                    <div
                      key={i.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${itemLabel(i)} timeline item`}
                      aria-pressed={state.selection === i.id}
                      className={`nle-clip nle-clip-${i.kind}`}
                      style={{
                        left: value.start * px,
                        width: Math.max(12, value.duration * px),
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
                      onPointerDown={(e) => start(e, i, "move")}
                      onPointerMove={move}
                      onPointerUp={end}
                      onPointerCancel={() => {
                        dragStart.current = null
                        setDrag(null)
                      }}
                    >
                      <span
                        className="nle-trim left"
                        onPointerDown={(e) => start(e, i, "left")}
                        aria-label="Trim start"
                      />
                      <span>{itemLabel(i)}</span>
                      <span
                        className="nle-trim right"
                        onPointerDown={(e) => start(e, i, "right")}
                        aria-label="Trim end"
                      />
                    </div>
                  )
                })}
            </div>
          ))}
          <div className="nle-playhead" style={{ left: state.playhead * px }}>
            <span />
          </div>
        </div>
      </div>
    </section>
  )
}
