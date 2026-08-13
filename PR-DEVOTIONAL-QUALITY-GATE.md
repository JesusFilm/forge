# feat(mastra): devotional quality gate, critics, and two missing owner rules

## What this does

Adds the quality layer the devotional pipeline was missing, and restores two
content rules that were never carried into the authored prompt.

Four things now hold that did not before:

1. **A quality gate runs before any paid narration or render.** It composes three
   critics — coherence, depth, and fidelity of the adaptation against its source
   — in the workflow's content step, and the produce step refuses to hand off to
   the paid steps on a blocking verdict. A critic that could not RUN counts as
   blocking: "we didn't check" is never treated as "it passed".
2. **At most two of the author's points per devotional.** A commentary excerpt
   often carries several ordinal points ("we learn, firstly ... secondly ...
   thirdly"). The source is narrowed BEFORE the writer sees it, so the rule is
   enforced by the data that reaches the writer rather than by an instruction it
   can drift from. Excerpts with no ordinal structure, roughly a fifth of the
   corpus, pass through whole.
3. **The closing line comes from a dedicated agent**, running after the
   copywriter so it can see the chosen title, question and prayer and stay
   complementary rather than redundant.
4. **A blocked run says which gate blocked it**, and the reasons plus the
   critics' own explanations land in the attempt artifact.

Plus two owner content rules added to `/inputs/prompts/generation.json`:

- The viewer ALREADY follows Jesus. Without it the model silently redirects a
  devotional for a believer into an altar call. What makes this one worth pinning
  is that every individual sentence still reads fine, so the drift does not
  announce itself in the output.
- Describe, don't command. The narration is a synthetic voice with no reputation
  to spend, so imperatives land as scolding.

## Why it is shaped this way

This work existed on `feat/daily-devotional-generator`, which diverged 25 commits
ago, before the Workspace data plane landed. Merging that branch would have meant
deciding 104 files where `main` is right in most of them: 27 of its files are
already upstream verbatim, and nine more were rewritten upstream to read through
the Workspace.

So this PR carries only what `main` does not have, onto current `main`. Four
separate checks all resolved in `main`'s favour before that call was made:
roadmap tickets, the video studio plan, the Azure voiceover prose, and the
chapter catalog.

Three things upstream deliberately does differently were NOT carried over: the
disk fallback for corpora, the single-argument chapter lookup, and hook styles
resolved without injection. All three read the local filesystem or an in-code
table instead of the Workspace, so importing them would have undone what the data
plane is for.

## What review caught

Nine reviewers ran against the first version of this branch. Six of them
independently found that the gate this PR is named for had no call site: it was
reachable only from its own test, so every devotional went to paid narration and
render unchecked while the PR description claimed otherwise. That is fixed, and
so are these, each falsified by reverting it and watching a specific test go red:

- A repeated or hallucinated index from the point picker collapsed the devotional
  to ONE point. The schema capped the model's raw answer before the caller
  de-duplicated it or dropped out-of-range values, so `[3,3,5]` became `[3]` —
  the exact collapse the cap's own comment claimed to prevent.
- A whitespace-only source excerpt passed the fidelity check. The gate tested
  truthiness, so a blank excerpt reached the critic, which had nothing to compare
  against and reported the adaptation faithful.
- A quality-blocked run reported `publish_failed` / `rendered_assets_missing`,
  because the status decision read the safety verdict alone. A quality problem
  arrived at the approver dressed as a render bug.
- The closing-line and point-selection prompts sat in code while every sibling
  seam reads its prompt from the Workspace, which took two of the owner's rules
  off the surface she can edit without a deploy.
- The critics retried every provider error, including the deterministic ones the
  inner retry layer had already given up on. The delay's rationale blamed a rate
  limit, which is the one cause that cannot reach that layer unresolved.
- Five modules' JSON schemas were outside the Anthropic-keyword sweep while two
  comments claimed coverage. The sweep now walks the directory, so a new module
  is covered by existing rather than by being remembered.
- The coherence critic — the one the gate reads FIRST — had no tests, so the
  `skipped` flag that separates a provider outage from a real pass was unpinned.
- `DevotionalQualityGateError`, `devotional-calendar.ts` and
  `buildDevotionalAgentLlms` were dead. Each read as working machinery.

Two of my own guards were vacuous and only the falsification pass found them: a
blocking-verdict test that passed whether or not the gate was consulted, because
`startAsync` resolves before the paid steps run; and a source pin using
`toContain` that still passed when one of two call sites lost the value.

## Verification

```
tsc     clean
lint    clean
tests   2415 passed, 5 skipped, exit 0
```

## Operator step this PR does NOT do

**The deployed Workspace prompt is not updated by merging this.** In Railway the
writable S3 Workspace is authoritative, and the migration script reports a
conflict rather than overwriting a diverged destination
(`migrate-devotional-workspace.ts`, the existence branch). The committed document
is what a FRESH environment seeds from.

So after merge, someone has to apply the same rules to the live Workspace prompt,
or production keeps generating without them. That covers the two content rules
AND the two prompts moved out of code: those keys are `.optional()` precisely
because the deployed document predates them, and the services fall back to their
in-code copy until it carries them. The guard test states this scope in place so a
green run is not mistaken for proof that production carries the rules.

## Known gaps, deliberately left

- **The critics run sequentially behind two retry layers with no abort signal.**
  Three independent reads of the same immutable text, so they could run
  concurrently; the worst case is long and cannot be cancelled, and the render
  step already threads a signal.
- **"Fidelity was not checked" reaches no caller.** The review shape is
  `{ blocking }` only, so the absent-excerpt case lives in a log line.
- **`pointPicker` and `conclusionWriter` do not consult their model entries.**
  Both run on the caller's shared LLM, so those two lines in the model map change
  nothing until each seam gets an agent of its own.
- **The CLI path does not forward its log**, so the picker's rationale is still
  dropped there. That file is imported by nothing outside its own test now that
  the render runs on the worker, so wiring it is part of deciding its future.
- **`DevotionalCopy.conclusion` is generated and discarded.** Documented in place
  rather than removed: dropping it needs the zod schema, the JSON schema and the
  authored prompt to move together, plus the one script that prints it.
- **A blocked run keeps its clip reservation** rather than returning it to the
  pool. Pre-existing for safety blocks too, so not introduced here, and pinning
  it either way would encode a decision nobody has made.
- **The lead-in regex does not match every form** J.C. Ryle uses, so some
  multi-point excerpts are not detected as multi-point and reach the writer whole,
  silently.
- **No roadmap ticket** covers this work, which the repo's own rules ask for.

## Deliberately not included

- **The social cover switches**: `hideCoverDate`, `coverTextStatic`,
  `coverSecondaryLine`. These three props, plus the `occasion` cover tag, are the
  only devotional composition props `main` does not already have. Small in
  themselves, but they land in a package where `main` has moved on twice over: the
  visual components were split out of the monolithic `DevotionalVideo.tsx` into
  `visual-primitives.tsx` / `card-body.tsx` / `card-chrome.tsx` /
  `background.tsx`, and `renderConfig` became a required prop sourced from
  Workspace-authored brand tokens with no compiled palette fallback. So this is a
  re-implementation against the current shape, not a port, and the styles file
  diverges by 393 lines. Worth doing on its own once someone decides whether the
  social cards are still wanted.
- **The two-act layout.** The clip split that produces the second act lives in the
  render, and the render moved into the shorts-worker container. The worker's
  render has no notion of acts yet, so this spans the Workspace passages schema,
  the worker, the manifest, and content composition. Landing any one layer alone
  would land something inert.
- **Narration reuse** (`produceNarration`, `assertNarrationComplete`,
  `trimClipSegments`). These live in mastra's `devotional-render.ts`, which
  nothing imports upstream except its own test now that the render runs on the
  worker. If they are wanted, they belong in the worker rather than ported into a
  dead file.
- **The Russian localization layer**, on the owner's instruction. It is not
  active, and `devotional-occasions` was deferred with it rather than partially
  ported, since its only coupling to that layer is a language type.

## Origin

Inventory of what the pipeline still depends on locally, including the per-file
categories behind these decisions: `DEVOTIONAL-INVENTORY.md` on
`feat/daily-devotional-generator`.
