import React, { useEffect, useMemo, useRef } from "react"
import * as Remotion from "remotion"
import Hls from "hls.js"
import { transform } from "sucrase"
import type { StudioPreview } from "@forge/studio-contracts/preview"
import type { StudioTimelineItem } from "@forge/studio-contracts"
class StudioRuntimeError extends Error {}

const send = (data: unknown) => window.parent.postMessage(data, "*")
function compile(source: string) {
  const code = transform(source, {
    transforms: ["typescript", "jsx", "imports"],
    production: true,
  }).code
  const exports: {
    default?: React.ComponentType<Record<string, string | number | boolean>>
  } = {}
  const require = (name: string) => {
    if (name === "react") return React
    if (name === "remotion")
      return {
        AbsoluteFill: Remotion.AbsoluteFill,
        useCurrentFrame: Remotion.useCurrentFrame,
        useVideoConfig: Remotion.useVideoConfig,
        interpolate: Remotion.interpolate,
        spring: Remotion.spring,
        Sequence: Remotion.Sequence,
        Easing: Remotion.Easing,
      }
    throw new StudioRuntimeError("Unsupported dependency")
  }
  // Preview evaluates custom components in the editor browser. Final renders use
  // the credential-free render child. Never evaluate authored code on the server.
  new Function("React", "exports", "require", code)(React, exports, require)
  if (typeof exports.default !== "function")
    throw new StudioRuntimeError("Default component export required")
  return exports.default
}
function HlsVideo({
  url,
  start,
  volume,
  onError,
}: {
  url: string
  start: number
  volume: number
  onError?: (message: string) => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const reportError = () => {
      if (onError) onError("Source media could not decode")
      else send({ type: "error", message: "Source media could not decode" })
    }
    video.addEventListener("error", reportError)
    let hls: Hls | undefined
    if (Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 6,
        maxMaxBufferLength: 12,
        enableWorker: true,
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) reportError()
      })
      hls.loadSource(url)
      hls.attachMedia(video)
    }
    return () => {
      hls?.destroy()
      video.removeEventListener("error", reportError)
    }
  }, [url, onError])
  return (
    <Remotion.Html5Video
      ref={ref}
      src={url}
      trimBefore={start}
      volume={volume}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  )
}
function Layer({
  item,
  input,
  compiled,
  mode,
  mediaBaseUrl,
  mediaUrls,
  onError,
}: {
  item: StudioTimelineItem
  input: StudioPreview
  mode: "preview" | "render"
  mediaBaseUrl: string
  onError?: (message: string) => void
  mediaUrls?: Record<string, string>
  compiled: Record<
    string,
    React.ComponentType<Record<string, string | number | boolean>>
  >
}) {
  const media = input.media[item.id],
    url = media
      ? (mediaUrls?.[media.file] ?? new URL(media.file, mediaBaseUrl).href)
      : "",
    fps = input.document.fps
  const t = item.transform ?? {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    },
    crop = t.crop
  const style: React.CSSProperties = {
    transform: `translate(${t.x}px,${t.y}px) rotate(${t.rotation}deg) scale(${t.scaleX},${t.scaleY})`,
    opacity: t.opacity,
    clipPath: crop
      ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
      : undefined,
  }
  const Component =
    item.kind === "component" ? compiled[item.componentVersionId] : null
  return (
    <Remotion.AbsoluteFill style={style}>
      {item.kind === "text" ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent:
              item.properties.align === "left"
                ? "flex-start"
                : item.properties.align === "right"
                  ? "flex-end"
                  : "center",
            whiteSpace: "pre-wrap",
            color: item.properties.color ?? "white",
            fontSize: item.properties.fontSize ?? 72,
            fontFamily: item.properties.fontFamily ?? "sans-serif",
            fontWeight: item.properties.fontWeight ?? 500,
            textAlign: item.properties.align ?? "center",
          }}
        >
          {item.text}
        </div>
      ) : item.kind === "component" && Component ? (
        <Component {...item.properties} />
      ) : item.kind === "video" && media ? (
        mode === "render" ? (
          <Remotion.OffthreadVideo
            src={url}
            trimBefore={
              ((item.source.startMs - media.sourceStartMs) * fps) / 1000
            }
            volume={item.volume}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <HlsVideo
            url={url}
            start={((item.source.startMs - media.sourceStartMs) * fps) / 1000}
            volume={item.volume}
            onError={onError}
          />
        )
      ) : item.kind === "audio" && media ? (
        <Remotion.Html5Audio
          src={url}
          trimBefore={(item.sourceStartMs * fps) / 1000}
          volume={item.volume}
        />
      ) : item.kind === "image" && media ? (
        <Remotion.Img
          src={url}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
    </Remotion.AbsoluteFill>
  )
}
export function StudioComposition({
  input,
  mode = "preview",
  mediaBaseUrl = location.href,
  mediaUrls,
  onError,
}: {
  input: StudioPreview
  mode?: "preview" | "render"
  mediaBaseUrl?: string
  onError?: (message: string) => void
  mediaUrls?: Record<string, string>
}) {
  const activeVersions = JSON.stringify(
    [
      ...new Set(
        input.document.items.flatMap((item) =>
          item.kind === "component" ? [item.componentVersionId] : [],
        ),
      ),
    ].sort(),
  )
  const compiled = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(input.code)
          .filter(([id]) =>
            (JSON.parse(activeVersions) as string[]).includes(id),
          )
          .map(([id, source]) => [id, compile(source)]),
      ),
    [input.code, activeVersions],
  )
  return (
    <Remotion.AbsoluteFill style={{ backgroundColor: "black" }}>
      {input.document.tracks.map((t) =>
        input.document.items
          .filter((i) => i.trackId === t.id)
          .map((i) => (
            <Remotion.Sequence
              key={i.id}
              from={i.startFrame}
              durationInFrames={i.durationInFrames}
            >
              <Layer
                item={i}
                input={input}
                compiled={compiled}
                mode={mode}
                mediaBaseUrl={mediaBaseUrl}
                mediaUrls={mediaUrls}
                onError={onError}
              />
            </Remotion.Sequence>
          )),
      )}
    </Remotion.AbsoluteFill>
  )
}
