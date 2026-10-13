# TV cloud development and macOS VM builds

Scope: `apps/tv`, its dedicated workflow, and setup documentation. Track as
feat-696. No PR may be merged without the user's explicit instruction.

Adapt the Cloud → VM Project Setup plugin's iOS template to managed Expo tvOS.
The native workspace is generated, so do not manufacture an empty Xcode project
to satisfy its initializer. Use TV-local helpers/configuration and a tvOS-specific
workflow. Generate native files with `EXPO_TV=1`; preserve the pinned Hermes
override, package declarations, lockfile, native patches and shared source.

Use Release `appletvsimulator` builds with an embedded JavaScript bundle and no
distribution signing. `test tvos` runs the actual TV Jest suite before the native
build and reports it explicitly as Jest, not XCTest or simulator UI testing. This
app has no checked-in shared XCTest target. Reject zero tests and failed results.

Serialize dependency install, prebuild, Pods and native build with the existing
per-user `Library/Caches/HybridBuilder/build.lock`. Require Node 24, pnpm 9.12.3,
Python 3, CocoaPods, full Xcode and an available Apple TV simulator runtime on
the VM. Do not re-register the sample project's runner for Forge.

Verify exact clean source before and after building, the Xcode success marker,
nonempty xcresult, app ZIP integrity, Apple TV simulator platform, app executable,
embedded JavaScript and Top Shelf extension/version parity. Publish the compact
GitHub Jobs API report only after artifact upload succeeds.

Cloud dispatch requires a clean pushed branch and a workflow registered on main.
An explicitly labelled, same-repository PR can validate before merging; fork PRs
must never execute on the persistent runner. Preserve the user's no-merge rule.

Initial external blockers: this cloud environment's proxy denies CONNECT to
`api.github.com` (403, upstream 000). Historical Mac setup identifies an
`utm-ios-builder` for `up-tandem/hybrid-hello-ios`, not authorization for Forge.
Live runner inventory, tvOS runtime and native build remain unverified.

## October 13 local validation

- Frozen TV dependency installation passed twice with Node 24 / pnpm 9.12.3.
- TV Jest: 165 suites / 2,116 tests passed, zero failures or skips. TV typecheck
  and lint passed.
- Helper tests: 31 passed. They exercise dirty/mismatched source rejection,
  platform/extension/bundle integrity, zero/failed Jest results, runner labels,
  missing reports/uploads, pending runs, and private failure diagnostics.
- Managed prebuild generated `JesusFilmWatch.xcodeproj` and its shared scheme
  targeting `appletvos`. CocoaPods must create the workspace on the Mac.
  `JesusFilmWatchTests` is a dangling generated scheme reference, not a project
  target; the workflow explicitly reports Jest rather than claiming XCTest.
- Expo exported a 6.23 MB Hermes bundle and its assets. TV package declarations
  and the lockfile remained unchanged. No live content/device behavior is claimed.
- Repository formatting and `git diff --check` passed.
- The cloud environment draft now contains TV-only install/start instructions
  and the user's explicit no-merge rule. Saving is not publication.

The Mac task history confirms the sample VM/source/runner survived sample-build
cleanup. This is historical evidence only. This cloud session cannot execute on
the Mac; Forge runner authorization and a tvOS runtime remain to be established.
