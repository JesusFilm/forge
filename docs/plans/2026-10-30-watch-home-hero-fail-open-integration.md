# Watch home hero failure isolation (feat-633)

## Scope

Integrate PR #2628 with main `067a1c27b53590db9d384b608e0a352b7847e090`.
Keep hero/body/message requests parallel; isolate resolved hero failures only.
Preserve audience, locale, chrome, structured data, missing-home redirects,
preview/recovery and legacy schema/category behavior. No player/schema changes.

## Work and review

1. Reproduce loss of a healthy authored body in both actual route functions
   using current-main source and the offered route regressions.
2. Retain the empty hero model when independent authored content survives.
   Exercise the actual renderer with hero-only and empty/filtered rails before
   deciding whether additional fallback classification is necessary.
3. Verify root/localized fault matrix, SSR, language/main/metadata contracts,
   focused lint/format/type checks and roadmap generation/identity checks.
4. Capture bounded paired fixture loading/browser evidence where available;
   label mocks and runtime gaps. Self-review and record durable conclusions.

## Publication

Leave an immutable unpublished candidate. Parent obtains independent review.
Historical CI and the old 106-test claim do not validate this integration.

## Results and self-review

The actual merge conflicted on both `heroModel` prop sites and the generated
README. Main's audience props and all other current source/policies survive.
The two original route regressions fail on exact main; ten real-renderer edge
cases fail with the offered array-length guard. The integrated repair passes
263 scoped tests. The fallback classifier changes only resolved-error behavior;
empty successful responses and missing localized-home redirects retain their
existing decisions. A static legacy category rail is independent content.

Known limit: this is a conservative classification of known synchronous empty
paths, not a complete section validator or an asynchronous availability promise.
The issue's proposed Suspense isolation of a slow hero remains outside this PR.
Local fixture/browser results do not establish production loading acceptance.

## Independent review follow-up: fixed-header clearance

Review R1-2628-001 found that the empty fallback carousel returns no height,
leaving the restored first rail underneath the fixed header on the supplied root
and Spanish desktop captures. This is a failure-state layout gap, not a new
query failure. Both routes now explicitly identify resolved hero failure, and
the shared renderer reserves responsive header clearance only for that state,
including safe-area and compact-landscape treatment. Healthy and successful
empty-hero behavior keep the existing layout. No query, player, listener,
client boundary or resource priority changes.

The roadmap ticket is reopened while acceptance is pending. Route wiring
regressions fail on the previous tree. Fresh scoped validation, desktop/mobile
geometry, CTA hit-testing, keyboard visibility, a healthy nonempty-hero control
and bounded loading comparison must validate this changed tree. The original
263-test and browser receipts remain evidence for their original tree only.

The updated nine-file suite passes all 263 tests on pinned Node 24.22.1, plus
Web typecheck, scoped ESLint/Prettier and whitespace checks. Five route signal
assertions failed on the prior source and pass with the explicit error state.
These checks do not measure CSS geometry; browser verification remains pending.
