# TV builds from Codex Cloud

Work on `apps/tv` in the existing cloud checkout. Native Apple TV builds run on
a trusted macOS VM through GitHub Actions. Do not merge any PR unless the user
explicitly requests it. These helpers do not upload to TestFlight or Play.

## Commands

From the repository root:

```sh
./apps/tv/dev doctor
./apps/tv/dev test tvos --builder cloud
./apps/tv/dev build tvos --builder cloud
```

Linux selects `cloud` automatically; macOS selects `local`. The cloud command
requires an exact clean, committed, pushed branch. `dev.project.json` contains
non-secret configuration; `.dev.local.json` stores an optional local builder
preference. `./apps/tv/dev builder cloud` changes only that ignored preference.

`test tvos` runs TV's Jest tests and then builds the Release tvOS simulator app.
It does **not** run XCTest or simulator UI tests. The generated scheme contains
an Expo test-reference placeholder, not a maintained native test suite. The
existing package `build` script only prints guidance; it is not a native build.

The VM bootstraps pinned pnpm dependencies, managed prebuild and CocoaPods under
the shared per-user `~/Library/Caches/HybridBuilder/build.lock`. Prebuild uses
`EXPO_TV=1`, the native `ios/` directory, and Hermes core override `0.81.5`.
It never uses `--clean` to delete a developer's native folder. Any tracked change
caused by bootstrap fails verification; investigate rather than resetting source.

The product is `JesusFilmWatch.app` from `Release-appletvsimulator`. Verification
requires a clean unchanged commit, a successful Xcode build, nonempty xcresult,
ZIP CRC integrity, tvOS simulator Mach-O executables, embedded JavaScript, and
matching app/Top Shelf extension versions. Test actions additionally require
positive passing Jest counts with zero failures; skipped/todo counts stay separate.
This is build evidence, not proof of playback, remote focus or App Group runtime
behavior. Unsigned simulator builds are not installable on a physical Apple TV.

## VM prerequisites and runner registration

The configured labels are `self-hosted`, `macOS`, `ARM64`, `hybrid-ios`. Verify
these against a runner available to **JesusFilm/forge** before using them.
`doctor` prints routing only; it does not establish live runner access.

The historical `utm-ios-builder` served `up-tandem/hybrid-hello-ios`. Its working
setup is preserved. That registration does not authorize Forge. On the same VM,
either authorize an organization runner group for Forge or install a separate
repository runner service (for example `forge-tv-builder`) in a separate
directory. Keep the existing runner and its registration unchanged. All services
sharing the build lock must run as the same logged-in macOS user.

Use Forge's GitHub **Settings → Actions → Runners** instructions. Download the
official ARM64 runner and verify its published checksum. Use a short-lived
registration token without logging or committing it. Do not share Mac passwords
or tokens in chat. Keep the Mac awake and the VM running and logged in.

Verify on the VM:

```sh
xcode-select -p
xcodebuild -version
xcrun simctl list devices available
node --version
corepack pnpm --version
pod --version
python3 --version
df -h .
```

Use full Xcode with its license/first-launch setup completed, an available
**Apple TV / tvOS Simulator** runtime, Node **24**, Corepack, pnpm **9.12.3**, and
CocoaPods. An iPhone-only VM is insufficient. Run pnpm version checks inside the
Forge checkout so Corepack reads the repository pin. No distribution certificate
is needed for this unsigned simulator workflow. The helper does not install
Xcode, runtimes, CocoaPods or the runner itself.

## Workflow bootstrap without merging

`workflow_dispatch` requires `.github/workflows/tvos-vm-build.yml` to exist on
the default branch. A feature-branch push alone does not register it. **Never
merge to bypass this prerequisite without the user's explicit instruction.**

Before merging, an authorized maintainer can add the `tv-vm-build` label to a
trusted same-repository PR to run the workflow against its exact head SHA. This
label opts that PR into subsequent reruns when commits change. Fork PRs are
excluded, and the workflow never uses `pull_request_target`. Both paths preserve
the host-wide lock and verify the source commit.

Cloud needs the existing GitHub authentication plus Contents read, Actions write,
and access to run/jobs APIs. Pushing workflows also needs Contents write and
workflow-update permission. Check these operations separately; successful Git
read does not prove Actions access. Runner inventory additionally requires
administrative visibility; an API 403 alone is not proof that the VM is offline.

The initial Forge cloud environment denied proxy CONNECT to `api.github.com`
with status 403 and no upstream response. Add that required hostname in cloud
environment settings before retrying the API. Preserve existing network rules,
proxy configuration and CA trust. The helpers do not broaden network access.

## Results and pending runs

The final successful workflow step begins `VM evidence: ` and follows both
verification and artifact upload. Cloud validates it through GitHub's Jobs API
and writes `apps/tv/.build-results/cloud-RUN_ID/verification.json`. The report
contains the exact commit, runner, workflow URL, platform, checksum and Jest
counts when requested. This proves VM-side verification, not artifact download.

The workflow's **Artifacts** section retains the simulator ZIP, xcresult,
verification report and logs for seven days. To request a download as well:

```sh
./apps/tv/dev test tvos --builder cloud --download-artifacts
```

A requested download failure remains nonzero even after VM verification succeeds.
The default wait is 600 seconds; `--wait SECONDS` adjusts it. Exit **75** means
pending, not passed. Inspect the existing request/run before dispatching another.
The helper saves a pending request record under `.build-results/`.

Capture complete command output in a private file and preserve the exit code:

```sh
umask 077
log=$(mktemp)
./apps/tv/dev test tvos --builder cloud >"$log" 2>&1
result=$?
printf 'Command exit: %s; private log: %s\n' "$result" "$log"
```

Do not paste raw logs containing signed URLs, tokens or environment values.

## Local validation and content configuration

```sh
corepack pnpm --filter forge --filter @forge/tv... install --frozen-lockfile
python3 -m unittest discover -s apps/tv/scripts/cloud-vm -p 'test_*.py'
corepack pnpm --filter @forge/tv exec jest --ci --maxWorkers=2
corepack pnpm --filter @forge/tv typecheck
corepack pnpm --filter @forge/tv lint
git diff --check
```

The workflow bundles the public Admin endpoint from `.env.example` by default;
repository variable `TV_GRAPHQL_URL` can select another endpoint. It supplies no
fleet bearer, identity or telemetry credentials. Compilation and unit tests do
not prove live content/recommendation access. For simulator runtime QA, follow
`CLAUDE.md`, including `bash scripts/setup-sim-env.sh tv` before launching; use
TV's own authorized fleet configuration and never fabricate or borrow a mobile
production key. Keep credentials in approved settings, never this configuration.

## Implementation provenance

Adapted from the Cloud → VM Project Setup plugin's Python routing, shared lock,
GitHub dispatch and API-report templates. Its iPhone/XCTest initializer was not
run against an invented workspace: Expo generates this project's tvOS workspace.
The adaptation is tested locally; a real Forge VM run is still required before
claiming the cloud-to-VM flow is ready.
