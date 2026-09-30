---
title: Narration reuse keyed on displayed text, not spoken text
date: "2026-09-05"
last_updated: "2026-09-30"
category: logic-errors
module: apps/mastra/src/services/devotional
problem_type: logic_error
component: service_object
symptoms:
  - "The finished devotional says the same connector phrase twice in a row — once from the new step card, once from the cached reflection card"
  - "The render logs `reusing cached audio` / `reused N cached segment(s)` and exits 0"
  - "The whole-bundle staleness check reports no changed segments after an edit that genuinely changed what is spoken"
  - "No test fails: both the key and the staleness check compared the same wrong field"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - testing_framework
tags:
  - devotional-pipeline
  - audio-cache
  - cache-key
  - elevenlabs
  - narration
  - silent-failure
  - voice-take
---

# Narration reuse keyed on displayed text, not spoken text

## Problem

The devotional audio cache reused a narration segment whenever the **displayed**
card text matched. A reuse key must describe what the **voice says**. The two
diverge exactly where a spoken connector moves between cards: relocating
"Reflect on this." onto a new stepper card left every reflection card's display
text unchanged, so the key matched and ElevenLabs bytes that still contained the
connector were replayed. The finished 3:22 video said "Reflect on this." twice,
with no error, no warning and no failing test. The owner reviews by watching, so
the only detector was her ear.

## Symptoms

- Two consecutive cards speak the same connector phrase.
- `♻️ reused N cached segment(s); synthesised M` — a healthy-looking log line.
- The whole-bundle shortcut in `devotional-render.ts` reports nothing changed
  after an edit that changed the script.
- Green tests. Both the per-segment key and the staleness check compared
  `display ?? text`, so no test could tell the two apart.

## What Didn't Work

- **Comparing display text in the whole-bundle shortcut.** It rebuilt the wanted
  segment list correctly, then compared `(w.display ?? w.text)` against the
  cached display text — the same blind spot as the key. A spoken-only edit reads
  as "no change", the whole bundle is returned, and the per-segment path that
  would have caught it never runs.
- **Falling back to display text for legacy entries.** The instinct on migration
  is `s.spoken ?? s.text`, to keep old caches working. That fallback _is_ the
  bug: for an entry written before `spoken` was recorded, what the bytes say is
  genuinely unknown, and assuming the display text is the script is precisely
  the assumption that produced the doubled connector.
- **Relying on the guards already in place.** Two guards existed in
  `devotional-cache.ts` for the same class of failure — the `synthetic`
  rejection in `saveCachedAudio` and the persisted `skipped` list. Neither
  fires here: the bytes are real narration in the real voice, and the bundle is
  complete. They guard _provenance_ and _completeness_, not _identity_.

## Solution

`ProducedSegment` now carries the spoken text alongside the displayed text, and
every consumer of the key reads the spoken field.

```ts
// apps/mastra/src/services/devotional/devotional-audio.ts
export type ProducedSegment = {
  id: string
  /** Clean ON-SCREEN text (no spoken connector). */
  text: string
  /** What the voice actually says — the reuse key (see `audioReuseKey`). */
  spoken?: string
  audio: VoiceoverAudio
}
```

Lookup, before and after (`produceDevotionalAudio`). On a `NarrationSegment`,
`text` is the spoken line and `display` is what the card shows:

```ts
// before
const hit = deps.reusable.get(
  audioReuseKey(role, seg.display ?? seg.text, devotional.voice),
)
// after
const hit = deps.reusable.get(audioReuseKey(role, seg.text, devotional.voice))
```

Both push sites — the reuse branch and the fresh-synthesis branch — now set
`spoken: seg.text`. The key's parameter was renamed so the contract cannot be
misread at the call site:

```ts
// apps/mastra/src/services/devotional/devotional-cache.ts
export function audioReuseKey(role: string, spokenText: string, voice: string) {
  return `${voice}::${role}::${spokenText.trim()}`
}
```

The index persists and rehydrates it, and `reuseMapFromSegments` keys on it —
and **drops** entries that lack it:

```ts
// before
const usable = segments.filter((s) => s.audio.voiceId === wantVoiceId)
out.set(audioReuseKey(role, s.text ?? "", voice), s)

// after
const usable = segments.filter(
  (s) => s.audio.voiceId === wantVoiceId && (s.spoken ?? "").trim().length > 0,
)
out.set(audioReuseKey(role, s.spoken ?? "", voice), s)
```

The whole-bundle staleness check in `devotional-render.ts` was fixed the same
way, because it makes the same claim in bulk:

```ts
const cachedSpoken = new Map(cached.segments.map((s) => [s.id, s.spoken]))
const changed = wanted.filter(
  (w) => (cachedSpoken.get(w.id) ?? "").trim() !== w.text.trim(),
)
```

A cached segment with no `spoken` compares as changed — the honest reading.

Tests in `devotional-cache.test.ts`, `describe("loadReusableAudio — keyed on the
SPOKEN text")`:

1. A segment whose spoken text is `"Reflect on this. He stopped."` and whose
   display is `"He stopped."` is found under the spoken key **and MISSES on the
   bare display text**. The negative half is what makes the test capable of
   failing if the key regresses.
2. A legacy entry with `spoken` stripped from `audio/index.json` yields an empty
   reuse map.

Also `stale-cached-narration.test.ts` → "compares the SPOKEN text, so moving a
connector is a real change".

**Cost of the fix:** every devotional cached before this change re-synthesises
once, at full ElevenLabs cost. That is the price of not knowing what the old
bytes say, and it is one-time — new entries always record `spoken`.

## Why This Works

A cache key is a claim: _artifacts with this key are interchangeable_. The
artifact here is an MP3 of a voice reading a script, and its identity is
(voice, delivery role, **script**). Display text is a _projection_ of the script
with connectors removed, so keying on it collapses distinct artifacts into one
bucket: two different recordings, one key, silent substitution.

Keying on `spoken` restores the invariant that the key names every input the
artifact depends on. Dropping `spoken`-less entries is the same principle
applied to unknowns: an entry whose key input cannot be recovered is not a hit,
it is an entry of unknown identity, and the only sound treatment is eviction.

## Prevention

- **The key must cover every input the artifact depends on, and a derived field
  is never a valid key.** Display text is derived from the script by removing
  connectors — lossy in exactly the direction that produces collisions. Write
  the key's inputs down at the key function, as a comment, in the imperative.
- **When you add a key component, entries missing it are evicted, never
  guessed.** `s.spoken ?? s.text` re-creates the original bug for every legacy
  row. Take the one-time re-synthesis. Cover it with a test that strips the
  field from a written index and asserts the map is empty.
- **Every branch needs a test where only that branch can match.** "Spoken key
  hits" passes under the _old_ implementation too, whenever spoken == display.
  The test earns its place only because it also asserts the display text
  **misses**. Same discipline as
  `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`.
- **Fix every place that makes the same claim, in the same commit.**
  `grep -rn "display ?? " apps/mastra/src/services/devotional/` surfaces the
  whole-bundle shortcut next to the per-segment key.
- **When the reviewer is a human ear, give the machine a loud line to print.**
  The corrected check logs
  `📝 text changed since the cached narration (<ids>) — re-producing those segments`
  — the operator-visible signal that was missing on all three occurrences of
  this family.
- **Keep test names in sync with what they assert.** A test still named
  "compares the DISPLAY text" after the rule inverted re-teaches the wrong rule
  to the next reader.

## Update 2026-09-30: the delivery take (a fourth input)

A voice's delivery became a key input. female-d reads the reflection with its
own settings (take `f4`: stability 0.18, style 0.8, speed 1.2), so the same
words in the same voice are now two different recordings. The key took the
take as part of the voice, `audioReuseKey(role, spoken, "female-d@f4")`, and
`ProducedSegment` gained `take?: string`. Two claim sites were missed, and the
code review (not a test) caught both:

1. **The index never persisted `take`.** It lived only in memory:
   `saveCachedAudio` wrote `spoken` but not `take`, so every F4 reading came
   back from disk as the default delivery. Rendering from that cache would
   have missed every female-d segment and re-billed ElevenLabs on each run.
2. **The whole-bundle shortcut compared only spoken text.** With unchanged
   words it returned an old (pre-F4) bundle wholesale, and the new pace never
   applied.

```ts
// devotional-cache.ts: persist and rehydrate it
...(s.take ? { take: s.take } : {}),

// devotional-render.ts: the bundle shortcut checks HOW it is said, too
const hit = cachedById.get(w.id)
if ((hit?.take ?? "") !== voiceTake(w.id, voice)) return true
const cachedVoice = hit ? voiceNameForId(hit.audio.voiceId) : undefined
return cachedVoice != null && cachedVoice !== voice
```

The one existing F4 cache (the Prodigal Son, 47 segments) was backfilled by
hand after checking that none of those segments could have come from the old
key: an F4 lookup could not have matched a take-less entry, so all 47 were
synthesised under F4 in that run. Backfilling is the exception the rule above
allows only when provenance is PROVEN; otherwise evict.

Test: `devotional-cache.test.ts` → "delivery takes": a take survives save and
load, the F4 reading is found only under `female-d@f4`, and a take-less
reading is never replayed where F4 is asked for.

**Rule it adds:** a new key component must be written by the persistence layer
in the same commit as the key change. Grep the save function for every field
the key reads. Delivery settings are not hashed into the key, so a changed
`VOICE_DELIVERY` entry must also rename its take, or old audio replays under
the new name.

## The family rule: three bugs, one shape

1. **Wrong provenance.** A `--silent-preview` run wrote −91 dB audio into the
   cache; the key matched a real run on all three components, so the next render
   logged "reused 16 cached segment(s)" and staged a devotional with no
   narration. Fixed with an `audio.synthetic` flag rejected at the cache
   _boundary_ in `saveCachedAudio` — at the boundary because three callers write
   there and only one had been fixed.
2. **Wrong completeness.** A whole-bundle "everything is cached" shortcut checked
   only that segments _existed_, so an approved text edit rendered new cards over
   the old narration. Fixed by comparing text, not presence.
3. **Wrong identity.** This bug: the text compared was the wrong text.

**A cache of expensive external artifacts must validate three separate things,
and none of them implies another** — _provenance_ (were these bytes produced by
the real thing?), _completeness_ (is every expected entry present and
non-failed?), and _identity_ (do these bytes match the current inputs, keyed on
every input?). Enforce all three at the cache boundary rather than at the
callers, and make each failure loud: the shared symptom of all three is a
successful-looking render that says the wrong thing out loud.

## Related Issues

- `apps/mastra/src/services/devotional/devotional-cache.ts` — `audioReuseKey`,
  `reuseMapFromSegments`, `saveCachedAudio` (synthetic guard), `loadCachedAudio`.
- `apps/mastra/src/services/devotional/devotional-render.ts` — the whole-bundle
  staleness check inside the cached narration path.
- `apps/mastra/src/services/devotional/devotional-audio.ts` — `ProducedSegment`,
  the reuse branch of `produceDevotionalAudio`.
- Tests: `devotional-cache.test.ts`, `audio-cache-synthetic.test.ts`,
  `stale-cached-narration.test.ts`.
- `docs/solutions/architecture-patterns/re-renderable-jobs-output-provenance-and-locked-report-merge-20260611.md`
  — the same failure geometry on the OUTPUT side (a reuse record short-circuited
  on a truthy `ready` flag with no provenance, so a re-render served the stale
  Mux asset). That doc states the output rule; this one states the input rule.
- `docs/solutions/architecture-patterns/smart-crop-three-app-decomposition-20260610.md`
  — "skip paths must parse and provenance-check the artifact, not just
  `artifactExists`".
- `docs/solutions/design-patterns/devotional-opening-sequence-stepper-contract-20260905.md`
  — the change that exposed this bug (moving a spoken connector onto its own card).
- `docs/solutions/logic-errors/devotional-derived-timeline-drift-20260930.md`
  — the same day's sibling: timelines derived from the composition drifting
  from it.
