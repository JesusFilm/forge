---
title: Next.js Server Action metadata must be removed before strict form validation
date: 2026-08-11
category: integration-issues
module: apps/admin
problem_type: integration_issue
component: service_object
symptoms:
  - "A valid Admin Watch search comparison returned: Check the comparison inputs and try again"
  - "Direct unit tests passed while every real browser submission failed before Typesense was called"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - nextjs
  - server-actions
  - formdata
  - strict-validation
  - regression-testing
---

# Next.js Server Action metadata must be removed before strict form validation

## Problem

The Admin Watch search comparison form rejected valid browser submissions before search ran. The action converted the complete `FormData` payload with `Object.fromEntries()` and passed it to a strict Zod object schema.

## Symptoms

- The UI returned `Check the comparison inputs and try again` for valid queries.
- Direct action tests passed because their synthetic `FormData` contained only visible application fields.
- Search logs contained no comparison attempt because validation returned early.

## What Didn't Work

- Supporting both the old and new language field names did not fix real submissions. Their application fields were valid, but the framework-owned fields were still unknown to the strict schema.
- Adding the missing production search variables did not affect this error. The action failed before constructing the Typesense comparison service.

## Solution

Remove only Next.js-reserved Server Action metadata before strict application validation:

```ts
function comparisonFormValues(formData: FormData) {
  return Object.fromEntries(
    [...formData.entries()].filter(([key]) => !key.startsWith("$ACTION_")),
  )
}

const parsed = ComparisonFormSchema.safeParse(comparisonFormValues(formData))
```

Keep the schema strict. Ordinary unknown fields must still fail validation.

The regression test should model bound-action fields produced by `useActionState`, such as `$ACTION_REF_0`, `$ACTION_0:0`, and `$ACTION_KEY`. It should also submit a near miss such as `$ACTIONX_metadata` and confirm that the ordinary unknown field is rejected.

## Why This Works

Next.js documents that `Object.fromEntries(formData)` includes extra properties prefixed with `$ACTION_`. Those keys are transport metadata, not user input. Removing the exact reserved namespace lets the strict schema validate only the form's application contract without broadening what user-controlled fields it accepts.

## Prevention

- When a Server Action uses `Object.fromEntries()` with a strict schema, account for the framework's `$ACTION_` namespace explicitly.
- Model the metadata shape emitted by the real action binding, not only the visible form inputs.
- Keep a near-miss unknown-key assertion so a future filter cannot expand to all dollar-prefixed fields.
- Use a built Next.js or browser smoke when claiming the complete Server Action transport path works.

## Related Issues

- [Mocked shape versus real contract discipline](../best-practices/mocked-shape-vs-real-contract-discipline-20260506.md)
- [Public Watch Server Actions require POST-aware edge routing](public-watch-server-actions-require-post-aware-edge-routing.md)
