# Independent narrow supply review

Fixed base: bb6ed63f30b326f468fd7eb8cdf866a022db8ffe. WIP scope: apps/studio-render/Dockerfile, scripts/stage-codec.mjs, IMAGE.md. Reviewers independently read diff and requirements; no tests/builds/edits performed.

## Standards

No actionable violations. Typed CodecInputError retained; exact archive selection and independent executable verification preserved. Repeated digests at the staging and Docker trust boundaries are a justified small duplication, not a recommended abstraction. Documentation preserves unresolved supply/deployment boundaries. Tooling formatting excluded.

## Spec

No actionable findings. Only the two reviewed archive digests are admitted; exact member roots and both extracted executable digests are checked. Documentation records missing original, forbids relabeling/fabrication, and requires explicit durable retention authorization. Historical mapping failure remains qualified by its earlier environment. Exact-image and deployed acceptance remain outstanding.

This review covers codec supply only, not future packaging fixes or unperformed exact-image runtime acceptance.

## Exact-image evidence follow-up

Independent Spec follow-up against the same fixed base found no actionable factual or acceptance gaps. The reviewer matched export identity, module-resolution evidence and HTTP422/proc EPERM; confirmed incomplete child mask replay and unimplemented bootstrap assessment remain explicit. Worker results were outside this review because its image build was still active.

Independent Standards follow-up against the same base also found no actionable violations. It confirmed empirical claims and explicit limits, retained deployment boundaries, and no new abstraction requirement. Worker results and tooling formatting were excluded.
