import React, {
  useState,
  useRef,
  useSyncExternalStore,
  useEffect,
  useCallback,
} from "react"
import { createRoot } from "react-dom/client"
import { Timeline } from "@qa/timeline"
import { Inspector } from "@qa/inspector"
import "@qa/studio.css"

import Preview from "@qa/preview"
import {
  studioDocumentSchema,
  type Short,
  type StudioApply,
} from "@forge/studio-contracts"
import { EditorSession } from "@qa/editor-session"
class FixtureError extends Error {}
const ref = { assetId: "fixture", versionId: "v1", digest: "0".repeat(64) }
const document: Record<string, unknown> & { items: unknown[] } = {
  version: 1,
  title: "Synthetic cut regression",
  language: "english",
  runtimeVersion: "studio-proof-1",
  width: 320,
  height: 180,
  fps: 30,
  durationInFrames: 390,
  tracks: [{ id: "video", kind: "visual" }],
  components: [],
  items: [0, 1, 2, 3].map((i) => ({
    id: "v" + i,
    kind: "video",
    trackId: "video",
    startFrame: i * 90,
    durationInFrames: i === 3 ? 120 : 90,
    volume: 0,
    source: {
      videoId: "fixture",
      dubId: "dub",
      editionId: "edition",
      language: "english",
      subtitle: {
        trackId: "sub",
        editionId: "edition",
        language: "english",
        asset: ref,
      },
      preview: ref,
      export: ref,
      startMs: i * 4000,
      endMs: i * 4000 + (i === 3 ? 4000 : 3000),
    },
  })),
}
document.items.push(
  ...[0, 1, 2].map((i) => ({
    id: "text" + i,
    kind: "text",
    trackId: "video",
    startFrame: i * 45,
    durationInFrames: 90,
    text:
      i === 0 ? "Can being right\nbecome a trap?" : "Confidence and humility",
    properties: { fontSize: 20 },
  })),
)
let stored: Short = {
  projectId: "fixture",
  revision: 1,
  lifecycle: "DRAFT",
  firstPublishedAt: null,
  actor: { kind: "human", id: "fixture" },
  document: studioDocumentSchema.parse(document),
}
if (new URLSearchParams(location.search).has("render-case")) {
  const props = await fetch("/artifacts/input.json").then((response) =>
    response.json(),
  )
  stored.document = studioDocumentSchema.parse(props.input.document)
}
const transport = {
  read: async () => structuredClone(stored),
  apply: async (input: StudioApply) => {
    if (input.expectedRevision !== stored.revision)
      throw new FixtureError("Revision conflict")
    const operation = input.operations[0]
    if (operation.kind !== "restore-document")
      throw new FixtureError("Restore expected")
    stored = {
      ...stored,
      revision: stored.revision + 1,
      document: structuredClone(operation.document),
    }
    return {
      projectId: stored.projectId,
      revision: stored.revision,
      outcome: "ACCEPTED" as const,
    }
  },
}
const createSession = () =>
  new EditorSession(structuredClone(stored), transport)

let blankFrames: number[] = []
let unreadySamples: unknown[] = []
let maxFrame = 0
const visitedCuts = new Set<number>()
let playEvents: string[] = []
let firstDecodedMs: number | null = null
let peakVideoElements = 0
window.addEventListener("error", (e) => {
  const el = window.document.getElementById("errors")
  if (el) el.textContent += e.message
})
function App() {
  const [session, setSession] = useState(createSession)
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const playbackRef = useRef<import("@qa/preview").PreviewPlaybackHandle>(null)
  const [playing, updatePlaying] = useState(false)
  const setPlaying = useCallback((value: boolean) => {
    if (!value) playbackRef.current?.pause()
    updatePlaying(value)
  }, [])
  const [result, setResult] = useState("Not run")
  const onPlaying = useCallback(
    (v: boolean) => {
      setPlaying(v)
      playEvents.push(String(v) + ":" + session.getSnapshot().playhead)
      if (!v)
        setResult(
          blankFrames.length
            ? "FAIL: blank video across cut"
            : maxFrame >= 388 &&
                visitedCuts.size === 3 &&
                !window.document.querySelector("[role=alert]") &&
                !window.document.getElementById("errors")?.textContent
              ? "PASS: completed all cuts without blank video"
              : "STOPPED: incomplete or errored",
        )
    },
    [session],
  )
  useEffect(() => {
    let id = 0
    let previous = -1
    function tick() {
      const videos = Array.from(window.document.querySelectorAll("video"))
      peakVideoElements = Math.max(peakVideoElements, videos.length)
      if (
        firstDecodedMs === null &&
        videos.some((video) => video.readyState >= 2 && video.videoWidth > 0)
      )
        firstDecodedMs = Math.round(performance.now())
      const frame = session.getSnapshot().playhead
      maxFrame = Math.max(maxFrame, frame)
      if (
        frame !== previous &&
        frame >= 90 &&
        [90, 180, 270].some((c) => frame >= c && frame < c + 25)
      ) {
        for (const cut of [90, 180, 270])
          if (frame >= cut && frame < cut + 25) visitedCuts.add(cut)
        const visible = Array.from(
          window.document.querySelectorAll("video"),
        ).filter((v) => {
          let e: Element | null = v
          while (e) {
            if (
              getComputedStyle(e).opacity === "0" ||
              getComputedStyle(e).display === "none"
            )
              return false
            e = e.parentElement
          }
          return true
        })
        if (!visible.some((v) => v.readyState >= 2 && v.videoWidth > 0)) {
          blankFrames.push(frame)
          unreadySamples.push({
            frame,
            videos: visible.map((video) => ({
              readyState: video.readyState,
              seeking: video.seeking,
              paused: video.paused,
              currentTime: video.currentTime,
              width: video.videoWidth,
            })),
          })
        }
      }
      previous = frame
      window.document.getElementById("samples")!.textContent = JSON.stringify({
        frame,
        firstDecodedMs,
        peakVideoElements,
        mediaRequests: performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.includes("/media/")).length,
        maxFrame,
        visitedCuts: [...visitedCuts],
        blankFrames,
        unreadySamples,
        playEvents,
      })
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [session])
  return (
    <div className="nle-editor" style={{ height: "auto", display: "block" }}>
      <h1>Studio feedback regression</h1>
      <p>Local synthetic media only. No production access.</p>
      <button onClick={() => session.undo()}>Undo</button>
      <button onClick={() => session.redo()}>Redo</button>
      <button onClick={() => void session.save()}>Save fixture</button>
      <button onClick={() => setSession(createSession())}>
        Reopen fixture
      </button>
      <button
        onClick={() => {
          blankFrames = []
          unreadySamples = []
          maxFrame = 0
          visitedCuts.clear()
          playEvents = []
          session.seek(0)
          setPlaying(true)
          setResult("Running")
        }}
      >
        Run cut playback
      </button>
      <button
        onClick={async () => {
          const samples = []
          for (let run = 0; run < 3; run++) {
            setPlaying(false)
            session.seek(15)
            await new Promise((resolve) => setTimeout(resolve, 600))
            setPlaying(true)
            const reached = await new Promise<boolean>((resolve) => {
              let unsubscribe = () => {}
              const finish = (success: boolean) => {
                clearTimeout(timer)
                unsubscribe()
                resolve(success)
              }
              const timer = setTimeout(() => finish(false), 8000)
              unsubscribe = session.subscribe(() => {
                if (session.getSnapshot().playhead >= 50) finish(true)
              })
            })
            if (!reached) {
              setPlaying(false)
              window.document.getElementById("pause-probe")!.textContent =
                JSON.stringify({
                  pass: false,
                  error: "Playback did not reach the pause sample",
                  samples,
                })
              return
            }
            const video = window.document.querySelector("video")!
            const before = video.currentTime
            const frameBefore = session.getSnapshot().playhead
            let seeks = 0
            const seeking = () => seeks++
            video.addEventListener("seeking", seeking)
            setPlaying(false)
            await new Promise((resolve) => setTimeout(resolve, 250))
            video.removeEventListener("seeking", seeking)
            samples.push({
              before,
              after: video.currentTime,
              deltaFrames: (video.currentTime - before) * 30,
              frameBefore,
              frameAfter: session.getSnapshot().playhead,
              seeks,
            })
          }
          window.document.getElementById("pause-probe")!.textContent =
            JSON.stringify({
              pass: samples.every((s) => Math.abs(s.deltaFrames) < 1),
              samples,
            })
        }}
      >
        Run pause probe
      </button>
      <pre id="pause-probe" />
      <button onClick={() => setPlaying(false)}>Pause</button>
      <button onClick={() => session.seek(90)}>Seek first cut</button>
      <div style={{ width: 640, height: 360, position: "relative" }}>
        <Preview
          playbackRef={playbackRef}
          session={session}
          state={state}
          projectId="fixture"
          playing={playing}
          onPlaying={onPlaying}
        />
      </div>
      <Timeline
        session={session}
        state={state}
        onError={setResult}
        onScrub={() => setPlaying(false)}
      />
      <Inspector session={session} state={state} onError={setResult} />
      <p>
        Frame {state.playhead} · {state.status} · Revision {state.revision}
      </p>
      <pre id="samples" />
      <pre id="errors" />
      <output>{result}</output>
    </div>
  )
}
createRoot(window.document.getElementById("root")!).render(<App />)
