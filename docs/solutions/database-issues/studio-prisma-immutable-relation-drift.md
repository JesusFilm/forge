---
module: Studio authoring
problem_type: database_issue
tags: [studio, prisma, migrations, retention, publication]
---

# Match Studio Prisma metadata to applied immutable relationships

Fresh isolated replay of all102 Admin migrations through0092 succeeded, but the
physical database-to-Prisma diff exposed20 Studio foreign keys that Prisma would
change from SQL's implicit `ON UPDATE NO ACTION` to its implicit `CASCADE`.
The applied migrations intentionally retain immutable identity references; changing
the database to match the Prisma default would weaken that design.

Only affected Studio relations now declare `onUpdate: NoAction`. Render and Mux
job `updatedAt` retain Prisma `@updatedAt` behavior while adding `@default(now())`
to describe the existing SQL `CURRENT_TIMESTAMP` creation default. Watch delivery
uses `@default(dbgenerated("clock_timestamp()"))`, matching migration0085 exactly,
rather than falsely describing transaction-start `now()` semantics.

The actual consumer, `apps/admin/src/services/studio-authoring/watch-delivery.ts`,
inserts only `release_id,phase` via SQL after receiver acknowledgements. The server
fills `delivered_at` at statement execution. No application timestamp or column
optionality changed; generated Prisma client declarations, Admin SDL and typed
GraphQL introspection remain byte-identical after normal regeneration.

The red full diff and green full diff are retained in
`docs/validation/studio-462-release/`. Green has zero Studio/Content Pack statements.
Unrelated inherited drift remains untouched. No generated diff SQL was executed,
no reviewed migration was rewritten, and no retention constraint was weakened.
Partial indexes, triggers and CHECK constraints remain authoritative raw SQL
features; Prisma's diff cannot certify them, so the fresh physical inventory is
retained separately. A zero scoped diff is not complete database equivalence.

When validating an additive feature, prove empty-database replay and generated
contracts separately from physical-schema drift. Compare defaults and referential
actions against intended applied semantics before deciding which side to change.
Never apply a broad generated diff as a cleanup operation.
