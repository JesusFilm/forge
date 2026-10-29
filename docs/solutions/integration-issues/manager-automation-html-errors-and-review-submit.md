---
title: "Manager automation HTML errors and premature review submission"
date: "2026-10-28"
module: "Manager Agents"
problem_type: "integration_issue"
component: "automation_creation"
tags: [manager, automations, json, react, forms]
---

# Manager automation response and review boundaries

A production screenshot showed `Unexpected token '<', "<!DOCTYPE " ... is not valid JSON` while creating a source-subtitle automation. The client parsed every response as JSON. Authentication and language validation were outside the creation handler's catch block, so a failure could bypass its JSON envelope. HTML may also come from an upstream proxy or login redirect; the screenshot alone does not identify which layer produced it. The production page required login in the available browser, so its original failing network response was not captured.

The current non-mock automation store also calls the deliberately removed Strapi client. Admin has no replacement enrichment automation contracts, candidate read model or scheduler. Treat this as missing functionality, with a clear HTTP 503 message and manual Report enrichment as the available alternative. Do not point old Strapi operations at Admin or add local production persistence. Restoration is tracked in feat-907.

`apps/manager/src/features/agents/automation-api.ts` checks response content type and handles invalid JSON without exposing parser internals, preserving structured API error messages. The creation/list routes keep authentication and all backend reads inside the JSON error boundary.

Browser verification exposed a separate form issue: React reused the footer button when moving from rules to review. The navigation click changed that same DOM node from `type="button"` to `type="submit"` before the browser's default action, which immediately submitted. Distinct `advance` and `create` keys keep separate DOM nodes. The submit handler also rejects pre-review submissions and submissions while already pending.

Verification on local mock Manager:

- Before the key fix, clicking Review launch immediately issued a create request.
- After the fix, Review launch issued zero POSTs; the final Create automation click issued exactly one.
- Injected HTML HTTP 502 retained the dialog and displayed a useful response error without `Unexpected token`.
- Injected JSON HTTP 503 displayed the unavailable-backend message.
- Restoring the real mock request created the automation, updated the list and closed the dialog.
- A real local non-mock POST for the screenshot configuration returned JSON HTTP 503 with the explicit unavailable message. This used dummy local credentials and did not contact production.
- Three warm local development navigations before/after each had 22 initial resources and no initial API calls. Median load event time was 61 ms before and 57 ms after. Development timings are a small-sample smoke check, not a production Web Vitals result.

When repairing a parser symptom, inspect both the response producer and the event that triggers the request. A valid mock happy path cannot establish that the production backend exists.
