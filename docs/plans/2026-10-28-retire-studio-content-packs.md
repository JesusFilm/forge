# Retire Studio Content Packs (feat-816)

Owner decision: remove the Content Pack concept. Production audit found no usage.

1. Remove the editor library entry and calendar selectors/requests.
2. Remove public GraphQL, RPC and agent discovery/write surfaces.
3. Remove runtime pack resolution from generation, rendering and publication;
   retain exact project source eligibility checks.
4. Make calendar suggestions depend on dates, language and weekly themes; preserve
   version binding, protected work and explicit production/publication review.
5. Delete the models and empty storage tables with a direct schema migration.
   No restoration or data-rewriting migration.
6. Regenerate GraphQL artifacts, validate affected contracts and consumers, and
   record retirement in current domain guidance. Historical evidence stays intact.
