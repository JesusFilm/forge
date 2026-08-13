# feat(mastra): devotional quality gate, critics, and two missing owner rules

## What this does

Adds the quality layer the devotional pipeline was missing, and restores two
content rules that were never carried into the authored prompt.

Three things now hold that did not before:

1. **At most two of the author's points per devotional.** A commentary excerpt
   often carries several ordinal points ("we learn, firstly ... secondly ...
   thirdly"). The source is narrowed BEFORE the writer sees it, so the rule is
   enforced by the data that reaches the writer rather than by an instruction it
   can drift from. Excerpts with no ordinal structure, roughly a fifth of the
   corpus, pass through whole.
2. **A quality gate runs before any paid narration or render.** It composes
   three critics: coherence, depth, and fidelity of the adaptation against its
   source. The narrowed excerpt is recorded as provenance, which is what the
   fidelity critic compares against.
3. **The closing line comes from a dedicated agent**, running after the
   copywriter so it can see the chosen title, question and prayer and stay
   complementary rather than redundant.

Plus two owner content rules added to `/inputs/prompts/generation.json`:

- The viewer ALREADY follows Jesus. Without it the model silently redirects a
  devotional for a believer into an altar call. Every individual sentence still
  reads fine, which is what makes the drift hard to catch by reading output.
- Describe, don't command. The narration is a synthetic voice with no
  reputation to spend, so imperatives land as scolding.

## Why it is shaped this way

This work existed on `feat/daily-devotional-generator`, which diverged 25
commits ago, before the Workspace data plane landed. Merging that branch would
have meant deciding 104 files where `main` is right in most of them: 27 of its
files are already upstream verbatim, and nine more were rewritten upstream to
read through the Workspace.

So this PR carries only what `main` does not have, onto current `main`. Four
separate checks all resolved in `main`'s favour before that call was made:
roadmap tickets, the video studio plan, the Azure voiceover prose, and the
chapter catalog.

Three things upstream deliberately does differently were NOT carried over:
the disk fallback for corpora, the single-argument chapter lookup, and hook
styles resolved without injection. All three read the local filesystem or an
in-code table instead of the Workspace, so importing them would have undone
what the data plane is for.

## Verification

```
tsc     clean
lint    clean
tests   2404 passed, 5 skipped
```

Each of the three wiring changes has a test that fails on its own revert,
falsified one at a time: dropping the provenance field, taking the copywriter's
conclusion instead of the agent's, and handing the writer the whole excerpt.
The narrowing fixture keeps points 1 and 3 so a pass cannot come from keeping
everything; point 2 must be absent.

The prompt guard was falsified once by rewording the audience heading, which
fails the audience case and leaves the other two green.

## Operator step this PR does NOT do

**The deployed Workspace prompt is not updated by merging this.** In Railway the
writable S3 Workspace is authoritative, and the migration script reports a
conflict rather than overwriting a diverged destination
(`migrate-devotional-workspace.ts`, the existence branch). The committed
document is what a FRESH environment seeds from.

So after merge, someone has to apply the same two rules to the live Workspace
prompt, or production keeps generating without them. The guard test states this
scope in place so a green run is not mistaken for proof that production carries
the rules.

## Deliberately not included

Each of these turned out to be entangled with something `main` replaced, so each
wants its own PR rather than being folded in here:

- **The cover-card and visual work** (~2200 lines in `DevotionalVideo.tsx`).
  `main` made `renderConfig` a required prop sourced from Workspace-authored
  brand tokens, with no compiled palette fallback; the branch version predates
  that and its styles file diverges by 393 lines. Porting it wholesale would
  remove the Workspace styling model.
- **The two-act layout.** The clip split that produces the second act lives in
  the render, and the render moved into the shorts-worker container. The
  worker's render has no notion of acts yet, so this spans the Workspace
  passages schema, the worker, the manifest, and content composition. Landing
  any one layer alone would land something inert.
- **Narration reuse** (`produceNarration`, `assertNarrationComplete`,
  `trimClipSegments`). These live in mastra's `devotional-render.ts`, which
  nothing imports upstream except its own test now that the render runs on the
  worker. If they are wanted, they belong in the worker rather than ported into
  a dead file.
- **The Russian localization layer**, on the owner's instruction. It is not
  active, and `devotional-occasions` was deferred with it rather than
  partially ported, since its only coupling to that layer is a language type.

## Origin

Inventory of what the pipeline still depends on locally, including the
per-file categories behind these decisions: `DEVOTIONAL-INVENTORY.md` on
`feat/daily-devotional-generator`.
