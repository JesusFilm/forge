---
title: "Mount Watch transcript cue controls on demand"
date: 2026-07-17
category: performance-issues
module: "apps/web Watch transcript"
problem_type: performance_issue
component: frontend_stimulus
symptoms:
  - "Long Watch films mounted a list item, button, timestamp, and text span for every transcript cue on initial render"
  - "The transcript DOM grew linearly to thousands of elements before the viewer requested cue interaction"
  - "Player timeupdate and seeking synchronization ran while the transcript was only being read"
  - "The default transcript was visually sparse even when continuous readable text was sufficient"
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components:
  - "apps/web/src/components/watch/SubtitleTranscript.tsx"
  - "apps/web/src/lib/watch-transcript.ts"
  - "Watch player synchronization"
tags:
  - watch
  - transcript
  - dom-size
  - hydration
  - conditional-rendering
  - subtitle-cues
  - on-demand-interaction
  - react
---

# Mount Watch transcript cue controls on demand

## Problem

`SubtitleTranscript` eagerly mapped every parsed cue into an interactive row on
the first render. A long film therefore paid for thousands of DOM elements and
playback listeners even when the viewer only wanted to read the transcript.

The server already fetched and parsed the selected VTT, but it passed every cue
object through the client boundary and the client immediately attached a
complete interactive UI to those cues. Both the serialized data shape and the
per-cue DOM arrived before user intent.

## Symptoms

- DOM size scaled linearly with cue count.
- Every cue was a focusable button with a timestamp on initial render.
- `timeupdate` and `seeking` listeners ran before the viewer requested cue
  highlighting or seeking.
- CSS spacing for interactive rows made the default reading view unnecessarily
  long.

## What Didn't Work

The eager shape created four main descendants per cue:

```tsx
<ol>
  {cues.map((cue) => (
    <li>
      <button>
        <time>{formatTimestamp(cue.start)}</time>
        <span>{cue.text}</span>
      </button>
    </li>
  ))}
</ol>
```

Visually collapsing or hiding this list would not solve the performance issue;
the browser would still own the same per-cue DOM and React would still hydrate
the same interactive tree.

## Solution

Format the compact transcript once on the server by joining cue text with blank
lines. Pass only that string and its source URL through the initial client
boundary, then render it in a neutral element that preserves line breaks:

```tsx
export function formatCompactTranscript(cues: SubtitleCue[]): string {
  return cues.map(({ text }) => text).join("\n\n")
}

return (
  <div
    data-testid="watch-subtitle-compact-text"
    className="whitespace-pre-line"
  >
    {compactText}
  </div>
)
```

The `<div>` contains one text node and no cue descendants. Blank lines preserve
phrase boundaries without falsely representing an entire film transcript as a
single paragraph.

Keep VTT loading and the timestamped cue UI in a separate dynamic module. The
compact shell imports that module and starts its fetch only after expansion:

```tsx
const LazyInteractiveSubtitleTranscript = lazy(
  () => import("./InteractiveSubtitleTranscript"),
)

useEffect(() => {
  if (!expanded || !activeVttSrc || cache.has(activeVttSrc)) return

  const controller = new AbortController()
  loadInteractiveTranscriptModule()
    .then(({ loadSubtitleCues }) =>
      loadSubtitleCues(activeVttSrc, durationSeconds, controller.signal),
    )
    .then((cues) => cacheCues(activeVttSrc, cues))

  return () => controller.abort()
}, [activeVttSrc, expanded])
```

Parsed cues are retained in a map keyed by VTT source. This avoids refetching
when a viewer reopens the transcript or switches back to a previously loaded
language, without mounting those cues while collapsed. Failed sources are
cleared on the next explicit expansion so a transient failure can retry.

Use a native disclosure button with a generated relationship instead of a
fixed ID:

```tsx
const contentId = useId()

<button
  type="button"
  aria-expanded={expanded}
  aria-controls={contentId}
  aria-label={t("heading")}
>
  <ChevronDown aria-hidden="true" />
</button>
```

The dynamically imported renderer owns playback synchronization, so its mount
boundary is also the listener boundary:

```tsx
useEffect(() => {
  const player = playerRef.current as HTMLMediaElement | null
  if (!player || cues.length === 0) return

  const update = () => {
    // Resolve and highlight the cue at player.currentTime.
  }

  player.addEventListener("timeupdate", update)
  player.addEventListener("seeking", update)
  return () => {
    player.removeEventListener("timeupdate", update)
    player.removeEventListener("seeking", update)
  }
}, [cues, playerRef])
```

The expanded branch retains language selection, active-cue highlighting,
seeking, player reveal, unmuting, and playback. Collapsing unmounts those
controls and removes the media listeners again.

## Why This Works

The compact DOM is constant-size because cue count changes only one text node.
All transcript text remains server-rendered and readable, while timestamp data,
the interactive JavaScript module, focusable cue controls, highlighting, and
media listeners arrive only after explicit user intent.

The live 1,147-cue _The Savior_ transcript measured 11 elements in the collapsed
transcript subtree and 4,600 when expanded. The compact node retained all
37,803 characters and 1,146 blank-line cue breaks with zero descendants,
timestamps, or cue-list controls. Collapsing returned the subtree to 11
elements. Network proof showed the interactive chunks and VTT request only
after expansion, and native Mobile Safari showed the intended compact spacing.

## Prevention

- Compare a short transcript with a large fixture and assert their collapsed
  subtree element counts are equal.
- Assert the compact text element has zero descendants and contains every cue's
  text in order.
- Assert timestamps, cue buttons, and the language selector are absent until
  expansion.
- Assert a collapsed source change performs no VTT fetch, a pending load is
  aborted on collapse, failures can retry, and successfully loaded languages
  are cached independently.
- Verify exact media-listener callback references are added on expansion and
  removed on collapse.
- Preserve cue-seek behavior tests for the expanded state.
- Pair visual smoke with DOM or timing evidence when changing frontend mount
  boundaries; a screenshot alone does not prove a performance improvement.

## Related Issues

- [Watch Non-Cloudflare Performance Hardening](./watch-non-cloudflare-performance-hardening-20260611.md) — established the server-parsed, hydrated transcript path preserved by this change.
- [Frontend changes require page-load performance verification](../conventions/frontend-change-page-load-performance-verification.md) — explains why the 11-versus-4,600 DOM measurement is the relevant proof for this rendering change.
- [Lean-bulk list query and lazy per-item heavy fetch](../design-patterns/lean-bulk-lazy-per-item-graphql-fetch-20260604.md) — related user-intent pattern for deferring a heavy representation while retaining a lightweight default.
