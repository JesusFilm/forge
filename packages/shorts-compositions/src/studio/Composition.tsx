import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import * as Remotion from "remotion"
import Hls from "hls.js"
import { transform } from "sucrase"
import type { StudioPreview } from "@forge/studio-contracts/preview"
import type { StudioTimelineItem } from "@forge/studio-contracts"
import {
  studioCuts,
  transitionPresentation,
} from "@forge/studio-contracts/transitions"
import { StudioText } from "./Text"
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
  holdIfUnready,
  onError,
}: {
  url: string
  start: number
  volume: number
  holdIfUnready: boolean
  onError?: (message: string) => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useLayoutEffect(() => {
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
  const buffer = Remotion.useBufferState()
  useEffect(() => {
    const video = ref.current
    if (!video || !holdIfUnready) return
    let pending: ReturnType<typeof buffer.delayPlayback> | undefined
    const release = () => {
      pending?.unblock()
      pending = undefined
    }
    const check = () => {
      if (video.error || (!video.seeking && video.readyState >= 3)) release()
      else pending ??= buffer.delayPlayback()
    }
    // HLS owns the MediaSource. Html5Video's built-in buffering calls load(),
    // which detaches that source; gate playback without resetting the element.
    const events = ["waiting", "seeking", "seeked", "canplay", "error"]
    events.forEach((event) => video.addEventListener(event, check))
    check()
    return () => {
      events.forEach((event) => video.removeEventListener(event, check))
      release()
    }
  }, [buffer, holdIfUnready, url])
  return (
    <Remotion.Html5Video
      ref={ref}
      src={url}
      trimBefore={start}
      volume={volume}
      pauseWhenBuffering={false}
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
  holdIfUnready,
  presentation,
  globalFrame,
}: {
  presentation: ReturnType<typeof transitionPresentation>
  globalFrame: number
  holdIfUnready: boolean
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
    opacity: t.opacity * presentation.opacity,
    filter:
      presentation.brightness < 1
        ? `brightness(${presentation.brightness})`
        : undefined,
    clipPath: crop
      ? `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
      : undefined,
  }
  const Component =
    item.kind === "component" ? compiled[item.componentVersionId] : null
  return (
    <Remotion.AbsoluteFill style={style}>
      {item.kind === "text" ? (
        <StudioText
          key={item.properties.fontFamily ?? "sans-serif"}
          item={item}
        />
      ) : item.kind === "component" && Component ? (
        <Component {...item.properties} />
      ) : item.kind === "video" && media ? (
        mode === "render" ? (
          <Remotion.OffthreadVideo
            src={url}
            trimBefore={
              ((item.source.startMs - media.sourceStartMs) * fps) / 1000 -
              presentation.preRoll
            }
            volume={globalFrame < item.startFrame ? 0 : item.volume}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <HlsVideo
            url={url}
            holdIfUnready={holdIfUnready}
            start={
              ((item.source.startMs - media.sourceStartMs) * fps) / 1000 -
              presentation.preRoll
            }
            volume={globalFrame < item.startFrame ? 0 : item.volume}
            onError={onError}
          />
        )
      ) : item.kind === "audio" && media ? (
        <Remotion.Html5Audio
          src={url}
          trimBefore={(item.sourceStartMs * fps) / 1000}
          volume={globalFrame < item.startFrame ? 0 : item.volume}
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
  const frame = Remotion.useCurrentFrame()
  const cuts = useMemo(() => studioCuts(input.document), [input.document])
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
          .map((i) => {
            const presentation = transitionPresentation(cuts, i.id, frame)
            return (
              <Remotion.Sequence
                key={i.id}
                from={i.startFrame - presentation.preRoll}
                durationInFrames={i.durationInFrames + presentation.preRoll}
                premountFor={
                  mode === "preview" && i.kind === "video"
                    ? input.document.fps
                    : 0
                }
              >
                <Layer
                  item={i}
                  holdIfUnready={
                    frame >= i.startFrame - presentation.preRoll - 1
                  }
                  presentation={presentation}
                  globalFrame={frame}
                  input={input}
                  compiled={compiled}
                  mode={mode}
                  mediaBaseUrl={mediaBaseUrl}
                  mediaUrls={mediaUrls}
                  onError={onError}
                />
              </Remotion.Sequence>
            )
          }),
      )}
    </Remotion.AbsoluteFill>
  )
}
