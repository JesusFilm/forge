> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# PR 2205 native test host contract

2026-09-09. Fixed base `56258cff495248f8f94e1a57ba5d34643f61af3a`.

The hosted job (run 34281960816, job 102248972948) failed six renderer tests before readiness with empty stderr. The workflow did not install Bubblewrap. Its [exact runner inventory](https://github.com/actions/runner-images/blob/ubuntu24/20260831.293/images/ubuntu/Ubuntu2404-Readme.md) does not list Bubblewrap; absence from this inventory alone is not proof of the full host filesystem. Local Bubblewrap 0.11.1 runs all eight targeted tests successfully. A copied fixture changing only the three fixed `/usr/bin/bwrap` launcher strings to `/nonexistent-studio-ci-bwrap` reproduces exactly six failures/two passes, including the same empty diagnostics. Missing/unexecutable launcher is the supported diagnosis; the original log lacks direct host binary/errno evidence.

The first two attempted private-mount negative probes were **not qualified reproductions**: they returned eight EACCES failures instead of six launcher failures. Both raw logs are preserved. A first copied-fixture invocation also failed pnpm workspace qualification, then was corrected with the repository pnpm 9.12.3 pin; no product conclusion comes from that failure.

## Narrow correction

The renderer-only CI setup installs compiler/build dependencies and distribution Bubblewrap, then builds the existing image's exact upstream 0.11.1 archive after checking SHA256 `c1b7455a1283b1295879a46d5f001dfd088c0bb0f238abb5e128b3583a246f71`. The [upstream release](https://github.com/containers/bubblewrap/releases/tag/v0.11.1) publishes this checksum. This avoids relying on Ubuntu's older command-line feature set. The binary is installed root-owned 0755, without setuid. Tests still run as the normal runner user. Distribution AppArmor profiles, namespace policies and all sandbox flags remain unchanged. No globally disabled AppArmor/sysctl workaround exists.

Package test admission now requires the exact executable/version and a real private PID1 namespace probe using the required namespace flags and Python3. Missing binary, version mismatch or denied namespaces fails before fixtures with an actionable diagnostic; it never silently skips tests. A future host-policy incompatibility must fail and be investigated. This is **test host** admission, not aggregate cgroup or actual-image acceptance.

CodeQL annotation 102248731414 identified a temporary filesystem path interpolated into generated preview preload JavaScript. The preload is now static source and reads that path from a dedicated child environment variable. Clock advancement and native HTTP expiry/range behavior are unchanged; no suppression or product authority change.

## Validation

- Failure-first missing-prerequisite and denied-namespace tests retained, then 2/2 pass.
- Actual local native preflight passes. Baseline targeted suite 8/8 passes; missing-launcher copied-fixture reproduction 2 pass/6 fail.
- Renderer package: startup Vitest passes; native/VM suite 49 pass, 0 fail, existing 10 artifact-dependent skips unchanged. No runtime image or prior full-length proof repeated.
- Preview native server suite: 2/2 pass (builds its own server, loopback fixture).
- Preview typecheck and targeted ESLint pass; shell syntax and actionlint 1.7.7 pass.

The installer was not executed against this shared development host. No hosted workflow was dispatched and no hosted installation or CodeQL-green claim is made. Root owns the next CI push/run. No VM/provider/production operation occurred.
