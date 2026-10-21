# Daily Bible Pause devotional kit (Studio Manager, 9:16)

For anyone on the team, with their own Claude and the Forge Shorts tools. It
needs nothing from anyone's computer: every file of the kit is stored in
Studio itself (search assets for "DBP kit"), and so are the components, the
fonts and the music beds ("DBP music bed").

## Files (all in Studio, search "DBP kit")

- `make-devotional-project.py`: turns an approved script into a Studio
  project. Python 3.9 or newer, no packages.
- `registry.json`: the exact registration of every component.
- `metrics.json`: letter widths, so the script can place text without fonts.
- `cues.json`: the film narrator's word times for 18 LUMO scenes we have
  used (they drive the scrolling Scripture during the film).
- `music.json`: the 13 music beds in Studio, with their lengths, so the
  script lays the bed under the opening and the reflection and repeats it.
- `paralytic-en.json`: a complete example script (The Paralytic, Luke 5).
- `KIT-README.md`: this file.

## Steps for Claude

1. Download every "DBP kit" asset with `shorts.assetRead` into one folder,
   saving each under its name without the "DBP kit " prefix. When a file has
   several versions, take the newest (the last one listed).
2. Write the new story's script in the same shape as `paralytic-en.json`
   (the field list is at the top of `make-devotional-project.py`). Find the
   film with `shorts.search` (e.g. "LUMO - Luke 5:1-39") and get its `source`
   block with `shorts.capture` (`trackId: null`).
3. Run: `python3 -I make-devotional-project.py script.json out/`.
4. `shorts.create` with `out/create.json`, then `shorts.apply` each
   `out/ops-N.json` in order, passing the revision each call returns.
5. Hand over the editor link `https://manager.jesusfilm.org/dashboard/shorts/<projectId>`.
   Render only if the person asks.

## Rules from the owner

- The reflection sentence is always Inter. The verse card shows only while
  the voice talks about that verse. Keep inner quotes in verse text single
  (‘ ’).
- Safe zones: no text in the top 270 px, nothing below 1450 px, keep text
  left of x 920 between y 880 and 1500.
- No em or en dashes in our own text (Scripture is quoted exactly).
- Credits: film (LUMO, Jesus Film Project, NIV narration), the verse
  translation (BSB), the commentary source with its year.
- Never reuse the previous devotional's music bed.

## Voices

Use only approved voice presets (asset role `voice`). A person adds a voice
in the Shorts editor ("Import a known preset" with the ElevenLabs voice id);
an agent never creates one by uploading an asset (the shorts-creator skill's
rule). Series voices to import: female-d `98ujrzs7rxAMEsaC4EpW`, male-e
`xLeLcqgjUx3wQJFSESKj`, Tatyana `nkvv6waLzFah2jTNUZGT`, Ivo
`hD8aK7CmEPgH3mbFO08e`. Four presets with these names were uploaded by an
agent on 2026-10-21 by mistake; do not rely on them until the Studio owner
confirms. `shorts.narrationQuote` is free, `shorts.narrate` costs money, so
ask first.

## Known limits (2026-10-21)

- Background blur: the blur element only darkens the footage now; Studio no
  longer blurs video under a component.
- Slowed footage longer than a few seconds fails to render, so backdrops play
  at normal speed.
- Word times for a film scene come from `cues.json`. A scene that is not
  there yet needs its cue file made (`make-film-cues.py`, which runs on a
  computer with the film and whisper).
- Studio audio has no crossfade: a repeated music bed is laid end to end
  (between its sound start and its fade-out), not crossfaded.
- Narration in Studio uses the presets' model (eleven_multilingual_v2); our
  v3 delivery tags and timed pauses are not tested there.
- Russian uses the earlier layout (credit above the sentence).
