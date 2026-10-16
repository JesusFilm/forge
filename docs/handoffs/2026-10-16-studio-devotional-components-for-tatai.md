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
   register our two English series voices as approved voice presets
   (ElevenLabs): female-d `98ujrzs7rxAMEsaC4EpW` and male-e
   `xLeLcqgjUx3wQJFSESKj`. The Russian voices can wait. An agent cannot do
   this.

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

   What we found on our side (2026-10-16), narrowing it down with short
   test projects:
   - **Our bug, fixed:** a component with a zero-length fade
     (`interpolate(t, [end - 0, end], ...)`) throws, and the whole render
     fails. `backdrop-blur-v3` guards it (`t-blur3-20261016` passes).
   - **A slowed video item longer than a few seconds fails.** One item of
     19 s at `playbackRate` 0.7 fails on its own (`t-long-slow-20261016`).
     4 s at 0.7 (`rate-test-20261016`) and 2.8 s at 0.5 pass. We moved the
     backgrounds to normal speed. Is this a known limit of the worker?
   - **Two adjacent items of the same film, both off normal speed, fail
     together:** a 2.8 s shot at 0.5 followed by the 64 s scene at 1.05
     (`t-hold-film-20261016`), though each renders alone and 1.0 + 0.5
     passes (`mixed-rate-test-20261016`). We set the shot to 1.0.
   - Every render takes long: the 64 s scene alone took about 20 minutes.
     If there is a render time limit, what is it?

Thanks!
Lyuba
