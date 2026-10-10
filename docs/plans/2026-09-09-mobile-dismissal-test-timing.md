# Bounded mobile dismissal assertion timing correction

Fixed base: `009cad4283515fb823568473f6a1ee6026aae9a1`. Source/test unchanged from main; observed CI run 34283722315 job 102254581297 has 2965 passing tests and one top-corner dismissal assertion failure. The aggregate worker warning has no attributed cause.

Use frozen owned mobile dependencies. Reproduce the intermediate-frame disappearance by delaying only observation beyond the existing dismissal completion deadline; preserve exact temporary probe as inert evidence. In the affected case only, enable fake timers before mount, retain fade and translation assertions, advance time explicitly and assert completed teardown. No product code, timeout increase, blanket mock, broad suite, native build, external operation or CI rerun. Run focused PlaybackHost test, changed-file lint and mobile types; independent fixed-base review and normal hooks; one local implementation-only commit.

Root additionally authorized the next CI schema-step failures in candidates/profile-candidate.db.test.ts and profiles/profile-projection.service.db.test.ts. Reproduce those exact two files, supply omitted Studio visibility fixture tables/views, add canonical profile visibility proof, inspect other isolated callers of the same predicate, and preserve production queries/migrations. No broad recommendation or mobile suite rerun.
