---
id: "feat-342"
title: "TV device-grant scaffold teardown"
owner: "ekkasit"
priority: "P2"
status: "not-started"
start_date: "2026-09-15"
duration: 2
depends_on:
  - "feat-322"
blocks: []
tags:
  - "platform"
  - "auth"
  - "tv"
---

## Problem

The TV sign-in work (`docs/roadmap/platform/feat-322-tv-auth-sign-in-profile.md` — reference by
path, `feat-322` is a colliding id) shipped two kinds of scaffolding. The first kind died with the
real grant and is already gone from source in the device-grant client PR (plan U4.5):

- the demo stub (`DEMO_PROFILE`, the "Approve on this device (demo)" row) — the phone approval is
  real now;
- the letters/numbers user-code evaluation switch (`userCodeFormatPreference.ts`,
  `USER_CODE_FORMATS`, `USER_CODE_SPECS`, `createPendingSession`) — D2 resolved: the SERVER mints
  the code (`DEVICE_USER_CODE_FORMAT = "numbers"`, ten digits, in
  `apps/auth/src/services/device-grant.service.ts`) and the TV only displays it, so the TV's own
  format choice is moot.

The second kind is what this ticket exists for: scaffolding whose removal trigger had not fired
when that PR merged, **plus one category no merged PR can ever claim**.

**The category no PR can claim.** Deleting `userCodeFormatPreference.ts` removed the code that
_writes_ `forge.tv.user_code_format`. It did **not** remove the key from AsyncStorage on TVs that
already ran a build carrying it — every internal/TestFlight device from the dark-ship period, and
any production device if the flag was ever on. Those installs keep an orphan key forever: nothing
reads it, nothing rewrites it, and no future deploy touches it. It is harmless (a short string in
the app's own sandbox, no PII), so the default resolution is an explicit, dated **no-op decision**
recorded here rather than a migration. The decision must be written down either way — an
undocumented orphan key is how a future reader concludes the teardown was incomplete and goes
looking for code that no longer exists.

## Entry Points — Read These First

1. `apps/tv/src/lib/auth/deviceAuthFlow.ts` — what survived the U4.5 sweep and why. The KEEP-list
   below is binding against this file.
2. `apps/tv/src/lib/auth/profileFlag.ts` + `profileFlagState.ts` — the release gate. **Still live
   when this ticket opens**; step 3 is the only thing that may remove it.
3. `apps/tv/src/components/profile/ProfileScreen.tsx` — `ProfileScreenProps.phase` is optional with
   a signed-out default. That optionality is transitional: it existed so the screen compiled after
   the local minter was deleted and before the grant hook was mounted.
4. `apps/tv/src/lib/safeStorage.ts` — the AsyncStorage wrapper. Read before considering any
   key-cleanup code; the in-memory fallback path means a "cleanup" that assumes a real backend is a
   no-op on some devices anyway.
5. `docs/plans/2026-08-05-001-feat-tv-device-grant-sign-in-plan.md` §U4.5 — the unit this ticket was
   written from, including the KEEP-list it binds.
6. `docs/solutions/workflow-issues/removal-recipe-ticket-for-phase-scoped-scaffolding-20260708.md` —
   why this ticket is shaped the way it is.

## Grep These

Drift-resistant on purpose: patterns and conditionals, not `file:line`. The code moves during a
release phase.

- `forge\.tv\.user_code_format` — must return **zero** source hits anywhere. Any hit means the U4.5
  sweep regressed or a new writer was added.
- `DEMO_PROFILE|createPendingSession|USER_CODE_FORMATS|USER_CODE_SPECS|userCodeFormatPreference` —
  must return zero hits **in `apps/tv`**. Scope matters: `USER_CODE_SPECS` also names the SERVER's
  own private table in `apps/auth/src/services/device-grant.service.ts`, which is the surviving
  source of truth for the code format and must not be swept. Historical mentions in `docs/plans/`
  and `docs/roadmap/` are the record and stay verbatim.
- `EXPO_PUBLIC_TV_PROFILE_ENABLED|isProfileSurfaceEnabled|profileFlagState` — the release gate.
  Every hit is in scope for step 3 and **out of scope until step 3's precondition holds**.
- `ProfileScreenProps|phase\?:` in `apps/tv/src/components/profile/` — the transitional optional
  prop (step 4).
- `DEVICE_VERIFICATION_URL` — the hardcoded production auth host kept as a display fallback
  (step 5).

**Rename covenant.** If any symbol above is renamed, the renaming PR updates these patterns in the
same commit. A removal ticket whose greps have silently drifted is worse than none: it reads as
"already done".

## What To Build

### Step 0 — Preconditions (do not start before all three hold)

- [ ] The device grant is live in **every** `apps/auth` environment and a real Apple TV **and** a
      real Android TV have completed scan → approve → signed-in (feat-322 Verification).
- [ ] A production TV build with `EXPO_PUBLIC_TV_PROFILE_ENABLED=1` has been in the store for at
      least one full release cycle with no sign-in rollback.
- [ ] Admin introspection accepts a TV token with the TV client id visible in logs.

Steps 1–2 may proceed on the first bullet alone. Step 3 requires all three.

### Step 1 — Record the AsyncStorage residue decision (no code)

Write the dated decision into this ticket's Resolution and into `apps/tv/CLAUDE.md` if it lands
anywhere other than "leave it":

- **Default: leave it.** `forge.tv.user_code_format` holds `"letters"` or `"numbers"` in the app's
  own sandbox. No PII, no security value, no size concern, and it is unreachable by any code path.
- **If cleanup is chosen instead**, it is one `removeItem` on a fixed key at launch, guarded so a
  storage failure is silent (the `safeStorage` convention), plus a follow-up to delete that line one
  release later — otherwise the cleanup becomes the next orphan.
- Either way this is an **operator/no-op-migration decision**, not something a PR diff can
  demonstrate. Do not close this ticket claiming a merged PR removed the key from installed devices.

### Step 2 — Confirm the source sweep held

Run the greps above. Zero hits outside `docs/`. This is the cheap regression check that the U4.5
deletion did not partially come back through a revert or a stacked branch.

### Step 3 — Retire the release gate (precondition-gated)

Only once step 0's third bullet holds: remove `EXPO_PUBLIC_TV_PROFILE_ENABLED`,
`apps/tv/src/lib/auth/profileFlag.ts`, `profileFlagState.ts` and every `isProfileSurfaceEnabled()`
call site, making Profile unconditional. Remove the env var from EAS environments **after** the
build that no longer reads it has shipped, never before — the reverse order darkens Profile on every
already-installed device.

### Step 4 — Make the ProfileScreen phase required

Once the grant hook is the only caller, change `ProfileScreenProps.phase` from optional to required
and delete the signed-out default. While it is optional, a wiring regression that stops passing a
phase renders a permanently "Preparing your sign-in code…" screen instead of failing to compile.

### Step 5 — Drop the hardcoded verification host

`DEVICE_VERIFICATION_URL` in `deviceAuthFlow.ts` names the production auth host. The server sends
`verification_uri` per environment; once every environment does, the constant is a way for a
preview build to print a production URL under its QR. Delete it and its display fallback.

## Constraints

**KEEP-list — binding. A naive `git revert` of the U4.5 commit would wrongly delete all of these,
and so would an over-eager reading of this ticket:**

- `apps/tv/src/lib/auth/deviceAuthFlow.ts`'s surviving shapes and RFC 8628 field names —
  `DeviceAuthSession`, `DeviceAuthPhase`, `TvUserProfile`, `formatUserCode`,
  `verificationUrlWithCode`, `isSessionExpired`, `displayVerificationUrl`. The real flow uses these;
  only the local **minter** was scaffolding. `formatUserCode` and `createPendingSession` sat in the
  same file and are easy to confuse — the minter mints, the formatter only groups digits for
  display.
- `apps/tv/src/components/profile/SignInQr.tsx` — the QR renderer is production UI.
- `apps/tv/src/lib/auth/deviceGrantClient.ts`, `deviceGrantMachine.ts`, `tokenStore.ts` — the real
  grant.
- `apps/tv/src/lib/auth/anonymousMerge.ts` and `deviceGrantTelemetry.ts` — account isolation and the
  zero-PII sanitizer. Neither is phase-scoped; both are permanent controls.
- `apps/tv/src/lib/auth/profileFlag.ts` / `profileFlagState.ts` and
  `EXPO_PUBLIC_TV_PROFILE_ENABLED` — kept until **step 3's** precondition holds, then removed by
  step 3 and nothing earlier.

Other constraints:

- Do not "clean up" the AsyncStorage key by enumerating storage keys. `apps/tv` never scans storage;
  `anonymousMerge.ts` documents why (account isolation). A fixed-key `removeItem` or nothing.
- Historical prose stays verbatim. `docs/plans/`, completed roadmap tickets and brainstorms that
  describe the demo stub or the format switch as live are the **record** of a decision, not
  instructions. Do not rewrite them; if one reads as a forward-looking instruction, add a dated
  supersession note next to it instead.
- Do not renumber or rename this ticket's id to resolve the `feat-322` collision; reference tickets
  by path.

## Verification

- `git grep -nE 'DEMO_PROFILE|createPendingSession|USER_CODE_FORMATS|USER_CODE_SPECS|userCodeFormatPreference' -- apps/tv`
  → no output.
- `git grep -n 'forge\.tv\.user_code_format' -- ':!docs'` → no output.
- `pnpm --filter @forge/tv exec jest && pnpm --filter @forge/tv exec tsc --noEmit && pnpm --filter @forge/tv exec eslint .`
- After step 3: an EAS preview build with **no** `EXPO_PUBLIC_TV_PROFILE_ENABLED` set still shows
  Profile (the gate is gone), on both tvOS and Android TV.
- After step 4: deleting the `phase` prop at the call site fails `tsc`, not the render.
- Step 1 is verified by the written decision in this file's Resolution, with a date and an owner —
  **not** by any diff.
