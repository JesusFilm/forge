# Lyuba baseline recovery — feat-452

Recovery performed 2026-09-07 against Forge
`3f9c8833914fc96f5a6ec73cf043fc4cedf9fee9`. This is the reproducibility companion
to the approved Studio video authoring plan. Scope is preservation, comparison,
fixtures, and isolated tests; no production implementation was ported.

## Recoverability and ancestry

The full fork was cloned without a depth limit from
[lyubavasilierrra/forge](https://github.com/lyubavasilierrra/forge).
`git fsck --full` passed. A standalone `fork.bundle` was created and verified;
Git reports complete history with no prerequisite commits. Both the bare clone
and bundle live outside disposable worktrees at
`/home/tataihono/.local/share/forge/studio-lyuba-baseline/`.
This is local preservation, not a claim of replicated/offsite backup.

| Revision         | Exact identity                             | Meaning                                        |
| ---------------- | ------------------------------------------ | ---------------------------------------------- |
| Shared ancestor  | `a6d34f2faf65ec7bc2009aab927d60459b6d1b2a` | Merge base with the Forge checkout above       |
| Patch base       | `05f458587d12f511dfa674a63106e60b291d9fa9` | Already contains the earlier creative pipeline |
| Creative handoff | `9d1e9335625054ba2660c345674c1bef219ec0a8` | Same stable patch ID as the supplied patch     |
| Later handoff    | `a5df24451b2e55b27de98d4f54ba9f78eb9a43fa` | Adds cache/music volume overrides              |

[ancestry.txt](fixtures/studio-lyuba-baseline/ancestry.txt) records all 29 fork-only
commits from the shared ancestor, including every parent SHA. The last two are
linear children of the patch base. Relevant prerequisites include `15efc4f7`
(video-first composition), `85659e89` (text/social covers), `2d84e6dd`
(quality/cache corrections), `29c5288b` (shared narration), and `c2b541a9`
(workflow parity). Recover from the full tree, not a two-commit cherry-pick.

Actual `git diff --shortstat`:

- Shared ancestor → later handoff: **203 files, 33,979 insertions, 11 deletions**.
- Patch base → creative handoff: **42 files, 4,113 insertions, 272 deletions**.
- Creative → later handoff: **5 files, 205 insertions, 17 deletions**.
- Patch base → later handoff: **45 files, 4,303 insertions, 274 deletions**.

The attached README's 2,292 insertions / 194 deletions is stale. Both the supplied
patch and `git show 9d1e9335` produce stable patch ID
`d964b85349cc7ef5d38fdeb3548a4607959264b8`. The later commit is absent from the
attachment. [handoff-diff.txt](fixtures/studio-lyuba-baseline/handoff-diff.txt)
records the actual 45-file change set. The bundle also pins the current Forge
reference, so the comparison remains reproducible after branch movement.

## Original assets and provenance

The untouched ZIP, four supplied handoff attachments, extracted original files,
Git bundle, and test logs are retained in the persistent directory above.
[sources.json](fixtures/studio-lyuba-baseline/sources.json) pins their byte counts
and SHA-256 identities; [inventory.json](fixtures/studio-lyuba-baseline/inventory.json)
pins **every one of the 132 regular files, totaling 30,574,172 bytes**.
The archive has 147 entries including 15 directories. No media binary is committed.

- Six scripts: `ch19-seq102`, `ch31-seq104`, `ch33-seq0`, `ch33-seq1`,
  `ch33-seq0-ep1`, `ch33-seq0-ep2`.
- Four audio indexes, **87 narration MP3s**, four cached music MP3s, four approval markers.
- **21 library MP3s**, plus one music manifest listing only 20 tracks.
- Five corpus JSON files: WEB Bible, Henry Gospels, Ryle Matthew, Ryle Luke,
  and Spurgeon Morning/Evening.

All indexed narration files exist. `ch33-seq1` and `ch33-seq0-ep2` have no audio
index, narration, or approval marker. The extra library track
`from-old-zaccheus.mp3` has no manifest row. All 20 listed music prompts explicitly
say provenance was lost on 2026-08-17; do not replace that with an inferred prompt.
The cached music hashes match library tracks respectively: `ch19-seq102` →
`peace-3.mp3`, `ch31-seq104` → `hope-5.mp3`, `ch33-seq0-ep1` → `hope-1.mp3`,
`ch33-seq0` → `from-old-zaccheus.mp3`.

Narration indexes record text, voice ID, model, character count, and filename.
These are historical metadata, not acoustic verification: some character counts
and sentence splits differ from re-derived speech. Provider request IDs, exact
voice settings, pronunciation dependencies, generation times and language
verification remain **unknown**. Script source/excerpt labels are preserved as
recorded; prompt/model versions and corpus retrieval dates/exact editions are
not established by those labels. Archive timestamps do not establish generation
provenance. Approval markers are historical fingerprints, not Studio approvals.

There is **no rendered MP4, full render manifest, source footage, or downloaded
canonical subtitle track** in the supplied ZIP. The music `manifest.json` is
not a composition manifest. The recoverable baseline is the complete supplied
source/archive, not every artifact ever made on Lyuba's machine. Prior lost paid
assets mentioned in the prose cannot be reconstructed from metadata.

## Creative reconciliation and acceptance fixtures

[saved-scripts.json](fixtures/studio-lyuba-baseline/saved-scripts.json) preserves
all six parsed scripts with their original-byte hash and archive path.
[acceptance.json](fixtures/studio-lyuba-baseline/acceptance.json) derives sentence
cards and effective spoken segments at the recovered revision with occasion
suppression enabled. Reflection-card counts are respectively **17, 24, 15, 14,
18, 16** in the script order listed above. Saved audio may predate these splits;
retain its original metadata and never silently relabel it as a fresh match.

The fixtures pin ordered role/text SHA-256 hashes including cover, Scripture,
connectors, reflection, conclusion and questions/prayer. A custom settle line
changes the hash for every example. These hashes intentionally cover effective
speech only: a future paid-cache key must also bind language, provider/model,
voice/settings and pronunciation versions. They are not a replacement production
cache implementation. The one-off derivation and verification scripts were removed
after recovery; the retained fixture data is unchanged.

[background.json](fixtures/studio-lyuba-baseline/background.json) preserves these
reconciled rules with synthetic timing vectors:

- Full devotionals use a shared continuous backdrop across text cards, with
  dissolved seams; **no deliberate reflection restart**. Episode mode retains
  the deliberate reflection restart and episode window bound. Earlier architecture
  prose describing restart for all devotionals is superseded by the actual patch.
- Ordinary sharp video cards do not advance the blurred-background clock.
  Teaser `continuousClip=true` advances the shared clock through video cards too,
  preventing replay; playback rate scales source offsets. Preserve the opt-in
  `verseHoldIntoVideoSec` teaser behavior rather than enabling it globally.
- Subtitle fixtures preserve cues when a proposed snap is too short, pull the
  start back to the speaking cue, map source cuts into edited caption timing,
  and prevent overlapping acts. These are synthetic examples from recovered
  tests, **not proof of a particular real dub/edition/subtitle track**.

The background check executes only the recovered arithmetic extracted from its
source seam. It does not execute React, ffmpeg, Chromium, media playback, or
crossfades; visual continuity and preview/export parity belong to feat-453.

## Hazards and later port boundaries

`apps/mastra/src/services/devotional/devotional-render.ts`,
`prepareAndRenderDevotional`, computes `spoken` with `suppressOccasion` but omits
`input.settleLine`. Later `produceNarration` forwards that line. The utility hash
correctly changes if passed the real speech (verified by fixtures), but the
caller approves a different input. A port must bind approval to exactly the
speech and suppression options that the audio producer consumes.

The same function writes approval when `input.approveText` is set **before**
review, then substitutes an empty blocking result for approved text. This skips
`reviewDevotionalText`, including deterministic voice checks and LLM critics.
`ignoreQualityGate` is another local bypass. This is observed source control
flow, not an executed provider integration test. Do not carry these switches
into Studio's canonical approval/command boundary. Russian voice rules remain
uncalibrated according to the recovered source warning.

| Reuse candidate (review in later ticket)                                                                                    | Keep out of the new product module                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `reflection-split.ts`, `reflection-voice-check.ts`, `reflection-points.ts`, `henry-sections.ts`, `caption-name-spelling.ts` | Local corpus paths, uncalibrated rules presented as release gates                      |
| `devotional-audio.ts` speech assembly, `devotional-locale.ts` connectors                                                    | CLI paid generation, incomplete audio/cache provenance and hash identity               |
| `subtitle-align.ts` cue parsing/mapping, `jesus-film-passages.ts` curated examples                                          | Silent subtitle failure/fallback, historical clip-length policy as universal policy    |
| `devotional-manifest.ts`, composition timing/background/teaser behavior                                                     | Fixed devotional arrangement as Studio's general timeline model                        |
| `reflection-modernizer.ts`, point picker/highlighter and critics                                                            | Workspace/CLI instruction authority competing with native Mastra Editor                |
| Library byte hashes and recorded music metadata                                                                             | `music-library-store.ts` miss-to-paid-generation fallback and implicit experimentation |

The current Forge Workspace orchestration, capability transfer, and lifecycle
controls are materially newer than this fork. Do not overwrite them with the
old filesystem runner. feat-455 and feat-458 own subsequent generation reuse;
canonical approval invariants belong to the approved Studio command model.
No new implementation ticket is needed for gaps already assigned by that plan.

## Historical recovery and validation

The one-off inventory and verification scripts have been removed. Commands and
results in this section document the completed recovery, not a current runbook.

Use a persistent directory outside disposable checkouts for `<preserve>`; use
`<recovered>` for its detached checkout of `a5df24451b2e55b27de98d4f54ba9f78eb9a43fa`.
Never source the old `.env.local`, call generation CLIs, or run a renderer for
this recovery procedure.

```bash
git clone --bare '<preserve>/fork.bundle' '<new bare clone>'
git --git-dir='<new bare clone>' worktree add --detach '<recovered>' a5df24451b2e55b27de98d4f54ba9f78eb9a43fa
```

The inventory command checks preserved originals rather than overwriting different
bytes. Its JSON is semantically deterministic; run Prettier before comparing
its output byte-for-byte with committed JSON. Use a temporary output directory
for verification, preserving the pinned fixture files.

For the executed test environment, Node 24.20.0 / pnpm 9.12.3 reused existing
`node_modules` through symlinks at recovered root, Mastra, and compositions from
`/home/tataihono/Developer/forge`. No files in that checkout were edited. This
**did not reinstall the old lockfile**. [validation.json](fixtures/studio-lyuba-baseline/validation.json)
records actual dependency versions, both lockfile hashes, commands and log hashes.
Package resolution therefore proves compatibility under the recorded installed
dependencies, not the handoff's original dependency graph.

Create `<recovered>/devo/corpus` as a symlink to
`<preserve>/originals/devo/corpus` (only corpus, not paid cache/music). Apply
[test-path-adaptation.patch](fixtures/studio-lyuba-baseline/test-path-adaptation.patch)
only to the recovered checkout: it changes one historical test's machine-specific
path to `LYUBA_BASELINE_DATA_DIR`. Production source is unchanged.

```bash
# From recovered/apps/mastra; prefix vitest with pnpm exec if needed.
LYUBA_BASELINE_DATA_DIR='<preserve>/originals' pnpm exec vitest run src/services/devotional --maxWorkers=2
LYUBA_BASELINE_DATA_DIR='<preserve>/originals' pnpm exec vitest run --maxWorkers=2
pnpm exec tsc --noEmit
# From recovered/packages/shorts-compositions:
pnpm exec vitest run --maxWorkers=2
pnpm exec tsc --noEmit
```

Actual results: initial focused run **470 passed / 7 failed** on missing corpus;
restored focused run **477/477 tests, 56 files**; full recovered Mastra suite
**954/954 tests, 110 files**; full recovered composition suite **59/59 tests,
6 files**; both typechecks exit 0; acceptance verifier **10/10**. The README's
historical 468/54 claim is not our executed result. No full current Forge
monorepo suite was run, because production packages are unchanged.

No paid generation, deployment, database mutation, browser smoke, runtime render,
acoustic inspection, or page-load measurement occurred. Missing media prevents
claiming original output recovery or visual acceptance. Fixture checks and unit
suites establish only the mechanisms they execute.

## Standards review

No actionable findings. A separate reviewer checked the staged implementation
against the root conventions and code-review smell baseline, and independently
verified all 12 fixture checksums. No production code or binary media was added.

## Spec review

No actionable findings. A separate reviewer verified the six script hashes,
all 132 preserved file hashes, and the retained logs against recorded test results.
Missing footage, canonical subtitles, rendered outputs and historical dependency
reproduction are explicit limitations; runtime proof remains a separate ticket.

Both reviews used the staged recovery diff against planning cherry-pick
`f4795e154cdf5f66b2824994e4cc9d4489070cb0` (source planning commit `29c187d2`).
Standards: 0 findings; Spec: 0 findings.
