Run the mobile release check. The runner builds the app from the current commit, runs the fixed journeys on its own five test devices behind a local read-only server, and writes a local report. The runner is `apps/mobile/release-check/cli.mjs`. This command only asks for consent, starts the runner, and summarizes the report. Read `apps/mobile/release-check/README.md` for the full guide.

`$ARGUMENTS` selects one mode. Accept only these forms:

- empty or `plan`: show the consent text, and start nothing.
- `run`: a full release check.
- `run <journey ids>`: a partial check of the journeys you name, separated by commas, for example `run cold-launch-home`. A partial check is not a release result.
- `status`: show the state of the newest run.
- `stop`: stop the running check.
- `setup`: check the Mac's tools and the five test devices, and create what is missing.

For any other value, show this list and stop. Pass no other flag to the runner.

## Rules

- Never call `maestro` yourself. Never boot, stop, erase, or install on a simulator named `Forge RC …` or an emulator named `forge_rc_…`. The runner is the only way to drive them.
- Never edit a file in `apps/mobile/release-check/config/`. The mobile owner changes the lists through a commit.
- Give no release decision. Report what the summary says. The mobile owner decides the release and tells the QA engineers.
- A yes covers only the exact command line that you showed. When anything changes (a new commit, a new plan, other journeys), show the plan again and ask again.
- Run every command from the repo root.

## Steps

1. **Plan.** Run `node apps/mobile/release-check/cli.mjs plan`, and show its text to the person without changes. Then run `node apps/mobile/release-check/cli.mjs plan --json`, and read `refusals`, `runCommand`, `commit`, and `estimate`. For `plan`, stop here.

2. **Run** (`run` or `run <journey ids>`):
   1. Do step 1.
   2. If `refusals` is not empty, list each refusal with its message, and stop. Do not ask for a yes. A refusal that names a command (for example a Maestro install) tells the person what to do; the person runs it, then asks again.
   3. Make the command line: take `runCommand` exactly, add ` --journey <journey ids>` for a partial check, and add ` --detach`. Show this exact line.
   4. Ask: "Start the release check with this command? It takes <estimate> for a full check. (yes/no)". For a partial check, say that it is a partial check and not a release result. Accept only a clear yes. On any other answer, stop.
   5. Run that exact line. It prints `{ "runId", "runDir" }` and returns at once, because a full check takes about 2.5 to 3 hours. If it prints a refusal and exits with 2, show the refusal and stop.
   6. Wait for `<runDir>/summary.md` with the harness's own wait mechanism, not with repeated tool calls. For example, start a background shell loop `until [ -f "<runDir>/summary.md" ]; do sleep 60; done`. The runner writes `summary.md` last, after `summary.json` and `report.html`.
   7. When `summary.md` exists, open the report with `open "<runDir>/report.html"`. Then write a short summary in chat: the headline, the counts for each label, the build check, the log check, the settings probe, the screen list gaps, and the stop reason. Give the run folder path. Tell the person that they can share the report as a zip of the run folder, or by pasting `summary.md`.

3. **Status.** Run `node apps/mobile/release-check/cli.mjs status`, and show its text. When the run has ended, do step 2.7 with its report.

4. **Stop.** Run `node apps/mobile/release-check/cli.mjs status`, and show its text. Ask: "Stop the running release check? (yes/no)". On a clear yes, run `node apps/mobile/release-check/cli.mjs stop`. It stops the run through the same end path as every other run and prints the path of `summary.md`. Then do step 2.7 with that run folder.

5. **Setup.** Run `node apps/mobile/release-check/cli.mjs setup --check`, and show its text. If it names a problem with a command, show the command; the person runs it. If it would create test devices or download images, show what it would do and the download size. Ask for a yes for `node apps/mobile/release-check/cli.mjs setup`, and run it on a clear yes.

## Notes

- Exit codes: 0 means that the selected scope passed, 1 means that a run started and failed, and 2 means a refusal before any side effect. Only `scope: "release"` with `result: "pass"` in `summary.json` is a passing release check. Exit 0 alone is not.
- Every failure fails the run: a new failure, a flaky journey, a known bug, a screen list gap, a failed check, and an early stop. The report labels each one.
- The runner needs Maestro 2.11.0. When `plan` names `MAESTRO_VERSION`, the person installs that version, or sets `MAESTRO_BIN` to a 2.11.0 binary, and runs the command again.
- A run uses a lot of memory and CPU. When `plan` names `HOST_CAPACITY`, other work on the Mac must finish first.
