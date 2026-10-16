# Recipe: a vertical Daily Bible Pause devotional in Studio Manager

For a teammate's Claude (Claude Code with the `shorts-creator` skill and the
Forge Shorts MCP). Result: an editable 9:16 project in Studio Manager
(`https://manager.jesusfilm.org/dashboard/shorts/<projectId>`) that a person
reviews and fixes in the editor. Reference projects: `widow-devotional-vertical-en-20261015` (built
2026-10-15 from the Persistent Widow long form) and the component test
`component-test-steps-verse-scroll-20261016`.

Components live in Studio already; their exact registration blocks are in
`apps/mastra/studio-components/registry.json`. Nothing on
anyone's laptop is needed.

## Inputs the person gives you

1. The story and passage (e.g. Luke 18:1-8) and the language (English or
   Russian).
2. The approved script: four opening lines, the reflection paragraphs (one
   of them may be the "insight": a history or word note with its source), the
   takeaway line, the closing verse (Berean Standard Bible for English,
   Synodal for Russian), one question and one prayer.
3. Which LUMO scene to use. Search `shorts.search` with the title form
   `LUMO - Luke 17:1-18:8` (the Gospel of Luke is split into segments; search
   by chapter). LUMO has no subtitle track: capture with `trackId: null`.

Ask only for what is missing. Never invent Scripture wording: the film's lines
are the NIV as the narrator reads them; the closing verse is quoted exactly.

## Timeline (about 3 to 5 minutes, 30 fps, 1080 x 1920)

| Part                | Picture                                                                                           | Component / text                                                                                                       | Voice                                     |
| ------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Opening, 15-20 s    | 4 film shots, one per line, muted, `film-look-v1` dim 0.25                                        | `Caption-orange` (RU `kinetic-ru-v1`) per line, `bottomPercent` 38; `dbp-mark-v1` at top 230                           | lines alternate between the two voices    |
| Step: watch         | last opening shot, slowed                                                                         | `step-line-v1`, step 0                                                                                                 | "Let's watch."                            |
| The scene           | the LUMO passage with its own sound                                                               | `scripture-scroll-en-v1` (RU `-ru-`) over the whole scene: numbered verses, the spoken word gold                       | film                                      |
| Step: reflect       | film at normal speed (a slowed clip over a few seconds fails the render), `film-look-v1` dim 0.45 | `step-line-v1`, step 1                                                                                                 | "Let's look more closely at what this..." |
| Reflection          | slow film                                                                                         | one `reveal-serif-en-v2` (RU `-ru-`) item per sentence: fontSize 60, width 760, top 960, colour #f4efe8                | reflection voice                          |
| Insight credit      |                                                                                                   | `source-mark-v1` (kind history / language / commentary) at top 520, held over three sentences, which move to top 1040  |                                           |
| Verse referred to   |                                                                                                   | `verse-callout-en-v1` (RU `-ru-`): top 430, width 860, maxHeight 420, the phrase underlined in gold; sentence top 1140 |                                           |
| Takeaway            | `backdrop-blur-v3` 8 px, scrim 0.42                                                               | `takeaway-v1`: large Literata 500 in gold, the highlight phrase italic, letter by letter                               | reflection voice                          |
| Closing verse       | `backdrop-blur-v3` 8 -> 25 px over 1.6 s, grain 0.5                                               | `closing-verse-v1`: gold quote mark, italic verse (EN Source Serif 4, RU Literata), gold citation "ROMANS 12:12 · BSB" | reflection voice                          |
| Step: pray          | `backdrop-blur-v3` 25 -> 44 px                                                                    | `step-line-v1`, step 2                                                                                                 | "Let's pray."                             |
| Question and prayer | `backdrop-blur-v3` 44 -> 72 px, scrim 0.36, grain 0.5                                             | `pray-block-v1`: both on one left-aligned screen, labels in gold caps, prayer in italic from `prayerAtSec`             | the other voice                           |
| End                 |                                                                                                   | `dbp-mark-v1`                                                                                                          |                                           |

Tracks, bottom to top: `fonts`, `clips`, `look`, `captions`, `cards`,
`brand` (visual) and `music` (audio). The `fonts` track carries the font-pack
items (`font-*-v1`), each from frame 0 to the end: the closing components name
those faces instead of embedding them, because one component holds at most
32768 bytes. Every component's controls and
sizes are in `registry.json` (`purpose`).

## Steps

1. Write the script as JSON (format in the header of
   `apps/mastra/studio-components/make-devotional-project.py`; the Persistent
   Widow is `examples/widow-en.json`). Film cue files come from
   `apps/mastra/scripts/make-film-cues.py` (see
   `docs/handoffs/devotional-new-story-kickoff.md`, step 3).
2. `shorts.capture` the LUMO segment (`trackId: null`, highest download) and
   put the returned source block in the JSON as `source`.
3. Run the generator:
   `python3 -I apps/mastra/studio-components/make-devotional-project.py script.json out/`.
   It prints warnings for text near the safe-zone edges and for dashes.
4. `shorts.create` with `out/create.json` as the document (empty: large
   creates fail), then `shorts.apply` each `out/ops-N.json` in order, with the
   revision each apply returns.
5. Voice: with `voices` in the JSON the ops already carry `set-speech`;
   otherwise add it per `out/speech.txt`, using APPROVED voice presets from
   `shorts.assets` (role `voice`). `shorts.narrationQuote` shows the cost; tell
   the person the price before `shorts.narrate`. One initial pass plus one
   correction per project, so get the script right first.
6. Read the project again and fit each item to its narration (the generator's
   timings are estimates from word counts). Without word times, `reveal-serif`
   spreads the words evenly over the item.
7. Hand over the editor link. Render only if the person asks.

## House rules (from the owner)

- Safe zones: no text in the top 270 px, nothing below 1450 px, keep text left
  of x 920 in the band y 880-1500 (the like/comment rail).
- No em or en dashes in on-screen text or captions.
- Russian text addressed to the viewer is gender-neutral ("больше не
  приходишь", not "перестал").
- Credits go on screen as small gold lines and in the post caption: film
  (LUMO, Jesus Film Project, narration NIV), the closing-verse translation, the
  commentary or source with its year.
- Do not reuse the previous devotional's music; the team keeps a list of beds.

## Voices

Studio has one approved English preset so far ("Bella"). The series voices
must be registered as presets by a person in Studio (it cannot be done by an
agent): ElevenLabs voice ids female-d `98ujrzs7rxAMEsaC4EpW`, male-e
`xLeLcqgjUx3wQJFSESKj` (English); Tatyana Voloshina `nkvv6waLzFah2jTNUZGT`,
Ivo `hD8aK7CmEPgH3mbFO08e` (Russian).
