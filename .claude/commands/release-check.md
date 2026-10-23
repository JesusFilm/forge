Run the mobile release check. The runner builds the app from the current commit, runs the fixed journeys on its own five test devices behind a local read-only server, and writes a local report. The runner is `apps/mobile/release-check/cli.mjs`. This command only asks for consent, starts the runner, and summarizes the report. Read `apps/mobile/release-check/README.md` for the full guide.

`$ARGUMENTS` selects one mode. Accept only these forms:

- empty or `plan`: show the consent text, and start nothing.
- `run`: a full release check.
- `run <journey ids>`: a partial check of the journeys you name, separated by commas, for example `run cold-launch-home`. A partial check is not a release result.
- `status`: show the state of the newest run.
- `stop`: stop the running check.
- `recover`: clean up after a runner that stopped before it wrote its report.
- `setup`: check the Mac's tools and the five test devices, and create what is missing.

For any other value, show this list and stop. Pass no other flag to the runner.

## Rules

- Never call `maestro` yourself. Never boot, stop, erase, or install on a simulator named `Forge RC …` or an emulator named `forge_rc_…`. The runner is the only way to drive them.
- Never edit a file in `apps/mobile/release-check/config/`. The mobile owner changes the lists through a commit.
- Give no release decision. Report what the summary says. The mobile owner decides the release and tells the QA engineers.
- A yes covers only the exact command line that you showed. When anything changes (a new commit, a new plan, other journeys), show the plan again and ask again.
- Read the plan, the run state, and the result from the JSON output (`plan --json`, `status --json`, and `summary.json`), not from the text.
- Run every command from the repo root.

## Steps

1. **Plan.** Run `node apps/mobile/release-check/cli.mjs plan --json` one time. Show its `text` field to the person without changes. Then read `refusals`, `runCommand`, `commit`, `estimate`, and `setup` from the same output. The text and these fields come from one reading of the Mac, so they agree. Do not run `plan` without `--json`. For `plan`, stop here.

2. **Run** (`run` or `run <journey ids>`):
   1. For a partial check, check each journey id against `^[a-z0-9-]+$`. If an id does not match, show it, and stop. Also stop when `apps/mobile/release-check/journeys/<id>.yaml` does not exist, because the runner finds an unknown id only after the yes.
   2. Do step 1.
   3. If `refusals` is not empty, list each refusal with its `code` and `message`, and stop. Do not ask for a yes. A refusal that names a command (for example a Maestro install) tells the person what to do; the person runs it, then asks again.
   4. Make the command line: take `runCommand` exactly, add ` --journey <journey ids>` for a partial check, and add ` --detach`. Show this exact line.
   5. Ask: "Start the release check with this command? It takes <estimate> for a full check. (yes/no)". Use `estimate.text` for <estimate>. If the line has `--allow-setup`, also say that the run first downloads each item of `setup.downloads` (its `package`, about `approxMb` MB). Also say that it creates each device in `setup.createsDevices`. For a partial check, say that it is a partial check and not a release result. Accept only a clear yes. On any other answer, stop.
   6. Run that exact line. It prints `{ "runId", "runDir" }` and returns at once, because a full check takes about 2.5 to 3 hours. If it prints a refusal and exits with 2, show the refusal and stop.
   7. Wait for the run to end with the harness's own wait mechanism, not with repeated tool calls. For example, start this loop as a background shell command:

      ```sh
      start=$(date +%s)
      until [ -f "<runDir>/summary.md" ] ||
        node apps/mobile/release-check/cli.mjs status --json | node -e '
          const run = JSON.parse(require("fs").readFileSync(0, "utf8")).run
          const late = Date.now() / 1000 - Number(process.argv[2]) > 900
          const ended = run && run.runId === process.argv[1] &&
            (run.summaryMd || ["ended", "refused"].includes(run.phase) ||
              run.pidState === "ended" || (run.phase === "starting" && late))
          process.exit(ended ? 0 : 1)' "<runId>" "$start"
      do sleep 60; done
      ```

      The loop ends when `summary.md` exists, or when `run.phase` is `ended` or `refused`. It also ends when `run.pidState` is `ended`, or when `run.phase` stays `starting` for 15 minutes.

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
      - The build check, the log check, and the settings probe: `passed` in `checks.build`, `checks.log`, and `checks.settingsProbe`. A null check did not run. Then the screen list gaps in `checks.screens.gaps`.
      - Each item of `staleKnownBugs`, with its `journey` and `ticket`.
      - Each item of `server.rateLimitRefusals`, with its `field`, `journey`, `deviceId`, and `causedFailure`.
      - Each item of `proposedActions`, with its `type` and `reason`, and its `journey` or `screen` when it has one. Give these only as proposals. The mobile owner decides each one and commits the list change.

      Give the run folder path. Tell the person that they can share the report as a zip of the run folder, or by pasting `summary.md`.

3. **Status.** Run `node apps/mobile/release-check/cli.mjs status`, and show its text. If it shows no run folder, stop. Otherwise do step 2.8.

4. **Stop.** Run `node apps/mobile/release-check/cli.mjs status`, and show its text. Show the line `node apps/mobile/release-check/cli.mjs stop`. Ask: "Stop the running release check with this command? (yes/no)". On a clear yes, run that line. It stops the run through the same end path as every other run and prints the path of `summary.md`. Then do step 2.9 with that run folder. If `stop` exits with 1, the run did not write `summary.md` in time. Do step 2.7 and step 2.8 for the run that `status` showed. If `stop` refuses and names `recover`, do step 6.

5. **Setup.** Run `node apps/mobile/release-check/cli.mjs setup --check`, and show its text. Exit 1 means that setup must run or that a tool is missing. It is not a runner fault. If it names a problem with a command, show the command; the person runs it. If it would create test devices or download images, show what it would do and the download size. Ask for a yes for `node apps/mobile/release-check/cli.mjs setup`, and run it on a clear yes.

6. **Recover.** Use this step when `status` shows a stale lock, or when step 2.8 finds a runner that stopped with no report. Run `node apps/mobile/release-check/cli.mjs status`, and show its text. Show the line `node apps/mobile/release-check/cli.mjs recover`. Ask: "Clean up after the stopped runner with this command? It stops the runner's own test devices and writes a report with stop reason `runner_killed`. (yes/no)". On a clear yes, run that line. If it refuses, show the refusal and stop. If its output names a `Summary:` path, do step 2.9 with that run folder. Otherwise show its text, and tell the person to read `runner.log` and `events.jsonl` in the run folder.

## Notes

- Exit codes of `run`: 0 means that the selected scope passed, 1 means that a run started and failed, and 2 means a refusal before any side effect. Only `scope: "release"` with `result: "pass"` in `summary.json` is a passing release check. Exit 0 alone is not.
- Every failure fails the run: a new failure, a flaky journey, a known bug, a screen list gap, a failed check, and an early stop. The report labels each one.
- The runner needs Maestro 2.11.0. When `plan` names `MAESTRO_VERSION`, the person installs that version, or sets `MAESTRO_BIN` to a 2.11.0 binary, and runs the command again.
- A run uses a lot of memory and CPU. When `plan` names `HOST_CAPACITY`, other work on the Mac must finish first.
- The runner boots simulators and emulators, binds local ports 38211-38213, and writes under `~/Library/Caches/forge-release-check`. When your shell runs commands in a sandbox, run the runner's commands outside it.
