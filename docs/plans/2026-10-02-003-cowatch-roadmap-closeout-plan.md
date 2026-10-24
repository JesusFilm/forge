# Co-watch and composition roadmap closeout

## Scope and decision

Reconcile content-discovery feat-387, feat-393, feat-565 and feat-573 against
the deployed direct owner release and the October 2 delivery-health policy.
This is a documentation and operational-evidence closeout. Keep the existing CI
workflow unchanged; feat-591 owns separate native database CI wiring. Do not
mutate production or clear immutable revocations.

The approved policy accepts sparse graph coverage and successful incumbent
fallback. Positive co-watch cards and a controlled usefulness study are not
release gates. They remain unobserved and unmeasured, respectively. Refresh is
bounded to one new attempt/publication per 12 hours; safe withdrawal between
attempts is part of that contract, not continuous co-watch influence.

## Work

1. Reuse existing G7 admission and activation receipts. Read only the current
   grant, pointer, release, graph, scheduler, attempt, capacity and a bounded
   natural serving window. Distinguish an activated pointer from executable
   authority and contributed cards.
2. Reconcile G8's first automatic replacement, its later source invalidation,
   the next eligible attempt, and the native test for revocation then recovery.
   Do not optimize receipt reuse without evidence of a real correctness error.
3. Record exact observed facts and limits in the operations record. Resolve
   ticket status from delivered scope: complete implemented direct graph/MMR
   and bounded refresh; cancel unbuilt optional broad slate-composer scope
   without claiming editorial or calibration work happened. Parent owns
   cross-ticket dependencies and generated roadmap index.
4. Review the diff for overstated production proof and contradictory status.
   Run formatting and roadmap metadata checks, commit and open a scoped PR.

## Verification

- Production reads use `BEGIN READ ONLY`, five-second statements and bounded
  request roots. No viewer, request or item identifiers leave the database.
- Native `cowatch/refresh.db.test.ts` covers source revocation, throttled
  fallback, renewed publication and immutable prior revocation.
- Documentation says the next real refresh remains pending and does not claim
  any observed co-watch-contributed card or measured usefulness.
