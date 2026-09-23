"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Volume2, Type, Film } from "lucide-react"
import type { StudioTimelineItem } from "@forge/studio-contracts"
import { EditorSession, type EditorSnapshot } from "./editor-session"
import {
  timelineRows,
  timelineGroups,
  itemGroup,
  groupTrackKind,
  type TimelineGroup,
} from "./timeline-layout"

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
  onScrub,
}: {
  session: EditorSession
  state: EditorSnapshot
  onError: (message: string) => void
  onScrub?: () => void
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
  const area = useRef<HTMLDivElement>(null)
  const scrubbing = useRef<number | null>(null)
  const doc = state.document,
    width = Math.max(
      700,
      Math.min(20000, (doc.durationInFrames / doc.fps) * 24 * zoom),
    ),
    px = width / doc.durationInFrames
  const rows = useMemo(() => timelineRows(doc), [doc])
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
    const targetRow = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-track]")
    const item = doc.items.find((i) => i.id === drag.id)
    const target =
      item && targetRow?.dataset.group === itemGroup(item)
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
        <output aria-live="off">
          {(state.playhead / doc.fps).toFixed(2)} /{" "}
          {(doc.durationInFrames / doc.fps).toFixed(2)}s · Frame{" "}
          {state.playhead}
        </output>
        <button
          title="Go to start"
          onClick={() => {
            onScrub?.()
            session.seek(0)
          }}
        >
          Start
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
            onInput={(e) => setZoom(+e.currentTarget.value)}
          />
        </label>
      </div>
      <div className="nle-timeline-scroll">
        <div className="nle-track-labels">
          <div>Tracks</div>
          {timelineGroups.map((group) => (
            <div
              className="nle-group-label"
              key={group}
              style={{
                height: rows.filter((r) => r.group === group).length * 48,
              }}
            >
              {group === "Audio" ? (
                <Volume2 size={14} />
              ) : group === "Text" ? (
                <Type size={14} />
              ) : (
                <Film size={14} />
              )}
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
        <div ref={area} className="nle-track-area" style={{ width }}>
          <div className="nle-ruler" onPointerDown={scrubStart}>
            {Array.from(
              { length: Math.min(100, Math.ceil(width / 80)) },
              (_, i) => (
                <span key={i} style={{ left: i * 80 }}>
                  {((i * 80) / px / doc.fps).toFixed(1)}s
                </span>
              ),
            )}
          </div>
          {rows.map((row, index) => (
            <div
              key={row.id}
              data-track={row.trackId ?? undefined}
              data-group={row.group}
              className={`nle-track ${rows[index - 1]?.group !== row.group ? "nle-group-start" : ""}`}
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
              {row.items.map((i) => {
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
