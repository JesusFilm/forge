---
title: "Gate recommendation trials on the actual browser parser capability"
date: "2026-09-29"
module: "Watch and Admin Recommendations"
problem_type: "integration_issue"
component: "service_object"
severity: "high"
symptoms:
  - "An already-open Watch tab rejects a newly issued co-watch response"
  - "Parallel app deployments can reject a newly added GraphQL argument"
root_cause: "async_timing"
resolution_type: "code_fix"
tags: [recommendations, graphql, compatibility, experiments, deployment]
---

# Gate recommendation trials on the actual browser parser capability

An older loaded Watch bundle rejects unfamiliar `candidateGenerator` and
`executionMode` values. Updating the deployed site does not replace JavaScript
in existing tabs. Issuing co-watch cards and removing or relabeling them at the
Web boundary would also make persisted issuance disagree with what the viewer
received.

The client now declares the separate `cowatch-mmr-v1` delivery capability. Web
forwards only the recognized value through the optional Admin GraphQL argument.
The earlier `viewing-mode-v1` disclosure header keeps its existing meaning.

`experiment/assignment.ts` checks capability after looking up an existing
assignment, but before admitting a new profile. Incumbent A/A and bundle efficacy
use the same frozen capability-at-enrollment cohort. Calibration for another
cohort cannot authorize it. A later request from an older tab keeps its original
assignment and intent-to-treat membership, and delivery serves the real incumbent
with an explicit unsupported-client fallback. A capable tab can resume the same
challenger arm. Privacy and current study authority remain required.

Ship nullable schema acceptance in a prerequisite PR before the new caller
operation. Verify the normal Admin deployment first. This keeps ordinary parallel
app deployments from producing an unknown-argument failure. Regenerate both SDL
and gql.tada output; a scalar field argument may leave the optimized introspection
file unchanged, so validate both operation documents against the emitted SDL.

Regression coverage belongs at each boundary: header forwarding, missing/unknown
capability enrollment refusal, capable-to-older-to-capable sticky assignment,
truthful fallback extraction, and exact calibration cohort matching. Fixture
results do not establish a production study outcome.
