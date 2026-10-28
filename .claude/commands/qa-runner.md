Create or change a journey of the mobile release check. A journey is a Maestro file in `apps/mobile/release-check/journeys/` that tests the Jesus Film Watch mobile app (`apps/mobile`) on the release check's five test devices. A QA engineer or the mobile owner uses this command. It finds out what the journey must do, then follows step 7 ("Journey") of `.claude/commands/release-check.md`, which writes the file, tries it on the test devices, and prepares a pull request.

`$ARGUMENTS` is optional free text, for example `add a journey that opens More and checks the About row`, or `repair play-video`.

## Scope

- This command covers only the mobile app's release check: `apps/mobile/release-check/`.
- It does not cover the web app (`apps/web` and its Playwright tests), the TV app (`apps/tv`), admin, or any other app. If the request is about one of them, say that `/qa-runner` covers only the mobile release check, and stop. Do not write or change a test for another app.
- To run a release check, see its status, or read a report, the person uses `/release-check`.

## Rules

- Follow every rule in the "Rules" section of `.claude/commands/release-check.md`.
- Never call `maestro` yourself, and never use a `Forge RC` simulator or a `forge_rc_` emulator outside the runner.
- Ask your questions in plain chat, as a numbered list. Ask only for what the conversation does not already say.
- Give no release decision.

## Steps

1. Read the section "Write or repair a journey" in `apps/mobile/release-check/README.md`, and step 7 and the "Rules" section of `.claude/commands/release-check.md`. Do this before you ask anything, so that your questions use the runner's words.
2. Find the task from `$ARGUMENTS` and the conversation: a new journey, a change to a journey, or a repair of a failing journey. If it is not clear, ask. When the person must choose a journey, list the journey ids: the names of the `.yaml` files in `apps/mobile/release-check/journeys/`.
3. Get the journey's brief:
   1. The journey id: lowercase letters, digits, and hyphens (`^[a-z0-9-]+$`). For a new journey, suggest an id from the description, and check that no journey file has it. For a change or a repair, the file must exist.
   2. Where it starts: a cold launch of the app, or a `forgemobile://` link.
   3. The steps, in order, with the words that the screen shows.
   4. What to check after each step: a screen, a text, or a state.
   5. What it must not tap: a control that opens a web page, Share, Send, or sign-in. The release check runs signed out.
   6. The platforms: all five devices, only iOS, or only Android.
   7. Any search that it types. A new search needs a saved answer, and `record-search` records it from the person's own local admin with production-like data.

   For a repair, ask instead for the run folder or the failing step, unless the conversation already gives it.

4. Show the brief back as a short list, and ask: "Write this journey? (yes/no)". On any answer other than a clear yes, change the brief or stop.
5. Do step 7 of `.claude/commands/release-check.md`, with the id from step 3 as `<journey id>` and the brief as what the journey must do. Every yes that step 7 asks for still applies.
6. At the end, give the pull request link and the partial check's result. The mobile owner reviews and merges the pull request.
