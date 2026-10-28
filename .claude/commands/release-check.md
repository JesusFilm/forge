Run the mobile release check. The runner builds the app from the current commit, runs the fixed journeys on its own five test devices behind a local read-only server, and writes a local report. The runner is `apps/mobile/release-check/cli.mjs`. This command asks for consent, starts the runner, summarizes the report, and guides the work on one journey. Read `apps/mobile/release-check/README.md` for the full guide.

`$ARGUMENTS` selects one mode. Accept only these forms:

- empty or `plan`: show the consent text, and start nothing.
- `run`: a full release check.
- `run <journey ids>`: a partial check of the journeys you name, separated by commas, for example `run cold-launch-home`. A partial check is not a release result.
- `status`: show the state of the newest run.
- `stop`: stop the running check.
- `recover`: clean up after a runner that stopped before it wrote its report.
- `setup`: check the Mac's tools and the five test devices, and create what is missing.
- `journey <journey id>`: write a new journey or repair one, try it on the test devices, and prepare a pull request.

For any other value, show this list and stop. Pass no other flag to the runner.

## Rules

- Never call `maestro` yourself. Never boot, stop, erase, or install on a simulator named `Forge RC …` or an emulator named `forge_rc_…`. The runner is the only way to drive them.
- Edit a file in `apps/mobile/release-check/config/` only in step 7, and only the three lists that step names. The mobile owner changes the other lists through a commit.
- Give no release decision. Report what the summary says. The mobile owner decides the release and tells the QA engineers.
- A yes covers only the exact command line that you showed. When anything changes (a new commit, a new plan, other journeys), show the plan again and ask again.
- Read the plan, the run state, and the result from the JSON output (`plan --json`, `status --json`, and `summary.json`), not from the text.
- Run every command from the repo root.

## Steps

1. **Plan.** Run `node apps/mobile/release-check/cli.mjs plan --json` one time. Show its `text` field to the person without changes. Then read `refusals`, `runCommand`, `commit`, `estimate`, and `setup` from the same output. The text and these fields come from one reading of the Mac, so they agree. Do not run `plan` without `--json`. For `plan`, stop here.

2. **Run** (`run` or `run <journey ids>`):
   1. For a partial check, check each journey id against `^[a-z0-9-]+$`. If an id does not match, show it, and stop. Also stop when `apps/mobile/release-check/journeys/<id>.yaml` does not exist, because the runner finds an unknown id only after the yes.
   2. Do step 1.
   3. If `refusals` is not empty, list each refusal with its `code` and `message`. Do not ask for a yes for the run. Then do the first item that applies:
      - A `STALE_RUN_LOCK` refusal names `session down`: that command is for the person. Tell the person to run it, and stop.
      - A `STALE_RUN_LOCK` refusal names `recover`: do step 6, which asks for its own yes. After step 6, if `recover` ran and did not refuse, do step 2.2 again. Do this one time only: if the new plan also has a `STALE_RUN_LOCK` refusal, stop.
      - In all other cases, stop. A refusal that names a command (for example a Maestro install) tells the person what to do; the person runs it, then asks again.
   4. Make the command line: take `runCommand` exactly, add ` --journey <journey ids>` for a partial check, and add ` --detach`. Show this exact line.
   5. Ask: "Start the release check with this command? It takes <estimate> for a full check. (yes/no)". Use `estimate.text` for <estimate>. If the line has `--allow-setup`, also say that the run first downloads each item of `setup.downloads` (its `package`, about `approxMb` MB). Also say that it creates each device in `setup.createsDevices`. For a partial check, say that it is a partial check and not a release result. Accept only a clear yes. On any other answer, stop.
   6. Run that exact line. It prints `{ "runId", "runDir" }` and returns at once, because a full check takes about 2.5 to 3 hours. If it prints a refusal and exits with 2, show the refusal and stop.
   7. Wait for the run to end with the harness's own wait mechanism, not with repeated tool calls. For example, start this loop as a background shell command:

      ```sh
      start=$(date +%s)
      until [ -f "<runDir>/summary.md" ] ||
        node apps/mobile/release-check/cli.mjs status --json | node -e '
          const waited = Date.now() / 1000 - Number(process.argv[2])
          if (waited > 7 * 3600) process.exit(0)
          const run = JSON.parse(require("fs").readFileSync(0, "utf8")).run
          const ended = run && run.runId === process.argv[1] &&
            (run.summaryMd || ["ended", "refused"].includes(run.phase) ||
              run.pidState === "ended" ||
              (run.phase === "starting" && waited > 900))
          process.exit(ended ? 0 : 1)' "<runId>" "$start"
      do sleep 60; done
      ```

      The loop ends when `summary.md` exists, or when `run.phase` is `ended` or `refused`. It also ends when `run.pidState` is `ended`, or when `run.phase` stays `starting` for 15 minutes. After 7 hours, the loop ends in every case, also when `status --json` fails. The runner stops each run after 6 hours, so a longer wait shows a fault. Then do step 2.8.

   8. Run `node apps/mobile/release-check/cli.mjs status --json` one time. `run.runDir` is the run folder. Do the first item that applies:
      - `run.summaryMd` is not null: do step 2.9.
      - `run.phase` is `refused`: list each item of `run.refusals` with its `code` and `message`, and stop.
      - `run.pidState` is `running`: tell the person that the run continues, and stop.
      - `run.pidState` is `ended`, and `run.phase` is not `ended`: the runner stopped before its end steps. Do step 6.
      - In any other case, the runner wrote no report. Show the last 20 lines of `<runDir>/runner.log`. Tell the person to read `runner.log` and `events.jsonl` in the run folder, and stop.
   9. Open the report with `open "<runDir>/report.html"`. Read `<runDir>/summary.json`. Its field names are in `apps/mobile/release-check/schema/summary.schema.json`. Write a short summary in chat, in this order:
      - `scope` and `result`. Only `scope` `release` with `result` `pass` is a passing release check. For `scope` `partial`, say that it is not a release result.
      - The `counts` for each label, and the `stopReason`.
      - Each item of `journeys` whose `label` is not `pass`: its `journey`, `deviceId`, and `label`. Add the `class` and `failedStep` of its last item in `attempts`.
      - The build check, the log check, and the settings probe: `passed` in `checks.build`, `checks.log`, and `checks.settingsProbe`. A null check did not run. For each check with `passed` false, list each item of its `findings` with its `code` and `message`. Then the screen list gaps in `checks.screens.gaps`.
      - The Not-Tested List, on one line: the count of items in `notTested`.
      - Each item of `staleKnownBugs`, with its `journey` and `ticket`.
      - Each item of `server.rateLimitRefusals`, with its `field`, `journey`, `deviceId`, and `causedFailure`.
      - Each item of `proposedActions`, with its `type` and `reason`, and its `journey` or `screen` when it has one. Give these only as proposals. The mobile owner decides each one and commits the list change.

      Give the run folder path. Tell the person that they can share the report as a zip of the run folder, or by pasting `summary.md`.

3. **Status.** Run `node apps/mobile/release-check/cli.mjs status`, and show its text. If it shows no run folder, stop. Otherwise do step 2.8.

4. **Stop.** Run `node apps/mobile/release-check/cli.mjs status`, and show its text. Show the line `node apps/mobile/release-check/cli.mjs stop`. Ask: "Stop the running release check with this command? (yes/no)". On a clear yes, run that line. It stops the run through the same end path as every other run and prints the path of `summary.md`. Then do step 2.9 with that run folder. If `stop` exits with 1, the run did not write `summary.md` in time. Do step 2.7 and step 2.8 for the run that `status` showed. If `stop` refuses and names `recover`, do step 6.

5. **Setup.** Run `node apps/mobile/release-check/cli.mjs setup --check`, and show its text. Exit 1 means that setup must run or that a tool is missing. It is not a runner fault. If it names a problem with a command, show the command; the person runs it. If it would create test devices or download images, show what it would do and the download size. Ask for a yes for `node apps/mobile/release-check/cli.mjs setup`, and run it on a clear yes.

6. **Recover.** Use this step when `status` shows a stale lock, when step 2.3 finds a `STALE_RUN_LOCK` refusal that names `recover`, or when step 2.8 finds a runner that stopped with no report. Run `node apps/mobile/release-check/cli.mjs status`, and show its text. Then run `node apps/mobile/release-check/cli.mjs status --json` one time, and read `lock.state` and `lock.mode`. If `lock.state` is not `stale`, `recover` has nothing to clean up: do not run it. Tell the person to read `runner.log` and `events.jsonl` in the run folder, and stop. Otherwise, show the line `node apps/mobile/release-check/cli.mjs recover`. Ask: "Clean up after the stopped runner with this command? <effect> (yes/no)". For <effect>, use the text for `lock.mode`:
   - `run`: "It stops the runner's own test devices and writes a report with stop reason `runner_killed`."
   - `record-search`: "It stops the runner's own test devices and removes the stale lock."
   - Any other value: "It removes the stale lock. It does not stop a test device." For a `session` lock, also say that `session down` stops the session's test device, and that the person runs it.

   On a clear yes, run that line. If it refuses, show the refusal and stop. If its output names a `Summary:` path, do step 2.9 with that run folder. Otherwise show its text, and tell the person to read `runner.log` and `events.jsonl` in the run folder.

7. **Journey** (`journey <journey id>`): write or repair the file `apps/mobile/release-check/journeys/<journey id>.yaml`. A QA engineer or the mobile owner can do this. `/qa-runner` asks for the journey's brief first, then follows this step.
   1. Check the id against `^[a-z0-9-]+$`. If it does not match, show it, and stop. When the file exists, this is a repair. Otherwise it is a new journey. If the conversation does not say what a new journey must do, or which run or step failed for a repair, ask for the brief that step 3 of `.claude/commands/qa-runner.md` lists, and wait for the answer. Write nothing before you have it.
   2. Read the current branch and the uncommitted changes with git. If the branch is main, ask the person for a branch name, and suggest `fix/release-check-<journey id>` for a repair or `feat/release-check-<journey id>` for a new journey. Create the branch from an up-to-date main. If the branch is not main and has commits that are not on main, show them, and ask whether to continue on this branch or to create a new branch from main: an open pull request of another journey can be on it. If uncommitted changes exist outside the journey file and the three lists of step 7.9, show them, and stop. Never commit to main.
   3. Read the section "Write or repair a journey" in `apps/mobile/release-check/README.md`, and `docs/solutions/developer-experience/maestro-journey-authoring-traps-mobile-release-check.md`. For a new journey, also read two journeys that cover similar screens. For a repair, read the failure first: use the run folder that the person names, or `run.runDir` from `status --json`. In its `summary.json`, read the `attempts` of the journey on each device, with `class` and `failedStep`, and look at the `screenshot` of the last attempt.
   4. Write or change the journey file. Follow every rule in the README section. If the journey needs a test ID that the app does not have, stop: an app change is the mobile owner's decision.
   5. Try the journey on `iphone-se` first, or on `android-phone` for a journey that runs only on Android (step 7.8). Show these three lines with that device id, and ask: "Try the journey on <device> with these commands? (yes/no)". A yes covers these lines on that device, and `session try` again after each change to the journey file.
      - `node apps/mobile/release-check/cli.mjs session up --device <device>`
      - `node apps/mobile/release-check/cli.mjs session try <journey id>`
      - `node apps/mobile/release-check/cli.mjs session down`

      Run `session up`. When no checked build of the commit exists, it builds one first, which can take 45 minutes. Uncommitted changes to journey files and to the three lists of step 7.9 do not block that build. If it refuses (for example `LOCK_HELD`, `DIRTY_BUILD_INPUTS`, or `HOST_CAPACITY`), show the refusal, and stop.

   6. Run `session try`. It checks every journey file with the journey rules, then runs the journey and prints each step. When it fails, read its failed step, its class, and its screenshot, and act on the class:
      - `selector_not_found`, or a failure that the screenshot shows as a mistake in the journey: change the journey file, and run `session try` again.
      - `missing_search_answer`: do step 7.10.
      - `device_unresponsive`, `driver_failed`, `rate_limited`, or `upstream_error`: run `session try` again with no change.
      - `app_crashed`, `app_unresponsive`, `memory_pressure_kill`, `request_blocked`, or a screenshot that shows wrong app behavior: run `session down`, show the failure to the person, and stop. An app bug or a blocked request is the mobile owner's decision.

      Never remove or weaken a check only to make the journey pass. After 5 failed tries on one device, run `session down`, show the last failure to the person, and stop.

   7. When the journey passes, run `session down`. It runs the log check. If the log check did not pass, show its `findings`, and stop: a write or a search reached production.
   8. Do steps 7.5 to 7.7 again on `ipad-pro-13` and on `android-phone`, but only on a platform that the journey runs on. `session try` does not check this. A journey with the Maestro tag platform:ios or platform:android runs only on that platform, and a journey does not run where `config/screens.json` hides its screens (for example Explore on Android). When you are not sure, leave that platform out here: the partial check in step 7.12 runs the journey on its own devices only. Each device gets its own yes.
   9. Run `node apps/mobile/release-check/cli.mjs check-lists` and `node apps/mobile/release-check/cli.mjs check-screens`. Both must pass. Change only these three lists, and only as the journey needs: in `config/not-tested.json`, remove an entry when the journey now covers it, and add an entry with its platforms and a reason when the journey leaves out a step on purpose (for example a control that opens a web page); add an alert or a native sheet with no test ID to `config/screens.json`, and record search answers in `config/search-answers.json` (step 7.10).
   10. When the journey types a search, it carries the Maestro tag search. When a try fails with the class `missing_search_answer`, run `session down` first, because `record-search` needs the lock that the session holds. If the log check did not pass, show its `findings`, and stop. Then the person starts a local admin with production-like data at `http://localhost:3003`. Show `node apps/mobile/release-check/cli.mjs record-search`, and ask for a yes. It boots test devices, and it checks each result against production. If it refuses, show the refusal, and stop. Then do step 7.5 again on the same device.
   11. Commit only the files that changed: the journey file and each changed list. Name each file in `git add` and in `git commit`. Use a conventional message, for example `fix(mobile): repair the <journey id> journey`. Commit when every device of steps 7.5 to 7.8 passes, not after each try: each new commit needs a new build of each platform before the partial check, about 45 minutes for each platform.
   12. Do step 2 with `run <journey id>`, a partial check on all five devices. It must pass on each device that the journey runs on. When it fails on a device, do steps 7.5 to 7.7 on that device, commit the change, and do this step again. When the label is `flaky` and the session try on that device passes with no change, do not repeat the partial check: show the result to the person, and stop. The mobile owner decides about a flaky journey.
   13. Ask the person before you push. Then push the branch, and open a pull request against main. In its description, give the partial check's `scope`, `result`, and the `label` of the journey on each device. The mobile owner reviews and merges it. Never merge it yourself.

## Notes

- Exit codes of `run`: 0 means that the selected scope passed, 1 means that a run started and failed, and 2 means a refusal before any side effect. Only `scope: "release"` with `result: "pass"` in `summary.json` is a passing release check. Exit 0 alone is not.
- Every failure fails the run: a new failure, a flaky journey, a known bug, a screen list gap, a failed check, and an early stop. The report labels each one.
- The runner needs Maestro 2.11.0. When `plan` names `MAESTRO_VERSION`, the person installs that version, or sets `MAESTRO_BIN` to a 2.11.0 binary, and runs the command again.
- A run uses a lot of memory and CPU. When `plan` names `HOST_CAPACITY`, other work on the Mac must finish first.
- The runner boots simulators and emulators, binds local ports 38211-38213, and writes under `~/Library/Caches/forge-release-check`. When your shell runs commands in a sandbox, run the runner's commands outside it.
