"use client"
import type {
  StudioTimelineItem,
  StudioDocument,
} from "@forge/studio-contracts"
import { Trash2, Copy } from "lucide-react"
import type { EditorSession, EditorSnapshot } from "./editor-session"
import { itemLabel } from "./timeline"
export const defaultTransform: NonNullable<StudioTimelineItem["transform"]> = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
}
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label>
      {label}
      <input
        key={value}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n !== value) onChange(n)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
      />
    </label>
  )
}
export function Inspector({
  session,
  state,
  onError,
}: {
  session: EditorSession
  state: EditorSnapshot
  onError: (s: string) => void
}) {
  const doc = state.document,
    item = doc.items.find((i) => i.id === state.selection)
  function change(fn: (d: StudioDocument) => StudioDocument) {
    try {
      session.edit(fn)
    } catch (e) {
      onError(e instanceof Error ? e.message : "Invalid edit")
    }
  }
  function patch(fn: (i: StudioTimelineItem) => StudioTimelineItem) {
    change((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === item?.id ? fn(i) : i)),
    }))
  }
  if (!item)
    return (
      <aside className="nle-inspector">
        <h2>Project</h2>
        <label>
          Title
          <input
            key={doc.title}
            defaultValue={doc.title}
            onBlur={(e) => {
              if (e.target.value.trim())
                change((d) => ({ ...d, title: e.target.value.trim() }))
            }}
          />
        </label>
        <div className="nle-row">
          <NumberField
            label="Width"
            value={doc.width}
            min={16}
            max={7680}
            onChange={(width) => change((d) => ({ ...d, width }))}
          />
          <NumberField
            label="Height"
            value={doc.height}
            min={16}
            max={7680}
            onChange={(height) => change((d) => ({ ...d, height }))}
          />
        </div>
        <NumberField
          label="Duration (seconds)"
          value={doc.durationInFrames / doc.fps}
          min={1 / doc.fps}
          step={0.1}
          onChange={(n) =>
            change((d) => ({ ...d, durationInFrames: Math.round(n * d.fps) }))
          }
        />
        <p className="nle-muted">
          Select a canvas element or timeline clip to inspect it.
        </p>
        <h3>Cards & elements</h3>
        {doc.items.map((i) => (
          <button
            className="nle-card-row"
            key={i.id}
            onClick={() => {
              session.select(i.id)
              session.seek(i.startFrame)
            }}
          >
            <strong>{itemLabel(i).slice(0, 100)}</strong>
            <span>
              {(i.startFrame / doc.fps).toFixed(1)}s ·{" "}
              {(i.durationInFrames / doc.fps).toFixed(1)}s
            </span>
          </button>
        ))}
      </aside>
    )
  const transform = item.transform ?? defaultTransform,
    crop = transform.crop ?? { top: 0, right: 0, bottom: 0, left: 0 }
  const component =
    item.kind === "component"
      ? doc.components.find((c) => c.versionId === item.componentVersionId)
      : null
  return (
    <aside className="nle-inspector">
      <header>
        <h2>{item.kind === "text" ? "Text card" : item.kind}</h2>
        <button
          title="Duplicate item"
          disabled={!state.editable}
          onClick={() =>
            change((d) => ({
              ...d,
              items: [...d.items, { ...item, id: crypto.randomUUID() }],
            }))
          }
        >
          <Copy size={14} />
        </button>
        <button
          title="Delete item"
          disabled={!state.editable}
          onClick={() => {
            change((d) => ({
              ...d,
              items: d.items.filter((i) => i.id !== item.id),
            }))
            session.select(null)
          }}
        >
          <Trash2 size={14} />
        </button>
      </header>
      <fieldset disabled={!state.editable}>
        {item.kind === "text" && (
          <>
            <label>
              Text
              <textarea
                aria-label="Text"
                key={item.id}
                value={item.text}
                onChange={(e) =>
                  patch((i) =>
                    i.kind === "text" ? { ...i, text: e.target.value } : i,
                  )
                }
              />
            </label>
            <NumberField
              label="Font size"
              value={item.properties.fontSize ?? 72}
              min={1}
              max={1000}
              onChange={(n) =>
                patch((i) =>
                  i.kind === "text"
                    ? { ...i, properties: { ...i.properties, fontSize: n } }
                    : i,
                )
              }
            />
            <label>
              Text color
              <input
                type="color"
                value={item.properties.color ?? "#ffffff"}
                onChange={(e) =>
                  patch((i) =>
                    i.kind === "text"
                      ? {
                          ...i,
                          properties: {
                            ...i.properties,
                            color: e.target.value,
                          },
                        }
                      : i,
                  )
                }
              />
            </label>
            <label>
              Alignment
              <select
                value={item.properties.align ?? "center"}
                onChange={(e) =>
                  patch((i) =>
                    i.kind === "text"
                      ? {
                          ...i,
                          properties: {
                            ...i.properties,
                            align: e.target.value as
                              | "left"
                              | "center"
                              | "right",
                          },
                        }
                      : i,
                  )
                }
              >
                <option>left</option>
                <option>center</option>
                <option>right</option>
              </select>
            </label>
          </>
        )}
        {component &&
          item.kind === "component" &&
          Object.entries(component.controls).map(([key, control]) => (
            <label key={key}>
              {key}
              {control.type === "boolean" ? (
                <input
                  type="checkbox"
                  checked={Boolean(item.properties[key])}
                  onChange={(e) =>
                    patch((i) =>
                      i.kind === "component"
                        ? {
                            ...i,
                            properties: {
                              ...i.properties,
                              [key]: e.target.checked,
                            },
                          }
                        : i,
                    )
                  }
                />
              ) : control.type === "enum" ? (
                <select
                  value={String(item.properties[key])}
                  onChange={(e) =>
                    patch((i) =>
                      i.kind === "component"
                        ? {
                            ...i,
                            properties: {
                              ...i.properties,
                              [key]: e.target.value,
                            },
                          }
                        : i,
                    )
                  }
                >
                  {control.values.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={
                    control.type === "color"
                      ? "color"
                      : control.type === "number"
                        ? "number"
                        : "text"
                  }
                  value={String(item.properties[key])}
                  min={control.type === "number" ? control.min : undefined}
                  max={control.type === "number" ? control.max : undefined}
                  onChange={(e) =>
                    patch((i) =>
                      i.kind === "component"
                        ? {
                            ...i,
                            properties: {
                              ...i.properties,
                              [key]:
                                control.type === "number"
                                  ? Number(e.target.value)
                                  : e.target.value,
                            },
                          }
                        : i,
                    )
                  }
                />
              )}
            </label>
          ))}
        <h3>Timing</h3>
        <label>
          Track
          <select
            aria-label="Track"
            value={item.trackId}
            onChange={(e) => patch((i) => ({ ...i, trackId: e.target.value }))}
          >
            {doc.tracks.map((t, i) => (
              <option key={t.id} value={t.id}>
                {t.kind} {i + 1}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Start (frames)"
          value={item.startFrame}
          min={0}
          onChange={(n) => patch((i) => ({ ...i, startFrame: n }))}
        />
        <NumberField
          label="Duration (frames)"
          value={item.durationInFrames}
          min={1}
          onChange={(n) =>
            patch((i) =>
              i.kind === "video"
                ? {
                    ...i,
                    durationInFrames: n,
                    source: {
                      ...i.source,
                      endMs:
                        i.source.startMs + Math.round((n * 1000) / doc.fps),
                    },
                  }
                : { ...i, durationInFrames: n },
            )
          }
        />
        {item.kind === "video" && (
          <>
            <NumberField
              label="Source in (seconds)"
              value={item.source.startMs / 1000}
              min={0}
              step={0.001}
              onChange={(n) =>
                patch((i) =>
                  i.kind === "video"
                    ? {
                        ...i,
                        source: {
                          ...i.source,
                          startMs: Math.round(n * 1000),
                          endMs: Math.round(
                            n * 1000 + (i.durationInFrames * 1000) / doc.fps,
                          ),
                        },
                      }
                    : i,
                )
              }
            />
            <NumberField
              label="Source out (seconds)"
              value={item.source.endMs / 1000}
              min={item.source.startMs / 1000}
              step={0.001}
              onChange={(n) =>
                patch((i) =>
                  i.kind === "video"
                    ? {
                        ...i,
                        durationInFrames: Math.round(
                          ((n * 1000 - i.source.startMs) * doc.fps) / 1000,
                        ),
                        source: { ...i.source, endMs: Math.round(n * 1000) },
                      }
                    : i,
                )
              }
            />
          </>
        )}
        {(item.kind === "audio" || item.kind === "video") && (
          <>
            <NumberField
              label="Volume"
              value={item.volume}
              min={0}
              max={2}
              step={0.05}
              onChange={(n) =>
                patch((i) =>
                  i.kind === "audio" || i.kind === "video"
                    ? { ...i, volume: n }
                    : i,
                )
              }
            />
            {item.kind === "audio" && (
              <NumberField
                label="Audio in (seconds)"
                value={item.sourceStartMs / 1000}
                min={0}
                step={0.01}
                onChange={(n) =>
                  patch((i) =>
                    i.kind === "audio"
                      ? { ...i, sourceStartMs: Math.round(n * 1000) }
                      : i,
                  )
                }
              />
            )}
          </>
        )}
        <h3>Transform</h3>
        <div className="nle-row">
          <NumberField
            label="X"
            value={transform.x}
            onChange={(x) =>
              patch((i) => ({ ...i, transform: { ...transform, x } }))
            }
          />
          <NumberField
            label="Y"
            value={transform.y}
            onChange={(y) =>
              patch((i) => ({ ...i, transform: { ...transform, y } }))
            }
          />
        </div>
        <NumberField
          label="Scale"
          value={transform.scaleX}
          min={0.01}
          max={100}
          step={0.05}
          onChange={(n) =>
            patch((i) => ({
              ...i,
              transform: { ...transform, scaleX: n, scaleY: n },
            }))
          }
        />
        <NumberField
          label="Rotation"
          value={transform.rotation}
          min={-360}
          max={360}
          onChange={(rotation) =>
            patch((i) => ({ ...i, transform: { ...transform, rotation } }))
          }
        />
        <NumberField
          label="Opacity"
          value={transform.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) =>
            patch((i) => ({ ...i, transform: { ...transform, opacity } }))
          }
        />
        {(item.kind === "video" || item.kind === "image") && (
          <>
            <h3>Crop</h3>
            {(["left", "right", "top", "bottom"] as const).map((side) => (
              <NumberField
                key={side}
                label={`Crop ${side} (%)`}
                value={Math.round(crop[side] * 100)}
                min={0}
                max={99}
                onChange={(n) => {
                  const next = { ...crop, [side]: n / 100 }
                  if (
                    next.left + next.right >= 1 ||
                    next.top + next.bottom >= 1
                  ) {
                    onError("Crop must leave a visible area")
                    return
                  }
                  patch((i) => ({
                    ...i,
                    transform: { ...transform, crop: next },
                  }))
                }}
              />
            ))}
          </>
        )}
        <label>
          Linked timing target
          <select
            disabled={item.kind === "audio" && !!item.narrationFor}
            value={item.linkedTo ?? ""}
            onChange={(event) =>
              patch((current) => {
                const next = { ...current }
                if (event.target.value) next.linkedTo = event.target.value
                else delete next.linkedTo
                return next
              })
            }
          >
            <option value="">Independent timing</option>
            {doc.items
              .filter(
                (candidate) =>
                  candidate.id !== item.id &&
                  !(candidate.kind === "audio" && candidate.narrationFor),
              )
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id}
                </option>
              ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={item.timingLocked ?? false}
            onChange={(e) =>
              patch((i) => ({ ...i, timingLocked: e.target.checked }))
            }
          />
          Lock linked timing
        </label>
      </fieldset>
    </aside>
  )
}
