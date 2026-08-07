---
title: "Datadog observability on a React-Native-tvos / Expo app — the completion gotchas"
date: "2026-07-07"
category: best-practices
module: apps/tv
problem_type: best_practice
component: tooling
severity: high
related_components:
  - "apps/tv/src/lib/videoQoe.ts"
  - "apps/tv/src/lib/datadog.ts"
  - "apps/tv/scripts/eas-build-on-success.sh"
  - "apps/tv/scripts/eas-build-pre-install.sh"
  - "scripts/check-patched-deps.mjs"
  - ".mcp.json"
applies_when:
  - "Instrumenting Datadog Mobile RUM + Logs on a react-native-tvos / Expo app"
  - "Writing EAS lifecycle build hooks (pre-install / on-success)"
  - "Registering a hosted Datadog MCP server for agent read access"
  - "Mirroring web analytics signals into a native TV/mobile client for cross-app parity"
tags:
  - datadog
  - observability
  - react-native-tvos
  - eas-build
  - mcp
  - video-qoe
  - pii
  - patched-dependencies
---

# Datadog observability on a React-Native-tvos / Expo app — the completion gotchas

## Context

The TV app (`apps/tv`, React Native tvOS + Expo SDK 54) already had an opt-in Datadog Mobile RUM
skeleton wired (feat-225/226, PR #1434 / #1449). Completing the observability injection (PR #1458)
meant adding the load-bearing pieces that the skeleton deferred: build-time symbol upload and
version stamping via EAS hooks, agent read access via a hosted Datadog MCP, video playback
Quality-of-Experience telemetry, web/TV analytics parity, and a CI guard for the native SDK patch.

Each of those pieces sits on a sharp edge that is invisible until production: an EAS hook that
returns non-zero **fails the entire build**; a hosted MCP's "read-only" toolset still exposes write
tools; a native HLS `PlayerError` string can embed a **signed Mux URL token**; `DdRum.addTiming`
silently measures from the wrong origin; bare-key log attributes **cannot join** a RUM action on a
Datadog facet; `pnpm` only **warns** when a patch key stops matching an installed version; and
tvOS has no Session Replay while the fleet is anonymous, so any web-parity copy-paste risks leaking
PII the web app is allowed to collect but the TV app is not.

This doc captures every one of those edges as an independently-titled sub-learning so the next
person instrumenting a native client — or the next person who bumps the Datadog SDK — does not
re-discover them the hard way.

## Guidance

### 1. EAS build hooks must contain their own failure — no `set -e`, gate every risky write, `exit 0`

EAS lifecycle hooks (`eas-build-pre-install`, `eas-build-on-success`) are wired in
`apps/tv/package.json` and run as shell scripts on the build worker. A **non-zero
exit from any EAS hook fails the whole build** (verified in eas-cli source and noted in the script
headers). Cosmetic / best-effort Datadog steps — the `EXPO_PUBLIC_DATADOG_VERSION` git-SHA stamp
and the dSYM upload — must never be able to abort a good build.

The rules the two scripts follow:

- **Never `set -e`.** Both scripts use `set -uo pipefail` and comment the omission explicitly
  (`set -uo pipefail # deliberately NOT -e`). `-e` would turn a transient upload hiccup or a
  `.env.local` write failure into a red build.
- **Gate every risky write behind its own success test**, don't let it ride the script's exit
  status. In `eas-build-pre-install.sh` the append is `if printf ... >>.env.local; then ...`,
  so a write hiccup degrades to an untagged build instead of aborting.
- **`exit 0` unconditionally at the end** (both scripts) so nothing downstream of the last command
  can leak a non-zero status.
- **Skip cleanly when unprovisioned.** `eas-build-on-success.sh` returns `exit 0` when
  `DATADOG_API_KEY` is unset, so keyless builds pass straight through.
- **`set -u` makes bare substring expansion a build-failure.** `dd_version="${EAS_BUILD_GIT_COMMIT_HASH:-}"`
  takes the `:-` default first, because a bare `${VAR:0:7}` on an unset variable exits non-zero
  under `set -u` — which, by the rule above, fails the whole build.
- **Gate the success log on the ACTUAL result** — this is the subtle one. Do NOT write
  `... upload || echo "failed"` then unconditionally `echo "dSYMs uploaded"`; the success line
  would print even on failure. The fix is an explicit `if/then/else` around the upload:

```bash
# apps/tv/scripts/eas-build-on-success.sh  (AFTER)
if pnpm dlx @datadog/datadog-ci@5.8.0 dsyms upload ios/build 2>&1 | redact; then
  echo "[datadog] dSYMs uploaded"
else
  echo "[datadog] dSYM upload failed (non-fatal)"
fi
```

The RN/Hermes source-map upload sits in the same script under the same rule, each arm with its own
non-fatal `else`: an `npx expo export:embed` re-export into a `mktemp` dir, then
`datadog-ci react-native upload --release-version "$dd_version"`. (It was deferred when this doc
was written and shipped in PR #1483 / feat-227.)

The BEFORE anti-pattern (do not ship this):

```bash
# WRONG — the success echo runs even when the upload failed, and with `set -e`
# the pipe failure would abort the build.
set -e
pnpm dlx @datadog/datadog-ci dsyms upload ios/build || echo "[datadog] upload failed"
echo "[datadog] dSYMs uploaded"   # lies on failure; also unreachable under set -e
```

Three adjacent details in the same scripts. The API key is redacted from all child-process output
via a `redact()` sed filter and `set -x` is explicitly banned around the key. The version stamp is
only attempted when `EAS_BUILD_GIT_COMMIT_HASH` is present, so local builds fall through untagged
rather than writing a bogus version. And **`DD_SITE` for `datadog-ci` is the intake DOMAIN, not the
mobile SDK enum** — the SDK config takes `US1`, but the CI tool needs `datadoghq.com`; passing the
enum resolves to `sourcemap-intake.us1` and fails with `ENOTFOUND`. The same site, spelled two ways
on two surfaces, is an easy silent misconfiguration.

### 2. A hosted Datadog MCP "read-only" toolset is a DENYLIST, not an allowlist — enumerate `omit_tools`

Registering the hosted Datadog MCP in `.mcp.json` with `toolsets=core,error-tracking` does **not**
give you a read-only surface. The toolset selector adds tool _families_; the write tools inside
those families (and adjacent ones) stay exposed unless you explicitly remove them via
`omit_tools`. The shipped URL (`.mcp.json`) therefore carries an explicit denylist:

```jsonc
// .mcp.json — the "datadog" server
"url": "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp?toolsets=core,error-tracking&omit_tools=update_datadog_error_tracking_issue,manage_datadog_error_tracking_issue_comments,create_datadog_notebook,edit_datadog_notebook,upsert_datadog_dashboard"
```

Five write tools are named out: `update_datadog_error_tracking_issue`,
`manage_datadog_error_tracking_issue_comments`, `create_datadog_notebook`,
`edit_datadog_notebook`, `upsert_datadog_dashboard`. Without `omit_tools`, an agent pointed at
`service:forge-tv` for read-only telemetry could create/edit notebooks and overwrite dashboards.

**WHY re-verify on a schedule:** the endpoint is under `/api/unstable/`, so Datadog can add,
rename, or re-scope tools without a version bump. The denylist is only correct for the tool set
that existed when it was written — treat it as staleable and re-check it against Datadog's
`/mcp_server/tools/` reference whenever you touch this file, because a newly-added write tool is
exposed by default the moment Datadog ships it.

### 3. Video playback QoE: six instrumentation rules that keep telemetry honest and PII-free

The QoE accumulator (`apps/tv/src/lib/videoQoe.ts`) is a pure, framework-free module fed by the
existing `expo-video` listeners in `apps/tv/src/components/VideoPlayer.tsx`, with the rebuffer flag
sourced from `apps/tv/src/components/watch/useSessionPlayback.ts`. Six sub-rules matter:

**(a) TTFF is a numeric `ttff_ms` field on a Log — never `DdRum.addTiming`.** `DdRum.addTiming`
measures the interval from the **active RUM view's start**, which is the route view (mounted by
`DatadogRouteTracker`), not the player's mount. That would fold navigation latency into "time to
first frame." Instead, the QoE session records `ttff_ms = round(now − mountAt)` in
`onFirstPlaying()` (`apps/tv/src/lib/videoQoe.ts`) and `VideoPlayer.tsx` emits it as a plain Log.

The rule is scoped to TTFF, not a ban on `addTiming`: a timing whose origin genuinely IS the route
view is the correct use, and TV has two (`SERIES_FIRST_RAIL_READY_TIMING`,
`SHOWCASE_FIRST_FRAME_TIMING`). Ask what the interval is measured FROM. Showcase mode later
re-derived this same law independently for per-excerpt TTFF
(`apps/tv/src/lib/showcaseMode/showcaseTelemetry.ts`), which is a good sign it is the right cut.

```ts
// VideoPlayer.tsx — inside the playingChange listener, first confirmed play
const ttffMs = qoeRef.current?.onFirstPlaying()
if (ttffMs != null) {
  datadogLog.info("video_playback.ttff", {
    content_id: contentIdRef.current,
    ttff_ms: ttffMs,
  })
}
```

The `onFirstPlaying` guard (`firstPlayingRecorded`) makes it fire exactly once per session.

**(b) Rebuffer counting excludes initial load, user seeks, and dub/source swaps — and the swap
guard is token-guarded.** A `statusChange:"loading"` is a _genuine_ rebuffer only when playback has
already started and no seek or source swap is in flight. Three exclusions:

- initial load — gated by `hasStarted`;
- user seeks — the caller early-returns when `seekTargetRef.current !== null` before the rebuffer
  code runs (`VideoPlayer.tsx`);
- dub/source swaps — gated by `sourceSwappingRef`, which is set `true` before `replaceAsync` and
  cleared in `.finally()` **only if the swap's token is still the latest**
  (`useSessionPlayback.ts`). The token guard is essential: two rapid dub changes
  would otherwise let the first swap's settle clear the flag while the second is still loading,
  miscounting the second's spurious `loading` as a real rebuffer.

The gate is extracted as a pure, testable predicate so none of this logic lives inline:

```ts
// videoQoe.ts
export function shouldCountRebuffer(
  hasStarted: boolean,
  isSourceSwapping: boolean,
): boolean {
  return hasStarted && !isSourceSwapping
}
// VideoPlayer.tsx — reached only with seekTargetRef null (guarded above)
if (shouldCountRebuffer(hasStartedRef.current, sourceSwappingRef.current)) {
  qoeRef.current?.onRebuffer()
}
```

**(c) `content_id` is the Mux playback id, never the title.** `VideoPlayer.tsx` seeds it via
`extractMuxPlaybackId(creationSource)` (`apps/tv/src/lib/muxUrl.ts`), which host-anchors on
`stream.mux.com` and reads the first path segment. The title is high-cardinality PII-adjacent free
text; the playback id is a stable, non-sensitive key. The `VideoQoeSummary` type
(`videoQoe.ts`) is documented "numbers/strings/bools only — never a title."

**(d) Sanitize the native error before Error Tracking — strip newlines, strip URL query strings,
cap length.** A native HLS `PlayerError` message can embed the failing **signed Mux URL**, whose
query string carries a token. `sanitizeVideoErrorMessage` (`videoQoe.ts`) collapses newlines
(which would break the flat log line and could smuggle a body fragment), rewrites
`https://…?<token>` to `…?[redacted]`, then caps at 200 chars. It is exported and reused on the
RUM error path:

```ts
// VideoPlayer.tsx — statusChange === "error"
const errorMessage = payload.error?.message
qoeRef.current?.onError(errorMessage)
reportDatadogError(
  errorMessage != null
    ? sanitizeVideoErrorMessage(errorMessage)
    : "video playback error",
  { content_id: contentIdRef.current, origin: "video_playback" },
)
```

**(e) The completion summary is emitted exactly once, on `playToEnd` OR unmount.** `finalize()` is
idempotent (`videoQoe.ts`, guarded by a `finalized` flag). Because **most TV sessions end
via the Back button (unmount), not natural completion**, the unmount cleanup must emit — otherwise
abandonment QoE is never captured. Both paths call `finalize` with the correct reason:

```ts
// VideoPlayer.tsx — unmount cleanup
return () => {
  const summary = qoeRef.current?.finalize("abandoned")
  if (summary != null) datadogLog.info("video_playback.summary", summary)
}
// VideoPlayer.tsx — playToEnd listener
const summary = qoeRef.current?.finalize("ended")
if (summary != null) datadogLog.info("video_playback.summary", summary)
```

Whichever fires first wins; the loser no-ops.

**(f) Every emit goes through `safeDatadogCall` so telemetry can never throw into playback.** The
`datadogLog.*`, `reportDatadogError`, and `reportDatadogAction` wrappers in
`apps/tv/src/lib/datadog.ts` all route through `safeDatadogCall`, which wraps the SDK call in
`try { void call().catch(() => undefined) } catch {}` — swallowing both synchronous throws and
promise rejections. A dead or mis-initialized SDK degrades telemetry to a no-op; it never black-
screens the player.

### 4. Web/TV parity requires attribute NAMESPACING — prefix log attributes with `watch_search.`

For the client-generated `search_request_id` to join the result-click RUM action on the same
Datadog facet, the per-search Log and the click action must use the **same fully-qualified
attribute path** — matching web's canonical `@watch_search.*` shape. Bare-key attributes land on a
different facet and cannot be joined.

**When a bare key is still fine.** This rule is about attributes that must JOIN across surfaces —
web's log and TV's action landing on one facet. TV's own `video_playback.*` QoE attributes
(`content_id`, `ttff_ms`, `rebuffer_count`, …) are deliberately bare: nothing joins them to another
app's events, so the facet cost is nil and the flat names read better in a dashboard. Bare is a
choice you make per attribute, not a mistake — but see the next paragraph for the one case where it
is never safe.

**A second, independent reason to namespace, found later in `apps/mobile` (2026-08-05):** Datadog
reserves `source`, `host`, `service`, `status`, `message`, and `trace_id` as top-level log fields.
A bare attribute using one of those names is not merely un-joinable — it is **dropped on ingest**,
with no error and no visible change to the log. Eight such attributes had shipped in `apps/mobile`
and none had ever been queryable. A namespace prefix makes that collision structurally impossible,
which is why it is the better default even where joinability is not the goal. `apps/tv` is clean
today by habit rather than by any guard; if you add a non-namespaced attribute here, check it
against the reserved list first. Full mechanism, the eight-site audit, and a portable guard test:
[Datadog reserved log attribute name shadowing](../conventions/datadog-reserved-log-attribute-name-shadowing.md).

The per-search Log (`apps/tv/src/lib/search.ts`) prefixes every attribute:

```ts
datadogLog.info("watch_search analytics", {
  "watch_search.outcome": outcome,
  "watch_search.result_count": resultCount,
  "watch_search.latency_ms": Date.now() - startedAt,
  "watch_search.request_type": WATCH_SEARCH_REQUEST_TYPE,
  "watch_search.search_request_id": searchRequestId,
  ...(errorCode ? { "watch_search.error_code": errorCode } : {}),
})
```

The result-click action carries the _same_ `watch_search.search_request_id`
(`apps/tv/src/lib/watchSearchRum.ts`, emitted from
`apps/tv/src/components/search/SearchResultsGrid.tsx` as the custom action
`watch_search.result_clicked`). The correlation id itself is generated client-side
(`apps/tv/src/lib/watchSearchLog.ts`, `crypto.randomUUID` with an RFC4122 v4 fallback because
Hermes lacks `crypto.randomUUID` and we add no dependency), set on resolution alongside the visible
results, and threaded into the click so a click links back to its own search. It is now also sent
to the server as `clientRequestId`, so the same id joins the client facet and the server-side
search trace. `watchSearchRum.ts` also assigns every key by name (never a `{...result}` spread) so
a future `SearchResult` field can't leak, and caps the title at 160 chars.

### 5. `trackInteractions: true` auto-fires RUM tap-actions on D-pad SELECT — give cards a stable low-cardinality name via `dd-action-name`, don't `addAction`

RUM is configured with `trackInteractions: true`
(`apps/tv/src/components/DatadogRum.tsx`), which auto-emits a tap action on every D-pad SELECT
and **names it from the pressed element's `accessibilityLabel`**. Content cards set their
`accessibilityLabel` to the item title, so the raw auto-name would be the (high-cardinality, PII-
adjacent) title. Two things follow:

- Override the action name with a stable, low-cardinality `dd-action-name` on the `Pressable`.
  Because RN's `Pressable` TS types don't declare the prop, the shipped idiom is a spread of a
  bracket-keyed object:

```tsx
// search/ResultCard.tsx
{...{ "dd-action-name": "search-result" }}
// home/HomeCard.tsx           → "home-card"
// search/KeyButton.tsx        → "keyboard-key"  (keeps typed letters out of telemetry)
// watch/AboutSection.tsx      → "about-section"
```

Three variants of the idiom now coexist, and which one a component uses is a design choice, not
drift: the **direct spread** above; a **required prop** on the shared `rails/ThumbCard`, whose
callers pass a per-context name from a noun object (`series-episode`, `film-chapter`,
`upnext-episode`) so one card serves several rails without inventing names inline; and an
**optional conditional spread** on `FocusableCard`'s `ddActionName?` prop, which omits the
attribute entirely when unset rather than emitting an empty name. Eight distinct action names ship
today; the required-prop form is the one to copy when a shared card is reused across contexts,
because it makes forgetting the name a type error.

- **Do NOT also `DdRum.addAction` for the same tap** — that double-counts the interaction (once
  auto, once manual). The one deliberate exception is the search result-click: it fires a _separate_
  custom action (`watch_search.result_clicked`) whose purpose is to carry the join context
  (`result_position`, `search_request_id`) that the auto tap-action cannot. That is supplemental
  correlation data, not a duplicate of the tap.

### 6. Patch-pin CI guard: turn pnpm's silent "stale patch key" WARNING into a hard failure

The tvOS Datadog SDK patch (`@datadog/mobile-react-native@3.5.2`) is load-bearing — it guards two
unguarded WebView refs that otherwise break the tvOS native build. `pnpm` only **warns** when a
`pnpm.patchedDependencies` key stops matching the installed version, so a routine version bump
silently orphans the patch and re-breaks the native build far from the causing commit.

`scripts/check-patched-deps.mjs` closes that gap. It is deliberately **dependency-free** (Node +
`package.json` + `pnpm-lock.yaml` only) so it runs in an **unconditional CI job without a workspace
install**, and its pure `findPatchMismatches()` is exported for unit tests. It searches only the
resolved-package region of the lockfile (`\npackages:` onward) so it doesn't match the
`patchedDependencies` mirror that echoes the same keys back, and `process.exit(1)`s on any
mismatch. CI wires it as its own job that both runs the guard's own test and then the
guard (`.github/workflows/ci.yml`):

```yaml
patched-deps-guard:
  runs-on: ubuntu-latest
  steps:
    - name: Test the patched-deps guard logic
      run: node scripts/check-patched-deps.test.mjs
    - name: Check pnpm patch keys match installed versions
      run: node scripts/check-patched-deps.mjs
```

**WHY unconditional (no `needs`/`affected` gate):** the whole point is to fail at the bump commit,
which may not touch `apps/tv` at all — a monorepo-wide dependency bump. Gating it behind the
affected-services matrix would let the very bump that orphans the patch skip the check.

### 7. PII / parity discipline on an anonymous tvOS fleet — mirror only non-sensitive signals; sample at 100% but normalize cross-app counts

TV mirrors web's non-sensitive signals (content actions, the `watch_search` per-search Log + result-
click action) plus TV-only `video_playback.*` QoE, but deliberately diverges from web on three
privacy/parity axes:

- **No Session Replay, ever.** Replay is unsupported on tvOS (the SDK patch strips the WebView
  tracking refs; SessionReplay/WebViewTracking packages must never be added — see
  `apps/tv/CLAUDE.md` "tvOS SDK patch"). `DatadogRum.tsx` never constructs a replay config.
- **No `setUser` / PII.** The TV fleet is anonymous; there is no user identity to attach, and
  attaching one would invent PII the web app happens to have but TV does not. `DatadogRum.tsx`
  configures `TrackingConsent.GRANTED` with `service: "forge-tv"` and no user call.
- **TV samples 100%, web samples 50%.** `getDatadogRumConfig()` sets `sessionSampleRate: 100`
  (`datadog.ts`, "real TV sessions are comparatively rare, so sample everything"), whereas web
  samples 50%. **Any cross-app dashboard comparing absolute counts must normalize** — a raw
  TV-vs-web session or action count is off by 2x before you even start. And normalizing counts
  assumes the sessions are in the same filtered set to begin with: the `env` tag value must match
  across apps (all tag `env:prod`), or a cross-app `env:prod` dashboard silently drops the app that
  tags a different literal — and no count-normalization recovers rows the filter never returned.
  See [Datadog RUM env tag: unify every app on one canonical value](../conventions/datadog-rum-env-tag-cross-app-canonical-value.md).
  The unification (PR #1665) is not retroactive: data written before it still carries `production`,
  so any dashboard or monitor whose window straddles that change needs `env:prod OR env:production`
  — exactly the silent-drop failure this bullet describes, aimed at your own history.

The through-line: when you copy an analytics signal from a web app into a native anonymous client,
audit it against the client's threat model rather than assuming parity means identical config.

## Why This Matters

Each sub-learning maps to a specific field failure it prevents:

- **Unsymbolicated crashes** — without the dSYM upload hook (and its failure containment), native
  tvOS crash stacks arrive as raw addresses. With `set -e`, the same hook flips a good build red.
- **Broken CI/builds** — an EAS hook that exits non-zero, or a version-stamp write that isn't
  gated, aborts the entire build for a cosmetic step; the `if/then/else` success-log bug quietly
  reports "uploaded" when nothing was.
- **Silent privilege escalation via MCP** — an under-scoped hosted MCP hands an agent notebook/
  dashboard write tools when all you wanted was read access to `service:forge-tv`.
- **Un-joinable dashboards** — TTFF measured from the wrong view origin, or log attributes on a
  different facet than the action they should correlate with, produce numbers that look plausible
  but can't be joined or trusted; miscounted rebuffers (seeks/swaps counted as stalls) corrupt the
  core QoE metric.
- **PII / token leaks** — an unsanitized native `PlayerError` ships a signed Mux URL token into
  Error Tracking; a title-as-content_id or a title-as-action-name ships high-cardinality user-
  facing text; a copied `setUser`/Replay config invents PII on an anonymous fleet.
- **Silently-rotting native patches** — a Datadog SDK bump orphans the load-bearing tvOS patch with
  only a pnpm warning, re-breaking the native build weeks later at a commit that never touched the
  TV app.

## When to Apply

- Instrumenting Datadog Mobile RUM + Logs (or any native crash/telemetry SDK) on a
  react-native-tvos / Expo app.
- Writing any EAS lifecycle build hook (`eas-build-pre-install`, `eas-build-on-success`,
  `eas-build-post-install`) — especially for best-effort/cosmetic steps.
- Registering a hosted MCP server (Datadog or otherwise) that you intend to be read-only.
- Mirroring web analytics/observability signals into a native or anonymous client for cross-app
  parity.
- Adding or bumping any `pnpm.patchedDependencies` entry that a native build depends on.

## Examples

Consolidated before/after and idiom references, all verified in the PR #1458 worktree:

- **EAS hook success-log** — BEFORE: `upload || echo failed` then unconditional
  `echo "dSYMs uploaded"` under `set -e`. AFTER:
  `apps/tv/scripts/eas-build-on-success.sh` (`if upload; then success else failed`),
  `set -uo pipefail`, `exit 0`.
- **MCP denylist** — `.mcp.json` `omit_tools=` names all five write tools out of a
  `toolsets=core,error-tracking` surface.
- **TTFF as a Log field** — `apps/tv/src/lib/videoQoe.ts` +
  `apps/tv/src/components/VideoPlayer.tsx` (`datadogLog.info("video_playback.ttff", …)`),
  not `DdRum.addTiming`.
- **Token-guarded rebuffer gate** — `videoQoe.ts` (`shouldCountRebuffer`),
  `useSessionPlayback.ts` (token-guarded `sourceSwappingRef` clear),
  `VideoPlayer.tsx`.
- **Error sanitization** — `videoQoe.ts` (`sanitizeVideoErrorMessage`), reused at
  `VideoPlayer.tsx`.
- **Once-only summary on abandon-or-end** — `VideoPlayer.tsx` — unmount → "abandoned", playToEnd → "ended", idempotent via `videoQoe.ts`.
- **Namespaced parity attributes** — `apps/tv/src/lib/search.ts` and
  `apps/tv/src/lib/watchSearchRum.ts` both key `watch_search.*`; join key
  `watch_search.search_request_id`.
- **`dd-action-name` spread idiom** — direct spread in `ResultCard.tsx`, `HomeCard.tsx`,
  `KeyButton.tsx`, `AboutSection.tsx`; required prop on `apps/tv/src/components/rails/ThumbCard.tsx`; optional
  conditional spread via `FocusableCard.tsx`'s `ddActionName?`.
- **Patch-pin guard** — `scripts/check-patched-deps.mjs` + unconditional job at
  `.github/workflows/ci.yml`.
- **Parity divergence** — `apps/tv/src/components/DatadogRum.tsx` (no Replay, no setUser,
  `TrackingConsent.GRANTED`) + `apps/tv/src/lib/datadog.ts` (`sessionSampleRate: 100`).

## Related

- `docs/solutions/conventions/datadog-reserved-log-attribute-name-shadowing.md` — the second reason
  to namespace (rule 4): a bare attribute named after a Datadog reserved field is dropped on ingest
  silently. Carries the portable guard test to run here if `apps/tv` ever grows the risk.
- `docs/solutions/integration-issues/datadog-mobile-rum-tvos-integration.md` — the tvOS SDK patch +
  `expo-datadog` plugin exclusion (the injection phase, PR #1434, this doc completes); its
  Prevention flagged the patch-pin CI guard as future work — now implemented here (rule 6).
- `docs/solutions/architecture-patterns/canonical-server-search-analytics-supplemental-rum-pattern.md`
  — the apps/web counterpart of the search-log namespacing, result-click action, and
  query-text-stays-server-side rules (rules 4-5); this doc extends that pattern to TV.
- `docs/solutions/build-errors/eas-managed-react-native-tvos-build-gotchas-20260615.md` — sibling
  apps/tv EAS build/submit gotchas; the EAS-pipeline neighbor to the build-hook containment rule.
- `docs/solutions/tooling-decisions/codex-launchdarkly-hosted-mcp-install-20260527.md` — prior art on
  the hosted-vs-local MCP install decision (precedent for the read-only-denylist trap, rule 2).
- `docs/solutions/security-issues/log-injection-sanitizer-user-input-structured-logs-20260429.md` —
  the general sanitize-before-log rule behind the native-error sanitization (rule 3d).
- `apps/tv/CLAUDE.md` "Observability (Datadog)" — the opt-in gate, action-name privacy, and
  load-bearing patch notes.
- `docs/observability/datadog.md` — TV runbook, "TV ↔ web data parity" table, and "Datadog MCP for
  agents".
