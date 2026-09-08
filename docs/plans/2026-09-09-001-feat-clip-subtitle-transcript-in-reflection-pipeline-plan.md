---
title: "feat: Thread the clip's real subtitle transcript into the devotional reflection pipeline"
date: "2026-09-09"
type: feat
status: completed
---

# feat: Thread the clip's real subtitle transcript into the devotional reflection pipeline

## Problem

The devotional pipeline (`apps/mastra/src/services/devotional/`) pairs a written reflection with a JESUS Film clip covering the same passage. The reflection-writing prompts carry a blanket instruction — "the viewer has JUST WATCHED this Bible scene on video, so drop sentences that re-narrate the plot" — told to the model as an assumption, never as a fact. That assumption holds for some chapters (ch7's window is the whole parable, nothing trimmed) and doesn't for others (ch14's window is hand-curated to specific beats that skip parts of the text). The model has no way to tell which case it's in, so retelling-detection is a guess.

The pipeline already fetches and parses the exact subtitle track for every clip window (`subtitle-align.ts`, used today only to align window boundaries and caption the video card). This plan wires that already-fetched text upstream into the two places that reason about "what does the reflection repeat": the reflection writer (`reflection-modernizer.ts`) and the depth critic's retells-scene check (`devotional-reflection-critic.ts`).

**Correction from the original ask:** `devotional-writer.ts` (mentioned in the initial request) is unwired legacy code — `writeDevotional` has zero production call sites; it's only exercised by its own test. The actual production writer is `modernizeReflection`, invoked from `composeDevotionalContent` in `generate-devotional.ts`. This plan targets the real pipeline, not `devotional-writer.ts`.

## Scope Boundaries

**In scope:**

- Fetching the clip's subtitle transcript for its curated window, best-effort, during content generation (before the reflection is written).
- Passing that transcript into `modernizeReflection` and `critiqueReflection`, with the existing blanket instruction kept as the fallback when no transcript is available.
- A small extraction — moving `arclightClipInfo` out of `devotional-render.ts` into a shared location so both the (new) generation-time fetch and the existing render-time fetch can call it — since it currently only exists as a private, unexported function in the render module.

**Deferred to Follow-Up Work:**

- De-duplicating the two Arclight/subtitle network calls that will now exist (one at generation time for the transcript, one at render time for window/caption alignment — this already existed before this plan). They're both small metadata/subtitle fetches, not video downloads, and the existing render-time fetch already tolerates failure independently. Threading the generation-time result all the way through the cache into the render stage is a reasonable future optimization but is a separate, structurally bigger change (it touches the `devo.json` cache shape) and isn't required for this plan's goal.
- `devotional-writer.ts` itself. It's dead code; leaving it as-is is correct scope discipline, not an oversight.
- Localizing the transcript fetch by target language. Devotionals are written in English first regardless of eventual locale (see `apps/mastra/CLAUDE.md`), so the transcript fetch always uses the English film language id, matching how every other generation-time step already operates in English.

## Key Technical Decisions

**Fetch the transcript at generation time (Stage 1), not at render time.** `sourceClipAndScripture` in `generate-devotional.ts` already has everything needed to build the Arclight subtitle URL — the chapter's `id`, `clipStartSec`, `clipLengthSec` — _before_ any text-generation call runs. Fetching there means the transcript is available to both `modernizeReflection` (called moments later in `composeDevotionalContent`) and, via a new field on `GeneratedDevotional`, to `critiqueReflection` (called later still, from `devotional-render.ts`'s quality gate). The alternative — fetching separately at each of the two call sites — would mean two more network calls instead of one and two places to keep the best-effort fallback correct instead of one.

**Extract `arclightClipInfo` into `subtitle-align.ts`.** It's the natural shared home: `subtitle-align.ts` already owns "given a subtitle URL and a window, get the aligned window back," and this plan adds "given a media id, get the subtitle URL" as the step before it. Both `generate-devotional.ts` (new caller) and `devotional-render.ts` (existing caller) can then import it without one importing from the other. `devotional-render.ts`'s existing call site is updated to import instead of defining it locally — behavior unchanged, just relocated.

**A new `transcriptForWindow` helper, not a repurposed existing one.** `fetchEditedWindow` already returns `EditedWindow.cues: SubtitleCue[]` — every cue in the window — but nothing joins their `.text` into a plain string. `mapCuesToEditedTimeline` (the other candidate) produces per-cue timed captions for on-screen rendering, which is the wrong shape for a prompt block. A small new function in `subtitle-align.ts` takes `SubtitleCue[]` and returns one joined transcript string; both this plan's new caller and (implicitly, in the future) the caption-rendering path could use it, though only this plan's caller is wired to it now.

**The fallback is silence, not an error, and it's the same fallback shape already proven in `devotional-render.ts`.** Guard on the subtitle URL existing; if the fetch, parse, or window-alignment fails at any layer, `clipTranscript` stays `undefined` and every downstream consumer falls back to exactly its current behavior (the blanket instruction in the writer prompt, no transcript block in the critic prompt). This mirrors the pattern already in `devotional-render.ts` lines ~1071-1122 (log a warning, never throw, keep the pre-fetch default).

**The critic gets a transcript excerpt or summary, not necessarily the full raw text, if it runs long.** Some curated windows run 50-90+ seconds of dialogue. Cap the transcript passed into both prompts at a generous but bounded length (implementer's call at implementation time, informed by a look at a few real transcripts' lengths — this is an execution-time detail, not a planning-time one) so a long, cue-dense scene doesn't blow past reasonable prompt budgets.

## Requirements Traceability

- Give the writer real clip content instead of just a title → U2, U3.
- Give the critic real clip content instead of an assumption → U2, U5.
- Best-effort, never fail the pipeline over missing subtitles → U1 (fallback built into the helper), U2 (guard + try/catch), U3/U5 (both consumers treat the field as optional).
- No change to existing approved-devotional behavior when subtitles are unavailable → U2's fallback preserves today's blanket-instruction behavior byte-for-byte when `clipTranscript` is absent.
- Full test coverage for the new wiring → U1, U2, U3, U5 each carry test scenarios; U6 covers the end-to-end fallback path.

## Implementation Units

### U1. `transcriptForWindow` helper in `subtitle-align.ts`

**Goal:** Join the `SubtitleCue[]` already returned by `fetchEditedWindow` into one plain transcript string, scoped to the cues that actually fall inside the final (possibly snapped) window.

**Requirements:** best-effort transcript extraction; no new fetching capability, pure text-shaping over data already fetched elsewhere.

**Dependencies:** none.

**Files:**

- `apps/mastra/src/services/devotional/subtitle-align.ts` — add `transcriptForWindow(cues: SubtitleCue[], windowStartSec: number, windowLenSec: number): string`.
- `apps/mastra/src/services/devotional/subtitle-align.test.ts` — new test cases (file likely already exists for `parseSubtitles`/`alignWindow`; add to it).

**Approach:** Filter `cues` to those overlapping `[windowStartSec, windowStartSec + windowLenSec]` (same overlap test pattern the render-time caption code already uses for its own window filtering — reuse that logic rather than inventing a second overlap rule), sort by `start` (cues from `parseSubtitles` are already sorted, but don't assume the input always came from there), join `.text` with a single space, collapse any doubled whitespace. Empty input or no overlapping cues returns `""`.

**Patterns to follow:** `parseSubtitles`'s existing whitespace/normalization handling; the cue-overlap filtering already present in the render-time caption path (read it before reimplementing the overlap test differently).

**Test scenarios:**

- Happy path: cues fully inside the window join in order, separated by single spaces.
- Edge case: a cue that starts before the window but ends inside it (partial overlap at the head) is included.
- Edge case: a cue that starts inside the window but ends after it (partial overlap at the tail) is included.
- Edge case: a cue entirely outside the window is excluded.
- Edge case: empty `cues` array returns `""`.
- Edge case: cues passed out of chronological order are still joined in time order, not input order.

**Verification:** unit tests pass; a manual check against one real fetched window (e.g. ch7, whose window is documented as the whole 52s parable) produces a transcript that reads as continuous prose, not cue fragments.

---

### U2. Generation-time transcript fetch in `generate-devotional.ts`, and the `arclightClipInfo` relocation

**Goal:** During `sourceClipAndScripture` (Stage 1, before any text-generation LLM call), best-effort fetch the clip's subtitle transcript for its curated window and attach it to the sourced result so it can flow into both the writer and (via `GeneratedDevotional`) the later critic call.

**Requirements:** transcript available before `modernizeReflection` runs; best-effort, never throws; no behavior change when subtitles are unavailable.

**Dependencies:** U1.

**Files:**

- `apps/mastra/src/services/devotional/subtitle-align.ts` — move `arclightClipInfo` here from `devotional-render.ts` (same implementation, now exported); export its `ArclightClipInfo` type alongside it.
- `apps/mastra/src/services/devotional/devotional-render.ts` — remove the local `arclightClipInfo` definition, import it from `subtitle-align.ts` instead. No other change at this call site — it's the same function, same behavior, just relocated.
- `apps/mastra/src/services/devotional/generate-devotional.ts` — in `sourceClipAndScripture`, after `chapterWithPassage` resolves the chapter (so `chapter.id`, `chapter.clipStartSec`, `chapter.clipLengthSec` are known), best-effort fetch `arclightClipInfo(chapter.id, 529)` (English — see Key Technical Decisions), then if a `subtitleUrl` came back, `fetchEditedWindow(...)` + `transcriptForWindow(...)`. Add `clipTranscript?: string` to `SourcedDevotional`'s return shape.
- `apps/mastra/src/services/devotional/generate-devotional.ts` — add `clipTranscript?: string` to `GeneratedDevotional` (sibling to `clip`), and to `ComposeContentInput`; thread it from `composeDevotionalContent`'s caller (`generateDevotional`, which already passes `sourced.chapter`/`sourced.scripture` — add `sourced.clipTranscript`) through to the returned `GeneratedDevotional`.
- `apps/mastra/src/services/devotional/generate-devotional.test.ts` — new test scenarios.

**Approach:** Wrap the whole fetch in the same defensive shape already proven in `devotional-render.ts`'s `renderInStage` (guard on `subtitleUrl` existing, log-and-continue on any failure at any layer, never throw out of `sourceClipAndScripture`). This is a new async step in a function that was previously synchronous-shaped around a single `selectScripture` await — sequence it so a slow or failing subtitle fetch doesn't block scripture selection any longer than necessary (fetch can run in parallel with `selectScriptureForPassage` via `Promise.all`, since neither depends on the other's result).

**Execution note:** the exact transcript length cap belongs here — look at a couple of real fetched transcripts (a short window like ch18's ~28s and a long one like ch14's ~94s) before picking a bound, rather than guessing one at planning time.

**Patterns to follow:** the try/catch-swallowing shape in `devotional-render.ts` lines ~1071-1122 (the pattern to copy, not to duplicate — that code stays as-is for its own render-time purpose; this is a second, independent instance of the same defensive shape).

**Test scenarios:**

- Happy path: a chapter with a working subtitle URL and a successful window fetch produces a non-empty `clipTranscript` on the returned `GeneratedDevotional`.
- Fallback: no `subtitleUrl` in the Arclight response → `clipTranscript` is `undefined`, `sourceClipAndScripture` and `generateDevotional` still succeed.
- Fallback: `fetchEditedWindow` returns `null` (network failure, parse failure, or any of its own internal catches) → `clipTranscript` is `undefined`, no throw.
- Fallback: the Arclight metadata fetch itself throws (network error, timeout, non-OK response) → caught, `clipTranscript` is `undefined`, no throw.
- Integration: `generateDevotional`'s returned object carries `clipTranscript` through from `sourceClipAndScripture` → `composeDevotionalContent`'s return, without requiring `composeDevotionalContent` to re-fetch anything.

**Verification:** the four fallback scenarios each independently confirm `generateDevotional` still returns a complete, valid `GeneratedDevotional` with no `clipTranscript`; existing `generate-devotional.test.ts` cases that predate this change continue to pass unmodified (parity check).

---

### U3. Thread the transcript into `modernizeReflection`

**Goal:** Replace the blanket "assume you just watched this" instruction with the real transcript when one is available, so the writer avoids specific lines/beats instead of guessing at what the assumption covers.

**Requirements:** writer produces reflections that don't repeat the clip's actual dialogue; behavior unchanged (today's blanket instruction) when no transcript is passed.

**Dependencies:** U2.

**Files:**

- `apps/mastra/src/services/devotional/reflection-modernizer.ts` — add `clipTranscript?: string` to `ModernizeReflectionOptions`; in `modernizeReflection`, when present, add a labeled block to the per-call `user` prompt (e.g. "What the clip's own audio says, word for word: <transcript>. Do not repeat these lines or this sequence of events in your reflection — say something ABOUT them instead.") alongside (not necessarily replacing) the existing static system-prompt instruction, since the static instruction's other guidance (present tense, insight-not-plot, "never begin from the story") still applies regardless of whether a transcript is available.
- `apps/mastra/src/services/devotional/reflection-modernizer.ts` — thread the new field from `composeDevotionalContent`'s call to `modernizeReflection` (source the value from `input.clipTranscript`, wired in U2).
- `apps/mastra/src/services/devotional/reflection-modernizer.test.ts` — new test scenarios.

**Approach:** Follow the existing test pattern exactly (`fakeLlm` + asserting on `complete.mock.calls[0][0].user`) — this file's tests already assert prompt _content_, which is the right shape for verifying the transcript actually lands in the prompt.

**Patterns to follow:** the existing `user` string assembly in `modernizeReflection` (quoted in research: built from `sourceText`, `focusReference`, `sourceName`, `scriptureReference`/`scriptureText`, `precedingHalf`, `approxWords`) — the transcript block is one more labeled section in that same assembly, not a structural rewrite.

**Test scenarios:**

- Happy path: calling with `clipTranscript` set produces a `user` prompt containing the transcript text under its own label.
- Fallback: calling without `clipTranscript` (or with it `undefined`) produces a `user` prompt with no transcript block, and existing prompt content is byte-for-byte unchanged — this is the regression guard that proves the fallback preserves current behavior exactly.
- Edge case: `clipTranscript` is an empty string (fetch technically "succeeded" but produced nothing, e.g. `transcriptForWindow` returned `""`) — treated the same as absent, no empty block emitted.

**Verification:** the "without transcript" test's exact prompt-string assertion matches the current, unmodified test's expected substrings — proving no accidental behavior change for the no-transcript path.

---

### U4. `retells-scene` critic module change (`devotional-reflection-critic.ts`)

**Goal:** Give the retells-scene check the same real transcript, so it judges "did this reflection retell what the clip showed" against actual content instead of the current zero-context guess.

**Requirements:** critic's `retells-scene` issue kind becomes evidence-based when a transcript is available; unchanged behavior when it isn't.

**Dependencies:** U2.

**Files:**

- `apps/mastra/src/services/devotional/devotional-reflection-critic.ts` — add `clipTranscript?: string` to `CritiqueReflectionInput`; when present, add a labeled block to the critic's prompt with the real transcript, alongside the existing "already showed" framing (which still applies as general guidance for the no-transcript case).
- `apps/mastra/src/services/devotional/devotional-reflection-critic.test.ts` — new test scenarios.

**Approach:** Same shape as U3 — additive prompt block, not a replacement of the existing static guidance, following the existing `fakeLlm` + prompt-content-assertion test pattern already used in this file.

**Patterns to follow:** the existing critic prompt assembly and its test style (quoted in research — `critiqueReflection` input asserted via the mocked `complete` call's arguments).

**Test scenarios:**

- Happy path: `clipTranscript` set → critic prompt contains the transcript under its own label.
- Fallback: `clipTranscript` absent → prompt unchanged from current behavior (regression guard, same discipline as U3).
- Edge case: empty-string transcript treated as absent, no empty block.

**Verification:** fallback test's exact prompt assertion matches pre-existing test expectations.

---

### U5. Wire `GeneratedDevotional.clipTranscript` into the quality-gate's `critiqueReflection` call

**Goal:** Close the loop from generation time to the later quality-gate call in `devotional-render.ts`, so the critic actually receives the transcript that was fetched back in U2.

**Requirements:** the critic call in production (not just in isolated unit tests) receives the transcript when one exists.

**Dependencies:** U2, U4.

**Files:**

- `apps/mastra/src/services/devotional/devotional-quality-gate.ts` — in `reviewDevotionalText`, pass `d.clipTranscript` through to the existing `critiqueReflection({...})` call (line ~136 per research).
- `apps/mastra/src/services/devotional/devotional-quality-gate.test.ts` — new test scenario.

**Approach:** One-line addition to an existing call site; `d` is already `input.devotional: GeneratedDevotional`, which carries `clipTranscript` after U2.

**Test scenarios:**

- Integration: a `GeneratedDevotional` fixture with `clipTranscript` set, passed through `reviewDevotionalText`, results in `critiqueReflection` being called with that transcript (assert via a mocked/spied `critiqueReflection`, mirroring however this test file already mocks its dependencies — check `devotional-quality-gate.test.ts`'s existing mocking pattern for `critiqueReflection`/`critiqueReflectionFidelity` before adding a new one).
- Fallback: a fixture without `clipTranscript` results in `critiqueReflection` being called with it `undefined` — parity with pre-change behavior.

**Verification:** the fallback test confirms no change to the existing, already-tested quality-gate behavior when no transcript is present.

---

### U6. End-to-end fallback parity check

**Goal:** One test proving the whole chain — generation through the quality gate — behaves identically to today when subtitle fetching fails at every layer, satisfying the plan's "must not change existing approved-devotional caches/behavior" requirement directly rather than only piecewise per-unit.

**Requirements:** no behavior change for the failure path, verified end-to-end, not just at each unit boundary.

**Dependencies:** U2, U3, U4, U5.

**Files:**

- `apps/mastra/src/services/devotional/generate-devotional.test.ts` (or a new focused integration test file if the existing one doesn't already exercise `generateDevotional` → quality-gate as one flow — check first) — one test that stubs the subtitle fetch to fail, runs generation, and confirms the resulting devotional's reflection text and quality-gate verdict match what the same fixture inputs would have produced before this plan (i.e., today's committed test fixtures/snapshots for a representative chapter still pass unmodified).

**Approach:** This is a parity/regression unit, not new feature surface — the goal is confidence that the four independent fallback guards (Arclight fetch, subtitle fetch, window alignment, empty transcript) compose correctly when stacked, since each was tested in isolation in U2-U5.

**Test scenarios:**

- Integration: subtitle/Arclight fetch failing at generation time produces a `GeneratedDevotional` with no `clipTranscript`, which flows through unchanged writer and critic prompts, which flow through an unchanged quality-gate verdict, matching the pre-existing test fixtures for at least one already-covered chapter.

**Verification:** this test, plus the full existing `apps/mastra` test suite, both pass — confirming no regression to any currently-cached or currently-tested devotional's generated text or quality-gate outcome.

---

## System-Wide Impact

- **`GeneratedDevotional` gains an optional field.** Cached `devo.json` files written before this change simply lack `clipTranscript` on read — this is the same "optional field, absent in old caches" pattern already established for `reflection.sourceExcerpt` on this exact type (see the doc comment already on that field). No cache migration needed.
- **One new outbound network call per devotional generation** (the Arclight metadata + subtitle fetch, now also happening at generation time in addition to its existing render-time occurrence). Both are best-effort and non-blocking to the pipeline's success; this roughly doubles the number of small subtitle-related HTTP calls per devotional but does not add a new _kind_ of external dependency (Arclight is already called from this exact pipeline).
- **No change to any already-approved, already-cached devotional's committed text.** The fallback path is behavior-identical to today; U6 exists specifically to prove this rather than assume it.

## Deferred Implementation Notes

- The transcript length cap's exact number is an execution-time decision (see U2's Execution note) — informed by looking at real transcript lengths for a short and a long curated window, not chosen in advance here.
- The exact wording of the new prompt blocks in U3/U4 (the "here is exactly what the clip's audio says... do not repeat these lines" framing suggested in the original request) is directional; final phrasing is an implementation-time judgment call, matching this module's existing convention of iterating prompt wording against real model output rather than fixing it at planning time.
