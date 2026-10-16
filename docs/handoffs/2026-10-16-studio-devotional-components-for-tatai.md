# Studio devotional components: what is done, what we need from you

Hi Tatai,

We set things up so someone on the team can build a Daily Bible Pause
devotional in Studio Manager (Shorts) with their own Claude and Studio's
own narration, in our series look, without anything from my laptop.

## Done

- **Components in Studio.** 18 devotional components are uploaded and
  listed with paste-ready registration blocks in
  `apps/mastra/studio-components/registry.json`. Three are new today and
  passed a test render (`component-test-steps-verse-scroll-20261016`), each in
  English and Russian builds:
  - `step-line-v1`: the WATCH / REFLECT / PRAY stepper.
  - `verse-callout-*-v1`: a verse with a gold underline.
  - `scripture-scroll-*-v1`: numbered film Scripture with the spoken word
    lit.
- **Generator.** `apps/mastra/studio-components/make-devotional-project.py`
  turns an approved script (JSON) into the Studio create document and apply
  operations. Example: `examples/widow-en.json` gives the project
  `widow-vertical-components-20261016` (71 items).
- **Docs.**
  - The recipe for a teammate's Claude: `docs/studio-devotional-recipe.md`.
  - From a story to cue files and scripts:
    `docs/handoffs/devotional-new-story-kickoff.md` and
    `apps/mastra/scripts/make-film-cues.py`.
- **Where it lives.** Everything is on `feat/devotional-video-pipeline-handoff`
  in my fork, inside PR JesusFilm/forge#2207.

## What we need from you

1. **Voice presets in Studio.** Only "Bella" is available now. Please
   register our series voices as approved voice presets. All are ElevenLabs
   voices:

   | Voice             | ElevenLabs ID          | Language |
   | ----------------- | ---------------------- | -------- |
   | female-d          | `98ujrzs7rxAMEsaC4EpW` | English  |
   | male-e            | `xLeLcqgjUx3wQJFSESKj` | English  |
   | Tatyana Voloshina | `nkvv6waLzFah2jTNUZGT` | Russian  |
   | Ivo               | `hD8aK7CmEPgH3mbFO08e` | Russian  |

   An agent cannot do this.

2. **Getting the files to the team.** The files sit in PR #2207 (large,
   devotional pipeline). If you prefer, we can open a small PR with only
   `apps/mastra/studio-components/` and the two docs, so it can merge sooner.
   Tell us which you want.

3. **A Studio error we could not see past.** Studio returns only "Studio
   command rejected" when a component `versionId` is registered with code
   that differs from the first code ever registered under that name, in any
   project. We worked around it with `reveal-serif-*-v2`. A clearer error
   message would save the next person an hour.

4. **Render failures.** The full 5-minute project
   `widow-vertical-components-20261016` (revision 8) failed with "Render
   execution failed" and no detail. Short tests of the same components
   render fine. If you can see the worker log for attempt
   `cmvau9lihimv8qa0shuddt27x`, that would tell us the cause.

   What we tested on our side (2026-10-16):
   - Every piece renders on its own: the components without video
     (`widow-bisect-c-20261016`), each film item alone, including the full
     64 s scene at 1.05 with sound (`film-test-20261016`), and short mixes
     of rates and sound.
   - What fails is length. The opening plus the film, as video items only,
     is 84 s in 6 items (`widow-bisect-a-20261016` revision 3). The full
     project is 5 min.
   - The 64 s film alone took about 20 minutes to render. So our guess is a
     render time limit on the worker. Can you confirm it and tell us the
     limit, or raise it for 3 to 5 minute projects?

Thanks!
Lyuba
