"use client"
import {
  studioDocumentSchema,
  type StudioTimelineItem,
  type StudioDocument,
} from "@forge/studio-contracts"
import { Trash2, Copy } from "lucide-react"
import type { EditorSession, EditorSnapshot } from "./editor-session"
import { isTextComponent } from "./item-presentation"
import { NumberField } from "./number-field"
import { TransitionControls } from "./transition-controls"
import { TextControls } from "./text-controls"
import { componentFieldLabel } from "./component-field-label"
export const defaultTransform: NonNullable<StudioTimelineItem["transform"]> = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
}
export function Inspector({
  session,
  state,
  onError,
  onPreview,
}: {
  session: EditorSession
  state: EditorSnapshot
  onError: (s: string) => void
  onPreview?: (document: StudioDocument | null) => void
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
  function numeric(
    changeDocument: (d: StudioDocument, n: number) => StudioDocument,
    validate?: (n: number) => string | undefined,
  ) {
    return {
      onChange: (n: number) => {
        const error = validate?.(n)
        if (error) return onError(error)
        change((d) => changeDocument(d, n))
      },
      onPreview: (n: number | null) => {
        if (n !== null && validate?.(n)) return
        preview(n === null ? null : (d) => changeDocument(d, n))
      },
    }
  }
  function preview(fn: ((d: StudioDocument) => StudioDocument) | null) {
    if (!onPreview) return
    if (!fn) return onPreview(null)
    const next = studioDocumentSchema.safeParse(fn(doc))
    if (state.editable && next.success) onPreview(next.data)
  }
  function previewPatch(
    fn: ((i: StudioTimelineItem) => StudioTimelineItem) | null,
  ) {
    preview(
      fn
        ? (d) => ({
            ...d,
            items: d.items.map((i) => (i.id === item?.id ? fn(i) : i)),
          })
        : null,
    )
  }
  function numericPatch(
    changeItem: (i: StudioTimelineItem, n: number) => StudioTimelineItem,
    validate?: (n: number) => string | undefined,
  ) {
    return numeric(
      (d, n) => ({
        ...d,
        items: d.items.map((i) => (i.id === item?.id ? changeItem(i, n) : i)),
      }),
      validate,
    )
  }
  if (!item)
    return (
      <aside className="nle-inspector">
        <p className="nle-muted">Nothing to inspect</p>
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
      <fieldset key={item.id} disabled={!state.editable}>
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
              {...numericPatch((i, n) =>
                i.kind === "text"
                  ? { ...i, properties: { ...i.properties, fontSize: n } }
                  : i,
              )}
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
            <TextControls
              item={item}
              onPreview={(properties) =>
                previewPatch(
                  properties === null
                    ? null
                    : (i) =>
                        i.kind === "text"
                          ? {
                              ...i,
                              properties: { ...i.properties, ...properties },
                            }
                          : i,
                )
              }
              onChange={(properties) =>
                patch((i) =>
                  i.kind === "text"
                    ? { ...i, properties: { ...i.properties, ...properties } }
                    : i,
                )
              }
            />
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
        {item.kind === "video" && (
          <NumberField
            label="Clip speed"
            value={item.playbackRate ?? 1}
            min={0.25}
            max={4}
            step={0.05}
            {...numeric((d, playbackRate) => {
              if (playbackRate < 0.25 || playbackRate > 4) return d
              const durationInFrames = Math.max(
                1,
                Math.round(
                  ((item.source.endMs - item.source.startMs) * d.fps) /
                    (1000 * playbackRate),
                ),
              )
              return {
                ...d,
                durationInFrames: Math.max(
                  d.durationInFrames,
                  item.startFrame + durationInFrames,
                ),
                items: d.items.map((i) =>
                  i.id === item.id
                    ? { ...item, playbackRate, durationInFrames }
                    : i,
                ),
              }
            })}
          />
        )}
        {component && (
          <>
            <label>
              Component name
              <input
                aria-label="Component name"
                maxLength={200}
                key={component.versionId + (component.name ?? "")}
                defaultValue={component.name ?? component.versionId}
                onBlur={(e) => {
                  const name = e.target.value.trim()
                  if (name)
                    change((d) => ({
                      ...d,
                      components: d.components.map((c) =>
                        c.versionId === component.versionId
                          ? { ...c, name }
                          : c,
                      ),
                    }))
                }}
              />
            </label>
            <label>
              Component type
              <select
                aria-label="Component type"
                value={isTextComponent(item, doc) ? "text" : "video"}
                onChange={(e) => {
                  const category = e.target.value as "text" | "video"
                  change((d) => ({
                    ...d,
                    components: d.components.map((c) =>
                      c.versionId === component.versionId
                        ? { ...c, category }
                        : c,
                    ),
                  }))
                }}
              >
                <option value="text">Text</option>
                <option value="video">Video</option>
              </select>
            </label>
          </>
        )}
        {item.kind === "video" && (
          <TransitionControls
            item={item}
            document={doc}
            onPreview={(transition) =>
              previewPatch(
                transition === null
                  ? null
                  : (i) => (i.kind === "video" ? { ...i, transition } : i),
              )
            }
            onChange={(transition) =>
              patch((i) => {
                if (i.kind !== "video") return i
                const next = { ...i }
                if (transition) next.transition = transition
                else delete next.transition
                return next
              })
            }
          />
        )}
        {component &&
          item.kind === "component" &&
          Object.entries(component.controls).map(([key, control]) => (
            <label key={key}>
              {componentFieldLabel(key)}
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
        {item.kind === "video" && (
          <>
            <h3>Source focus</h3>
            <p className="nle-muted">
              Choose which part of the source fills the frame.
            </p>
            {(["x", "y"] as const).map((axis) => (
              <NumberField
                key={axis}
                label={`Focus ${axis === "x" ? "horizontal" : "vertical"} (%)`}
                value={(item.focus?.[axis] ?? 0.5) * 100}
                min={0}
                max={100}
                step={1}
                {...numericPatch((i, value) =>
                  i.kind === "video"
                    ? {
                        ...i,
                        focus: {
                          x: i.focus?.x ?? 0.5,
                          y: i.focus?.y ?? 0.5,
                          [axis]: value / 100,
                        },
                      }
                    : i,
                )}
              />
            ))}
          </>
        )}
        <h3>Transform</h3>
        <div className="nle-row">
          <NumberField
            label="X"
            decimalPlaces={2}
            value={transform.x}
            {...numericPatch((i, x) => ({
              ...i,
              transform: { ...transform, x },
            }))}
          />
          <NumberField
            label="Y"
            decimalPlaces={2}
            value={transform.y}
            {...numericPatch((i, y) => ({
              ...i,
              transform: { ...transform, y },
            }))}
          />
        </div>
        <NumberField
          label="Scale"
          decimalPlaces={2}
          value={transform.scaleX}
          min={0.01}
          max={100}
          step={0.05}
          {...numericPatch((i, n) => ({
            ...i,
            transform: { ...transform, scaleX: n, scaleY: n },
          }))}
        />
        <NumberField
          label="Rotation"
          decimalPlaces={2}
          value={transform.rotation}
          min={-360}
          max={360}
          {...numericPatch((i, rotation) => ({
            ...i,
            transform: { ...transform, rotation },
          }))}
        />
        <NumberField
          label="Opacity"
          decimalPlaces={2}
          value={transform.opacity}
          min={0}
          max={1}
          step={0.05}
          {...numericPatch((i, opacity) => ({
            ...i,
            transform: { ...transform, opacity },
          }))}
        />
        {(item.kind === "video" || item.kind === "image") && (
          <>
            <h3>Crop</h3>
            <div className="nle-crop-controls">
              <div className="nle-crop-frame" aria-hidden="true">
                <div
                  style={{
                    inset: `${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%`,
                  }}
                />
              </div>
              {(["left", "right", "top", "bottom"] as const).map((side) => (
                <div className={`nle-crop-${side}`} key={side}>
                  <NumberField
                    hideLabel
                    unit="%"
                    label={`Crop ${side} (%)`}
                    value={Math.round(crop[side] * 100)}
                    min={0}
                    max={99}
                    {...numericPatch(
                      (i, n) => ({
                        ...i,
                        transform: {
                          ...transform,
                          crop: { ...crop, [side]: n / 100 },
                        },
                      }),
                      (n) => {
                        const next = { ...crop, [side]: n / 100 }
                        return next.left + next.right >= 1 ||
                          next.top + next.bottom >= 1
                          ? "Crop must leave a visible area"
                          : undefined
                      },
                    )}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </fieldset>
    </aside>
  )
}
