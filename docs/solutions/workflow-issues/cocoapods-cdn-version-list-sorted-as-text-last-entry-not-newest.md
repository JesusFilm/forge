---
title: "The CocoaPods CDN version list is sorted as text, so its last entry is not the newest version"
date: "2026-10-23"
category: workflow-issues
module: apps/mobile
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Checking whether a CocoaPods pod version is published before a plan, a podspec, or a Podfile depends on it"
  - "Reading a cdn.cocoapods.org all_pods_versions shard file, or the versions array of the CocoaPods trunk API"
  - "Choosing between a trunk pod and a release podspec URL for a native iOS SDK"
symptoms:
  - "The last version on a pod's line in the CDN shard file is older than the pod's real newest release"
  - "A plan says that a pod version is missing from CocoaPods, but `pod install` resolves that version from trunk"
root_cause: incorrect_assumption
tags:
  - cocoapods
  - ios
  - dependency-version
  - cdn
  - trunk
  - podspec
  - registry-lookup
---

# The CocoaPods CDN version list is sorted as text, so its last entry is not the newest version

## Context

On 2026-10-20, a planning step for mobile Mux Data checked whether `Mux-Stats-AVPlayer` 4.17.0 was published on CocoaPods. It read the pod's line in the CDN shard file `https://cdn.cocoapods.org/all_pods_versions_b_2_8.txt` and took the last version on that line, 4.9.0, as the newest one.

The wrong fact spread:

- The plan said that the CDN "stops at 4.9.0". It chose release podspec URLs through `expo-build-properties` `ios.extraPods`, and designed a guard to pin those URLs.
- A risk row said that the CocoaPods trunk read-only date had no effect on the work, because the pods came from podspec URLs.
- A chat answer repeated the fact during a discussion about a move from CocoaPods to SPM.

On 2026-10-21, `pod install` resolved `Mux-Stats-AVPlayer` 4.17.0 and `Mux-Stats-Core` 5.14.0 from trunk (`Podfile.lock` lists both under `SPEC REPOS: trunk`). The plan was corrected in KTD9 and in its appendix (`docs/plans/2026-10-20-1530-feat-mobile-mux-data-plan.md`).

## Guidance

The shard file lists each pod's versions sorted as text, not as version numbers. So `4.9.0` comes after `4.17.0`, and `2.10.0` comes before `2.2.0`. The last entry on the line is the last one in text order, not the newest release. The `versions` array of the trunk API (`https://trunk.cocoapods.org/api/v1/pods/<pod>`) is not sorted by version either. Its text order differs a little from the shard file's, but for `Mux-Stats-AVPlayer` it also ends at 4.9.0.

Use one of these checks instead:

1. **Sort the list as versions** with `sort -V`.
2. **Ask trunk:** `pod trunk info <pod>` lists every published version with its date. Check whether the version is in the list; do not rely on the list order.
3. **Check one version directly:** request its podspec path on the CDN. The path is `Specs/<a>/<b>/<c>/<pod>/<version>/<pod>.podspec.json`, where `a`, `b`, and `c` are the first three hex characters of the MD5 hash of the pod name. HTTP 200 (after a redirect) means published, and 404 means not published.
4. **Final proof:** run `pod install`, then read `Podfile.lock`. A pod under `SPEC REPOS: trunk` came from trunk, not from a podspec URL.

## Why This Matters

One misread produced a workaround that the app did not need, a guard designed around it, a wrong risk assessment, and a wrong answer in a tooling discussion. The wrong value looks correct: 4.9.0 is a real release, so nothing in the output shows an error.

CocoaPods trunk becomes read-only on 2026-12-02. Checks of "is this version on trunk" will therefore come up again for every iOS SDK that the app adds or updates.

## When to Apply

- Before a plan, a podspec, or a Podfile states that a pod version is or is not on CocoaPods.
- Whenever a script or a research step reads a CocoaPods version list.
- Before choosing a release podspec URL over a trunk pod. Choose the podspec URL only after one of the checks above shows the version is missing from trunk.

## Examples

```bash
# The shard file name: the first three hex characters of md5(pod name).
printf %s Mux-Stats-AVPlayer | md5 | cut -c1-3
# b28  ->  https://cdn.cocoapods.org/all_pods_versions_b_2_8.txt

# Wrong: the last entry of the line is the last one in text order.
curl -s https://cdn.cocoapods.org/all_pods_versions_b_2_8.txt \
  | grep '^Mux-Stats-AVPlayer/' | tr '/' '\n' | tail -1
# 4.9.0

# Right: sort the versions as versions.
curl -s https://cdn.cocoapods.org/all_pods_versions_b_2_8.txt \
  | grep '^Mux-Stats-AVPlayer/' | tr '/' '\n' | sed 1d | sort -V | tail -1
# 4.17.0

# Right: check one version directly (404 when the version does not exist).
curl -s -L -o /dev/null -w '%{http_code}\n' \
  https://cdn.cocoapods.org/Specs/b/2/8/Mux-Stats-AVPlayer/4.17.0/Mux-Stats-AVPlayer.podspec.json
# 200
```

On Linux, use `md5sum` in place of `md5`. These outputs were checked on 2026-10-23.

## Related

- `docs/plans/2026-10-20-1530-feat-mobile-mux-data-plan.md`: KTD9 and the appendix note "iOS, install" carry the dated correction.
- `docs/solutions/workflow-issues/git-grep-e-backslash-escapes-make-removal-greps-vacuous.md`: the same class of failure, where a lookup gives a confident wrong answer.
- `docs/solutions/best-practices/mocked-shape-vs-real-contract-discipline-20260506.md`: hold an empirical platform claim at its own layer before a design decision depends on it.
- `docs/solutions/build-errors/expo-doctor-affected-gated-live-registry-drift-20260817.md`: another registry-state read in mobile dependency work.
- `docs/solutions/build-errors/mmkv-memset-s-xcode-26.md`: CocoaPods version resolution in the same app.
- `docs/solutions/integration-issues/mux-native-sdks-send-downloaded-video-local-file-path.md`: the same feature, which uses the trunk pods.
